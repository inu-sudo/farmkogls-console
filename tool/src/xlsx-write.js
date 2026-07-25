/* ============================================================================
   xlsx-write.js — build a styled multi-sheet .xlsx. Depends on FZip.

   API
     FXlsxWrite.build([{
       name, rows, cols, freeze, autofilter, merges
     }]) -> Blob

     rows : Array of Array of (primitive | {v, s, f})
              s = style name: 'hdr' | 'sub' | 'date' | 'int' | 'dec' | 'bold'
                              | 'pct' | 'warn' | 'good' | 'wrap' | 'money'
     cols : Array of {w:number}
     freeze : e.g. 'A2' (freeze everything above/left of that cell)
   ========================================================================= */
(function (global) {
  'use strict';

  const STYLE = {
    def: 0, hdr: 1, date: 2, int: 3, dec: 4, bold: 5, sub: 6,
    pct: 7, warn: 8, good: 9, wrap: 10, money: 11, title: 12,
  };

  /* Control characters other than tab/LF/CR are illegal in XML 1.0 and make
     Excel reject the file. Filtered by code point rather than by a regex so the
     source stays free of literal control bytes. */
  function stripCtl(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue;
      if (c === 0xfffe || c === 0xffff) continue;
      out += s.charAt(i);
    }
    return out;
  }

  function esc(s) {
    return stripCtl(String(s))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colLetter(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; }
    return s;
  }

  const EPOCH = Date.UTC(1899, 11, 31);
  function dateToSerial(d) {
    const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
                        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
    const days = (ms - EPOCH) / 86400000;
    return days >= 60 ? days + 1 : days;
  }

  /* ---- styles.xml ---------------------------------------------------- */
  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>
<numFmt numFmtId="165" formatCode="#,##0"/>
<numFmt numFmtId="166" formatCode="#,##0.00"/>
<numFmt numFmtId="167" formatCode="0.0%"/>
</numFmts>
<fonts count="4">
<font><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><name val="Calibri"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4E4"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB4C6E7"/></left><right style="thin"><color rgb="FFB4C6E7"/></right><top style="thin"><color rgb="FFB4C6E7"/></top><bottom style="thin"><color rgb="FFB4C6E7"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="165" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
</styleSheet>`;
  }

  /* ---- sheet XML ----------------------------------------------------- */
  function sheetXml(sheet, sst) {
    const rows = sheet.rows || [];
    let maxCol = 1;
    for (const r of rows) if (r && r.length > maxCol) maxCol = r.length;
    const dim = `A1:${colLetter(Math.max(1, maxCol))}${Math.max(1, rows.length)}`;

    /* frozen panes */
    let pane = '';
    if (sheet.freeze) {
      const m = String(sheet.freeze).match(/^([A-Z]+)(\d+)$/);
      if (m) {
        let xs = 0;
        for (let i = 0; i < m[1].length; i++) xs = xs * 26 + (m[1].charCodeAt(i) - 64);
        xs -= 1;
        const ys = parseInt(m[2], 10) - 1;
        const attrs = [];
        if (xs > 0) attrs.push(`xSplit="${xs}"`);
        if (ys > 0) attrs.push(`ySplit="${ys}"`);
        pane = `<pane ${attrs.join(' ')} topLeftCell="${sheet.freeze}" activePane="bottomRight" state="frozen"/>`;
      }
    }

    let cols = '';
    if (sheet.cols && sheet.cols.length) {
      cols = '<cols>' + sheet.cols.map((c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${(c && c.w) || 12}" customWidth="1"${c && c.hidden ? ' hidden="1"' : ''}/>`
      ).join('') + '</cols>';
    }

    const body = [];
    rows.forEach((row, ri) => {
      if (!row) return;
      const r = ri + 1;
      const cells = [];
      row.forEach((raw, ci) => {
        if (raw === null || raw === undefined || raw === '') return;
        const c = colLetter(ci + 1);
        let v = raw, sName = null, formula = null;
        if (typeof raw === 'object' && !(raw instanceof Date)) {
          v = raw.v; sName = raw.s; formula = raw.f;
          if (v === null || v === undefined || v === '') {
            if (!formula) return;
          }
        }
        let s = sName && STYLE[sName] !== undefined ? STYLE[sName] : 0;
        let out;
        if (v instanceof Date && !isNaN(v)) {
          if (!sName) s = STYLE.date;
          out = `<c r="${c}${r}" s="${s}"><v>${dateToSerial(v)}</v></c>`;
        } else if (typeof v === 'number' && isFinite(v)) {
          out = `<c r="${c}${r}" s="${s}"><v>${v}</v></c>`;
        } else if (typeof v === 'boolean') {
          out = `<c r="${c}${r}" s="${s}" t="b"><v>${v ? 1 : 0}</v></c>`;
        } else if (formula) {
          out = `<c r="${c}${r}" s="${s}"><f>${esc(formula)}</f></c>`;
        } else {
          const text = String(v);
          let idx = sst.map.get(text);
          if (idx === undefined) { idx = sst.list.length; sst.list.push(text); sst.map.set(text, idx); }
          out = `<c r="${c}${r}" s="${s}" t="s"><v>${idx}</v></c>`;
        }
        cells.push(out);
      });
      if (cells.length) body.push(`<row r="${r}">${cells.join('')}</row>`);
    });

    const af = sheet.autofilter && rows.length > 1
      ? `<autoFilter ref="A${sheet.autofilterRow || 1}:${colLetter(maxCol)}${rows.length}"/>` : '';
    const mg = sheet.merges && sheet.merges.length
      ? `<mergeCells count="${sheet.merges.length}">` +
        sheet.merges.map((m) => `<mergeCell ref="${esc(m)}"/>`).join('') + '</mergeCells>' : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/><sheetViews><sheetView${sheet.active ? ' tabSelected="1"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="14.5"/>${cols}<sheetData>${body.join('')}</sheetData>${af}${mg}</worksheet>`;
  }

  /* ---- assemble ------------------------------------------------------ */
  function safeName(name, used) {
    let s = String(name || 'Sheet').replace(/[\\/*?:[\]]/g, '-').slice(0, 31) || 'Sheet';
    let base = s, i = 2;
    while (used.has(s)) { const suf = '~' + i++; s = base.slice(0, 31 - suf.length) + suf; }
    used.add(s);
    return s;
  }

  function build(sheets) {
    const sst = { list: [], map: new Map() };
    const used = new Set();
    const prepared = sheets.map((sh, i) => {
      const nm = safeName(sh.name, used);
      return { name: nm, xml: sheetXml(Object.assign({}, sh, { active: i === 0 }), sst) };
    });

    const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.list.length}" uniqueCount="${sst.list.length}">` +
      sst.list.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('') + '</sst>';

    const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      prepared.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>';

    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      prepared.map((s, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      ).join('') +
      `<Relationship Id="rId${prepared.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId${prepared.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
      '</Relationships>';

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      prepared.map((s, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      ).join('') +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

    const entries = [
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'xl/workbook.xml', data: wbXml },
      { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
      { name: 'xl/styles.xml', data: stylesXml() },
      { name: 'xl/sharedStrings.xml', data: sstXml },
    ];
    prepared.forEach((s, i) => entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml }));

    return global.FZip.writeZip(entries);
  }

  global.FXlsxWrite = { build, STYLE, colLetter, dateToSerial };
})(typeof window !== 'undefined' ? window : globalThis);
