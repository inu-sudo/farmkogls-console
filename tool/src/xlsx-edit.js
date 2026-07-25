/* ============================================================================
   xlsx-edit.js — surgical .xlsx editing.

   Opens an existing workbook, changes only the parts that must change, and
   writes it back. Everything untouched stays byte-identical, so formulas,
   number formats, cell styles, merged cells, drawings, comments and print
   settings all survive.

   This is deliberately NOT a rewrite: FXlsxWrite builds workbooks from scratch
   and cannot preserve someone else's formatting. Use this when the deliverable
   is "their file, updated".

   Depends on FZip.
   ========================================================================= */
(function (global) {
  'use strict';

  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const td = new TextDecoder('utf-8');
  const te = new TextEncoder();

  /* ---- refs ---------------------------------------------------------- */
  function colToNum(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n;
  }
  function numToCol(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; }
    return s;
  }
  function splitRef(ref) {
    const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(String(ref).toUpperCase());
    return m ? { col: m[1], row: +m[2] } : null;
  }

  const EPOCH = Date.UTC(1899, 11, 31);
  function dateToSerial(d) {
    const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const days = (ms - EPOCH) / 86400000;
    return days >= 60 ? days + 1 : days;
  }

  /* ---- package ------------------------------------------------------- */
  /**
   * @param {ArrayBuffer|Uint8Array} bytes
   * @returns {Promise<object>} package handle
   */
  async function open(bytes) {
    const files = await global.FZip.readZip(bytes);
    const parser = new DOMParser();
    const parse = (path) => {
      const b = files.get(path);
      if (!b) return null;
      const doc = parser.parseFromString(td.decode(b), 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) {
        throw new Error('손상된 XML: ' + path);
      }
      return doc;
    };

    const wbDoc = parse('xl/workbook.xml');
    if (!wbDoc) throw new Error('올바른 .xlsx 파일이 아닙니다 (xl/workbook.xml 없음).');
    const relsDoc = parse('xl/_rels/workbook.xml.rels');
    const rmap = {};
    if (relsDoc) {
      for (const r of relsDoc.getElementsByTagName('Relationship')) {
        rmap[r.getAttribute('Id')] = r.getAttribute('Target');
      }
    }
    const sheets = [];
    for (const sh of wbDoc.getElementsByTagName('sheet')) {
      const rid = sh.getAttribute('r:id') || sh.getAttributeNS(RNS, 'id');
      let t = (rmap[rid] || '').replace(/^\/xl\//, '').replace(/^\//, '').replace(/^xl\//, '');
      sheets.push({ name: sh.getAttribute('name'), path: 'xl/' + t });
    }

    const docs = Object.create(null);
    /* Cache workbook.xml under its path too, so edits to wbDoc are saved. */
    docs['xl/workbook.xml'] = wbDoc;

    return {
      files, sheets, wbDoc, parser, docs,
      dirty: new Set(),
      /** Parsed document for a part, cached. */
      doc(path) {
        if (!(path in this.docs)) this.docs[path] = parse(path);
        return this.docs[path];
      },
      markDirty(path) { this.dirty.add(path); },
      sheetPath(name) {
        const s = this.sheets.find((x) => x.name === name);
        return s ? s.path : null;
      },
    };
  }

  /** Serialise every touched part back into the archive and zip it up. */
  function save(pkg) {
    /* Newly written formulas carry no cached result, so tell Excel to compute
       the whole book on open. Without this the new cells can show blank. */
    const wb = pkg.wbDoc;
    if (wb) {
      let calcPr = wb.getElementsByTagName('calcPr')[0];
      if (!calcPr) {
        calcPr = wb.createElementNS(NS, 'calcPr');
        calcPr.setAttribute('calcId', '191029');
        wb.documentElement.appendChild(calcPr);
      }
      calcPr.setAttribute('fullCalcOnLoad', '1');
      pkg.markDirty('xl/workbook.xml');
    }

    const ser = new XMLSerializer();
    for (const path of pkg.dirty) {
      const doc = pkg.docs[path];
      if (!doc) continue;
      let xml = ser.serializeToString(doc);
      if (!/^<\?xml/.test(xml)) {
        xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml;
      }
      pkg.files.set(path, te.encode(xml));
    }
    /* Excel's calculation cache references cells by address; after moving rows
       it is stale. Dropping it makes Excel rebuild it on open, which is the
       documented-safe thing to do. */
    pkg.files.delete('xl/calcChain.xml');
    const ct = pkg.files.get('[Content_Types].xml');
    if (ct) {
      const s = td.decode(ct).replace(
        /<Override[^>]*calcChain\.xml[^>]*\/>/g, '');
      pkg.files.set('[Content_Types].xml', te.encode(s));
    }
    const rels = pkg.files.get('xl/_rels/workbook.xml.rels');
    if (rels) {
      const s = td.decode(rels).replace(
        /<Relationship[^>]*calcChain\.xml[^>]*\/>/g, '');
      pkg.files.set('xl/_rels/workbook.xml.rels', te.encode(s));
    }

    const entries = [];
    for (const [name, data] of pkg.files) entries.push({ name, data });
    return global.FZip.writeZip(entries);
  }

  /* ---- formula reference shifting ------------------------------------ */
  /**
   * Shift every row reference >= `at` by `n` inside a formula string.
   * Skips quoted literals so a text constant like "A380" is untouched.
   */
  function shiftFormula(f, at, n) {
    if (!f) return f;
    const parts = String(f).split(/("(?:[^"]|"")*")/);   // keep quoted chunks
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(
        /(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
        (m, d1, col, d2, row) => {
          const r = +row;
          return r >= at ? d1 + col + d2 + (r + n) : m;
        }
      );
    }
    return parts.join('');
  }

  /** Shift a range/sqref such as "E398" or "B7:AC375 E10". */
  function shiftRefList(sqref, at, n) {
    return String(sqref).split(/\s+/).map((tok) =>
      tok.split(':').map((one) => {
        const p = /^(\$?[A-Z]{1,3}\$?)(\d+)$/.exec(one);
        if (!p) return one;
        const r = +p[2];
        return p[1] + (r >= at ? r + n : r);
      }).join(':')
    ).join(' ');
  }

  /* ---- row insertion ------------------------------------------------- */
  /**
   * Insert `count` blank rows before row `at` in a sheet, adjusting everything
   * that refers to a moved row.
   *
   * @returns {Array<Element>} the newly created <row> elements
   */
  function insertRows(pkg, sheetName, at, count, opts) {
    const o = opts || {};
    const path = pkg.sheetPath(sheetName);
    if (!path) throw new Error(`시트를 찾을 수 없습니다: ${sheetName}`);
    const doc = pkg.doc(path);
    if (!doc) throw new Error(`시트 XML을 읽을 수 없습니다: ${path}`);
    pkg.markDirty(path);

    const ws = doc.documentElement;
    const sd = ws.getElementsByTagName('sheetData')[0];
    if (!sd) throw new Error('sheetData 없음');

    /* -- 1. move existing rows down ---------------------------------- */
    const rows = Array.from(sd.getElementsByTagName('row'));
    for (const row of rows) {
      const r = +row.getAttribute('r');
      if (r < at) continue;
      const nr = r + count;
      row.setAttribute('r', String(nr));
      for (const c of Array.from(row.getElementsByTagName('c'))) {
        const p = splitRef(c.getAttribute('r'));
        if (p) c.setAttribute('r', p.col + nr);
      }
    }

    /* -- 2. shift row references inside every formula in the sheet ---- */
    for (const f of Array.from(ws.getElementsByTagName('f'))) {
      if (f.textContent) f.textContent = shiftFormula(f.textContent, at, count);
      const ref = f.getAttribute('ref');            // shared-formula range
      if (ref) f.setAttribute('ref', shiftRefList(ref, at, count));
    }

    /* -- 3. sheet-level ranges --------------------------------------- */
    const dim = ws.getElementsByTagName('dimension')[0];
    if (dim) dim.setAttribute('ref', shiftRefList(dim.getAttribute('ref'), at, count));

    for (const cf of Array.from(ws.getElementsByTagName('conditionalFormatting'))) {
      const sq = cf.getAttribute('sqref');
      if (sq) cf.setAttribute('sqref', shiftRefList(sq, at, count));
    }
    for (const mc of Array.from(ws.getElementsByTagName('mergeCell'))) {
      const ref = mc.getAttribute('ref');
      if (ref) mc.setAttribute('ref', shiftRefList(ref, at, count));
    }
    for (const dv of Array.from(ws.getElementsByTagName('dataValidation'))) {
      const sq = dv.getAttribute('sqref');
      if (sq) dv.setAttribute('sqref', shiftRefList(sq, at, count));
    }
    for (const hl of Array.from(ws.getElementsByTagName('hyperlink'))) {
      const ref = hl.getAttribute('ref');
      if (ref) hl.setAttribute('ref', shiftRefList(ref, at, count));
    }

    /* autoFilter: extend so the new rows fall inside the filter range */
    const af = ws.getElementsByTagName('autoFilter')[0];
    if (af) {
      const ref = af.getAttribute('ref');
      const m = /^(\$?[A-Z]{1,3}\$?\d+):(\$?[A-Z]{1,3}\$?)(\d+)$/.exec(ref || '');
      if (m) af.setAttribute('ref', `${m[1]}:${m[2]}${+m[3] + count}`);
    }

    /* -- 4. workbook-level defined names ----------------------------- */
    const dn = pkg.wbDoc.getElementsByTagName('definedNames')[0];
    if (dn) {
      let changed = false;
      for (const d of Array.from(dn.getElementsByTagName('definedName'))) {
        const txt = d.textContent || '';
        if (txt.indexOf(sheetName) < 0) continue;
        const m = /^(.*\$\d+:\$[A-Z]{1,3}\$)(\d+)$/.exec(txt);
        if (m) { d.textContent = m[1] + (+m[2] + count); changed = true; }
      }
      if (changed) pkg.markDirty('xl/workbook.xml');
    }

    /* -- 5. comment anchors + their VML shapes ----------------------- */
    const relPath = path.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels');
    const relDoc = pkg.doc(relPath);
    if (relDoc) {
      for (const rel of Array.from(relDoc.getElementsByTagName('Relationship'))) {
        const t = rel.getAttribute('Target') || '';
        const type = rel.getAttribute('Type') || '';
        const abs = 'xl/' + t.replace(/^\.\.\//, '');
        if (/\/comments$/.test(type)) {
          const cd = pkg.doc(abs);
          if (cd) {
            let ch = false;
            for (const cm of Array.from(cd.getElementsByTagName('comment'))) {
              const p = splitRef(cm.getAttribute('ref'));
              if (p && p.row >= at) { cm.setAttribute('ref', p.col + (p.row + count)); ch = true; }
            }
            if (ch) pkg.markDirty(abs);
          }
        } else if (/vmlDrawing$/.test(type)) {
          /* VML uses 0-based <x:Row>; only touch rows at/after the insert. */
          const b = pkg.files.get(abs);
          if (b) {
            const s = td.decode(b).replace(/<x:Row>(\d+)<\/x:Row>/g, (mm, rr) => {
              const v = +rr;
              return v >= at - 1 ? `<x:Row>${v + count}</x:Row>` : mm;
            });
            pkg.files.set(abs, te.encode(s));
          }
        } else if (/\/drawing$/.test(type)) {
          const dd = pkg.doc(abs);
          if (dd) {
            let ch = false;
            for (const rw of Array.from(dd.getElementsByTagName('row'))) {
              const v = +rw.textContent;
              if (isFinite(v) && v >= at - 1) { rw.textContent = String(v + count); ch = true; }
            }
            if (ch) pkg.markDirty(abs);
          }
        }
      }
    }

    /* -- 6. create the blank rows, styled after a template row ------- */
    const tplRow = o.styleFrom
      ? rows.find((r) => +r.getAttribute('r') === (o.styleFrom >= at ? o.styleFrom + count : o.styleFrom))
      : null;
    const tplCells = {};
    if (tplRow) {
      for (const c of tplRow.getElementsByTagName('c')) {
        const p = splitRef(c.getAttribute('r'));
        if (p) tplCells[p.col] = c.getAttribute('s');
      }
    }

    const made = [];
    /* keep sheetData ordered by row number */
    const after = Array.from(sd.getElementsByTagName('row'))
      .find((r) => +r.getAttribute('r') > at + count - 1);
    for (let i = 0; i < count; i++) {
      const row = doc.createElementNS(NS, 'row');
      row.setAttribute('r', String(at + i));
      if (tplRow) {
        if (tplRow.getAttribute('spans')) row.setAttribute('spans', tplRow.getAttribute('spans'));
        if (tplRow.getAttribute('ht')) row.setAttribute('ht', tplRow.getAttribute('ht'));
        if (tplRow.getAttribute('customHeight')) row.setAttribute('customHeight', tplRow.getAttribute('customHeight'));
      }
      if (after) sd.insertBefore(row, after); else sd.appendChild(row);
      made.push(row);
    }
    return { rows: made, tplCells, doc, path };
  }

  /* ---- cell writing -------------------------------------------------- */
  /**
   * Write a value into a row element.
   * kind: 'n' number | 's' inline string | 'd' date | 'f' formula | 'blank'
   */
  function setCell(doc, row, col, value, kind, styleIdx) {
    const rowNum = row.getAttribute('r');
    const ref = col + rowNum;
    /* find or create <c> keeping column order */
    let cell = null, before = null;
    const target = colToNum(col);
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const p = splitRef(c.getAttribute('r'));
      if (!p) continue;
      const n = colToNum(p.col);
      if (n === target) { cell = c; break; }
      if (n > target && !before) before = c;
    }
    if (!cell) {
      cell = doc.createElementNS(NS, 'c');
      cell.setAttribute('r', ref);
      if (before) row.insertBefore(cell, before); else row.appendChild(cell);
    }
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    cell.removeAttribute('t');
    if (styleIdx !== undefined && styleIdx !== null) cell.setAttribute('s', String(styleIdx));

    if (kind === 'blank' || value === null || value === undefined || value === '') return cell;

    if (kind === 'f') {
      const f = doc.createElementNS(NS, 'f');
      f.textContent = String(value).replace(/^=/, '');
      cell.appendChild(f);
      return cell;
    }
    if (kind === 'd') {
      const v = doc.createElementNS(NS, 'v');
      v.textContent = String(dateToSerial(value));
      cell.appendChild(v);
      return cell;
    }
    if (kind === 'n') {
      const v = doc.createElementNS(NS, 'v');
      v.textContent = String(value);
      cell.appendChild(v);
      return cell;
    }
    /* inline string — avoids having to touch sharedStrings.xml */
    cell.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(NS, 'is');
    const t = doc.createElementNS(NS, 't');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = String(value);
    is.appendChild(t);
    cell.appendChild(is);
    return cell;
  }

  /** Read a cell's current value/formula/style from a sheet. */
  function readSheet(pkg, sheetName) {
    const path = pkg.sheetPath(sheetName);
    const doc = pkg.doc(path);
    const out = { rows: Object.create(null), maxRow: 0, doc, path };
    if (!doc) return out;
    const sst = readSharedStrings(pkg);
    for (const row of doc.getElementsByTagName('row')) {
      const r = +row.getAttribute('r');
      out.maxRow = Math.max(out.maxRow, r);
      const cells = Object.create(null);
      for (const c of row.getElementsByTagName('c')) {
        const p = splitRef(c.getAttribute('r'));
        if (!p) continue;
        const t = c.getAttribute('t');
        const fEl = c.getElementsByTagName('f')[0];
        const vEl = c.getElementsByTagName('v')[0];
        let v = null;
        if (t === 's' && vEl) v = sst[+vEl.textContent] ?? null;
        else if (t === 'inlineStr') {
          const is = c.getElementsByTagName('is')[0];
          v = is ? Array.from(is.getElementsByTagName('t')).map((x) => x.textContent).join('') : null;
        } else if (vEl) v = vEl.textContent;
        cells[p.col] = { v, t, s: c.getAttribute('s'), f: fEl ? fEl.textContent : null, el: c };
      }
      out.rows[r] = { el: row, cells };
    }
    return out;
  }

  function readSharedStrings(pkg) {
    if (pkg._sst) return pkg._sst;
    const doc = pkg.doc('xl/sharedStrings.xml');
    const out = [];
    if (doc) {
      for (const si of doc.getElementsByTagName('si')) {
        let s = '';
        for (const t of si.getElementsByTagName('t')) {
          const pn = t.parentNode && t.parentNode.nodeName;
          if (pn === 'rPh' || pn === 'phoneticPr') continue;
          s += t.textContent;
        }
        out.push(s);
      }
    }
    pkg._sst = out;
    return out;
  }

  global.FXlsxEdit = {
    open, save, insertRows, setCell, readSheet, readSharedStrings,
    shiftFormula, shiftRefList, colToNum, numToCol, splitRef, dateToSerial,
  };
})(typeof window !== 'undefined' ? window : globalThis);
