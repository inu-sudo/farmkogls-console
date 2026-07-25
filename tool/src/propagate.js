/* ============================================================================
   propagate.js — push an agency weekly forecast into the existing
   "FES BK FCST" register, in place.

   Column mapping and conventions were derived from the five rows a person had
   already transcribed by hand (see docs/01), not guessed:

     학습 B  Remark        -> FES B  Remark          (copied verbatim)
              (nothing)    -> FES C  Customer        (left blank)
     학습 C  Agnecy        -> FES D  BK PARTY        (+ "(SKS)" on SKS)
     학습 D  B/L NO        -> FES E  B/L NO
     학습 E+F Vessel/Voy   -> FES F  1st Leg Vessel  ("VESSEL 073E")
     학습 H  ETD           -> FES G  ETD
              (formula)    -> FES H  =WEEKNUM(G#)
     DIR: mirror F/G       -> FES I/J 2nd Leg        (T/S: left blank for a person)
              (formula)    -> FES K  =WEEKNUM(J#)
     POD != F.POD          -> FES L  DIR | T/S
     sheet SVC NAME        -> FES M  1st SVC
              (nothing)    -> FES N  2nd SVC         (left blank)
     학습 I  POL           -> FES O  POL
     학습 J  POD           -> FES P  T/S             (only when T/S)
     학습 K  F.POD         -> FES Q  F.POD
     학습 L..R 7 boxes     -> FES R..X 7 boxes
              (formula)    -> FES Y  TEU
     학습 T  VGM           -> FES Z  VGM             (blank stays blank)
     학습 V  Item          -> FES AA Item
     학습 W  Rate/Box      -> FES AB Rate/Box        (blank stays blank)
              (formula)    -> FES AC Lumpsum Rate

   Depends on FZip, FXlsxRead, FXlsxEdit, FNorm.
   ========================================================================= */
