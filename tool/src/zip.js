/* ============================================================================
   zip.js — minimal ZIP reader/writer, no dependencies.
   Reading uses the browser-native DecompressionStream('deflate-raw').
   Writing uses STORE (no compression) — Excel opens these without complaint.
   ========================================================================= */
(function (global) {
  'use strict';

  const te = new TextEncoder();
  const td = new TextDecoder('utf-8');

  /* ---- CRC32 -------------------------------------------------------- */
  let CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
    return CRC_TABLE;
  }
  function crc32(buf) {
    const t = crcTable();
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ t[(c ^ buf[i]) & 0xff];
    return (c ^ -1) >>> 0;
  }

  /* ---- inflate (native) --------------------------------------------- */
  const HAS_DS = typeof global.DecompressionStream === 'function';

  async function inflateRaw(bytes) {
    if (!HAS_DS) {
      throw new Error(
        'This browser cannot decompress .xlsx files (DecompressionStream is unavailable). ' +
        'Please open this file in Microsoft Edge, Google Chrome, or Firefox 113+.'
      );
    }
    const ds = new global.DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(bytes);
    w.close();
    const chunks = [];
    const r = ds.readable.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  /* ---- read --------------------------------------------------------- */
  /**
   * Read a ZIP archive.
   * @param {ArrayBuffer|Uint8Array} data
   * @returns {Promise<Map<string, Uint8Array>>} path -> bytes
   */
  async function readZip(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    // Locate End Of Central Directory (scan backwards; comment may follow).
    let eocd = -1;
    const floor = Math.max(0, u8.length - 66000);
    for (let i = u8.length - 22; i >= floor; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid .xlsx/.zip file (no central directory found).');

    let count = dv.getUint16(eocd + 10, true);
    let cdOff = dv.getUint32(eocd + 16, true);

    // ZIP64 fallback when the 32-bit fields are saturated.
    if (cdOff === 0xffffffff || count === 0xffff) {
      for (let i = eocd - 20; i >= 0; i--) {
        if (dv.getUint32(i, true) === 0x07064b50) {
          const z64 = Number(dv.getBigUint64(i + 8, true));
          if (dv.getUint32(z64, true) === 0x06064b50) {
            count = Number(dv.getBigUint64(z64 + 32, true));
            cdOff = Number(dv.getBigUint64(z64 + 48, true));
          }
          break;
        }
      }
    }

    const files = new Map();
    let p = cdOff;
    for (let n = 0; n < count && p + 46 <= u8.length; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csizeRaw = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      let lho = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));

      // ZIP64 extra field for oversized offsets.
      let csize = csizeRaw;
      if (lho === 0xffffffff || csizeRaw === 0xffffffff) {
        let e = p + 46 + nameLen;
        const end = e + extraLen;
        while (e + 4 <= end) {
          const hid = dv.getUint16(e, true);
          const hsz = dv.getUint16(e + 2, true);
          if (hid === 0x0001) {
            let q = e + 4;
            if (dv.getUint32(p + 24, true) === 0xffffffff) q += 8;   // uncompressed
            if (csizeRaw === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
            if (lho === 0xffffffff) lho = Number(dv.getBigUint64(q, true));
            break;
          }
          e += 4 + hsz;
        }
      }

      // Read the local file header to find where the payload actually starts.
      if (dv.getUint32(lho, true) === 0x04034b50) {
        const lNameLen = dv.getUint16(lho + 26, true);
        const lExtraLen = dv.getUint16(lho + 28, true);
        const start = lho + 30 + lNameLen + lExtraLen;
        const raw = u8.subarray(start, start + csize);
        files.set(name, method === 0 ? raw : await inflateRaw(raw));
      }
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return files;
  }

  /* ---- write (STORE) ------------------------------------------------ */
  /**
   * Build a ZIP archive with stored (uncompressed) entries.
   * @param {Array<{name:string, data:string|Uint8Array}>} entries
   * @returns {Blob}
   */
  function writeZip(entries) {
    const items = entries.map((e) => {
      const bytes = typeof e.data === 'string' ? te.encode(e.data) : e.data;
      return { name: te.encode(e.name), bytes, crc: crc32(bytes) };
    });

    const locals = [];
    const centrals = [];
    let offset = 0;

    // DOS timestamp — fixed value keeps output byte-stable across runs.
    const dosTime = ((12 & 0x1f) << 11) | ((0 & 0x3f) << 5) | 0;
    const dosDate = (((2026 - 1980) & 0x7f) << 9) | ((1 & 0x0f) << 5) | 1;

    for (const it of items) {
      const lh = new Uint8Array(30 + it.name.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);          // version needed
      lv.setUint16(6, 0x0800, true);      // UTF-8 filename flag
      lv.setUint16(8, 0, true);           // method = store
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, it.crc, true);
      lv.setUint32(18, it.bytes.length, true);
      lv.setUint32(22, it.bytes.length, true);
      lv.setUint16(26, it.name.length, true);
      lv.setUint16(28, 0, true);
      lh.set(it.name, 30);
      locals.push(lh, it.bytes);

      const ch = new Uint8Array(46 + it.name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, it.crc, true);
      cv.setUint32(20, it.bytes.length, true);
      cv.setUint32(24, it.bytes.length, true);
      cv.setUint16(28, it.name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(it.name, 46);
      centrals.push(ch);

      offset += lh.length + it.bytes.length;
    }

    const cdSize = centrals.reduce((a, c) => a + c.length, 0);
    const eo = new Uint8Array(22);
    const ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, items.length, true);
    ev.setUint16(10, items.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    return new Blob([...locals, ...centrals, eo], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  global.FZip = { readZip, writeZip, crc32, hasNativeInflate: HAS_DS };
})(typeof window !== 'undefined' ? window : globalThis);
