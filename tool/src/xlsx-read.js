/* ============================================================================
   xlsx-read.js — read .xlsx into plain JS grids. Depends on FZip.
   Output shape:
     { sheets: [ { name, index, nrows, ncols, cells, merges } ], byName: {} }
   `cells` is a 1-based 2-D array: cells[row][col] = {v, t, f} | undefined
     v : value  (number | string | boolean | Date | null)
     t : 'n' | 's' | 'b' | 'd' | 'e'
     f : formula source without '=' (when present)
   ========================================================================= */
(function (global) {
  'use strict';

  const td = new TextDecoder('utf-8');
  const parser = new DOMParser();

  function xml(bytes) {
    const doc = parser.parseFromString(td.decode(bytes), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Malformed XML inside the workbook.');
    }
    return doc;
  }

  /* A1 -> {r, c} (both 1-based) */
  function refToRC(ref) {
    let c = 0, i = 0;
    while (i < ref.length) {
      const ch = ref.charCodeAt(i);
      if (ch < 65 || ch > 90) break;
      c = c * 26 + (ch - 64);
      i++;
    }
    return { c, r: parseInt(ref.slice(i), 10) || 0 };
  }

  function colLetter(n) {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = (n - 1 - m) / 26;
    }
    return s;
  }

  /* Excel serial -> Date (UTC-based, 1900 system incl. the historical leap bug) */
  function serialToDate(n) {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    let days = Math.floor(n);
    const frac = n - days;
    if (days > 60) days -= 1;              // skip the fictitious 1900-02-29
    const ms = Date.UTC(1899, 11, 31) + days * 86400000 + Math.round(frac * 86400000);
    return new Date(ms);
  }

  const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

  function looksLikeDateFormat(code) {
    if (!code) return false;
    // Strip quoted literals, escapes, colours and locale hints before sniffing.
    const s = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
    return /[ymdhs]/i.test(s) && !/^(general)$/i.test(s.trim());
  }

  function parseStyles(files) {
    const dateXf = new Set();
    const bytes = files.get('xl/styles.xml');
    if (!bytes) return dateXf;
    let doc;
    try { doc = xml(bytes); } catch { return dateXf; }

    const custom = new Map();
    for (const n of doc.getElementsByTagName('numFmt')) {
      custom.set(parseInt(n.getAttribute('numFmtId'), 10), n.getAttribute('formatCode') || '');
    }
    const cellXfs = doc.getElementsByTagName('cellXfs')[0];
    if (!cellXfs) return dateXf;
    const xfs = cellXfs.getElementsByTagName('xf');
    for (let i = 0; i < xfs.length; i++) {
      const id = parseInt(xfs[i].getAttribute('numFmtId') || '0', 10);
      if (BUILTIN_DATE_FMT.has(id) || looksLikeDateFormat(custom.get(id))) dateXf.add(i);
    }
    return dateXf;
  }

  function parseSharedStrings(files) {
    const out = [];
    const bytes = files.get('xl/sharedStrings.xml');
    if (!bytes) return out;
    const doc = xml(bytes);
    for (const si of doc.getElementsByTagName('si')) {
      // Concatenate every <t>, skipping ruby/phonetic annotations.
      let s = '';
      for (const t of si.getElementsByTagName('t')) {
        const pn = t.parentNode && t.parentNode.nodeName;
        if (pn === 'rPh' || pn === 'phoneticPr') continue;
        s += t.textContent;
      }
      out.push(s);
    }
    return out;
  }

  function sheetTargets(files) {
    /* name -> zip path, in workbook order */
    const wbBytes = files.get('xl/workbook.xml');
    if (!wbBytes) throw new Error('Not a valid .xlsx workbook (xl/workbook.xml missing).');
    const rels = new Map();
    const relBytes = files.get('xl/_rels/workbook.xml.rels');
    if (relBytes) {
      for (const r of xml(relBytes).getElementsByTagName('Relationship')) {
        rels.set(r.getAttribute('Id'), r.getAttribute('Target'));
      }
    }
    const out = [];
    for (const sh of xml(wbBytes).getElementsByTagName('sheet')) {
      const name = sh.getAttribute('name');
      const state = sh.getAttribute('state') || 'visible';
      const rid =
        sh.getAttribute('r:id') ||
        sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = rels.get(rid) || '';
      target = target.replace(/^\/xl\//, '').replace(/^\//, '').replace(/^xl\//, '');
      let path = 'xl/' + target;
      if (!files.has(path)) {
        // Fall back to positional guess when relationships are unusual.
        const guess = `xl/worksheets/sheet${out.length + 1}.xml`;
        if (files.has(guess)) path = guess;
      }
      out.push({ name, state, path });
    }
    return out;
  }

  function parseSheet(bytes, sst, dateXf) {
    const doc = xml(bytes);
    const cells = [];
    let nrows = 0, ncols = 0;

    for (const row of doc.getElementsByTagName('row')) {
      const rAttr = parseInt(row.getAttribute('r') || '0', 10);
      let rIdx = rAttr;
      const cs = row.getElementsByTagName('c');
      let autoCol = 0;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        const ref = c.getAttribute('r');
        let rc;
        if (ref) rc = refToRC(ref);
        else rc = { r: rIdx || 0, c: ++autoCol };
        if (!rc.r) rc.r = rIdx;
        autoCol = rc.c;
        rIdx = rc.r;

        const t = c.getAttribute('t') || 'n';
        const sIdx = parseInt(c.getAttribute('s') || '-1', 10);
        const fEl = c.getElementsByTagName('f')[0];
        const vEl = c.getElementsByTagName('v')[0];

        let value = null, type = 'n';
        if (t === 's') {
          const k = vEl ? parseInt(vEl.textContent, 10) : -1;
          value = sst[k] != null ? sst[k] : null;
          type = 's';
        } else if (t === 'inlineStr') {
          const is = c.getElementsByTagName('is')[0];
          value = is ? Array.from(is.getElementsByTagName('t')).map((x) => x.textContent).join('') : null;
          type = 's';
        } else if (t === 'str') {
          value = vEl ? vEl.textContent : null;
          type = 's';
        } else if (t === 'b') {
          value = vEl ? vEl.textContent === '1' : null;
          type = 'b';
        } else if (t === 'e') {
          value = vEl ? vEl.textContent : null;
          type = 'e';
        } else {
          if (vEl && vEl.textContent !== '') {
            const num = Number(vEl.textContent);
            if (Number.isNaN(num)) { value = vEl.textContent; type = 's'; }
            else if (dateXf.has(sIdx) && num > 0) { value = serialToDate(num); type = 'd'; }
            else { value = num; type = 'n'; }
          }
        }

        if (value === null && !fEl) continue;
        if (!cells[rc.r]) cells[rc.r] = [];
        const obj = { v: value, t: type };
        if (fEl) obj.f = fEl.textContent;
        cells[rc.r][rc.c] = obj;
        if (rc.r > nrows) nrows = rc.r;
        if (rc.c > ncols) ncols = rc.c;
      }
    }

    const merges = [];
    for (const m of doc.getElementsByTagName('mergeCell')) {
      const ref = m.getAttribute('ref');
      if (!ref) continue;
      const [a, b] = ref.split(':');
      const A = refToRC(a), B = refToRC(b || a);
      merges.push({ r1: A.r, c1: A.c, r2: B.r, c2: B.c, ref });
    }
    return { cells, nrows, ncols, merges };
  }

  /**
   * Parse a whole workbook.
   * @param {ArrayBuffer|Uint8Array} data
   * @param {string} [fileName]
   */
  async function readWorkbook(data, fileName) {
    const files = await global.FZip.readZip(data);
    const sst = parseSharedStrings(files);
    const dateXf = parseStyles(files);
    const targets = sheetTargets(files);

    const sheets = [];
    const byName = Object.create(null);
    targets.forEach((t, i) => {
      const bytes = files.get(t.path);
      let parsed = { cells: [], nrows: 0, ncols: 0, merges: [] };
      if (bytes) {
        try { parsed = parseSheet(bytes, sst, dateXf); }
        catch (e) { parsed.error = String(e && e.message || e); }
      }
      const sh = {
        name: t.name, index: i, state: t.state, file: fileName || '',
        cells: parsed.cells, nrows: parsed.nrows, ncols: parsed.ncols,
        merges: parsed.merges, error: parsed.error,
      };
      /* Resolve a merged-region anchor value for any covered cell. */
      sh.get = function (r, c) {
        const row = this.cells[r];
        const cell = row ? row[c] : undefined;
        if (cell && cell.v !== null && cell.v !== undefined && cell.v !== '') return cell.v;
        for (const m of this.merges) {
          if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) {
            const ar = this.cells[m.r1];
            const anchor = ar ? ar[m.c1] : undefined;
            return anchor ? anchor.v : null;
          }
        }
        return cell ? cell.v : null;
      };
      sheets.push(sh);
      byName[t.name] = sh;
    });

    return { fileName: fileName || '', sheets, byName };
  }

  global.FXlsxRead = { readWorkbook, refToRC, colLetter, serialToDate };
})(typeof window !== 'undefined' ? window : globalThis);