(function (global) {
  'use strict';

  const N = () => global.FNorm;
  const E = () => global.FXlsxEdit;

  /* Source columns in the agency sheet (1-based). */
  const H = {
    remark: 2, agnecy: 3, bl: 4, vessel: 5, voy: 6, wk: 7, etd: 8,
    pol: 9, pod: 10, fpod: 11,
    boxes: [12, 13, 14, 15, 16, 17, 18],       // 20DV 20MT 40HC 40MT 20FR 40FR Void
    teu: 19, vgm: 20, wtPerTeu: 21, item: 22, rate: 23, lumpsum: 24,
  };

  /* Target columns in FES BK FCST. */
  const F = {
    remark: 'B', customer: 'C', party: 'D', bl: 'E',
    vsl1: 'F', etd1: 'G', wk1: 'H',
    vsl2: 'I', etd2: 'J', wk2: 'K',
    dirTs: 'L', svc1: 'M', svc2: 'N',
    pol: 'O', ts: 'P', fpod: 'Q',
    boxes: ['R', 'S', 'T', 'U', 'V', 'W', 'X'],
    teu: 'Y', vgm: 'Z', item: 'AA', rate: 'AB', lumpsum: 'AC',
  };

  const TARGET_SHEET = 'FES BK FCST';

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */
  function normBl(v) {
    return String(v == null ? '' : v).toUpperCase().replace(/[\s\-_/\\()]+/g, '');
  }

  function slug(v) {
    return String(v == null ? '' : v).toUpperCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Identity used to decide "is this forecast row already in the register?".
   *
   * A real B/L number is enough on its own. But rows whose B/L is a note —
   * "Empty Repo", "MT", "FULL" — would all collapse onto each other, so those
   * add vessel/voyage, lane and the note text. Quantities are deliberately left
   * out of the key: they are exactly what a re-forecast is expected to change.
   */
  function matchKey(bl, vslVoy, pol, fpod) {
    const n = N();
    if (!n.isPlaceholderBl(bl)) return 'B|' + normBl(bl);
    return 'X|' + slug(vslVoy) + '|' + n.canonPort(pol) + '>' + n.canonPort(fpod) +
           '|' + normBl(bl);
  }

  /** "E073" -> "073E"; leaves "26029E" / "2603E" alone. */
  function normVoy(v) {
    const s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');
    const m = /^([EWNS])(\d{2,5})$/.exec(s);
    return m ? m[2] + m[1] : s;
  }

  function txt(v) {
    if (v == null) return '';
    if (v instanceof Date) return N().isoDate(v);
    return String(v).trim();
  }

  function same(a, b) {
    return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
  }

  /* ------------------------------------------------------------------ *
   * Read the agency forecast into rows ready for the register
   * ------------------------------------------------------------------ */
  function readAgency(wb) {
    const n = N();
    const out = [];
    const sheetsSeen = [];

    for (const sh of wb.sheets) {
      /* service from the "SVC NAME : XXX" cell, else the sheet name */
      let svc = '';
      for (let r = 1; r <= Math.min(sh.nrows, 10) && !svc; r++) {
        for (let c = 1; c <= Math.min(sh.ncols, 14); c++) {
          const v = sh.get(r, c);
          if (typeof v === 'string' && /SVC\s*NAME/i.test(v)) {
            const m = v.match(/:\s*([A-Za-z]{3})/);
            if (m) { svc = m[1].toUpperCase(); break; }
          }
        }
      }
      if (!svc) {
        const m = String(sh.name).toUpperCase().match(/(?:^|[^A-Z])(CSC|NWX|CCS|SKS)(?:[^A-Z]|$)/);
        if (m) svc = m[1];
      }
      if (!svc) continue;

      /* header row: the one whose D cell reads "B/L NO" */
      let hdr = 0;
      for (let r = 1; r <= Math.min(sh.nrows, 20); r++) {
        const v = sh.get(r, H.bl);
        if (typeof v === 'string' && /^B\/?L\s*NO/i.test(v.trim())) { hdr = r; break; }
      }
      if (!hdr) continue;

      let count = 0;
      for (let r = hdr + 1; r <= sh.nrows; r++) {
        const bl = sh.get(r, H.bl);
        const vessel = sh.get(r, H.vessel);
        const boxes = H.boxes.map((c) => n.num(sh.get(r, c)));
        const boxSum = boxes.reduce((a, b) => a + b, 0);

        /* skip blanks and the SUMIF subtotal row at the bottom */
        if (!bl && !vessel && !boxSum) continue;
        const rowTxt = [2, 3, 4, 5].map((c) => txt(sh.get(r, c))).join(' ').toUpperCase();
        if (/합계|소계|TOTAL|SUBTOTAL/.test(rowTxt)) continue;
        if (!vessel && !bl) continue;

        const sp = n.splitVesselVoy(vessel);
        const vsl = sp.vessel || n.canonVessel(vessel);
        const voyRaw = txt(sh.get(r, H.voy)) || sp.voy;
        const voy = normVoy(voyRaw);
        const pod = txt(sh.get(r, H.pod));
        const fpod = txt(sh.get(r, H.fpod));
        const isTs = !!(pod && fpod && n.canonPort(pod) !== n.canonPort(fpod));
        const etd = n.toDate(sh.get(r, H.etd));

        out.push({
          srcSheet: sh.name, srcRow: r, svc,
          remark: txt(sh.get(r, H.remark)),
          party: txt(sh.get(r, H.agnecy)) + (svc === 'SKS' ? '(SKS)' : ''),
          bl: txt(sh.get(r, H.bl)),
          vessel: vsl, voy,
          vslVoy: (vsl + ' ' + voy).trim(),
          etd, dirTs: isTs ? 'T/S' : 'DIR',
          pol: txt(sh.get(r, H.pol)), pod, fpod,
          boxes,
          vgm: n.num(sh.get(r, H.vgm)),
          item: txt(sh.get(r, H.item)),
          rate: n.num(sh.get(r, H.rate)),
          voyRawDiffers: normVoy(voyRaw) !== String(voyRaw || '').trim().toUpperCase(),
          voyRaw: String(voyRaw || '').trim().toUpperCase(),
        });
        count++;
      }
      sheetsSeen.push({ sheet: sh.name, svc, rows: count });
    }
    return { rows: out, sheets: sheetsSeen };
  }

  /* ------------------------------------------------------------------ *
   * Locate the register's active region
   * ------------------------------------------------------------------ */
  function surveyRegister(pkg) {
    const ed = E();
    const s = ed.readSheet(pkg, TARGET_SHEET);
    if (!s.doc) throw new Error(`'${TARGET_SHEET}' 시트를 찾을 수 없습니다.`);

    /* header row = the one whose E cell reads "B/L NO" */
    let hdr = 0;
    for (let r = 1; r <= Math.min(s.maxRow, 30); r++) {
      const row = s.rows[r];
      const c = row && row.cells[F.bl];
      if (c && typeof c.v === 'string' && /^B\/?L\s*NO/i.test(c.v.trim())) { hdr = r; break; }
    }
    if (!hdr) throw new Error('등록부의 헤더 행(B/L NO)을 찾을 수 없습니다.');

    /* the "** CANCEL LIST" divider */
    let cancelRow = 0;
    for (let r = hdr + 1; r <= s.maxRow; r++) {
      const row = s.rows[r];
      if (!row) continue;
      const joined = ['B', 'C', 'D', 'E', 'F'].map((c) =>
        row.cells[c] ? String(row.cells[c].v || '') : '').join(' ').toUpperCase();
      if (/CANCEL\s*LIST/.test(joined)) { cancelRow = r; break; }
    }
    const activeEnd = (cancelRow || s.maxRow + 1) - 1;

    /* last row carrying real data, plus a match index over the active region */
    let lastData = hdr;
    const index = new Map();
    for (let r = hdr + 1; r <= activeEnd; r++) {
      const row = s.rows[r];
      if (!row) continue;
      const has = ['B', 'C', 'D', 'E', 'F'].some((c) =>
        row.cells[c] && row.cells[c].v != null && String(row.cells[c].v).trim() !== '');
      if (has) lastData = r;
      const cv = (col) => (row.cells[col] ? row.cells[col].v : '');
      const bl = cv(F.bl);
      if (!bl && !cv(F.vsl1)) continue;
      const k = matchKey(bl, cv(F.vsl1), cv(F.pol), cv(F.fpod));
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(r);
    }
    return { sheet: s, hdr, cancelRow, activeEnd, lastData, index };
  }

  /* ------------------------------------------------------------------ *
   * Write one forecast row into a register row
   * ------------------------------------------------------------------ */
  function styleOf(tplCells, col) {
    const s = tplCells[col];
    return s === null || s === undefined ? undefined : s;
  }

  function fillNewRow(doc, rowEl, rec, tplCells) {
    const r = rowEl.getAttribute('r');
    const set = (col, v, kind) => E().setCell(doc, rowEl, col, v, kind, styleOf(tplCells, col));

    set(F.remark, rec.remark, 's');
    set(F.customer, '', 'blank');
    set(F.party, rec.party, 's');
    set(F.bl, rec.bl, 's');
    set(F.vsl1, rec.vslVoy, 's');
    set(F.etd1, rec.etd, rec.etd ? 'd' : 'blank');
    set(F.wk1, `WEEKNUM(${F.etd1}${r})`, 'f');

    if (rec.dirTs === 'DIR') {
      set(F.vsl2, rec.vslVoy, 's');
      set(F.etd2, rec.etd, rec.etd ? 'd' : 'blank');
    } else {
      set(F.vsl2, '', 'blank');
      set(F.etd2, '', 'blank');
    }
    set(F.wk2, `WEEKNUM(${F.etd2}${r})`, 'f');

    set(F.dirTs, rec.dirTs, 's');
    set(F.svc1, rec.svc, 's');
    set(F.svc2, '', 'blank');
    set(F.pol, rec.pol, 's');
    set(F.ts, rec.dirTs === 'T/S' ? rec.pod : '', rec.dirTs === 'T/S' ? 's' : 'blank');
    set(F.fpod, rec.fpod, 's');

    F.boxes.forEach((col, i) => {
      const v = rec.boxes[i];
      set(col, v || '', v ? 'n' : 'blank');
    });

    const B = F.boxes;
    set(F.teu,
      `${B[0]}${r}+${B[1]}${r}+${B[4]}${r}+${B[3]}${r}*2+${B[6]}${r}+${B[2]}${r}*2+${B[5]}${r}*2`,
      'f');
    set(F.vgm, rec.vgm || '', rec.vgm ? 'n' : 'blank');
    set(F.item, rec.item, 's');
    set(F.rate, rec.rate || '', rec.rate ? 'n' : 'blank');
    set(F.lumpsum,
      `IFERROR((${B[0]}${r}*${F.rate}${r})+(${B[2]}${r}*${F.rate}${r}),0)`, 'f');
  }

  /* ------------------------------------------------------------------ *
   * Main
   * ------------------------------------------------------------------ */
  /**
   * @param {ArrayBuffer} agencyBytes  학습.xlsx
   * @param {ArrayBuffer} targetBytes  FES AGENCY workbook
   * @param {object} [opts] { agencyName, targetName }
   */
  async function propagate(agencyBytes, targetBytes, opts) {
    const o = opts || {};
    const ed = E();
    const agencyWb = await global.FXlsxRead.readWorkbook(agencyBytes, o.agencyName || '학습.xlsx');
    const { rows: recs, sheets } = readAgency(agencyWb);

    const pkg = await ed.open(targetBytes);
    const sv = surveyRegister(pkg);

    /* Split into updates vs inserts. Each register row can be claimed once, so
       three look-alike "Empty Repo" lines map to three rows, not all to one. */
    const updates = [], inserts = [];
    const used = new Map();          // key -> how many of its rows are taken
    for (const rec of recs) {
      const k = matchKey(rec.bl, rec.vslVoy, rec.pol, rec.fpod);
      rec.matchKey = k;
      const rowsFor = sv.index.get(k) || [];
      const taken = used.get(k) || 0;
      if (taken < rowsFor.length) {
        used.set(k, taken + 1);
        updates.push({ rec, row: rowsFor[taken] });
      } else {
        inserts.push(rec);
      }
    }

    const report = {
      agency: o.agencyName || '학습.xlsx',
      target: o.targetName || 'FES AGENCY',
      sheets,
      parsed: recs.length,
      insertAt: sv.lastData + 1,
      inserted: inserts.length,
      updated: 0,
      unchanged: 0,
      changes: [],
      notes: [],
      tsRows: [],
      voyNormalised: [],
    };

    for (const rec of recs) {
      if (rec.voyRawDiffers) {
        report.voyNormalised.push({ bl: rec.bl, from: rec.voyRaw, to: rec.voy });
      }
    }

    /* ---- 1. update rows that already exist --------------------------- */
    const doc = sv.sheet.doc;
    pkg.markDirty(sv.sheet.path);

    for (const u of updates) {
      const row = sv.sheet.rows[u.row];
      if (!row) continue;
      const rec = u.rec;
      const diffs = [];
      const cur = (col) => (row.cells[col] ? row.cells[col].v : null);
      const curStyle = (col) => (row.cells[col] ? row.cells[col].s : undefined);
      const put = (col, v, kind) => ed.setCell(doc, row.el, col, v, kind, curStyle(col));

      /* 2nd leg mirrors the 1st only when the file already does that */
      const mirrors = same(cur(F.vsl2), cur(F.vsl1));

      const plan = [
        [F.remark, rec.remark, 's', !!rec.remark],
        [F.party, rec.party, 's', !!rec.party],
        [F.vsl1, rec.vslVoy, 's', !!rec.vslVoy],
        [F.etd1, rec.etd, 'd', !!rec.etd],
        [F.dirTs, rec.dirTs, 's', true],
        [F.svc1, rec.svc, 's', !!rec.svc],
        [F.pol, rec.pol, 's', !!rec.pol],
        [F.fpod, rec.fpod, 's', !!rec.fpod],
        [F.item, rec.item, 's', !!rec.item],
      ];
      if (rec.dirTs === 'T/S') plan.push([F.ts, rec.pod, 's', !!rec.pod]);
      if (rec.vgm) plan.push([F.vgm, rec.vgm, 'n', true]);
      if (rec.rate) plan.push([F.rate, rec.rate, 'n', true]);

      for (const [col, val, kind, active] of plan) {
        if (!active) continue;
        const before = cur(col);
        const beforeTxt = kind === 'd' && before != null && !isNaN(+before)
          ? N().isoDate(global.FXlsxRead.serialToDate(+before)) : txt(before);
        const afterTxt = kind === 'd' ? N().isoDate(val) : txt(val);
        if (same(beforeTxt, afterTxt)) continue;
        put(col, val, kind);
        diffs.push({ col, from: beforeTxt, to: afterTxt });
      }

      /* boxes move as a set when the forecast declares any */
      if (rec.boxes.some((x) => x)) {
        F.boxes.forEach((col, i) => {
          const before = N().num(cur(col));
          const after = rec.boxes[i];
          if (before === after) return;
          put(col, after || '', after ? 'n' : 'blank');
          diffs.push({ col, from: before || '', to: after || '' });
        });
      }

      /* keep the 2nd-leg mirror consistent for DIR rows */
      if (rec.dirTs === 'DIR' && mirrors) {
        ed.setCell(doc, row.el, F.vsl2, rec.vslVoy, 's', curStyle(F.vsl2));
        if (rec.etd) ed.setCell(doc, row.el, F.etd2, rec.etd, 'd', curStyle(F.etd2));
      }

      if (diffs.length) {
        report.updated++;
        report.changes.push({
          kind: 'updated', row: u.row, bl: rec.bl, svc: rec.svc,
          src: `${rec.srcSheet} r${rec.srcRow}`, diffs,
        });
      } else {
        report.unchanged++;
      }
      if (rec.dirTs === 'T/S') {
        report.tsRows.push({ row: u.row, bl: rec.bl, svc: rec.svc, ts: rec.pod, fpod: rec.fpod, isNew: false });
      }
    }

    /* ---- 2. insert the new rows ------------------------------------- */
    if (inserts.length) {
      const at = sv.lastData + 1;
      const made = ed.insertRows(pkg, TARGET_SHEET, at, inserts.length, { styleFrom: sv.lastData });
      inserts.forEach((rec, i) => {
        fillNewRow(made.doc, made.rows[i], rec, made.tplCells);
        report.changes.push({
          kind: 'inserted', row: at + i, bl: rec.bl, svc: rec.svc,
          src: `${rec.srcSheet} r${rec.srcRow}`,
          teu: N().computeTeu({
            c20dv: rec.boxes[0], c20mt: rec.boxes[1], c40hc: rec.boxes[2],
            c40mt: rec.boxes[3], c20fr: rec.boxes[4], c40fr: rec.boxes[5], cvoid: rec.boxes[6],
          }),
        });
        if (rec.dirTs === 'T/S') {
          report.tsRows.push({ row: at + i, bl: rec.bl, svc: rec.svc, ts: rec.pod, fpod: rec.fpod, isNew: true });
        }
      });
      report.rowsShifted = { from: at, by: inserts.length, cancelListMovedTo: sv.cancelRow ? sv.cancelRow + inserts.length : null };
    }

    if (report.tsRows.length) {
      report.notes.push(
        `T/S ${report.tsRows.length}건은 2nd Leg 선박·ETD·2nd SVC가 비어 있습니다. ` +
        `학습.xlsx에 없는 정보이므로 담당자가 직접 채워야 합니다.`);
    }
    const noVgm = recs.filter((r) => !r.vgm).length;
    if (noVgm) {
      report.notes.push(`${noVgm}건은 학습.xlsx에 VGM 중량이 없어 Z열을 비워 두었습니다.`);
    }
    if (report.voyNormalised.length) {
      report.notes.push(
        `항차 표기 ${report.voyNormalised.length}건을 숫자+방향문자 순으로 정리했습니다 ` +
        `(${report.voyNormalised.map((v) => v.from + '→' + v.to).join(', ')}).`);
    }

    const blob = ed.save(pkg);
    return { blob, report };
  }

  function outName(original) {
    const base = String(original || 'FES_AGENCY').replace(/\.xlsx?$/i, '');
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `${base}_updated_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
  }

  /** Which of these workbooks is the agency forecast and which the register? */
  function classifyFiles(wbList) {
    let agency = null, target = null;
    for (const w of wbList) {
      const names = w.wb.sheets.map((s) => s.name);
      if (names.indexOf(TARGET_SHEET) >= 0) target = w;
      else if (names.some((nm) => /FES\s+(CSC|NWX|CCS|SKS)\s+BK\s*FCST/i.test(nm))) agency = w;
    }
    return { agency, target };
  }

  global.FProp = {
    propagate, readAgency, surveyRegister, classifyFiles, outName,
    normVoy, normBl, TARGET_SHEET, H, F,
  };
})(typeof window !== 'undefined' ? window : globalThis);
