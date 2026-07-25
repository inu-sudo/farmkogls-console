/* ============================================================================
   aggregate.js — rollups over the merged register.
   Also regenerates the ROB (remaining-on-board) load plan per voyage by
   walking the service rotation, which is what the per-vessel ROB sheets do
   by hand.
   ========================================================================= */
(function (global) {
  'use strict';

  const N = () => global.FNorm;

  const DG_RE = /(^|[^A-Z])DG([^A-Z]|$)|DANGEROUS|위험물|IMO\s*\d|UN\s?\d{4}|CLASS\s*\d/i;

  /** Cargo class as used on the ROB sheets: NDG / DG / OOG(Void). */
  function cargoClass(r) {
    const n = N();
    if (n.num(r.c20fr) + n.num(r.c40fr) + n.num(r.cvoid) > 0) return 'OOG';
    const hay = `${r.special || ''} ${r.remark || ''} ${r.item || ''} ${r.specialApproval || ''}`;
    if (DG_RE.test(hay)) return 'DG';
    return 'NDG';
  }

  /** Port where the box leaves this vessel (T/S port for transshipments). */
  function dischargePort(r) {
    return r.pod || r.fpod || '';
  }

  function teu20(r) {
    const n = N();
    return n.num(r.c20dv) + n.num(r.c20mt) + n.num(r.c20fr) + n.num(r.cvoid);
  }
  function teu40(r) {
    const n = N();
    return n.num(r.c40hc) + n.num(r.c40mt) + n.num(r.c40fr);
  }

  function blank() {
    return { rows: 0, teu: 0, boxes: 0, wt: 0, revenue: 0, u20: 0, u40: 0 };
  }
  function accum(a, r) {
    const n = N();
    a.rows += 1;
    a.teu += n.num(r.teu);
    a.boxes += n.num(r.boxes);
    a.wt += n.num(r.vgmWt);
    a.revenue += n.num(r.lumpsum);
    a.u20 += teu20(r);
    a.u40 += teu40(r);
    return a;
  }
  function round(a) {
    a.teu = Math.round(a.teu * 100) / 100;
    a.wt = Math.round(a.wt * 100) / 100;
    a.revenue = Math.round(a.revenue * 100) / 100;
    return a;
  }

  function groupBy(records, keyFn) {
    const m = new Map();
    for (const r of records) {
      const k = keyFn(r);
      if (k === null || k === undefined || k === '') continue;
      if (!m.has(k)) m.set(k, blank());
      accum(m.get(k), r);
    }
    return Array.from(m, ([key, v]) => Object.assign({ key }, round(v)));
  }

  /* ------------------------------------------------------------------ *
   * ROB projection
   * ------------------------------------------------------------------ */
  /**
   * Walk a voyage's port rotation, accumulating on-board load.
   * Returns one entry per port call with load / discharge / onboard / remaining.
   */
  function robPlan(voyage, records, svcRotation) {
    const n = N();
    let rotation = [];
    if (voyage && voyage.rotation && voyage.rotation.length) {
      rotation = voyage.rotation.map((p) => ({ port: p.port, etd: p.etd, wk: p.wk, note: p.note }));
    } else if (svcRotation && svcRotation.length) {
      rotation = svcRotation.map((p) => ({ port: p, etd: '', wk: 0, note: '' }));
    }
    if (!rotation.length) {
      /* Derive a rotation from the traffic itself, ordered by ETD. */
      const seen = [];
      for (const r of records) {
        for (const p of [r.pol, dischargePort(r)]) {
          if (p && seen.indexOf(p) < 0) seen.push(p);
        }
      }
      rotation = seen.map((p) => ({ port: p, etd: '', wk: 0, note: '' }));
    }

    const bsaTeu = n.num(voyage && voyage.bsaTeu);
    const bsaTon = n.num(voyage && voyage.bsaTon);
    const legs = [];
    let on20 = 0, on40 = 0, onTeu = 0, onTon = 0;

    const live = records.filter((r) => r.status !== 'cancel');

    /* A rotation can call the same port twice (CCS and NWX both return to
       CNTAO/KRPUS). Each booking must therefore be loaded exactly once —
       at the first call that matches its POL — and discharged exactly once,
       at the first later call matching its discharge port. */
    const loadIdx = new Map();       // record -> rotation index where it loads
    let unplaced = 0;
    for (const r of live) {
      const i = rotation.findIndex((c) => c.port === r.pol);
      if (i >= 0) loadIdx.set(r, i);
      else { loadIdx.set(r, 0); unplaced++; }   // POL not on this rotation
    }

    const loadsByIdx = new Map();
    for (const [r, i] of loadIdx) {
      if (!loadsByIdx.has(i)) loadsByIdx.set(i, []);
      loadsByIdx.get(i).push(r);
    }

    const dischargedRecs = new Set();
    rotation.forEach((call, i) => {
      const loads = loadsByIdx.get(i) || [];
      /* Discharge cargo loaded strictly earlier in the rotation. */
      const dis = live.filter((r) =>
        !dischargedRecs.has(r) &&
        dischargePort(r) === call.port &&
        loadIdx.get(r) < i
      );

      const L = { teu: 0, t20: 0, t40: 0, ton: 0, byClass: { NDG: 0, DG: 0, OOG: 0 } };
      for (const r of loads) {
        L.teu += n.num(r.teu); L.t20 += teu20(r); L.t40 += teu40(r);
        L.ton += n.num(r.vgmWt); L.byClass[cargoClass(r)] += n.num(r.teu);
      }
      const D = { teu: 0, t20: 0, t40: 0, ton: 0 };
      for (const r of dis) {
        D.teu += n.num(r.teu); D.t20 += teu20(r); D.t40 += teu40(r); D.ton += n.num(r.vgmWt);
        dischargedRecs.add(r);
      }

      onTeu += L.teu - D.teu;
      on20 += L.t20 - D.t20;
      on40 += L.t40 - D.t40;
      onTon += L.ton - D.ton;

      legs.push({
        seq: i + 1, port: call.port, etd: call.etd, wk: call.wk, note: call.note,
        loadTeu: Math.round(L.teu * 100) / 100,
        loadTon: Math.round(L.ton * 100) / 100,
        load20: L.t20, load40: L.t40,
        loadNDG: L.byClass.NDG, loadDG: L.byClass.DG, loadOOG: L.byClass.OOG,
        dischTeu: Math.round(D.teu * 100) / 100,
        dischTon: Math.round(D.ton * 100) / 100,
        onboardTeu: Math.round(onTeu * 100) / 100,
        onboard20: on20, onboard40: on40,
        onboardTon: Math.round(onTon * 100) / 100,
        remainTeu: bsaTeu ? Math.round((bsaTeu - onTeu) * 100) / 100 : null,
        remainTon: bsaTon ? Math.round((bsaTon - onTon) * 100) / 100 : null,
        rows: loads.length,
      });
    });

    const peak = legs.reduce((m, l) => Math.max(m, l.onboardTeu), 0);
    const peakTon = legs.reduce((m, l) => Math.max(m, l.onboardTon), 0);
    return {
      legs, peakTeu: Math.round(peak * 100) / 100, peakTon: Math.round(peakTon * 100) / 100,
      bsaTeu, bsaTon, unplaced,
      overTeu: bsaTeu ? Math.round((peak - bsaTeu) * 100) / 100 : null,
      overTon: bsaTon ? Math.round((peakTon - bsaTon) * 100) / 100 : null,
    };
  }

  /* ------------------------------------------------------------------ *
   * Main build
   * ------------------------------------------------------------------ */
  function build(st, filter) {
    const n = N();
    const all = filter ? st.records.filter(filter) : st.records;
    const active = all.filter((r) => r.status !== 'cancel');
    const cancelled = all.filter((r) => r.status === 'cancel');

    const totals = round(active.reduce((a, r) => accum(a, r), blank()));
    totals.cancelledRows = cancelled.length;
    totals.cancelledTeu = Math.round(cancelled.reduce((s, r) => s + n.num(r.teu), 0) * 100) / 100;
    totals.allRows = all.length;
    totals.emptyRepoTeu = Math.round(
      active.filter((r) => r.emptyRepo).reduce((s, r) => s + n.num(r.teu), 0) * 100) / 100;

    const byService = groupBy(active, (r) => n.svcOf(r) || '(unknown)')
      .sort((a, b) => b.teu - a.teu);
    const byWeek = groupBy(active.filter((r) => r.wk), (r) => r.wk)
      .sort((a, b) => a.key - b.key);
    const byLane = groupBy(active, (r) => r.lane).sort((a, b) => b.teu - a.teu);
    const byPol = groupBy(active, (r) => r.pol).sort((a, b) => b.teu - a.teu);
    const byPod = groupBy(active, (r) => r.fpod || r.pod).sort((a, b) => b.teu - a.teu);
    const byParty = groupBy(active, (r) => r.bkParty || '(none)').sort((a, b) => b.teu - a.teu);
    const byCustomer = groupBy(active.filter((r) => r.customer), (r) => r.customer)
      .sort((a, b) => b.teu - a.teu);
    const byDirTs = groupBy(active, (r) => r.dirTs || 'DIR');
    const byClass = groupBy(active, (r) => cargoClass(r));

    /* Week × service matrix for the heat chart. */
    const weeks = byWeek.map((w) => w.key);
    const svcCodes = byService.map((s) => s.key);
    const matrix = {};
    for (const s of svcCodes) matrix[s] = {};
    for (const r of active) {
      const s = n.svcOf(r) || '(unknown)';
      if (!matrix[s]) matrix[s] = {};
      matrix[s][r.wk] = (matrix[s][r.wk] || 0) + n.num(r.teu);
    }

    /* Container mix. */
    const mix = n.BOX_FIELDS.map((f) => ({
      key: f.label,
      units: active.reduce((s, r) => s + n.num(r[f.key]), 0),
      teu: active.reduce((s, r) => s + n.num(r[f.key]) * f.teu, 0),
    })).filter((x) => x.units);

    /* ---- per-voyage ---------------------------------------------- */
    const voyMap = new Map();
    for (const r of all) {
      const k = r.voyKey;
      if (!k || k === '|') continue;
      if (!voyMap.has(k)) voyMap.set(k, []);
      voyMap.get(k).push(r);
    }
    /* Include voyages known only from schedules/BSA. */
    for (const k in st.voyages) if (!voyMap.has(k)) voyMap.set(k, []);

    const byVoyage = [];
    for (const [key, rows] of voyMap) {
      const meta = st.voyages[key] || {};
      const act = rows.filter((r) => r.status !== 'cancel');
      const a = round(act.reduce((x, r) => accum(x, r), blank()));
      const parts = key.split('|');
      const vessel = meta.vessel || parts[0] || '';
      const voy = meta.voy || parts[1] || '';
      const svc = meta.svc || (act[0] && n.svcOf(act[0])) || st.vesselSvc[vessel] ||
                  n.VESSEL_SVC_SEED[vessel] || '';
      const etd = meta.firstEtd || (act.map((r) => r.leg1Etd).filter(Boolean).sort()[0] || '');
      const bsaTeu = n.num(meta.bsaTeu);
      const bsaTon = n.num(meta.bsaTon);

      const rot = meta.rotation && meta.rotation.length
        ? meta.rotation
        : (n.SERVICES[svc] ? n.SERVICES[svc].rotation.map((p) => ({ port: p, etd: '', wk: 0 })) : []);
      const rob = robPlan(Object.assign({}, meta, { rotation: rot, bsaTeu, bsaTon }), act,
                          n.SERVICES[svc] ? n.SERVICES[svc].rotation : null);

      /* Economics — only what the data actually supports. */
      const dfBase = n.num(meta.df && meta.df.base);
      const dfExcess = n.num(meta.df && meta.df.excess);
      const selling = a.revenue;
      const slotPerTeu = a.teu ? Math.round((dfBase / a.teu) * 100) / 100 : 0;
      const profit = dfBase ? Math.round((selling - dfBase - dfExcess) * 100) / 100 : null;

      byVoyage.push({
        key, vessel, voy, svc, etd,
        wk: etd ? n.excelWeekNum(etd) : 0,
        rows: a.rows, cancelRows: rows.length - act.length,
        teu: a.teu, boxes: a.boxes, wt: a.wt,
        u20: a.u20, u40: a.u40,
        bsaTeu, bsaTon,
        vesselTeu: meta.vesselTeu || null, vesselTon: meta.vesselTon || null,
        peakTeu: rob.peakTeu, peakTon: rob.peakTon,
        remainTeu: bsaTeu ? Math.round((bsaTeu - rob.peakTeu) * 100) / 100 : null,
        remainTon: bsaTon ? Math.round((bsaTon - rob.peakTon) * 100) / 100 : null,
        utilPct: bsaTeu ? Math.round((rob.peakTeu / bsaTeu) * 1000) / 10 : null,
        dfBase, dfExcess, selling, slotPerTeu, profit,
        winSabis: meta.winSabis || '', docClosing: meta.docClosing || '',
        cargoClosing: meta.cargoClosing || '', scheduleRemark: meta.scheduleRemark || '',
        rob,
      });
    }
    byVoyage.sort((a, b) => (a.etd || 'zzzz').localeCompare(b.etd || 'zzzz') ||
                            a.vessel.localeCompare(b.vessel));

    /* Alerts worth surfacing. */
    const alerts = [];
    for (const v of byVoyage) {
      if (v.bsaTeu && v.peakTeu > v.bsaTeu) {
        alerts.push({
          level: 'over', text: `${v.vessel} ${v.voy} peaks at ${v.peakTeu} TEU against a ${v.bsaTeu} TEU BSA ` +
            `(+${Math.round((v.peakTeu - v.bsaTeu) * 10) / 10})`,
        });
      }
      if (v.bsaTon && v.peakTon > v.bsaTon) {
        alerts.push({
          level: 'over', text: `${v.vessel} ${v.voy} peaks at ${Math.round(v.peakTon)} T against a ${v.bsaTon} T limit`,
        });
      }
    }
    for (const r of active) {
      if (r.teuSheet && Math.abs(r.teuSheet - r.teu) > 0.001) {
        alerts.push({
          level: 'warn',
          text: `TEU mismatch on ${r.blNo || '(no B/L)'} — source sheet says ${r.teuSheet}, boxes compute to ${r.teu}`,
        });
      }
    }
    /* Two sources describing the same booking differently — worth a human look. */
    for (const c of (st.conflicts || []).slice(0, 40)) {
      alerts.push({
        level: 'warn',
        text: `${c.blNo || '(no B/L)'} — ${c.field} differs between sources: kept "${c.kept}" ` +
              `(${c.keptFrom}), ignored "${c.dropped}" (${c.droppedFrom})`,
      });
    }

    /* Services taken from the voyage schedule in place of a mistyped header.
       Grouped so one bad sheet produces one line, not thirty. */
    const svcFix = new Map();
    for (const c of (st.svcCorrections || [])) {
      const k = c.voy + '~' + c.from + '~' + c.to + '~' + c.src;
      const e = svcFix.get(k) || Object.assign({ count: 0 }, c);
      e.count += 1;
      svcFix.set(k, e);
    }
    for (const e of svcFix.values()) {
      alerts.push({
        level: 'warn',
        text: `${e.vessel} ${e.voyNo}: sheet header says service ${e.from}, but this voyage's ` +
              `schedule is ${e.to}. Used ${e.to} for ${e.count} booking(s) — fix ${e.src}`,
      });
    }

    /* A vessel on a loop it does not normally run, where no schedule settles it. */
    const svcMismatch = new Map();
    for (const r of active) {
      if (!r.svc1 || !r.leg1Vessel) continue;
      const meta = st.voyages[r.voyKey];
      if (meta && meta.svcRank === 2) continue;      /* already schedule-backed */
      const expected = n.VESSEL_SVC_SEED[r.leg1Vessel];
      if (!expected || expected === r.svc1) continue;
      const k = r.voyKey + '~' + r.svc1 + '~' + expected;
      const e = svcMismatch.get(k) ||
        { vessel: r.leg1Vessel, voy: r.leg1Voy, got: r.svc1, expected, count: 0 };
      e.count += 1;
      svcMismatch.set(k, e);
    }
    for (const e of svcMismatch.values()) {
      alerts.push({
        level: 'warn',
        text: `${e.vessel} ${e.voy} is marked service ${e.got} on ${e.count} booking(s), ` +
              `but ${e.vessel} normally runs ${e.expected} — no schedule on file to settle it`,
      });
    }

    const noSvc = active.filter((r) => !n.svcOf(r)).length;
    if (noSvc) alerts.push({ level: 'info', text: `${noSvc} row(s) have no service assigned` });
    const noEtd = active.filter((r) => !r.leg1Etd).length;
    if (noEtd) alerts.push({ level: 'info', text: `${noEtd} row(s) have no 1st-leg ETD` });
    const unknownPorts = new Set();
    for (const r of active) {
      for (const p of [r.pol, r.pod, r.fpod, r.ts]) {
        if (p && !n.PORTS[p]) unknownPorts.add(p);
      }
    }
    if (unknownPorts.size) {
      alerts.push({ level: 'info', text: 'Unrecognised port codes: ' + Array.from(unknownPorts).join(', ') });
    }

    return {
      totals, byService, byWeek, byLane, byPol, byPod, byParty, byCustomer,
      byDirTs, byClass, byVoyage, matrix, weeks, svcCodes, mix,
      alerts: alerts.slice(0, 200),
      active, cancelled, all,
    };
  }

  global.FAgg = { build, robPlan, cargoClass, dischargePort, teu20, teu40, groupBy };
})(typeof window !== 'undefined' ? window : globalThis);
