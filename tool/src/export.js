/* ============================================================================
   export.js — assemble the consolidated deliverable workbook.
   Column orders deliberately mirror the source files so the output can be
   dropped straight into the existing routine.
   ========================================================================= */
(function (global) {
  'use strict';

  const N = () => global.FNorm;
  const W = () => global.FXlsxWrite;

  function H(labels) { return labels.map((l) => ({ v: l, s: 'hdr' })); }
  function D(v) {
    const d = N().toDate(v);
    return d ? { v: d, s: 'date' } : '';
  }
  function num(v, style) {
    const x = N().num(v);
    return x ? { v: Math.round(x * 100) / 100, s: style || 'dec' } : '';
  }
  function int(v) {
    const x = N().num(v);
    return x ? { v: x, s: 'int' } : '';
  }

  /* ------------------------------------------------------------------ *
   * 1. MASTER BK FCST — the consolidated register
   * ------------------------------------------------------------------ */
  const MASTER_COLS = [
    'Remark', 'Customer', 'BK PARTY', 'B/L NO', '1st Leg Vessel', 'Voy', 'ETD', '1st Leg WK',
    '2nd Leg Vessel', 'Voy', 'ETD', '2nd Leg WK', 'DIR/TS', '1st SVC', '2nd SVC',
    'POL', 'T/S', 'F.POD',
    "20'DV", "20'MT", "40'HC", "40'MT", "20'FR", "40'FR", 'Void',
    'TEU', 'VGM Wt.', 'Wt./TEU', 'Item', 'Rate/Box', 'Lumpsum Rate',
    'Status', 'Source File', 'Source Sheet', 'Src Row', 'First Seen', 'Last Seen',
  ];
  const MASTER_W = [24, 20, 14, 24, 20, 9, 11, 9, 20, 9, 11, 9, 8, 8, 8, 9, 9, 9,
    7, 7, 7, 7, 7, 7, 6, 7, 10, 9, 22, 10, 12, 9, 26, 20, 8, 18, 18];

  function masterRow(r) {
    const n = N();
    return [
      r.remark, r.customer, r.bkParty, r.blNo,
      r.leg1Vessel, r.leg1Voy, D(r.leg1Etd), int(r.wk),
      r.leg2Vessel, r.leg2Voy, D(r.leg2Etd), int(r.wk2),
      r.dirTs, N().svcOf(r), r.svc2,
      r.pol, r.ts, r.fpod,
      int(r.c20dv), int(r.c20mt), int(r.c40hc), int(r.c40mt), int(r.c20fr), int(r.c40fr), int(r.cvoid),
      num(r.teu), num(r.vgmWt), num(r.wtPerTeu), r.item, num(r.ratePerBox), num(r.lumpsum),
      r.status, r.srcFile, r.srcSheet, int(r.srcRow),
      D(r.firstSeen && r.firstSeen.slice(0, 10)), D(r.lastSeen && r.lastSeen.slice(0, 10)),
    ];
  }

  function totalsRow(records, offset, label) {
    const n = N();
    const row = new Array(MASTER_COLS.length).fill('');
    row[0] = { v: label, s: 'bold' };
    const boxKeys = ['c20dv', 'c20mt', 'c40hc', 'c40mt', 'c20fr', 'c40fr', 'cvoid'];
    boxKeys.forEach((k, i) => {
      const s = records.reduce((a, r) => a + n.num(r[k]), 0);
      row[offset + i] = { v: s, s: 'money' };
    });
    row[offset + 7] = { v: Math.round(records.reduce((a, r) => a + n.num(r.teu), 0) * 100) / 100, s: 'money' };
    row[offset + 8] = { v: Math.round(records.reduce((a, r) => a + n.num(r.vgmWt), 0) * 100) / 100, s: 'money' };
    row[offset + 13] = { v: Math.round(records.reduce((a, r) => a + n.num(r.lumpsum), 0) * 100) / 100, s: 'money' };
    return row;
  }

  /* ------------------------------------------------------------------ *
   * 2. Per-service sheets in the agency layout
   * ------------------------------------------------------------------ */
  const SVC_COLS = [
    'Remark', 'Agency', 'B/L NO', 'Vessel', 'Voy', 'WK', 'ETD', 'POL', 'POD', 'F.POD',
    "20'DV", "20'MT", "40'HC", "40'MT", "20'FR", "40'FR", 'Void',
    'TEU', 'VGM Wt.', 'Wt./TEU', 'Item', 'Rate/Box', 'Lumpsum Rate',
  ];
  const SVC_W = [24, 14, 24, 20, 9, 6, 11, 9, 9, 9, 7, 7, 7, 7, 7, 7, 6, 7, 10, 9, 22, 10, 12];

  function svcRow(r) {
    return [
      r.remark, r.bkParty, r.blNo, r.leg1Vessel, r.leg1Voy, int(r.wk), D(r.leg1Etd),
      r.pol, r.pod, r.fpod,
      int(r.c20dv), int(r.c20mt), int(r.c40hc), int(r.c40mt), int(r.c20fr), int(r.c40fr), int(r.cvoid),
      num(r.teu), num(r.vgmWt), num(r.wtPerTeu), r.item, num(r.ratePerBox), num(r.lumpsum),
    ];
  }

  /* ------------------------------------------------------------------ *
   * Build
   * ------------------------------------------------------------------ */
  async function buildWorkbook(st, ag, opts) {
    const n = N();
    const o = opts || {};
    const agg = ag || global.FAgg.build(st);
    const sheets = [];
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

    /* --- MASTER BK FCST ------------------------------------------- */
    const active = agg.active.slice().sort(
      (a, b) => (a.leg1Etd || 'zzzz').localeCompare(b.leg1Etd || 'zzzz') ||
                (a.leg1Vessel || '').localeCompare(b.leg1Vessel || '') ||
                (a.blNo || '').localeCompare(b.blNo || '')
    );
    const mrows = [H(MASTER_COLS)];
    active.forEach((r) => mrows.push(masterRow(r)));
    mrows.push(totalsRow(active, 18, `TOTAL — ${active.length} bookings`));
    sheets.push({
      name: 'MASTER BK FCST', rows: mrows, cols: MASTER_W.map((w) => ({ w })),
      freeze: 'E2', autofilter: true,
    });

    /* --- per-service sheets --------------------------------------- */
    const svcOrder = n.SERVICE_CODES.concat(
      agg.byService.map((s) => s.key).filter((k) => n.SERVICE_CODES.indexOf(k) < 0)
    );
    for (const svc of svcOrder) {
      const rows = active.filter((r) => (n.svcOf(r) || '(unknown)') === svc);
      if (!rows.length) continue;
      const body = [
        [{ v: `SVC NAME : ${svc}`, s: 'title' }, '', '', '',
         { v: `${rows.length} bookings`, s: 'bold' }, '',
         { v: `generated ${stamp}`, s: 'def' }],
        [{ v: 'Tare weight', s: 'sub' }, { v: "20FT", s: 'sub' }, { v: n.TARE.ft20, s: 'dec' },
         { v: "40FT", s: 'sub' }, { v: n.TARE.ft40, s: 'dec' }],
        [],
        H(SVC_COLS),
      ];
      rows.forEach((r) => body.push(svcRow(r)));
      /* weekly subtotals, mirroring their SUMIF row */
      const wks = Array.from(new Set(rows.map((r) => r.wk).filter(Boolean))).sort((a, b) => a - b);
      body.push([]);
      body.push([{ v: 'WEEKLY SUBTOTAL', s: 'sub' }].concat(new Array(SVC_COLS.length - 1).fill({ v: '', s: 'sub' })));
      for (const wk of wks) {
        const sub = rows.filter((r) => r.wk === wk);
        const row = new Array(SVC_COLS.length).fill('');
        row[0] = { v: `WK ${wk}`, s: 'bold' };
        row[5] = { v: wk, s: 'int' };
        ['c20dv', 'c20mt', 'c40hc', 'c40mt', 'c20fr', 'c40fr', 'cvoid'].forEach((k, i) => {
          const s = sub.reduce((a, r) => a + n.num(r[k]), 0);
          if (s) row[10 + i] = { v: s, s: 'money' };
        });
        row[17] = { v: Math.round(sub.reduce((a, r) => a + n.num(r.teu), 0) * 100) / 100, s: 'money' };
        row[18] = { v: Math.round(sub.reduce((a, r) => a + n.num(r.vgmWt), 0) * 100) / 100, s: 'money' };
        body.push(row);
      }
      sheets.push({
        name: `FES ${svc} BK FCST`, rows: body, cols: SVC_W.map((w) => ({ w })),
        freeze: 'D5', autofilter: true, autofilterRow: 4,
      });
    }

    /* --- VOYAGE SUMMARY ------------------------------------------- */
    const vcols = ['SVC', 'Vessel', 'Voy', 'ETD', 'WK', 'Bookings', 'Cancelled',
      "20' units", "40' units", 'Booked TEU', 'Peak TEU', 'BSA TEU', 'Remaining TEU', 'Util %',
      'Booked Ton', 'Peak Ton', 'BSA Ton', 'Remaining Ton',
      'DF Base', 'DF Excess', 'Slot / TEU', 'Selling', 'Profit',
      'Win-Sabis', 'DOC Closing', 'Cargo Closing', 'Schedule Remark'];
    const vrows = [H(vcols)];
    for (const v of agg.byVoyage) {
      const over = v.bsaTeu && v.peakTeu > v.bsaTeu;
      vrows.push([
        v.svc, v.vessel, v.voy, D(v.etd), int(v.wk), int(v.rows), int(v.cancelRows),
        int(v.u20), int(v.u40), num(v.teu), num(v.peakTeu), int(v.bsaTeu),
        v.remainTeu === null ? '' : { v: v.remainTeu, s: over ? 'warn' : 'good' },
        v.utilPct === null ? '' : { v: v.utilPct / 100, s: 'pct' },
        num(v.wt), num(v.peakTon), int(v.bsaTon),
        v.remainTon === null ? '' : { v: v.remainTon, s: v.bsaTon && v.peakTon > v.bsaTon ? 'warn' : 'good' },
        num(v.dfBase), num(v.dfExcess), num(v.slotPerTeu), num(v.selling),
        v.profit === null ? '' : { v: v.profit, s: v.profit < 0 ? 'warn' : 'good' },
        v.winSabis, v.docClosing, v.cargoClosing, v.scheduleRemark,
      ]);
    }
    sheets.push({
      name: 'VOYAGE SUMMARY', rows: vrows,
      cols: [7, 20, 9, 11, 6, 10, 10, 9, 9, 11, 10, 9, 13, 8, 11, 10, 9, 13, 11, 10, 10, 11, 11, 14, 14, 14, 30].map((w) => ({ w })),
      freeze: 'D2', autofilter: true,
    });

    /* --- ROB LOAD PLAN ------------------------------------------- */
    const rcols = ['SVC', 'Vessel', 'Voy', 'Seq', 'Port', 'ETD', 'WK',
      'Load TEU', "Load 20'", "Load 40'", 'Load NDG', 'Load DG', 'Load OOG', 'Load Ton',
      'Disch TEU', 'Disch Ton', 'On-board TEU', "On-board 20'", "On-board 40'", 'On-board Ton',
      'BSA TEU', 'Remaining TEU', 'BSA Ton', 'Remaining Ton', 'Note'];
    const rrows = [H(rcols)];
    for (const v of agg.byVoyage) {
      if (!v.rob || !v.rob.legs.length) continue;
      if (!v.rows && !v.bsaTeu) continue;
      for (const lg of v.rob.legs) {
        rrows.push([
          v.svc, v.vessel, v.voy, int(lg.seq), lg.port, D(lg.etd), int(lg.wk),
          num(lg.loadTeu), int(lg.load20), int(lg.load40),
          num(lg.loadNDG), num(lg.loadDG), num(lg.loadOOG), num(lg.loadTon),
          num(lg.dischTeu), num(lg.dischTon),
          num(lg.onboardTeu), int(lg.onboard20), int(lg.onboard40), num(lg.onboardTon),
          int(v.bsaTeu),
          lg.remainTeu === null ? '' : { v: lg.remainTeu, s: lg.remainTeu < 0 ? 'warn' : 'good' },
          int(v.bsaTon),
          lg.remainTon === null ? '' : { v: lg.remainTon, s: lg.remainTon < 0 ? 'warn' : 'good' },
          lg.note,
        ]);
      }
      rrows.push([]);
    }
    sheets.push({
      name: 'ROB LOAD PLAN', rows: rrows,
      cols: [7, 20, 9, 5, 10, 11, 6, 10, 9, 9, 10, 9, 10, 10, 10, 10, 13, 12, 12, 13, 9, 13, 9, 13, 24].map((w) => ({ w })),
      freeze: 'E2', autofilter: true,
    });

    /* --- WEEK SUMMARY -------------------------------------------- */
    const svcKeys = agg.byService.map((s) => s.key);
    const wrows = [H(['WK'].concat(svcKeys, ['TOTAL TEU', 'Bookings', 'Boxes', 'VGM Ton', 'Revenue']))];
    for (const w of agg.byWeek) {
      const row = [int(w.key)];
      for (const s of svcKeys) {
        const v = (agg.matrix[s] && agg.matrix[s][w.key]) || 0;
        row.push(v ? { v: Math.round(v * 100) / 100, s: 'dec' } : '');
      }
      row.push({ v: w.teu, s: 'money' }, int(w.rows), int(w.boxes), num(w.wt), num(w.revenue));
      wrows.push(row);
    }
    const totRow = [{ v: 'TOTAL', s: 'bold' }];
    for (const s of svcKeys) {
      const v = agg.byService.find((x) => x.key === s);
      totRow.push({ v: v ? v.teu : 0, s: 'money' });
    }
    totRow.push({ v: agg.totals.teu, s: 'money' }, { v: agg.totals.rows, s: 'money' },
                { v: agg.totals.boxes, s: 'money' }, { v: agg.totals.wt, s: 'money' },
                { v: agg.totals.revenue, s: 'money' });
    wrows.push(totRow);
    sheets.push({
      name: 'WEEK SUMMARY', rows: wrows,
      cols: [6].concat(svcKeys.map(() => 10), [12, 10, 9, 11, 13]).map((w) => ({ w })),
      freeze: 'B2',
    });

    /* --- LANE / PARTY -------------------------------------------- */
    const lrows = [H(['POL → F.POD', 'Bookings', 'TEU', "20' units", "40' units", 'Boxes', 'VGM Ton', 'Revenue'])];
    for (const l of agg.byLane) {
      lrows.push([l.key, int(l.rows), num(l.teu), int(l.u20), int(l.u40), int(l.boxes), num(l.wt), num(l.revenue)]);
    }
    sheets.push({ name: 'LANE SUMMARY', rows: lrows, cols: [26, 10, 9, 9, 9, 8, 11, 13].map((w) => ({ w })), freeze: 'B2', autofilter: true });

    const prows = [H(['BK Party', 'Bookings', 'TEU', 'Boxes', 'VGM Ton', 'Revenue'])];
    for (const p of agg.byParty) prows.push([p.key, int(p.rows), num(p.teu), int(p.boxes), num(p.wt), num(p.revenue)]);
    if (agg.byCustomer.length) {
      prows.push([]);
      prows.push(H(['Customer', 'Bookings', 'TEU', 'Boxes', 'VGM Ton', 'Revenue']));
      for (const c of agg.byCustomer) prows.push([c.key, int(c.rows), num(c.teu), int(c.boxes), num(c.wt), num(c.revenue)]);
    }
    sheets.push({ name: 'PARTY SUMMARY', rows: prows, cols: [34, 10, 9, 8, 11, 13].map((w) => ({ w })), freeze: 'B2' });

    /* --- CANCEL LIST --------------------------------------------- */
    if (agg.cancelled.length) {
      const crows = [
        [{ v: '** CANCEL LIST', s: 'title' }, '', '', { v: `${agg.cancelled.length} rows`, s: 'bold' }],
        [],
        H(MASTER_COLS),
      ];
      agg.cancelled
        .slice()
        .sort((a, b) => (a.leg1Etd || '').localeCompare(b.leg1Etd || ''))
        .forEach((r) => crows.push(masterRow(r)));
      sheets.push({
        name: 'CANCEL LIST', rows: crows, cols: MASTER_W.map((w) => ({ w })),
        freeze: 'E4', autofilter: true, autofilterRow: 3,
      });
    }

    /* --- CHANGE LOG ---------------------------------------------- */
    const glrows = [H(['When', 'Batch', 'Added', 'Updated', 'Unchanged', 'Cancelled', 'Total after', 'Files'])];
    for (const e of st.log) {
      glrows.push([
        e.ts.replace('T', ' ').slice(0, 19), e.label,
        int(e.added), int(e.updated), int(e.unchanged), int(e.cancelled), int(e.total),
        (e.files || []).join(', '),
      ]);
    }
    glrows.push([]);
    glrows.push(H(['When', 'Batch', 'Change', 'B/L NO', 'Voyage', 'TEU', 'Field', 'From', 'To']));
    for (const e of st.log) {
      for (const c of (e.changes || [])) {
        if (c.type === 'added') {
          glrows.push([e.ts.replace('T', ' ').slice(0, 19), e.label, 'added', c.blNo, c.voy, num(c.teu)]);
        } else {
          for (const d of (c.diff || [])) {
            glrows.push([e.ts.replace('T', ' ').slice(0, 19), e.label, 'updated', c.blNo, c.voy, num(c.teu),
              d.f, String(d.from == null ? '' : d.from), String(d.to == null ? '' : d.to)]);
          }
        }
      }
    }
    sheets.push({ name: 'CHANGE LOG', rows: glrows, cols: [20, 22, 10, 10, 11, 10, 12, 40, 16, 22, 22].map((w) => ({ w })), freeze: 'A2' });

    /* --- DF CONTRACTS -------------------------------------------- */
    if (st.df && st.df.length) {
      const drows = [H(['Provider', 'SVC', 'Period label', 'Period', 'Maiden VOY', 'Term',
        'Rate / TEU', 'Vol TEU', 'Wt Ton', 'Fixed Amount', 'Actual Slot / TEU', 'Surcharges', 'Source'])];
      for (const d of st.df) {
        const sur = Object.keys(d.surcharges || {})
          .map((k) => `${k} ${d.surcharges[k].rate}/${d.surcharges[k].unit}`).join('; ');
        drows.push([d.provider, d.svc, d.periodLabel, d.period, d.maidenVoy, d.term,
          num(d.ratePerTeu), int(d.volTeu), int(d.wtTon), num(d.fixedAmount),
          num(d.actualSlotPerTeu), sur, d.srcSheet]);
      }
      sheets.push({ name: 'DF CONTRACTS', rows: drows, cols: [10, 7, 16, 22, 40, 8, 11, 9, 9, 13, 15, 40, 26].map((w) => ({ w })), freeze: 'C2' });
    }

    /* --- DATA QUALITY -------------------------------------------- */
    const qrows = [
      [{ v: 'Farmkogls booking consolidation — data quality', s: 'title' }],
      [{ v: 'Generated', s: 'sub' }, stamp],
      [{ v: 'Source files', s: 'sub' }, (st.files || []).join(', ')],
      [{ v: 'Active bookings', s: 'sub' }, { v: agg.totals.rows, s: 'money' },
       { v: 'Active TEU', s: 'sub' }, { v: agg.totals.teu, s: 'money' }],
      [{ v: 'Cancelled', s: 'sub' }, { v: agg.totals.cancelledRows, s: 'money' },
       { v: 'Cancelled TEU', s: 'sub' }, { v: agg.totals.cancelledTeu, s: 'money' }],
      [{ v: 'Empty-repo TEU', s: 'sub' }, { v: agg.totals.emptyRepoTeu, s: 'money' }],
      [],
      H(['Level', 'Finding']),
    ];
    for (const a of agg.alerts) {
      qrows.push([{ v: a.level, s: a.level === 'over' ? 'warn' : 'def' }, { v: a.text, s: 'wrap' }]);
    }
    if (!agg.alerts.length) qrows.push([{ v: 'ok', s: 'good' }, 'No issues detected.']);
    qrows.push([]);
    qrows.push(H(['Container type', 'Units', 'TEU']));
    for (const m of agg.mix) qrows.push([m.key, int(m.units), num(m.teu)]);

    /* Where two files described the same booking differently. */
    if (st.conflicts && st.conflicts.length) {
      qrows.push([]);
      qrows.push([{ v: 'SOURCE DISAGREEMENTS — same booking, different values', s: 'title' }]);
      qrows.push(H(['B/L NO', 'Voyage', 'Field', 'Kept', 'Kept from', 'Ignored', 'Ignored from']));
      for (const c of st.conflicts.slice(0, 300)) {
        qrows.push([c.blNo, c.voy, c.field, c.kept, c.keptFrom, c.dropped, c.droppedFrom]);
      }
    }
    sheets.push({
      name: 'DATA QUALITY', rows: qrows,
      cols: [26, 90, 16, 24, 30, 24, 30].map((w) => ({ w })),
    });

    return W().build(sheets);
  }

  function fileName(prefix) {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `${prefix || 'FES_BK_FCST_CONSOLIDATED'}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
  }

  global.FExport = { buildWorkbook, fileName, MASTER_COLS, SVC_COLS };
})(typeof window !== 'undefined' ? window : globalThis);
