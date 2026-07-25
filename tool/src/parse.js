/* ============================================================================
   parse.js — recognise Farmkogls workbook layouts and emit canonical records.

   Recognised sheet kinds:
     agencyForecast  overseas agency weekly forecast   (FES <SVC> BK FCST)
     masterForecast  consolidated register             (FES BK FCST)
     bkSheet         per-voyage booking sheet          ("... 마감")
     schedule        service port rotation             (Schedule / SCHEDULE)
     bsa             block space allocation            (<SVC> BSA)
     dfContract      dead-freight slot contract        (GFS_/BTL_/XPR_ ...)
     rob             remaining-on-board load plan      (per-vessel)
   ========================================================================= */
(function (global) {
  'use strict';

  const N = () => global.FNorm;

  /* ------------------------------------------------------------------ *
   * Header vocabulary
   * ------------------------------------------------------------------ */
  function hkey(v) {
    return String(v == null ? '' : v)
      .replace(/ /g, ' ')
      .replace(/[\n\r]+/g, ' ')
      .trim().toUpperCase()
      .replace(/\s+/g, ' ')
      .replace(/['’`]/g, "'");
  }

  /* exact-match table: normalised header text -> canonical field */
  const H_EXACT = {
    // identity / parties
    'REMARK': 'remark',
    "CANCEL 사유/선적전 REMARK": 'remark',
    'CUSTOMER': 'customer',
    'BK PARTY': 'bkParty',
    'AGNECY': 'bkParty', 'AGENCY': 'bkParty',
    'SHIPPER': 'bkParty',
    "B/L NO": 'blNo', "B/L NO.": 'blNo', 'BL NO': 'blNo', "B/LNO": 'blNo',
    // vessel / voyage / timing
    'VESSEL': 'leg1VesselOnly', 'VSL': 'leg1VesselOnly',
    'VOY': 'leg1Voy', 'VOY.': 'leg1Voy', 'VOYAGE': 'leg1Voy',
    '1ST LEG VESSEL': 'leg1Vessel',
    '2ND LEG VESSEL': 'leg2Vessel',
    'WK': 'leg1Wk', '1ST LEG ETD': 'leg1Wk', '2ND LEG WK': 'leg2Wk',
    'ETD': 'etd', 'ETD ': 'etd',
    'BK DATE': 'bkDate', 'BK DATE.': 'bkDate',
    'CANCEL DATE': 'cancelDate',
    // routing
    'DIR/TS': 'dirTs',
    '1ST SVC': 'svc1', '2ND SVC': 'svc2', 'SVC': 'svc1', 'SVC NAME': 'svc1',
    'POL': 'pol', 'POD': 'pod', 'T/S': 'ts', 'F.POD': 'fpod', 'FINAL POD': 'fpod',
    // boxes
    "20'DV": 'c20dv', '20DV': 'c20dv', "20' DV": 'c20dv',
    "20'MT": 'c20mt', '20MT': 'c20mt',
    "40'HC": 'c40hc', '40HC': 'c40hc', "40'HQ": 'c40hc', '40HQ': 'c40hc',
    "40'MT": 'c40mt', '40MT': 'c40mt',
    "20'FR": 'c20fr', '20FR': 'c20fr',
    "40'FR": 'c40fr', '40FR': 'c40fr',
    'VOID': 'cvoid',
    // measures
    'TEU': 'teu',
    'VGM WT.': 'vgmWt', 'VGM WT': 'vgmWt', 'VGM WT. (MT)': 'vgmWt', 'VGM WEIGHT': 'vgmWt',
    'WT./TEU': 'wtPerTeu', 'WT/TEU': 'wtPerTeu',
    'ITEM': 'item',
    'RATE/BOX': 'ratePerBox', 'LUMPSUM RATE': 'lumpsum',
    // BK-sheet extras
    'SPECIAL(DG/OOG)': 'special', 'SPECIAL (DG/OOG)': 'special', 'SPECIAL': 'special',
    'SPECIAL APPROVAL': 'specialApproval',
    'PICK UP TERMINAL': 'pickupTerminal', 'PICK UP DATE': 'pickupDate',
    '영업사원': 'salesRep',
    '청구 특이사항': 'billingNote',
    'SELLING RATE': 'sellingRateBlock',
  };

  function fieldFor(text) {
    const k = hkey(text);
    if (!k) return null;
    if (H_EXACT[k]) return H_EXACT[k];
    // tolerant fallbacks for wrapped / suffixed headers
    if (/^B\/?L\s*NO/.test(k)) return 'blNo';
    if (/^VGM/.test(k)) return 'vgmWt';
    if (/^F\.?\s*POD/.test(k)) return 'fpod';
    if (/^PICK\s*UP\s*TER/.test(k)) return 'pickupTerminal';
    if (/^PICK\s*UP\s*DATE/.test(k)) return 'pickupDate';
    if (/^LUMPSUM/.test(k)) return 'lumpsum';
    if (/^RATE\s*\/\s*BOX/.test(k)) return 'ratePerBox';
    return null;
  }

  const BOX_KEYS = ['c20dv', 'c20mt', 'c40hc', 'c40mt', 'c20fr', 'c40fr', 'cvoid'];

  /* Service code inside a label such as "CSC_Schedule" or "SVC : CCS".
     Note \b is useless here: '_' counts as a word character, so \bCSC\b never
     matches "CSC_Schedule". */
  const SVC_IN_TEXT = /(?:^|[^A-Z])(CSC|NWX|CCS|SKS)(?:[^A-Z]|$)/;
  function svcFromText(v) {
    if (v == null) return '';
    const m = hkey(v).match(SVC_IN_TEXT);
    return m ? m[1] : '';
  }

  /* ------------------------------------------------------------------ *
   * Header-row detection
   * ------------------------------------------------------------------ */
  function findHeaderRow(sh, maxScan) {
    const limit = Math.min(sh.nrows, maxScan || 40);
    let best = null;
    for (let r = 1; r <= limit; r++) {
      const row = sh.cells[r];
      if (!row) continue;
      const map = {};
      let hits = 0, boxHits = 0, hasBl = false;
      for (let c = 1; c <= sh.ncols; c++) {
        const cell = row[c];
        if (!cell || cell.v == null || cell.v === '') continue;
        const f = fieldFor(cell.v);
        if (!f) continue;
        if (map[f] === undefined) { map[f] = c; hits++; }
        if (BOX_KEYS.indexOf(f) >= 0) boxHits++;
        if (f === 'blNo') hasBl = true;
      }
      if (hits >= 6 && boxHits >= 2 && hasBl) {
        if (!best || hits > best.hits) best = { row: r, map, hits };
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ *
   * Sheet classification
   * ------------------------------------------------------------------ */
  function scanText(sh, maxRow, maxCol) {
    const out = [];
    const R = Math.min(sh.nrows, maxRow || 15);
    const C = Math.min(sh.ncols, maxCol || 40);
    for (let r = 1; r <= R; r++) {
      const row = sh.cells[r];
      if (!row) continue;
      for (let c = 1; c <= C; c++) {
        const cell = row[c];
        if (cell && typeof cell.v === 'string' && cell.v.trim()) {
          out.push({ r, c, t: hkey(cell.v) });
        }
      }
    }
    return out;
  }

  function classify(sh) {
    const head = scanText(sh, 14, 40);
    const txt = head.map((x) => x.t).join(' § ');
    const nm = hkey(sh.name);

    if (/DF CONTRACT/.test(txt) && /RATE\s*:/.test(txt)) return 'dfContract';
    if (/VSL\/VOY/.test(txt) && /\bWK\b/.test(txt)) return 'schedule';
    if (/(NORTHBOUND|SOUTHBOUND)/.test(txt) && /VESSEL\s*\/\s*VOY|BSA/.test(txt + ' ' + nm)) return 'bsa';
    if (/\bBSA\b/.test(nm)) return 'bsa';
    if (/TOTAL\(INCL\. ROB\)|LUMPSUM TEU|OOG\(VOID\)/.test(txt)) return 'rob';

    const hdr = findHeaderRow(sh);
    if (hdr) {
      if (hdr.map.leg1Vessel !== undefined || hdr.map.leg2Vessel !== undefined) return 'masterForecast';
      if (hdr.map.pickupTerminal !== undefined || hdr.map.cancelDate !== undefined ||
          hdr.map.special !== undefined || hdr.map.salesRep !== undefined) return 'bkSheet';
      if (hdr.map.leg1VesselOnly !== undefined) return 'agencyForecast';
      return 'genericForecast';
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Small readers
   * ------------------------------------------------------------------ */
  /**
   * Value immediately right of a label cell.
   * `sh.get` resolves merged regions, so a label merged across two columns
   * would otherwise echo itself — skip any cell that repeats the label text.
   */
  function valueRightOf(sh, r, c, span) {
    const label = hkey(sh.get(r, c));
    for (let k = 1; k <= (span || 6); k++) {
      const v = sh.get(r, c + k);
      if (v == null || v === '') continue;
      if (hkey(v) === label) continue;
      return v;
    }
    return null;
  }

  function findLabel(sh, re, maxRow, maxCol) {
    const R = Math.min(sh.nrows, maxRow || 15);
    const C = Math.min(sh.ncols, maxCol || 45);
    for (let r = 1; r <= R; r++) {
      for (let c = 1; c <= C; c++) {
        const v = sh.get(r, c);
        if (typeof v === 'string' && re.test(hkey(v))) return { r, c, v };
      }
    }
    return null;
  }

  /** "50(70)" -> {own:50, vessel:70}; "70+1" -> {own:71}; "600(910)" -> {own:600, vessel:910} */
  function parseCapacity(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return { own: raw, vessel: null, raw: String(raw) };
    const s = String(raw).trim();
    const paren = s.match(/\(([\d.,]+)\)/);
    const base = s.replace(/\([^)]*\)/g, '');
    const nums = (base.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (!nums.length) return null;
    let own = nums[0];
    if (/\+/.test(base) && nums.length > 1) own = nums.reduce((a, b) => a + b, 0);
    return { own, vessel: paren ? Number(paren[1].replace(/,/g, '')) : null, raw: s };
  }

  /* ------------------------------------------------------------------ *
   * Booking-row extraction (shared by all three booking layouts)
   * ------------------------------------------------------------------ */
  const STOP_RE = /^(GRAND TOTAL|TOTAL|TOTAL\s*:|ACCOUNT NO|소계|합계|SUB TOTAL)/;
  const CANCEL_SECTION_RE = /(CANCEL 정리|\*+\s*CANCEL LIST|CANCEL LIST)/;
  /* Summary/subtotal rows that sit inside the data range and must not become bookings. */
  const TOTALS_HINT_RE =
    /(GRAND TOTAL|SUB\s*TOTAL|ACCOUNT NO|TOTAL SELLING|TOTAL\s*:|PROFIT|합계|소계|선적 합계|부산 선적|TTL\b)/;

  function extractBookings(sh, hdr, kind, ctx) {
    const n = N();
    const map = hdr.map;
    const out = [];
    let cancelMode = false;

    const col = (f) => map[f];
    const val = (r, f) => (col(f) === undefined ? null : sh.get(r, col(f)));

    for (let r = hdr.row + 1; r <= sh.nrows; r++) {
      const row = sh.cells[r];

      /* Section switches -------------------------------------------- */
      let joined = '';
      if (row) {
        for (let c = 1; c <= Math.min(sh.ncols, 12); c++) {
          const cell = row[c];
          if (cell && typeof cell.v === 'string') joined += ' ' + hkey(cell.v);
        }
      }
      if (CANCEL_SECTION_RE.test(joined)) { cancelMode = true; continue; }
      if (!row) continue;

      /* A repeat of the header (the cancel list re-prints it) --------- */
      const blRaw = val(r, 'blNo');
      if (typeof blRaw === 'string' && /^B\/?L\s*NO/.test(hkey(blRaw))) continue;

      /* Totals / summary rows ---------------------------------------- */
      if (TOTALS_HINT_RE.test(joined)) continue;
      const firstTxt = hkey(sh.get(r, map.remark !== undefined ? map.remark : 1));
      if (STOP_RE.test(firstTxt)) continue;

      /* Gather the record ------------------------------------------- */
      const rec = {
        srcFile: sh.file, srcSheet: sh.name, srcRow: r, srcKind: kind,
        status: cancelMode ? 'cancel' : 'active',
      };

      rec.remark = n.str(val(r, 'remark'));
      rec.customer = n.str(val(r, 'customer'));
      const party = n.canonParty(val(r, 'bkParty'));
      rec.bkParty = party.party;
      rec.partySvc = party.partySvc;
      rec.blNo = n.str(val(r, 'blNo')).replace(/\s*\n\s*/g, ' / ');
      rec.item = n.str(val(r, 'item'));
      rec.special = n.str(val(r, 'special'));
      rec.specialApproval = n.str(val(r, 'specialApproval'));
      rec.salesRep = n.str(val(r, 'salesRep'));
      rec.billingNote = n.str(val(r, 'billingNote'));
      rec.pickupTerminal = n.str(val(r, 'pickupTerminal'));

      /* boxes */
      for (const k of BOX_KEYS) rec[k] = n.num(val(r, k));

      /* dates */
      rec.bkDate = n.isoDate(n.toDate(val(r, 'bkDate')));
      rec.cancelDate = n.isoDate(n.toDate(val(r, 'cancelDate')));
      rec.pickupDate = n.isoDate(n.toDate(val(r, 'pickupDate')));
      if (rec.cancelDate && rec.status === 'active') rec.status = 'cancel';

      /* vessel / voyage / legs -------------------------------------- */
      if (kind === 'masterForecast') {
        const a = n.splitVesselVoy(val(r, 'leg1Vessel'));
        rec.leg1Vessel = a.vessel; rec.leg1Voy = a.voy;
        const b = n.splitVesselVoy(val(r, 'leg2Vessel'));
        rec.leg2Vessel = b.vessel; rec.leg2Voy = b.voy;
        rec.leg1Etd = n.isoDate(n.toDate(val(r, 'etd')));
        /* the 2nd-leg ETD is the column immediately left of "2nd Leg WK" */
        if (map.leg2Wk !== undefined) {
          rec.leg2Etd = n.isoDate(n.toDate(sh.get(r, map.leg2Wk - 1)));
        }
        rec.svc1 = n.canonSvc(val(r, 'svc1'));
        rec.svc2 = n.canonSvc(val(r, 'svc2'));
        rec.dirTs = n.canonDirTs(val(r, 'dirTs'));
        rec.pol = n.canonPort(val(r, 'pol'));
        rec.ts = n.canonPort(val(r, 'ts'));
        rec.fpod = n.canonPort(val(r, 'fpod'));
        rec.pod = rec.ts || rec.fpod;
      } else if (kind === 'agencyForecast' || kind === 'genericForecast') {
        rec.leg1Vessel = n.canonVessel(val(r, 'leg1VesselOnly'));
        rec.leg1Voy = n.canonVoy(val(r, 'leg1Voy'));
        if (!rec.leg1Voy && rec.leg1Vessel) {
          const s = n.splitVesselVoy(rec.leg1Vessel);
          rec.leg1Vessel = s.vessel; rec.leg1Voy = s.voy;
        }
        rec.leg1Etd = n.isoDate(n.toDate(val(r, 'etd')));
        rec.pol = n.canonPort(val(r, 'pol'));
        rec.pod = n.canonPort(val(r, 'pod'));
        rec.fpod = n.canonPort(val(r, 'fpod')) || rec.pod;
        rec.svc1 = n.canonSvc(val(r, 'svc1')) || (ctx && ctx.svc) || '';
        rec.dirTs = rec.pod && rec.fpod && rec.pod !== rec.fpod ? 'TS' : 'DIR';
        rec.leg2Vessel = ''; rec.leg2Voy = ''; rec.leg2Etd = '';
        rec.svc2 = '';
      } else { /* bkSheet */
        rec.leg1Vessel = (ctx && ctx.vessel) || '';
        rec.leg1Voy = (ctx && ctx.voy) || '';
        rec.svc1 = (ctx && ctx.svc) || '';
        rec.pol = n.canonPort(val(r, 'pol'));
        /* Adopt the sheet's ETD only for cargo loaded at the port it refers to;
           the schedule fills in the rest after the merge. */
        rec.leg1Etd = (ctx && ctx.etd &&
          (!ctx.etdPort || ctx.etdPort === rec.pol)) ? ctx.etd : '';
        rec.voyEtdRef = (ctx && ctx.etd) || '';
        rec.pod = n.canonPort(val(r, 'pod'));
        rec.fpod = n.canonPort(val(r, 'fpod')) || rec.pod;
        rec.dirTs = rec.fpod && rec.pod && rec.fpod !== rec.pod ? 'TS' : 'DIR';
        rec.leg2Vessel = ''; rec.leg2Voy = ''; rec.leg2Etd = '';
        rec.svc2 = '';
        rec.voyageRef = ctx && ctx.voyageKey;
      }

      if (!rec.svc1 && rec.partySvc) rec.svc1 = rec.partySvc;

      /* measures ---------------------------------------------------- */
      const teuSheet = n.num(val(r, 'teu'));
      rec.teuCalc = n.computeTeu(rec);
      rec.teu = rec.teuCalc || teuSheet;
      rec.teuSheet = teuSheet;
      rec.vgmWt = n.num(val(r, 'vgmWt'));
      rec.ratePerBox = n.num(val(r, 'ratePerBox'));
      rec.lumpsum = n.num(val(r, 'lumpsum'));
      rec.wtPerTeu = rec.teu ? Math.round((rec.vgmWt / rec.teu) * 100) / 100 : 0;
      rec.boxes = n.boxCount(rec);
      rec.wk = rec.leg1Etd ? n.excelWeekNum(rec.leg1Etd) : n.num(val(r, 'leg1Wk'));
      rec.wk2 = rec.leg2Etd ? n.excelWeekNum(rec.leg2Etd) : n.num(val(r, 'leg2Wk'));
      rec.emptyRepo = n.isEmptyRepo(rec);

      /* Drop rows that carry no information at all ------------------ */
      const hasId = rec.blNo || rec.leg1Vessel || rec.customer || rec.bkParty;
      if (!hasId && !rec.teu && !rec.boxes) continue;
      if (!rec.teu && !rec.boxes && !rec.blNo) continue;

      out.push(rec);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Per-kind context extraction
   * ------------------------------------------------------------------ */
  function agencyContext(sh) {
    const hit = findLabel(sh, /SVC\s*NAME/, 12, 30);
    let svc = '';
    if (hit) {
      const m = String(hit.v).match(/:\s*([A-Za-z]{2,5})/);
      if (m) svc = N().canonSvc(m[1]);
    }
    if (!svc) svc = svcFromText(sh.name);
    return { svc };
  }

  function bkSheetContext(sh) {
    const n = N();
    const ctx = { svc: '', vessel: '', voy: '', etd: '', bsa: null, df: {}, winSabis: '', scheduleRemark: '' };

    const svcHit = findLabel(sh, /^SVC\s*NAME\s*:?$/, 14, 20);
    if (svcHit) ctx.svc = n.canonSvc(valueRightOf(sh, svcHit.r, svcHit.c, 4));
    if (!ctx.svc) {
      const any = findLabel(sh, SVC_IN_TEXT, 14, 20);
      if (any) ctx.svc = svcFromText(any.v);
    }
    if (!ctx.svc) ctx.svc = svcFromText(sh.name);

    const vHit = findLabel(sh, /^VSL\s*&?\s*VOY\s*:?$/, 14, 20);
    if (vHit) {
      /* Vessel then voyage sit in separate merged blocks to the right. */
      const vLabel = hkey(vHit.v);
      const parts = [];
      for (let c = vHit.c + 1; c <= Math.min(sh.ncols, vHit.c + 12); c++) {
        const v = sh.get(vHit.r, c);
        if (v == null || v === '') continue;
        const s = n.str(v);
        if (!s || /^BSA/i.test(s)) break;
        if (hkey(s) === vLabel) continue;
        if (parts[parts.length - 1] !== s) parts.push(s);
      }
      const joined = parts.join(' ').trim();
      const sp = n.splitVesselVoy(joined);
      ctx.vessel = sp.vessel; ctx.voy = sp.voy;
    }
    if (!ctx.vessel) {
      /* Fall back to the sheet name, e.g. "W521 W042(0726)" */
      const nm = String(sh.name).replace(/[()]/g, ' ').replace(/마감/g, ' ').trim();
      const sp = n.splitVesselVoy(nm);
      ctx.vessel = sp.vessel; ctx.voy = sp.voy;
    }

    /* The header reads e.g. "ETD PUS :" — that date is the departure from that
       one port, so it only applies to cargo actually loaded there. */
    const etdHit = findLabel(sh, /^ETD\b/, 14, 40);
    if (etdHit) {
      ctx.etd = n.isoDate(n.toDate(valueRightOf(sh, etdHit.r, etdHit.c, 4)));
      const m = hkey(etdHit.v).match(/^ETD\s+([A-Z()]{3,10})/);
      if (m) ctx.etdPort = n.canonPort(m[1]);
    }

    const ws = findLabel(sh, /WIN-?SABIS/, 14, 20);
    if (ws) ctx.winSabis = n.str(valueRightOf(sh, ws.r, ws.c, 6));
    const sr = findLabel(sh, /SCHEDULE REMARK/, 14, 20);
    if (sr) ctx.scheduleRemark = n.str(valueRightOf(sh, sr.r, sr.c, 8));

    /* BSA block: "TEU :" / "Wt. :" near a cell containing BSA */
    const bsaHit = findLabel(sh, /^BSA/, 14, 40);
    if (bsaHit) {
      const teuLab = findLabelNear(sh, /^TEU\s*:?$/, bsaHit.r - 2, bsaHit.r + 4);
      const wtLab = findLabelNear(sh, /^WT\.?\s*:?$/, bsaHit.r - 2, bsaHit.r + 4);
      ctx.bsa = {
        teu: teuLab ? parseCapacity(valueRightOf(sh, teuLab.r, teuLab.c, 4)) : null,
        ton: wtLab ? parseCapacity(valueRightOf(sh, wtLab.r, wtLab.c, 4)) : null,
      };
    }

    const dfBase = findLabel(sh, /DF RATE/, 14, 45);
    if (dfBase) ctx.df.base = n.num(valueRightOf(sh, dfBase.r, dfBase.c, 3) ?? sh.get(dfBase.r + 1, dfBase.c));
    const dfEx = findLabel(sh, /DF EXCESS/, 14, 45);
    if (dfEx) ctx.df.excess = n.num(valueRightOf(sh, dfEx.r, dfEx.c, 3) ?? sh.get(dfEx.r + 1, dfEx.c));
    const dfSur = findLabel(sh, /DF SURCHARG/, 14, 45);
    if (dfSur) ctx.df.surcharge = n.num(valueRightOf(sh, dfSur.r, dfSur.c, 3) ?? sh.get(dfSur.r + 1, dfSur.c));

    const doc = findLabel(sh, /DOC CLOSING/, 14, 45);
    if (doc) ctx.docClosing = n.str(valueRightOf(sh, doc.r, doc.c, 3));
    const cargo = findLabel(sh, /CARGO CLOSING/, 14, 45);
    if (cargo) ctx.cargoClosing = n.str(valueRightOf(sh, cargo.r, cargo.c, 3));

    ctx.voyageKey = n.voyageKey(ctx.vessel, ctx.voy);
    return ctx;

    function findLabelNear(s, re, r0, r1) {
      for (let r = Math.max(1, r0); r <= Math.min(s.nrows, r1); r++) {
        for (let c = 1; c <= Math.min(s.ncols, 45); c++) {
          const v = s.get(r, c);
          if (typeof v === 'string' && re.test(hkey(v))) return { r, c };
        }
      }
      return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * Schedule sheets -> voyage rotations
   * ------------------------------------------------------------------ */
  function parseSchedule(sh) {
    const n = N();
    const voyages = [];
    for (let r = 1; r <= sh.nrows; r++) {
      const row = sh.cells[r];
      if (!row) continue;
      /* Header row for a block: contains VSL/VOY and at least two "WK" columns */
      let vslCol = -1;
      const wkCols = [];
      for (let c = 1; c <= sh.ncols; c++) {
        const v = row[c] && row[c].v;
        if (v == null) continue;
        const k = hkey(v);
        if (k === 'VSL/VOY' || k === 'VSL / VOY' || k === 'VESSEL/VOY') vslCol = c;
        else if (k === 'WK') wkCols.push(c);
      }
      if (vslCol < 0 || wkCols.length < 2) continue;

      /* Port name sits in the header cell right after each WK column. */
      const legs = wkCols.map((c) => ({
        wkCol: c, dateCol: c + 1,
        port: n.canonPort(sh.get(r, c + 1)),
      })).filter((l) => l.port);

      /* Service name from the nearest label above, e.g. "CCS_Schedule". */
      let svc = '';
      for (let rr = r - 1; rr >= Math.max(1, r - 4) && !svc; rr--) {
        for (let c = 1; c <= Math.min(sh.ncols, 8); c++) {
          const v = sh.get(rr, c);
          if (typeof v !== 'string') continue;
          const hit = svcFromText(v);
          if (hit) { svc = hit; break; }
        }
      }
      if (!svc) svc = svcFromText(sh.name);

      /* Data rows until a blank vessel cell or the next block header. */
      for (let d = r + 1; d <= sh.nrows; d++) {
        const vRaw = sh.get(d, vslCol);
        if (vRaw == null || vRaw === '') {
          const nxt = sh.get(d + 1, vslCol);
          if (nxt == null || nxt === '') break;
          continue;
        }
        if (/VSL\/VOY|SCHEDULE/.test(hkey(vRaw))) break;
        const vessel = n.canonVessel(vRaw);
        if (!vessel) continue;
        let voy = n.canonVoy(sh.get(d, vslCol + 1));
        if (!voy) { const sp = n.splitVesselVoy(vessel); if (sp.voy) voy = sp.voy; }

        const ports = [];
        for (const lg of legs) {
          const raw = sh.get(d, lg.dateCol);
          const dt = n.toDate(raw);
          const note = (!dt && typeof raw === 'string') ? n.str(raw) : '';
          ports.push({ port: lg.port, etd: n.isoDate(dt), wk: dt ? n.excelWeekNum(dt) : 0, note });
        }
        const withDate = ports.filter((p) => p.etd);
        voyages.push({
          srcFile: sh.file, srcSheet: sh.name,
          svc, vessel, voy, key: n.voyageKey(vessel, voy),
          rotation: ports,
          firstEtd: withDate.length ? withDate[0].etd : '',
          lastEta: withDate.length ? withDate[withDate.length - 1].etd : '',
        });
      }
      r = r + 1; /* continue scanning; nested blocks are handled by the outer loop */
    }
    return voyages;
  }

  /* ------------------------------------------------------------------ *
   * BSA sheets -> per-voyage allocation
   * ------------------------------------------------------------------ */
  function parseBsa(sh) {
    const n = N();
    const out = [];
    let bound = '';
    let teuCol = -1, wtCol = -1, vslCol = 2;

    for (let r = 1; r <= sh.nrows; r++) {
      const row = sh.cells[r];
      if (!row) continue;
      let rowText = '';
      for (let c = 1; c <= sh.ncols; c++) {
        const v = row[c] && row[c].v;
        if (typeof v === 'string') rowText += ' ' + hkey(v);
      }
      if (/NORTHBOUND/.test(rowText)) { bound = 'N'; teuCol = wtCol = -1; }
      if (/SOUTHBOUND/.test(rowText)) { bound = 'S'; teuCol = wtCol = -1; }

      /* Column header row for a block */
      for (let c = 1; c <= sh.ncols; c++) {
        const v = row[c] && row[c].v;
        if (v == null) continue;
        const k = hkey(v);
        if (k === 'TEUS' || k === 'TEU') teuCol = c;
        else if (k === 'WT' || k === 'WT.' || k === 'TON') wtCol = c;
        else if (/^VESSEL\s*\/\s*VOY/.test(k) || k === 'VSL/VOY') vslCol = c;
      }

      /* Data row: vessel-ish text plus numbers */
      const vRaw = sh.get(r, vslCol);
      if (typeof vRaw !== 'string' || !vRaw.trim()) continue;
      const vTxt = vRaw.trim();
      if (/^(TOTAL|NORTHBOUND|SOUTHBOUND|VESSEL|VSL|POL|BOUND|AFTER|UNDER)/i.test(hkey(vTxt))) continue;

      /* Multi-line cells describe substitutions: "A => B" — keep the last vessel. */
      const lines = vTxt.split(/\n|=+>/).map((s) => s.trim()).filter(Boolean);
      const primary = lines[0];
      const effective = lines[lines.length - 1];
      const sp = n.splitVesselVoy(primary);
      if (!sp.vessel) continue;

      let teu = 0, wt = 0;
      if (teuCol > 0) teu = n.num(sh.get(r, teuCol));
      if (wtCol > 0) wt = n.num(sh.get(r, wtCol));
      if (!teu) {
        /* Fall back to the first two numbers to the right of the vessel cell. */
        const nums = [];
        for (let c = vslCol + 1; c <= Math.min(sh.ncols, vslCol + 8); c++) {
          const v = sh.get(r, c);
          if (typeof v === 'number') nums.push(v);
          else if (typeof v === 'string' && /^\d+(\s*=?>?\s*\d+)?$/.test(v.trim())) {
            nums.push(n.num(v.split(/=+>/).pop()));
          }
        }
        if (nums.length) { teu = nums[0]; wt = nums[1] || 0; }
      }
      if (!teu) continue;

      const eff = n.splitVesselVoy(effective);
      out.push({
        srcFile: sh.file, srcSheet: sh.name, bound,
        vessel: sp.vessel, voy: sp.voy, key: n.voyageKey(sp.vessel, sp.voy),
        effVessel: eff.vessel || sp.vessel, effVoy: eff.voy || sp.voy,
        substituted: effective !== primary,
        bsaTeu: teu, bsaTon: wt, note: lines.length > 1 ? vTxt.replace(/\n/g, ' ') : '',
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * DF contract sheets
   * ------------------------------------------------------------------ */
  function parseDf(sh) {
    const n = N();
    const g = (re, span) => {
      const h = findLabel(sh, re, 16, 12);
      return h ? valueRightOf(sh, h.r, h.c, span || 4) : null;
    };
    const nameM = String(sh.name).match(/^([A-Za-z]+)_([A-Za-z]{3})\s*\((.*)\)\s*$/);
    const title = n.str(sh.get(2, 2));

    const c = {
      srcFile: sh.file, srcSheet: sh.name,
      provider: nameM ? nameM[1].toUpperCase() : (title.match(/^(\w+)/) || [, ''])[1].toUpperCase(),
      svc: n.canonSvc(g(/^SVC\s*:?$/)) || (nameM ? n.canonSvc(nameM[2]) : ''),
      periodLabel: nameM ? nameM[3] : '',
      maidenVoy: n.str(g(/MADEN VOY|MAIDEN VOY/, 2)),
      period: n.str(g(/^(DF )?PERIOD\s*:?$/)),
      term: n.str(g(/^TERM\s*:?$/)),
      ratePerTeu: n.num(g(/^RATE\s*:?$/)),
      volTeu: n.num(g(/^VOL\.?\s*:?$/)),
      wtTon: n.num(g(/^WT\.?\s*:?$/)),
      surcharges: {},
      excess: [],
    };
    c.fixedAmount = n.num(g(/FIXED AMOUNT/)) || (c.ratePerTeu * c.volTeu);

    /* Surcharge table: label / rate / unit */
    const sh6 = findLabel(sh, /^SURCHARGE$/, 16, 20);
    if (sh6) {
      for (let r = sh6.r + 1; r <= Math.min(sh.nrows, sh6.r + 10); r++) {
        const lab = n.str(sh.get(r, sh6.c));
        if (!lab) continue;
        const key = lab.replace(/\s*:\s*$/, '').trim().toUpperCase();
        if (!key || /^(TTL|TOTAL)/.test(key)) break;
        c.surcharges[key] = { rate: n.num(sh.get(r, sh6.c + 1)), unit: n.str(sh.get(r, sh6.c + 2)) };
      }
    }

    /* "Actual booking" derived slot cost, when present */
    const act = findLabel(sh, /ACTUAL BOOKING/, 40, 10);
    if (act) {
      for (let r = act.r; r <= Math.min(sh.nrows, act.r + 16); r++) {
        for (let cc = 1; cc <= Math.min(sh.ncols, 10); cc++) {
          const v = sh.get(r, cc);
          if (typeof v === 'string' && /SLOT RATE PER TEU/i.test(v)) {
            c.actualSlotPerTeu = n.num(sh.get(r, cc - 1));
          }
        }
      }
    }
    return c;
  }

  /* ------------------------------------------------------------------ *
   * ROB sheets — capture the BSA cap; the app regenerates the load plan.
   * ------------------------------------------------------------------ */
  function parseRob(sh) {
    const n = N();
    let teu = 0, ton = 0;

    /* Primary: a "TEU" / "TON" header pair in the top rows, values on the next row.
       This is how both the CCS and SKS ROB templates express the BSA cap. */
    outer:
    for (let r = 1; r <= Math.min(sh.nrows, 5); r++) {
      for (let c = 1; c <= Math.min(sh.ncols, 45); c++) {
        if (hkey(sh.get(r, c)) !== 'TEU') continue;
        const t = n.num(sh.get(r + 1, c));
        if (!t) continue;
        teu = t;
        ton = n.num(sh.get(r + 1, c + 1)) || (hkey(sh.get(r, c + 1)) === 'TON' ? 0 : 0);
        break outer;
      }
    }
    /* Secondary: an explicit "BSA" label with the numbers to its right. */
    if (!teu) {
      const hit = findLabel(sh, /^BSA$/, 8, 45);
      if (hit) {
        teu = n.num(valueRightOf(sh, hit.r, hit.c, 3));
        ton = n.num(sh.get(hit.r, hit.c + 2)) || n.num(sh.get(hit.r, hit.c + 3));
      }
    }

    /* Vessel/voyage from the title cell, ignoring template labels. */
    let title = n.str(sh.get(3, 1)) || n.str(sh.get(2, 1)) || '';
    if (/VESSEL|VOYAGE|POL|TYPE|SAMPLE/i.test(title) || !title) title = sh.name;
    const sp = n.splitVesselVoy(String(title).split('/')[0]);
    const vessel = sp.vessel || n.canonVessel(sh.name);
    return {
      srcFile: sh.file, srcSheet: sh.name, title,
      vessel, voy: sp.voy, key: n.voyageKey(vessel, sp.voy),
      bsaTeu: teu, bsaTon: ton,
    };
  }

  /* ------------------------------------------------------------------ *
   * Entry point
   * ------------------------------------------------------------------ */
  function parseWorkbook(wb) {
    const res = {
      fileName: wb.fileName,
      sheets: [], records: [], voyages: [], bsa: [], df: [], rob: [],
      skipped: [],
    };

    for (const sh of wb.sheets) {
      if (!sh.nrows) { res.skipped.push({ sheet: sh.name, why: 'empty' }); continue; }
      let kind = null;
      try { kind = classify(sh); } catch (e) { /* fall through to skip */ }
      if (!kind) { res.skipped.push({ sheet: sh.name, why: 'unrecognised layout' }); continue; }

      try {
        if (kind === 'schedule') {
          const v = parseSchedule(sh);
          res.voyages.push(...v);
          res.sheets.push({ kind, sheet: sh.name, count: v.length });
        } else if (kind === 'bsa') {
          const b = parseBsa(sh);
          res.bsa.push(...b);
          res.sheets.push({ kind, sheet: sh.name, count: b.length });
        } else if (kind === 'dfContract') {
          const d = parseDf(sh);
          res.df.push(d);
          res.sheets.push({ kind, sheet: sh.name, count: 1, note: `${d.provider}/${d.svc} ${d.ratePerTeu}/TEU x ${d.volTeu}` });
        } else if (kind === 'rob') {
          const r = parseRob(sh);
          res.rob.push(r);
          res.sheets.push({ kind, sheet: sh.name, count: 1, note: `BSA ${r.bsaTeu} TEU` });
        } else {
          const hdr = findHeaderRow(sh);
          if (!hdr) { res.skipped.push({ sheet: sh.name, why: 'no header row' }); continue; }
          let ctx = {};
          if (kind === 'bkSheet') ctx = bkSheetContext(sh);
          else if (kind === 'agencyForecast' || kind === 'genericForecast') ctx = agencyContext(sh);
          const recs = extractBookings(sh, hdr, kind, ctx);
          res.records.push(...recs);
          if (kind === 'bkSheet' && ctx.vessel) {
            res.voyages.push({
              srcFile: sh.file, srcSheet: sh.name, svc: ctx.svc,
              vessel: ctx.vessel, voy: ctx.voy, key: ctx.voyageKey,
              rotation: [], firstEtd: ctx.etd || '',
              bsaTeu: ctx.bsa && ctx.bsa.teu ? ctx.bsa.teu.own : 0,
              bsaTon: ctx.bsa && ctx.bsa.ton ? ctx.bsa.ton.own : 0,
              vesselTeu: ctx.bsa && ctx.bsa.teu ? ctx.bsa.teu.vessel : null,
              vesselTon: ctx.bsa && ctx.bsa.ton ? ctx.bsa.ton.vessel : null,
              df: ctx.df, winSabis: ctx.winSabis,
              docClosing: ctx.docClosing, cargoClosing: ctx.cargoClosing,
              scheduleRemark: ctx.scheduleRemark,
              fromBkSheet: true, bsaRank: 3,
            });
          }
          res.sheets.push({
            kind, sheet: sh.name, count: recs.length,
            note: (ctx.svc ? 'SVC=' + ctx.svc : '') +
                  (ctx.vessel ? ' ' + ctx.vessel + ' ' + (ctx.voy || '') : '') +
                  (ctx.bsa && ctx.bsa.teu ? ` BSA=${ctx.bsa.teu.own}` : ''),
          });
        }
      } catch (e) {
        res.skipped.push({ sheet: sh.name, why: 'parse error: ' + (e && e.message) });
      }
    }
    return res;
  }

  global.FParse = {
    parseWorkbook, classify, findHeaderRow, parseCapacity,
    parseSchedule, parseBsa, parseDf, parseRob, hkey, fieldFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
