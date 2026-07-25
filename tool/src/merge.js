/* ============================================================================
   merge.js — the running master register.

   Design: every ingest is a field-level *enrichment*, not a blind overwrite.
   A newly uploaded row updates a field only when it actually carries a value,
   so a narrow weekly agency file never blanks out detail already held in the
   master. Cancellation is sticky: once any source reports a row cancelled it
   stays cancelled until explicitly reinstated.
   ========================================================================= */
(function (global) {
  'use strict';

  const N = () => global.FNorm;
  const SCHEMA_VERSION = 3;

  const TEXT_FIELDS = [
    'remark', 'customer', 'bkParty', 'partySvc', 'blNo', 'item', 'special', 'specialApproval',
    'salesRep', 'billingNote', 'pickupTerminal', 'pickupDate', 'bkDate', 'cancelDate',
    'leg1Vessel', 'leg1Voy', 'leg1Etd', 'leg2Vessel', 'leg2Voy', 'leg2Etd',
    'dirTs', 'svc1', 'svc2', 'pol', 'ts', 'pod', 'fpod', 'voyEtdRef',
  ];
  const BOX_FIELDS = ['c20dv', 'c20mt', 'c40hc', 'c40mt', 'c20fr', 'c40fr', 'cvoid'];
  const NUM_FIELDS = ['vgmWt', 'ratePerBox', 'lumpsum'];

  /* Fields compared to decide whether a record materially changed. */
  const FINGERPRINT = TEXT_FIELDS.concat(BOX_FIELDS, NUM_FIELDS, ['status']);

  /* Fields where two sources disagreeing is worth telling the user about. */
  const MATERIAL = ['leg1Etd', 'leg1Vessel', 'leg1Voy', 'leg2Etd', 'leg2Vessel',
    'pol', 'pod', 'fpod', 'ts', 'svc1', 'dirTs'].concat(BOX_FIELDS);

  /* How much a layout is trusted when two sources describe the same booking.
     The per-voyage booking sheet is the operational closing document, so it wins;
     equal ranks fall back to whichever was read later. Making this explicit keeps
     the outcome independent of the order files happen to be dropped in. */
  const SRC_RANK = { bkSheet: 3, masterForecast: 2, agencyForecast: 2, genericForecast: 1 };
  const rankOf = (r) => (r && r.srcRank) || SRC_RANK[r && r.srcKind] || 1;

  /**
   * Does `a` take precedence over `b`? Layout trust first, then file modification
   * time — so when two equally-trusted files disagree, the more recently saved one
   * wins, which is what anyone would expect.
   */
  function beats(a, b) {
    const ra = rankOf(a), rb = rankOf(b);
    if (ra !== rb) return ra > rb;
    const ma = (a && a.srcMtime) || 0, mb = (b && b.srcMtime) || 0;
    if (ma !== mb) return ma > mb;
    /* Dead heat (files saved in the same second). Break it on file then sheet
       name so the result never depends on the order files were dropped in. */
    const fa = (a && a.srcFile) || '', fb = (b && b.srcFile) || '';
    if (fa !== fb) return fa > fb;
    const sa = (a && a.srcSheet) || '', sb = (b && b.srcSheet) || '';
    if (sa !== sb) return sa > sb;
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Keys
   * ------------------------------------------------------------------ */
  function normBl(bl) {
    return String(bl || '')
      .toUpperCase()
      .replace(/[\s\-_/\\]+/g, '')
      .replace(/[()]/g, '');
  }

  function boxSignature(r) {
    return BOX_FIELDS.map((f) => N().num(r[f])).join('.');
  }

  function shortHash(s) {
    let h = 5381;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** Shape-based signature for rows with no usable B/L number. */
  function shapeSig(r) {
    const n = N();
    const narrative = shortHash([r.remark, r.item, r.customer, r.special].join('~'));
    return n.voyageKey(r.leg1Vessel, r.leg1Voy) + '|' +
           (r.pol || '') + '>' + (r.pod || r.fpod || '') + '|' +
           (r.bkParty || '') + '|' + boxSignature(r) + '|' + narrative;
  }

  /** Stable identity for a booking row across re-uploads. */
  function recordKey(r) {
    const n = N();
    if (!n.isPlaceholderBl(r.blNo)) {
      return 'B|' + normBl(r.blNo) + '|' + n.voyageKey(r.leg1Vessel, r.leg1Voy) + '|' +
             (r.pod || r.fpod || '');
    }
    /* Several identical-looking empty-repo lines can sit on one sheet and are
       genuinely separate bookings, so the occurrence index is part of identity. */
    return 'X|' + shapeSig(r) + '|#' + (r.occ || 1);
  }

  /**
   * Number the placeholder rows within each source sheet, in sheet order.
   * Same sheet re-read -> same numbers (idempotent). The same line appearing in
   * two different sheets gets #1 in both, so cross-source merging still works.
   */
  function assignOccurrences(records) {
    const n = N();
    const seen = new Map();
    for (const r of records) {
      if (!n.isPlaceholderBl(r.blNo)) { r.occ = 0; continue; }
      const sig = (r.srcFile || '') + '~' + (r.srcSheet || '') + '~' + shapeSig(r);
      const k = (seen.get(sig) || 0) + 1;
      seen.set(sig, k);
      r.occ = k;
    }
    return records;
  }

  function fingerprint(r) {
    const n = N();
    return FINGERPRINT.map((f) =>
      BOX_FIELDS.indexOf(f) >= 0 || NUM_FIELDS.indexOf(f) >= 0 ? n.num(r[f]) : n.slug(r[f])
    ).join('|');
  }

  /* ------------------------------------------------------------------ *
   * Derived fields — recomputed after every merge so the store is
   * always internally consistent.
   * ------------------------------------------------------------------ */
  function recompute(r) {
    const n = N();
    r.teu = n.computeTeu(r);
    r.boxes = n.boxCount(r);
    r.wk = r.leg1Etd ? n.excelWeekNum(r.leg1Etd) : (r.wk || 0);
    r.wk2 = r.leg2Etd ? n.excelWeekNum(r.leg2Etd) : (r.wk2 || 0);
    r.wtPerTeu = r.teu ? Math.round((n.num(r.vgmWt) / r.teu) * 100) / 100 : 0;
    r.tare = Math.round(n.tareWeight(r) * 100) / 100;
    r.emptyRepo = n.isEmptyRepo(r);
    r.voyKey = n.voyageKey(r.leg1Vessel, r.leg1Voy);
    r.voyKey2 = r.leg2Vessel ? n.voyageKey(r.leg2Vessel, r.leg2Voy) : '';
    if (!r.svc1 && r.leg1Vessel) r.svc1 = n.VESSEL_SVC_SEED[r.leg1Vessel] || '';
    if (!r.svc2 && r.leg2Vessel) r.svc2 = n.VESSEL_SVC_SEED[r.leg2Vessel] || '';
    if (!r.dirTs) r.dirTs = r.leg2Vessel && r.voyKey2 !== r.voyKey ? 'TS' : 'DIR';
    r.lane = (r.pol || '?') + '→' + (r.fpod || r.pod || '?');
    if (!r.lumpsum) {
      const rate = n.num(r.ratePerBox);
      if (rate) r.lumpsum = rate * (n.num(r.c20dv) + n.num(r.c40hc));
    }
    return r;
  }

  /* ------------------------------------------------------------------ *
   * Store
   * ------------------------------------------------------------------ */
  function createStore() {
    return {
      schemaVersion: SCHEMA_VERSION,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      records: [],            // canonical booking rows
      index: Object.create(null), // key -> array position
      voyages: Object.create(null), // voyageKey -> voyage meta
      df: [],                 // dead-freight contracts
      bsa: [],                // raw BSA allocations
      log: [],                // ingest history
      conflicts: [],          // same booking, different values across sources
      files: [],              // every file ever ingested
      vesselSvc: Object.create(null), // learned vessel -> service
    };
  }

  function reindex(st) {
    st.index = Object.create(null);
    st.records.forEach((r, i) => { st.index[r.key] = i; });
  }

  /* Learn vessel -> service from whatever the data asserts. */
  function learnVessels(st, records) {
    for (const r of records) {
      if (r.leg1Vessel && r.svc1) st.vesselSvc[r.leg1Vessel] = r.svc1;
      if (r.leg2Vessel && r.svc2) st.vesselSvc[r.leg2Vessel] = r.svc2;
    }
    for (const k in st.voyages) {
      const v = st.voyages[k];
      if (v.vessel && v.svc) st.vesselSvc[v.vessel] = v.svc;
    }
  }

  function applySvcFallback(st) {
    const n = N();
    st.svcCorrections = [];
    for (const r of st.records) {
      if (!r.svc1 && r.leg1Vessel) r.svc1 = st.vesselSvc[r.leg1Vessel] || n.VESSEL_SVC_SEED[r.leg1Vessel] || '';
      if (!r.svc2 && r.leg2Vessel) r.svc2 = st.vesselSvc[r.leg2Vessel] || n.VESSEL_SVC_SEED[r.leg2Vessel] || '';

      /* A vessel cannot be on two loops for one voyage. Where the voyage's own
         schedule contradicts the service typed on a sheet header, report and use
         the schedule — as a derived field. `svc1` keeps exactly what the source
         said, so re-reading the same file stays a no-op. */
      const v = st.voyages[r.voyKey];
      r.svcEff = r.svc1;
      if (v && v.svcRank === 2 && v.svc) {
        r.svcEff = v.svc;
        if (r.svc1 && r.svc1 !== v.svc) {
          st.svcCorrections.push({
            blNo: r.blNo, voy: r.voyKey, vessel: r.leg1Vessel, voyNo: r.leg1Voy,
            from: r.svc1, to: v.svc, src: `${r.srcFile} › ${r.srcSheet}`,
          });
        }
      }
    }
  }

  /**
   * Fill a blank 1st-leg ETD from the voyage's own schedule: the departure of the
   * port the cargo is actually loaded at. Falls back to the voyage's first ETD.
   */
  function applyScheduleEtd(st) {
    const n = N();
    for (const r of st.records) {
      if (r.leg1Etd) continue;
      const v = st.voyages[r.voyKey];
      if (!v) continue;
      let etd = '';
      if (v.rotation && v.rotation.length && r.pol) {
        const call = v.rotation.find((c) => c.port === r.pol && c.etd);
        if (call) { etd = call.etd; r.etdFrom = 'schedule'; }
      }
      if (!etd && r.voyEtdRef) { etd = r.voyEtdRef; r.etdFrom = 'voyage header'; }
      if (!etd && v.firstEtd) { etd = v.firstEtd; r.etdFrom = 'voyage first call'; }
      if (etd) { r.leg1Etd = etd; r.wk = n.excelWeekNum(etd); }
    }
  }

  /**
   * Merge parsed records into the store.
   * @param {object} st
   * @param {Array} incoming  canonical records from FParse
   * @param {object} [opts]   { label, files, voyages, df, bsa, reinstate }
   */
  function ingest(st, incoming, opts) {
    const n = N();
    const o = opts || {};
    const ts = new Date().toISOString();
    let added = 0, updated = 0, unchanged = 0, cancelled = 0;
    const changes = [];

    /* --- voyage metadata (schedules, BSA, BK-sheet headers) --------- */
    if (o.voyages) {
      for (const v of o.voyages) {
        if (!v.key) continue;
        const cur = st.voyages[v.key] || { key: v.key };
        /* Only overwrite with something meaningful. */
        for (const f of ['vessel', 'voy', 'winSabis', 'docClosing', 'cargoClosing', 'scheduleRemark']) {
          if (v[f]) cur[f] = v[f];
        }
        /* A source that also supplies a port rotation is proving which loop the
           vessel is on, so its service beats a hand-typed sheet header. */
        if (v.svc) {
          const sRank = (v.rotation && v.rotation.length) ? 2 : 1;
          if (sRank >= (cur.svcRank || 0)) { cur.svc = v.svc; cur.svcRank = sRank; }
        }
        if (v.rotation && v.rotation.length) cur.rotation = v.rotation;
        if (v.firstEtd) cur.firstEtd = v.firstEtd;
        if (v.lastEta) cur.lastEta = v.lastEta;
        /* Voyage numbers recycle year to year, so a historical ROB sheet can
           collide with a current voyage. Trust the more specific source:
           rank 3 = per-voyage booking sheet, 2 = schedule, 1 = ROB/BSA sheet. */
        const rank = v.bsaRank || 1;
        if ((v.bsaTeu || v.bsaTon) && rank >= (cur.bsaRank || 0)) {
          if (v.bsaTeu) cur.bsaTeu = v.bsaTeu;
          if (v.bsaTon) cur.bsaTon = v.bsaTon;
          cur.bsaRank = rank;
        }
        if (v.vesselTeu) cur.vesselTeu = v.vesselTeu;
        if (v.vesselTon) cur.vesselTon = v.vesselTon;
        if (v.df && (v.df.base || v.df.excess || v.df.surcharge)) cur.df = v.df;
        cur.sources = cur.sources || [];
        const tag = (v.srcFile || '') + '::' + (v.srcSheet || '');
        if (cur.sources.indexOf(tag) < 0) cur.sources.push(tag);
        st.voyages[v.key] = cur;
      }
    }
    if (o.bsa) {
      for (const b of o.bsa) {
        st.bsa.push(b);
        const key = n.voyageKey(b.effVessel || b.vessel, b.effVoy || b.voy);
        const cur = st.voyages[key] || { key, vessel: b.effVessel || b.vessel, voy: b.effVoy || b.voy };
        if (b.bsaTeu && !cur.bsaTeu) cur.bsaTeu = b.bsaTeu;
        if (b.bsaTon && !cur.bsaTon) cur.bsaTon = b.bsaTon;
        if (b.bound) cur.bound = b.bound;
        st.voyages[key] = cur;
      }
    }
    if (o.df) {
      for (const d of o.df) {
        const dupe = st.df.findIndex((x) => x.srcSheet === d.srcSheet && x.provider === d.provider);
        if (dupe >= 0) st.df[dupe] = d; else st.df.push(d);
      }
    }

    /* --- booking rows ---------------------------------------------- *
     * Fold duplicates inside the batch first: the same booking often appears
     * in both the consolidated register and its voyage booking sheet. Applying
     * each key once per batch is what makes re-ingesting a file a no-op.      */
    const staged = incoming.map((raw) => recompute(Object.assign({}, raw)));
    assignOccurrences(staged);

    /* Group every copy of a booking, then resolve each group as a whole.
       Resolving pairwise in arrival order was subtly wrong: a blank filled from
       one low-precedence copy could no longer be corrected by a better one, so
       the answer depended on the order files happened to be dropped in. */
    const groups = new Map();
    for (const rec of staged) {
      rec.key = recordKey(rec);
      if (!groups.has(rec.key)) groups.set(rec.key, []);
      groups.get(rec.key).push(rec);
    }

    const isEmpty = (f, v) =>
      v === '' || v == null || (BOX_FIELDS.indexOf(f) >= 0 && !n.num(v)) ||
      (NUM_FIELDS.indexOf(f) >= 0 && !n.num(v));

    /* Best copy first: layout trust, then file time, then a stable name order. */
    const byPrecedence = (a, b) =>
      rankOf(b) - rankOf(a) ||
      ((b.srcMtime || 0) - (a.srcMtime || 0)) ||
      String(a.srcFile || '').localeCompare(String(b.srcFile || '')) ||
      String(a.srcSheet || '').localeCompare(String(b.srcSheet || '')) ||
      ((a.srcRow || 0) - (b.srcRow || 0));

    const folded = new Map();
    let dupsInBatch = 0;
    const conflicts = [];

    for (const [key, grp] of groups) {
      if (grp.length === 1) { folded.set(key, grp[0]); continue; }
      dupsInBatch += grp.length - 1;
      grp.sort(byPrecedence);
      const lead = grp[0];

      /* Report where a lower-precedence copy said something different. */
      for (let i = 1; i < grp.length; i++) {
        const other = grp[i];
        for (const f of MATERIAL) {
          if (isEmpty(f, lead[f]) || isEmpty(f, other[f])) continue;
          const same = BOX_FIELDS.indexOf(f) >= 0
            ? n.num(lead[f]) === n.num(other[f])
            : n.slug(lead[f]) === n.slug(other[f]);
          if (same) continue;
          conflicts.push({
            key, blNo: lead.blNo || other.blNo, voy: lead.voyKey, field: f,
            kept: String(lead[f]), keptFrom: `${lead.srcFile} › ${lead.srcSheet}`,
            dropped: String(other[f]), droppedFrom: `${other.srcFile} › ${other.srcSheet}`,
          });
        }
      }

      /* Each field takes the value from the best copy that actually has one. */
      for (const f of TEXT_FIELDS.concat(NUM_FIELDS)) {
        if (!isEmpty(f, lead[f])) continue;
        for (let i = 1; i < grp.length; i++) {
          if (!isEmpty(f, grp[i][f])) { lead[f] = grp[i][f]; break; }
        }
      }
      /* Box counts move as a set, from the best copy that declares any. */
      if (!BOX_FIELDS.some((f) => n.num(lead[f]) !== 0)) {
        const src = grp.find((r) => BOX_FIELDS.some((f) => n.num(r[f]) !== 0));
        if (src) for (const f of BOX_FIELDS) lead[f] = src[f];
      }
      if (grp.some((r) => r.status === 'cancel')) lead.status = 'cancel';
      lead.mergedFrom = grp.map((r) => r.srcSheet).filter((v, i, a) => v && a.indexOf(v) === i);
      recompute(lead);
      folded.set(key, lead);
    }

    for (const rec of folded.values()) {
      const pos = st.index[rec.key];

      if (pos === undefined) {
        rec.firstSeen = ts;
        rec.lastSeen = ts;
        rec.srcRank = rankOf(rec);
        rec.srcMtime = rec.srcMtime || 0;
        rec.fp = fingerprint(rec);
        rec.history = [];
        st.records.push(rec);
        st.index[rec.key] = st.records.length - 1;
        added++;
        if (rec.status === 'cancel') cancelled++;
        changes.push({ type: 'added', key: rec.key, blNo: rec.blNo, teu: rec.teu, voy: rec.voyKey });
        continue;
      }

      const cur = st.records[pos];
      const before = fingerprint(cur);
      const diff = [];
      /* A less-trusted layout may fill blanks but must not overwrite what a
         more-trusted one already stated. */
      const mayOverwrite = beats(rec, cur);

      /* text: take the newcomer only when it says something */
      for (const f of TEXT_FIELDS) {
        const nv = rec[f];
        if (nv === '' || nv === null || nv === undefined) continue;
        const blank = cur[f] === '' || cur[f] == null;
        if (!blank && !mayOverwrite) continue;
        if (n.slug(cur[f]) !== n.slug(nv)) { diff.push({ f, from: cur[f], to: nv }); cur[f] = nv; }
      }
      /* boxes: replace as a set, but only if this row actually declares any */
      const incomingHasBoxes = BOX_FIELDS.some((f) => n.num(rec[f]) !== 0);
      const curHasBoxes = BOX_FIELDS.some((f) => n.num(cur[f]) !== 0);
      if (incomingHasBoxes && (mayOverwrite || !curHasBoxes)) {
        for (const f of BOX_FIELDS) {
          if (n.num(cur[f]) !== n.num(rec[f])) { diff.push({ f, from: cur[f], to: rec[f] }); cur[f] = rec[f]; }
        }
      }
      for (const f of NUM_FIELDS) {
        if (!n.num(rec[f])) continue;
        if (n.num(cur[f]) && !mayOverwrite) continue;
        if (n.num(cur[f]) !== n.num(rec[f])) {
          diff.push({ f, from: cur[f], to: rec[f] }); cur[f] = rec[f];
        }
      }
      /* cancellation is sticky unless the caller asks for reinstatement */
      if (rec.status === 'cancel' && cur.status !== 'cancel') {
        diff.push({ f: 'status', from: cur.status, to: 'cancel' });
        cur.status = 'cancel'; cancelled++;
      } else if (o.reinstate && rec.status === 'active' && cur.status === 'cancel') {
        diff.push({ f: 'status', from: 'cancel', to: 'active' });
        cur.status = 'active';
      }

      cur.lastSeen = ts;
      if (mayOverwrite) {
        cur.srcFile = rec.srcFile; cur.srcSheet = rec.srcSheet;
        cur.srcRow = rec.srcRow; cur.srcKind = rec.srcKind;
        cur.srcRank = rankOf(rec); cur.srcMtime = rec.srcMtime || 0;
      }
      recompute(cur);
      cur.fp = fingerprint(cur);

      if (cur.fp !== before && diff.length) {
        updated++;
        cur.history = (cur.history || []).concat([{ ts, label: o.label || '', diff }]).slice(-20);
        changes.push({ type: 'updated', key: cur.key, blNo: cur.blNo, teu: cur.teu, voy: cur.voyKey, diff });
      } else {
        unchanged++;
      }
    }

    learnVessels(st, st.records);
    applySvcFallback(st);
    applyScheduleEtd(st);
    reindex(st);
    st.updated = ts;

    st.conflicts = conflicts;
    const entry = {
      ts, label: o.label || '', files: o.files || [],
      parsed: incoming.length, dupsInBatch, conflicts: conflicts.length,
      added, updated, unchanged, cancelled, total: st.records.length,
      changes: changes.slice(0, 500),
      conflictList: conflicts.slice(0, 200),
    };
    st.log.unshift(entry);
    st.log = st.log.slice(0, 60);
    if (o.files) for (const f of o.files) if (st.files.indexOf(f) < 0) st.files.push(f);

    return entry;
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */
  function toJSON(st) {
    return JSON.stringify({
      schemaVersion: st.schemaVersion, created: st.created, updated: st.updated,
      records: st.records.map((r) => {
        const c = Object.assign({}, r);
        delete c.fp;
        return c;
      }),
      voyages: st.voyages, df: st.df, bsa: st.bsa,
      log: st.log, files: st.files, vesselSvc: st.vesselSvc,
      conflicts: st.conflicts || [],
    });
  }

  function fromJSON(text) {
    const o = typeof text === 'string' ? JSON.parse(text) : text;
    const st = createStore();
    st.schemaVersion = o.schemaVersion || 1;
    st.created = o.created || st.created;
    st.updated = o.updated || st.updated;
    st.records = (o.records || []).map((r) => {
      const rec = recompute(r);
      if (!rec.key) rec.key = recordKey(rec);
      rec.fp = fingerprint(rec);
      return rec;
    });
    st.voyages = o.voyages || Object.create(null);
    st.df = o.df || [];
    st.bsa = o.bsa || [];
    st.log = o.log || [];
    st.files = o.files || [];
    st.vesselSvc = o.vesselSvc || Object.create(null);
    st.conflicts = o.conflicts || [];
    applySvcFallback(st);
    applyScheduleEtd(st);
    reindex(st);
    return st;
  }

  function removeByKeys(st, keys) {
    const kill = new Set(keys);
    const before = st.records.length;
    st.records = st.records.filter((r) => !kill.has(r.key));
    reindex(st);
    return before - st.records.length;
  }

  global.FMerge = {
    createStore, ingest, recordKey, fingerprint, recompute, assignOccurrences, shapeSig,
    toJSON, fromJSON, removeByKeys, reindex,
    SCHEMA_VERSION, TEXT_FIELDS, BOX_FIELDS, NUM_FIELDS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
