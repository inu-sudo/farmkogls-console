/* ============================================================================
   ui.js — Farmkogls Booking Console application shell.
   ========================================================================= */
(function (global) {
  'use strict';

  const N = () => global.FNorm;
  const LS_KEY = 'farmkogls.console.store.v3';

  const App = {
    store: null,
    agg: null,
    tab: 'propagate',
    /* Raw bytes kept so the register file can be edited in place, not rebuilt. */
    prop: { agency: null, target: null, report: null, blob: null, running: false },
    filters: { svc: '', wkFrom: '', wkTo: '', voy: '', status: 'active', q: '', party: '', pol: '', pod: '' },
    sort: { bookings: { col: 'leg1Etd', dir: 1 }, voyages: { col: 'etd', dir: 1 } },
    busy: false,
    exportFiltered: false,
  };

  /* ------------------------------------------------------------------ *
   * small helpers
   * ------------------------------------------------------------------ */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function fmt(v, dp) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!isFinite(n)) return esc(v);
    return n.toLocaleString('en-US', {
      minimumFractionDigits: dp || 0,
      maximumFractionDigits: dp === undefined ? (Number.isInteger(n) ? 0 : 1) : dp,
    });
  }
  function svcTag(s) { return s ? `<span class="tag ${esc(s)}">${esc(s)}</span>` : '<span class="tag">—</span>'; }
  function svcColour(s) {
    const m = { CSC: 'var(--csc)', NWX: 'var(--nwx)', CCS: 'var(--ccs)', SKS: 'var(--sks)' };
    return m[s] || 'var(--ink-3)';
  }

  function toast(title, msg, kind) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = `<b>${esc(title)}</b>${msg ? `<span>${esc(msg)}</span>` : ''}`;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, kind === 'bad' ? 9000 : 4200);
    setTimeout(() => el.remove(), kind === 'bad' ? 9500 : 4700);
  }

  /**
   * Hand a generated file to the user.
   * On the hosted build the frame cannot download directly — the viewer has to
   * confirm a save, and .xlsx is not an allowed type there. Say so plainly and
   * point at the downloadable tool rather than failing silently.
   */
  async function download(blob, name) {
    const cd = global.claude && global.claude.downloads;
    if (cd) {
      try {
        await cd.save({ filename: name, data: blob });
        return true;
      } catch (e) {
        const code = e && e.code;
        if (code === 'declined') return false;
        if (code === 'rejected_extension' || code === 'extension_not_enabled') {
          toast('이 화면에서는 엑셀 파일로 저장할 수 없습니다',
            '아래 “도구 내려받기”로 받은 파일을 PC에서 열면 엑셀 저장까지 됩니다.', 'bad');
          return false;
        }
        if (code === 'too_large') {
          toast('파일이 너무 큽니다', '필터를 좁혀 내보내거나, 도구를 받아 PC에서 실행하세요.', 'bad');
          return false;
        }
        /* anything else: fall through and try the ordinary way */
      }
    }
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e) {
      toast('파일을 저장하지 못했습니다', String((e && e.message) || e), 'bad');
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * persistence
   * ------------------------------------------------------------------ */
  let warnedSize = false;
  function save() {
    if (!App.canPersist) return;
    let json;
    try { json = global.FMerge.toJSON(App.store); } catch (e) { return; }
    try {
      localStorage.setItem(LS_KEY, json);
      /* Browsers cap local storage around 5 MB. Warn before we hit the wall. */
      if (!warnedSize && json.length > 3.6e6) {
        warnedSize = true;
        toast('등록부가 커지고 있습니다',
          '약 5 MB 중 ' + (Math.round(json.length / 1024 / 1024 * 10) / 10) + ' MB를 썼습니다. ' +
          '프로젝트 파일로 저장하고 지난 시즌은 정리해 주세요.', 'bad');
      }
    } catch (e) {
      App.canPersist = false;
      toast('이 브라우저에는 등록부를 보관할 수 없습니다',
        '저장 공간이 가득 찼거나 막혀 있어 새로고침하면 사라집니다. ' +
        '“프로젝트 저장”으로 파일을 받아 두세요.', 'bad');
    }
  }
  function load() {
    try {
      const t = localStorage.getItem(LS_KEY);
      if (!t) return null;
      return global.FMerge.fromJSON(t);
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ *
   * filtering
   * ------------------------------------------------------------------ */
  function filterFn() {
    const f = App.filters;
    const q = f.q.trim().toLowerCase();
    const wf = f.wkFrom === '' ? -Infinity : Number(f.wkFrom);
    const wt = f.wkTo === '' ? Infinity : Number(f.wkTo);
    return (r) => {
      if (f.status === 'active' && r.status === 'cancel') return false;
      if (f.status === 'cancel' && r.status !== 'cancel') return false;
      if (f.svc && (N().svcOf(r) || '') !== f.svc) return false;
      if (f.voy && r.voyKey !== f.voy) return false;
      if (f.party && r.bkParty !== f.party) return false;
      if (f.pol && r.pol !== f.pol) return false;
      if (f.pod && (r.fpod || r.pod) !== f.pod) return false;
      if (r.wk && (r.wk < wf || r.wk > wt)) return false;
      if (q) {
        const hay = [r.blNo, r.customer, r.bkParty, r.leg1Vessel, r.leg1Voy, r.leg2Vessel,
          r.item, r.remark, r.pol, r.pod, r.fpod, r.special, r.salesRep].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    };
  }

  function rebuild() {
    App.agg = global.FAgg.build(App.store);
    render();
  }

  /* ------------------------------------------------------------------ *
   * ingest
   * ------------------------------------------------------------------ */
  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => /\.(xlsx|xlsm|xltx)$/i.test(f.name));
    const json = Array.from(fileList).filter((f) => /\.json$/i.test(f.name));

    if (json.length) {
      for (const jf of json) {
        try {
          App.store = global.FMerge.fromJSON(await jf.text());
          save(); rebuild();
          toast('프로젝트를 불러왔습니다', `${jf.name} — 부킹 ${App.store.records.length}건`, 'good');
        } catch (e) { toast('프로젝트를 불러오지 못했습니다', jf.name + ': ' + e.message, 'bad'); }
      }
      if (!files.length) return;
    }
    if (!files.length) {
      toast('읽을 파일이 없습니다', '.xlsx 파일이나 저장해 둔 .json 프로젝트를 넣어 주세요.', 'bad');
      return;
    }

    App.busy = true; renderStatus();
    const prog = $('#prog');
    prog.hidden = false; prog.max = files.length; prog.value = 0;

    let recs = [], voy = [], bsa = [], df = [], rob = [];
    const names = [], report = [];

    for (const f of files) {
      try {
        const bytes = await f.arrayBuffer();
        const wb = await global.FXlsxRead.readWorkbook(bytes, f.name);

        /* Remember the two workbooks the in-place update needs.
           NB: this list is the workbook's SHEET names — keep it distinct from
           `names`, the list of ingested file names used for the batch label. */
        const sheetNames = wb.sheets.map((s) => s.name);
        if (sheetNames.indexOf(global.FProp.TARGET_SHEET) >= 0) {
          App.prop.target = { name: f.name, bytes, mtime: f.lastModified || 0 };
          App.prop.report = null; App.prop.blob = null;
        } else if (sheetNames.some((nm) => /FES\s+(CSC|NWX|CCS|SKS)\s+BK\s*FCST/i.test(nm))) {
          App.prop.agency = { name: f.name, bytes, mtime: f.lastModified || 0 };
          App.prop.report = null; App.prop.blob = null;
        }

        const res = global.FParse.parseWorkbook(wb);
        /* Stamp the file's own timestamp so a newer file wins a disagreement
           against an equally-trusted older one. */
        const mtime = f.lastModified || 0;
        res.records.forEach((r) => { r.srcMtime = mtime; });
        recs = recs.concat(res.records);
        voy = voy.concat(res.voyages);
        bsa = bsa.concat(res.bsa);
        df = df.concat(res.df);
        rob = rob.concat(res.rob);
        names.push(f.name);
        const kinds = {};
        res.sheets.forEach((s) => { kinds[s.kind] = (kinds[s.kind] || 0) + 1; });
        report.push({
          file: f.name, records: res.records.length, sheets: res.sheets.length,
          kinds, skipped: res.skipped,
        });
        if (!res.sheets.length) {
          toast('인식된 시트가 없습니다', f.name + ' — 아는 양식과 맞는 시트를 찾지 못했습니다.', 'bad');
        }
      } catch (e) {
        toast(f.name + ' 을(를) 읽지 못했습니다', e.message, 'bad');
        report.push({ file: f.name, error: e.message });
      }
      prog.value += 1;
    }

    /* ROB sheets contribute BSA caps at the lowest precedence. */
    const voyAll = voy.concat(rob.map((r) => ({
      srcFile: r.srcFile, srcSheet: r.srcSheet, key: r.key,
      vessel: r.vessel, voy: r.voy, bsaTeu: r.bsaTeu, bsaTon: r.bsaTon, bsaRank: 1,
    })));

    const entry = global.FMerge.ingest(App.store, recs, {
      label: names.length === 1 ? names[0] : `${names.length}개 파일`,
      files: names, voyages: voyAll, bsa, df,
    });
    App.lastReport = report;

    prog.hidden = true; App.busy = false;
    save(); rebuild();

    toast(names.length + '개 파일을 반영했습니다',
      `신규 ${entry.added} · 갱신 ${entry.updated} · 변화없음 ${entry.unchanged}` +
      (entry.dupsInBatch ? ` · 중복 ${entry.dupsInBatch}행 병합` : '') +
      ` → 누적 ${entry.total}건`, 'good');
  }

  /* ------------------------------------------------------------------ *
   * export
   * ------------------------------------------------------------------ */
  async function doExport() {
    if (!App.store.records.length) { toast('내보낼 내용이 없습니다', '먼저 파일을 넣어 주세요.', 'bad'); return; }
    const btn = $('#btnExport');
    btn.disabled = true; btn.textContent = '만드는 중…';
    try {
      const agg = App.exportFiltered ? global.FAgg.build(App.store, filterFn()) : global.FAgg.build(App.store);
      const blob = await global.FExport.buildWorkbook(App.store, agg);
      const ok = await download(blob, global.FExport.fileName());
      if (ok) {
        toast('통합 엑셀을 저장했습니다',
          `활성 부킹 ${agg.active.length}건 · ${fmt(agg.totals.teu, 1)} TEU · ` +
          `항차 ${agg.byVoyage.length}개`, 'good');
      }
    } catch (e) {
      toast('내보내기에 실패했습니다', e.message, 'bad');
    } finally {
      btn.disabled = false; btn.innerHTML = '⬇ 통합 엑셀 내보내기';
    }
  }

  /* ------------------------------------------------------------------ *
   * chart: stacked bars, week × service
   * ------------------------------------------------------------------ */
  function weekChart(agg) {
    const weeks = agg.byWeek.map((w) => w.key);
    if (!weeks.length) return '<div class="empty">No dated bookings yet.</div>';
    const svcs = agg.byService.map((s) => s.key);
    const W = 1000, H = 240, PL = 44, PR = 12, PT = 12, PB = 26;
    const iw = W - PL - PR, ih = H - PT - PB;
    const max = Math.max.apply(null, agg.byWeek.map((w) => w.teu)) || 1;
    const step = Math.max(1, Math.ceil(Math.log10(max)));
    const nice = Math.ceil(max / Math.pow(10, step - 1)) * Math.pow(10, step - 1);
    const bw = Math.max(3, Math.min(34, (iw / weeks.length) * 0.72));
    const x = (i) => PL + (iw / weeks.length) * (i + 0.5);
    const y = (v) => PT + ih - (v / nice) * ih;

    let g = '';
    for (let t = 0; t <= 4; t++) {
      const v = (nice / 4) * t;
      g += `<line class="gl" x1="${PL}" y1="${y(v).toFixed(1)}" x2="${W - PR}" y2="${y(v).toFixed(1)}"/>` +
           `<text class="vlab" x="${PL - 6}" y="${(y(v) + 3.4).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`;
    }
    let bars = '';
    weeks.forEach((wk, i) => {
      let acc = 0;
      for (const s of svcs) {
        const v = (agg.matrix[s] && agg.matrix[s][wk]) || 0;
        if (!v) continue;
        const h = (v / nice) * ih;
        bars += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(y(acc) - h).toFixed(1)}" ` +
                `width="${bw.toFixed(1)}" height="${Math.max(0.6, h).toFixed(1)}" ` +
                `fill="${svcColour(s)}" rx="1"><title>WK ${wk} · ${s} · ${fmt(v, 1)} TEU</title></rect>`;
        acc += v;
      }
    });
    let lab = '';
    const every = weeks.length > 34 ? 4 : weeks.length > 20 ? 2 : 1;
    weeks.forEach((wk, i) => {
      if (i % every) return;
      lab += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${wk}</text>`;
    });
    const legend = svcs.map((s) =>
      `<span><i style="background:${svcColour(s)}"></i>${esc(s)}</span>`).join('');

    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet"
      aria-label="TEU by week and service">${g}${bars}
      <line class="ax" x1="${PL}" y1="${PT + ih}" x2="${W - PR}" y2="${PT + ih}"/>${lab}</svg>
      <div class="legend">${legend}<span style="color:var(--ink-3)">week number (Excel WEEKNUM)</span></div>`;
  }

  function utilBar(pct) {
    if (pct === null || pct === undefined) return '<span class="dim">—</span>';
    const cls = pct > 100 ? 'over' : pct > 85 ? 'hi' : '';
    return `<div class="ubar ${cls}"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i>` +
           `<em>${fmt(pct, 1)}%</em></div>`;
  }

  /* ------------------------------------------------------------------ *
   * renderers
   * ------------------------------------------------------------------ */
  function renderStatus() {
    const t = App.agg ? App.agg.totals : { rows: 0, teu: 0, cancelledRows: 0 };
    const vs = App.agg ? App.agg.byVoyage.filter((v) => v.rows).length : 0;
    $('#hstat').innerHTML = [
      ['Bookings', fmt(t.rows)],
      ['TEU', fmt(t.teu, 1)],
      ['Voyages', fmt(vs)],
      ['Cancelled', fmt(t.cancelledRows)],
      ['Updated', App.store && App.store.updated ? App.store.updated.slice(5, 16).replace('T', ' ') : '—'],
    ].map(([k, v]) => `<div><u>${k}</u><b>${v}</b></div>`).join('');
    $('#btnExport').disabled = App.busy || !App.store.records.length;
  }

  /* ------------------------------------------------------------------ *
   * 파일 갱신 — 학습.xlsx 를 기존 FES BK FCST 에 밀어넣기
   * ------------------------------------------------------------------ */
  async function runPropagate() {
    const p = App.prop;
    if (!p.agency || !p.target || p.running) return;
    p.running = true; render();
    try {
      const { blob, report } = await global.FProp.propagate(p.agency.bytes, p.target.bytes, {
        agencyName: p.agency.name, targetName: p.target.name,
      });
      p.blob = blob; p.report = report;
      toast('갱신 완료',
        `신규 ${report.inserted}건 삽입 · 기존 ${report.updated}건 갱신 · ${report.unchanged}건 변화 없음`,
        'good');
    } catch (e) {
      p.report = null; p.blob = null;
      toast('갱신 실패', e.message, 'bad');
    } finally {
      p.running = false; render();
    }
  }

  function propagateTab() {
    const p = App.prop;
    const slot = (role, label, hint, file) => `
      <div class="card" style="${file ? 'border-color:var(--pos)' : ''}">
        <h4>${label}${file ? '<span class="sub" style="color:var(--pos)">준비됨</span>' : ''}</h4>
        <div class="body">
          ${file
            ? `<b class="mono" style="font-size:13px">${esc(file.name)}</b>
               <div class="note" style="color:var(--ink-2);font-size:12px;margin-top:4px">
                 ${(file.bytes.byteLength / 1024).toFixed(0)} KB${file.mtime
                   ? ' · 저장 ' + new Date(file.mtime).toISOString().slice(0, 16).replace('T', ' ') : ''}</div>`
            : `<div style="color:var(--ink-3);font-size:12.5px">${esc(hint)}</div>`}
        </div>
      </div>`;

    const slots = `<div class="grid g2">
      ${slot('agency', '① 입력 — 에이전트 주간 예보', '학습.xlsx 처럼 FES CSC/NWX/CCS/SKS BK FCST 시트가 있는 파일', p.agency)}
      ${slot('target', '② 대상 — 통합 등록부', 'FES BK FCST 시트가 있는 파일 (FES AGENCY BOOKING FORECAST)', p.target)}
    </div>`;

    if (!p.agency || !p.target) {
      return slots + `<div class="card" style="margin-top:14px"><div class="empty">
        <h3>두 파일을 위에 끌어다 놓으세요</h3>
        <p>어느 쪽이 입력이고 어느 쪽이 대상인지는 시트 이름으로 자동 판별합니다.<br>
        대상 파일의 <b>수식·서식·그림·메모는 그대로 유지</b>되고, 필요한 칸만 고쳐서 새 사본으로 나옵니다.</p>
      </div></div>`;
    }

    const runBtn = `<div class="filters" style="margin-top:14px">
      <button class="btn primary" id="btnProp" ${p.running ? 'disabled' : ''}>
        ${p.running ? '처리 중…' : '③ 등록부에 반영하기'}</button>
      ${p.blob ? `<button class="btn primary" id="btnPropDl">⬇ 갱신된 파일 내려받기</button>` : ''}
      <span class="sp"></span>
      <span style="font-size:12px;color:var(--ink-3)">원본은 그대로 두고 새 사본을 만듭니다</span>
    </div>`;

    if (!p.report) return slots + runBtn;

    const r = p.report;
    const kpi = [
      ['신규 삽입', r.inserted, `${r.insertAt}행부터`],
      ['기존 갱신', r.updated, '값이 달라진 행'],
      ['변화 없음', r.unchanged, '이미 최신'],
      ['읽은 행', r.parsed, r.sheets.map((s) => `${s.svc} ${s.rows}`).join(' · ')],
    ].map(([k, v, note]) => `<div class="card kpi"><u>${k}</u><b>${fmt(v)}</b>
      <div class="note">${esc(note)}</div></div>`).join('');

    const shift = r.rowsShifted
      ? `<div class="alert info"><span class="lv">이동</span><span>
          ${r.rowsShifted.from}행 이하가 ${r.rowsShifted.by}행 아래로 밀렸습니다.
          <code>** CANCEL LIST</code>는 ${r.rowsShifted.cancelListMovedTo}행으로 이동합니다.
          수식·조건부서식·메모 위치도 함께 조정됩니다.</span></div>` : '';

    const notes = r.notes.map((n) =>
      `<div class="alert warn"><span class="lv">확인</span><span>${esc(n)}</span></div>`).join('');

    const ins = r.changes.filter((c) => c.kind === 'inserted').map((c) => `<tr>
      <td><span class="tag active">신규</span></td>
      <td class="n">${c.row}</td><td>${svcTag(c.svc)}</td>
      <td class="mono">${esc(String(c.bl).replace(/\n/g, ' / '))}</td>
      <td class="n">${fmt(c.teu, 0)}</td>
      <td class="dim">${esc(c.src)}</td><td></td></tr>`).join('');

    const upd = r.changes.filter((c) => c.kind === 'updated').map((c) => `<tr>
      <td><span class="tag TS">갱신</span></td>
      <td class="n">${c.row}</td><td>${svcTag(c.svc)}</td>
      <td class="mono">${esc(String(c.bl).replace(/\n/g, ' / '))}</td>
      <td></td><td class="dim">${esc(c.src)}</td>
      <td class="wrap">${c.diffs.map((d) =>
        `<code>${esc(d.col)}</code> ${esc(String(d.from) || '(빈칸)')} → <b>${esc(String(d.to))}</b>`
      ).join('<br>')}</td></tr>`).join('');

    const ts = r.tsRows.length ? `<div class="card" style="margin-top:14px">
      <h4>T/S 행 — 2nd Leg를 직접 채워야 합니다
        <span class="sub">${r.tsRows.length}건 · 학습.xlsx에 없는 정보</span></h4>
      <div class="body flush"><table class="dt">
        <thead><tr><th class="no-sort">행</th><th class="no-sort">구분</th><th class="no-sort">SVC</th>
        <th class="no-sort">B/L NO</th><th class="no-sort">T/S 항구</th><th class="no-sort">F.POD</th>
        <th class="no-sort">비워둔 칸</th></tr></thead>
        <tbody>${r.tsRows.map((t) => `<tr>
          <td class="n">${t.row}</td>
          <td>${t.isNew ? '<span class="tag active">신규</span>' : '<span class="tag TS">기존</span>'}</td>
          <td>${svcTag(t.svc)}</td>
          <td class="mono">${esc(String(t.bl).replace(/\n/g, ' / '))}</td>
          <td>${esc(t.ts)}</td><td>${esc(t.fpod)}</td>
          <td class="dim">${t.isNew ? 'I(2nd Leg Vessel) · J(ETD) · N(2nd SVC)' : '기존 값 유지'}</td>
        </tr>`).join('')}</tbody></table></div></div>` : '';

    return slots + runBtn + `
      <div class="grid g4" style="margin-top:14px">${kpi}</div>
      ${shift || notes ? `<div class="card" style="margin-top:14px"><h4>처리 요약</h4>
        <div class="body flush">${shift}${notes}</div></div>` : ''}
      <div class="card" style="margin-top:14px"><h4>변경 내역
        <span class="sub">이 내용이 대상 파일에 반영됩니다</span></h4>
        <div class="body flush"><div class="tw"><table class="dt">
        <thead><tr><th class="no-sort">구분</th><th class="no-sort">행</th><th class="no-sort">SVC</th>
        <th class="no-sort">B/L NO</th><th class="no-sort">TEU</th><th class="no-sort">출처</th>
        <th class="no-sort">바뀌는 값</th></tr></thead>
        <tbody>${upd}${ins}</tbody></table></div></div></div>
      ${ts}`;
  }

  function overviewTab() {
    const a = App.agg;
    const t = a.totals;
    if (!a.all.length) {
      return `<div class="card"><div class="empty">
        <h3>No data yet</h3>
        <p>Drop this week's booking files above. The console figures out what each
        sheet is, merges it into a running register, and keeps the result.</p></div></div>`;
    }
    const over = a.byVoyage.filter((v) => v.bsaTeu && v.peakTeu > v.bsaTeu);
    const kpis = [
      ['Active bookings', fmt(t.rows), '', `${fmt(t.allRows)} rows held in total`],
      ['Active TEU', fmt(t.teu, 1), 'TEU', `${fmt(t.boxes)} boxes · ${fmt(t.u20)}×20′ ${fmt(t.u40)}×40′`],
      ['VGM weight', fmt(t.wt, 0), 't', t.teu ? `${fmt(t.wt / t.teu, 1)} t per TEU average` : ''],
      ['Voyages over BSA', fmt(over.length), '', over.length
        ? `${fmt(over.reduce((s, v) => s + (v.peakTeu - v.bsaTeu), 0), 1)} TEU of excess slots`
        : 'every voyage within allocation'],
    ].map(([k, v, u, note]) => `<div class="card kpi"><u>${k}</u>
      <b>${v}${u ? `<span class="unit">${u}</span>` : ''}</b>
      ${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`).join('');

    const svcRows = a.byService.map((s) => {
      const pct = t.teu ? (s.teu / t.teu) * 100 : 0;
      return `<tr><td>${svcTag(s.key)}</td><td class="n">${fmt(s.rows)}</td>
        <td class="n">${fmt(s.teu, 1)}</td>
        <td><div class="bar-mini"><i style="width:${pct.toFixed(1)}%;background:${svcColour(s.key)}"></i></div></td>
        <td class="n dim">${fmt(pct, 1)}%</td></tr>`;
    }).join('');

    const laneRows = a.byLane.slice(0, 14).map((l) => `<tr>
      <td>${esc(l.key)}</td><td class="n">${fmt(l.rows)}</td>
      <td class="n">${fmt(l.teu, 1)}</td><td class="n dim">${fmt(l.wt, 0)}</td></tr>`).join('');

    const partyRows = a.byParty.slice(0, 14).map((p) => `<tr>
      <td>${esc(p.key)}</td><td class="n">${fmt(p.rows)}</td>
      <td class="n">${fmt(p.teu, 1)}</td></tr>`).join('');

    const alerts = a.alerts.length
      ? a.alerts.slice(0, 40).map((x) =>
          `<div class="alert ${x.level}"><span class="lv">${x.level}</span><span>${esc(x.text)}</span></div>`).join('')
      : '<div class="alert ok"><span class="lv">ok</span><span>No issues detected.</span></div>';

    const mixRows = a.mix.map((m) => `<tr><td class="mono">${esc(m.key)}</td>
      <td class="n">${fmt(m.units)}</td><td class="n">${fmt(m.teu, 0)}</td></tr>`).join('');

    return `
    <div class="grid g4">${kpis}</div>
    <div class="grid" style="margin-top:14px">
      <div class="card"><h4>TEU by week and service
        <span class="sub">${a.byWeek.length} weeks · stacked</span></h4>
        <div class="body">${weekChart(a)}</div></div>
    </div>
    <div class="grid g3" style="margin-top:14px">
      <div class="card"><h4>Service mix</h4><div class="body flush"><table class="dt">
        <thead><tr><th class="no-sort">SVC</th><th class="no-sort">Bkgs</th><th class="no-sort">TEU</th>
        <th class="no-sort" style="width:34%">Share</th><th class="no-sort"></th></tr></thead>
        <tbody>${svcRows}</tbody></table></div></div>
      <div class="card"><h4>Top lanes <span class="sub">POL → final POD</span></h4>
        <div class="body flush"><div class="tw" style="max-height:290px"><table class="dt">
        <thead><tr><th class="no-sort">Lane</th><th class="no-sort">Bkgs</th>
        <th class="no-sort">TEU</th><th class="no-sort">Ton</th></tr></thead>
        <tbody>${laneRows}</tbody></table></div></div></div>
      <div class="card"><h4>Booking parties</h4>
        <div class="body flush"><div class="tw" style="max-height:290px"><table class="dt">
        <thead><tr><th class="no-sort">Party</th><th class="no-sort">Bkgs</th>
        <th class="no-sort">TEU</th></tr></thead><tbody>${partyRows}</tbody></table></div></div></div>
    </div>
    <div class="grid g21" style="margin-top:14px">
      <div class="card"><h4>Checks and exceptions
        <span class="sub">${a.alerts.length} finding${a.alerts.length === 1 ? '' : 's'}</span></h4>
        <div class="body flush"><div class="tw" style="max-height:340px">${alerts}</div></div></div>
      <div class="card"><h4>Container mix</h4><div class="body flush"><table class="dt">
        <thead><tr><th class="no-sort">Type</th><th class="no-sort">Units</th>
        <th class="no-sort">TEU</th></tr></thead><tbody>${mixRows}</tbody></table></div></div>
    </div>`;
  }

  function voyagesTab() {
    const a = App.agg;
    const f = App.filters;
    let list = a.byVoyage.filter((v) => v.rows || v.bsaTeu);
    if (f.svc) list = list.filter((v) => v.svc === f.svc);
    if (f.q) {
      const q = f.q.toLowerCase();
      list = list.filter((v) => (v.vessel + ' ' + v.voy + ' ' + v.svc).toLowerCase().indexOf(q) >= 0);
    }
    const s = App.sort.voyages;
    list = list.slice().sort((x, y) => {
      const A = x[s.col], B = y[s.col];
      if (typeof A === 'number' || typeof B === 'number') return ((A || 0) - (B || 0)) * s.dir;
      return String(A || '').localeCompare(String(B || '')) * s.dir;
    });

    if (!list.length) return '<div class="card"><div class="empty">No voyages match.</div></div>';

    const cols = [
      ['svc', 'SVC'], ['vessel', 'Vessel'], ['voy', 'Voy'], ['etd', 'First ETD'], ['wk', 'WK'],
      ['rows', 'Bkgs'], ['teu', 'Booked TEU'], ['peakTeu', 'Peak TEU'], ['bsaTeu', 'BSA'],
      ['remainTeu', 'Remain'], ['utilPct', 'Utilisation'],
      ['peakTon', 'Peak t'], ['bsaTon', 'BSA t'], ['remainTon', 'Remain t'],
      ['dfBase', 'DF cost'], ['selling', 'Selling'], ['profit', 'Margin'],
    ];
    const head = cols.map(([k, l]) =>
      `<th data-sort="voyages:${k}" ${s.col === k ? 'aria-sort="1"' : ''}>${l}${
        s.col === k ? `<span class="ar">${s.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('');

    const body = list.map((v) => {
      const remCls = v.remainTeu === null ? 'dim' : v.remainTeu < 0 ? 'neg' : 'pos';
      const remTCls = v.remainTon === null ? 'dim' : v.remainTon < 0 ? 'neg' : 'pos';
      return `<tr>
        <td>${svcTag(v.svc)}</td>
        <td><b>${esc(v.vessel)}</b></td>
        <td class="mono">${esc(v.voy)}</td>
        <td class="mono">${esc(v.etd || '—')}</td>
        <td class="n dim">${v.wk || ''}</td>
        <td class="n">${fmt(v.rows)}${v.cancelRows ? `<span class="dim"> +${v.cancelRows}c</span>` : ''}</td>
        <td class="n">${fmt(v.teu, 1)}</td>
        <td class="n"><b>${fmt(v.peakTeu, 1)}</b></td>
        <td class="n">${v.bsaTeu ? fmt(v.bsaTeu) : '<span class="dim">—</span>'}</td>
        <td class="n ${remCls}">${v.remainTeu === null ? '—' : fmt(v.remainTeu, 1)}</td>
        <td>${utilBar(v.utilPct)}</td>
        <td class="n">${fmt(v.peakTon, 0)}</td>
        <td class="n">${v.bsaTon ? fmt(v.bsaTon) : '<span class="dim">—</span>'}</td>
        <td class="n ${remTCls}">${v.remainTon === null ? '—' : fmt(v.remainTon, 0)}</td>
        <td class="n dim">${v.dfBase ? fmt(v.dfBase) : ''}</td>
        <td class="n">${v.selling ? fmt(v.selling) : ''}</td>
        <td class="n ${v.profit === null ? 'dim' : v.profit < 0 ? 'neg' : 'pos'}">${
          v.profit === null ? '' : fmt(v.profit)}</td>
      </tr>`;
    }).join('');

    return `<div class="card"><h4>Voyage utilisation vs BSA
      <span class="sub">${list.length} voyages · peak TEU is the highest on-board load across the rotation</span></h4>
      <div class="body flush"><div class="tw"><table class="dt">
      <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div></div>`;
  }

  function robTab() {
    const a = App.agg;
    const f = App.filters;
    let list = a.byVoyage.filter((v) => v.rows && v.rob && v.rob.legs.length);
    if (f.svc) list = list.filter((v) => v.svc === f.svc);
    if (f.q) {
      const q = f.q.toLowerCase();
      list = list.filter((v) => (v.vessel + ' ' + v.voy).toLowerCase().indexOf(q) >= 0);
    }
    list = list.slice().sort((x, y) => String(y.etd || '').localeCompare(String(x.etd || '')));
    if (!list.length) return '<div class="card"><div class="empty">No voyages with traffic yet.</div></div>';

    const items = list.slice(0, 80).map((v, i) => {
      const legs = v.rob.legs.map((l) => `<tr>
        <td class="n dim">${l.seq}</td>
        <td><b>${esc(l.port)}</b><span class="dim"> ${esc((N().PORTS[l.port] || {}).name || '')}</span></td>
        <td class="mono">${esc(l.etd || '—')}</td>
        <td class="n dim">${l.wk || ''}</td>
        <td class="n">${l.loadTeu ? fmt(l.loadTeu, 1) : ''}</td>
        <td class="n dim">${l.load20 || ''}</td>
        <td class="n dim">${l.load40 || ''}</td>
        <td class="n">${l.loadDG ? fmt(l.loadDG, 1) : ''}</td>
        <td class="n">${l.loadOOG ? fmt(l.loadOOG, 1) : ''}</td>
        <td class="n">${l.dischTeu ? '−' + fmt(l.dischTeu, 1) : ''}</td>
        <td class="n"><b>${fmt(l.onboardTeu, 1)}</b></td>
        <td class="n ${l.remainTeu === null ? 'dim' : l.remainTeu < 0 ? 'neg' : 'pos'}">${
          l.remainTeu === null ? '—' : fmt(l.remainTeu, 1)}</td>
        <td class="n">${fmt(l.onboardTon, 0)}</td>
        <td class="n ${l.remainTon === null ? 'dim' : l.remainTon < 0 ? 'neg' : 'pos'}">${
          l.remainTon === null ? '—' : fmt(l.remainTon, 0)}</td>
        <td class="dim">${esc(l.note || '')}</td></tr>`).join('');
      const badge = v.bsaTeu
        ? (v.peakTeu > v.bsaTeu
            ? `<span class="tag cancel">over by ${fmt(v.peakTeu - v.bsaTeu, 1)} TEU</span>`
            : `<span class="tag active">${fmt(v.bsaTeu - v.peakTeu, 1)} TEU free</span>`)
        : '<span class="tag">no BSA on file</span>';
      return `<details class="voy" ${i < 3 ? 'open' : ''}>
        <summary><span class="caret">▶</span>${svcTag(v.svc)}
          <b>${esc(v.vessel)}</b><span class="mono">${esc(v.voy)}</span>
          <span class="dim mono">${esc(v.etd || '—')}</span>
          <span class="dim">${fmt(v.rows)} bkgs · peak ${fmt(v.peakTeu, 1)} TEU</span>
          ${badge}</summary>
        <div class="inner"><div class="tw" style="max-height:none"><table class="dt">
          <thead><tr><th class="no-sort">#</th><th class="no-sort">Port</th><th class="no-sort">ETD</th>
          <th class="no-sort">WK</th><th class="no-sort">Load</th><th class="no-sort">20′</th>
          <th class="no-sort">40′</th><th class="no-sort">DG</th><th class="no-sort">OOG</th>
          <th class="no-sort">Disch</th><th class="no-sort">On-board</th><th class="no-sort">Remain</th>
          <th class="no-sort">Ton</th><th class="no-sort">Remain t</th><th class="no-sort">Note</th>
          </tr></thead><tbody>${legs}</tbody></table></div></div></details>`;
    }).join('');

    return `<div class="card"><h4>ROB load plan
      <span class="sub">rebuilt from bookings along each service rotation${
        list.length > 80 ? ` · showing 80 of ${list.length}` : ''}</span></h4>
      <div class="body flush">${items}</div></div>`;
  }

  function bookingsTab() {
    const rows = App.agg.all.filter(filterFn());
    const s = App.sort.bookings;
    const sorted = rows.slice().sort((x, y) => {
      const A = x[s.col], B = y[s.col];
      if (typeof A === 'number' || typeof B === 'number') return ((A || 0) - (B || 0)) * s.dir;
      return String(A || '').localeCompare(String(B || '')) * s.dir;
    });
    const LIMIT = 600;
    const view = sorted.slice(0, LIMIT);
    const cols = [
      ['status', 'St'], ['svc1', 'SVC'], ['wk', 'WK'], ['leg1Etd', 'ETD'],
      ['leg1Vessel', 'Vessel'], ['leg1Voy', 'Voy'], ['dirTs', 'D/T'],
      ['pol', 'POL'], ['pod', 'POD'], ['fpod', 'F.POD'],
      ['blNo', 'B/L No'], ['bkParty', 'Party'], ['customer', 'Customer'],
      ['c20dv', "20DV"], ['c20mt', '20MT'], ['c40hc', '40HC'], ['c40mt', '40MT'],
      ['c20fr', '20FR'], ['c40fr', '40FR'], ['cvoid', 'Void'],
      ['teu', 'TEU'], ['vgmWt', 'VGM t'], ['wtPerTeu', 't/TEU'],
      ['item', 'Item'], ['lumpsum', 'Lumpsum'], ['srcSheet', 'Source'],
    ];
    const head = cols.map(([k, l]) =>
      `<th data-sort="bookings:${k}">${l}${s.col === k ? `<span class="ar">${s.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('');
    const nCols = new Set(['wk', 'c20dv', 'c20mt', 'c40hc', 'c40mt', 'c20fr', 'c40fr', 'cvoid',
      'teu', 'vgmWt', 'wtPerTeu', 'lumpsum']);

    const body = view.map((r) => '<tr>' + cols.map(([k]) => {
      if (k === 'status') return `<td>${r.status === 'cancel' ? '<span class="tag cancel">CXL</span>' : ''}</td>`;
      if (k === 'svc1') {
        const eff = N().svcOf(r);
        return `<td>${svcTag(eff)}${r.svc1 && r.svc1 !== eff
          ? `<span class="dim" title="the source sheet said ${esc(r.svc1)}"> ⚑</span>` : ''}</td>`;
      }
      if (k === 'dirTs') return `<td>${r.dirTs === 'TS' ? '<span class="tag TS">T/S</span>' : '<span class="dim">DIR</span>'}</td>`;
      if (k === 'item' || k === 'customer') return `<td class="wrap dim">${esc(r[k])}</td>`;
      if (k === 'srcSheet') return `<td class="dim" title="${esc(r.srcFile)}">${esc(r.srcSheet)}</td>`;
      if (nCols.has(k)) {
        const v = N().num(r[k]);
        return `<td class="n">${v ? fmt(v, k === 'teu' || k === 'vgmWt' || k === 'wtPerTeu' ? 1 : 0) : ''}</td>`;
      }
      return `<td>${esc(r[k])}</td>`;
    }).join('') + '</tr>').join('');

    const sum = view.reduce((a, r) => {
      a.teu += N().num(r.teu); a.wt += N().num(r.vgmWt); a.ls += N().num(r.lumpsum);
      return a;
    }, { teu: 0, wt: 0, ls: 0 });
    const totRow = `<tr class="tot">${cols.map(([k]) => {
      if (k === 'status') return `<td>${view.length} rows</td>`;
      if (k === 'teu') return `<td class="n">${fmt(sum.teu, 1)}</td>`;
      if (k === 'vgmWt') return `<td class="n">${fmt(sum.wt, 0)}</td>`;
      if (k === 'lumpsum') return `<td class="n">${fmt(sum.ls, 0)}</td>`;
      return '<td></td>';
    }).join('')}</tr>`;

    return `<div class="card"><h4>Bookings
      <span class="sub">${fmt(rows.length)} match the filter${
        rows.length > LIMIT ? ` · showing the first ${LIMIT}` : ''}</span></h4>
      <div class="body flush"><div class="tw"><table class="dt">
      <thead><tr>${head}</tr></thead><tbody>${body}${totRow}</tbody></table></div></div></div>`;
  }

  function changesTab() {
    const st = App.store;
    if (!st.log.length) return '<div class="card"><div class="empty">No files merged yet.</div></div>';
    const batches = st.log.map((e) => `<tr>
      <td class="mono">${esc(e.ts.replace('T', ' ').slice(0, 16))}</td>
      <td>${esc(e.label)}</td>
      <td class="n pos">${e.added ? '+' + e.added : ''}</td>
      <td class="n warnc">${e.updated || ''}</td>
      <td class="n dim">${e.unchanged || ''}</td>
      <td class="n neg">${e.cancelled || ''}</td>
      <td class="n dim">${e.dupsInBatch || ''}</td>
      <td class="n">${fmt(e.total)}</td>
      <td class="wrap dim">${esc((e.files || []).join(', '))}</td></tr>`).join('');

    const diffs = [];
    for (const e of st.log) {
      for (const c of (e.changes || [])) {
        if (diffs.length > 400) break;
        if (c.type === 'added') {
          diffs.push(`<tr><td class="mono dim">${esc(e.ts.slice(5, 16).replace('T', ' '))}</td>
            <td><span class="tag active">new</span></td><td class="mono">${esc(c.blNo)}</td>
            <td class="dim">${esc(c.voy)}</td><td class="n">${fmt(c.teu, 1)}</td>
            <td colspan="3" class="dim">first seen</td></tr>`);
        } else {
          for (const d of (c.diff || [])) {
            diffs.push(`<tr><td class="mono dim">${esc(e.ts.slice(5, 16).replace('T', ' '))}</td>
              <td><span class="tag TS">edit</span></td><td class="mono">${esc(c.blNo)}</td>
              <td class="dim">${esc(c.voy)}</td><td class="n">${fmt(c.teu, 1)}</td>
              <td class="mono">${esc(d.f)}</td>
              <td class="dim">${esc(String(d.from == null ? '' : d.from).slice(0, 40))}</td>
              <td>${esc(String(d.to == null ? '' : d.to).slice(0, 40))}</td></tr>`);
          }
        }
      }
    }

    const rep = (App.lastReport || []).map((r) => r.error
      ? `<div class="alert over"><span class="lv">error</span><span>${esc(r.file)}: ${esc(r.error)}</span></div>`
      : `<div class="alert info"><span class="lv">${r.records}</span><span><b>${esc(r.file)}</b> — ${
          Object.keys(r.kinds).map((k) => `${r.kinds[k]}× ${k}`).join(', ') || 'nothing recognised'}${
          r.skipped.length ? ` · skipped ${r.skipped.length} sheet(s): ` +
            esc(r.skipped.slice(0, 6).map((s) => s.sheet).join(', ')) : ''}</span></div>`).join('');

    const cf = (st.conflicts || []).map((c) => `<tr>
      <td class="mono">${esc(c.blNo || '—')}</td><td class="dim">${esc(c.voy)}</td>
      <td class="mono">${esc(c.field)}</td>
      <td><b>${esc(c.kept)}</b></td><td class="dim wrap">${esc(c.keptFrom)}</td>
      <td class="neg">${esc(c.dropped)}</td><td class="dim wrap">${esc(c.droppedFrom)}</td></tr>`).join('');

    return `${rep ? `<div class="card" style="margin-bottom:14px"><h4>Last upload</h4>
      <div class="body flush">${rep}</div></div>` : ''}
    ${cf ? `<div class="card" style="margin-bottom:14px"><h4>Source disagreements
      <span class="sub">${(st.conflicts || []).length} — same booking, different values.
      The per-voyage booking sheet wins; verify these by hand.</span></h4>
      <div class="body flush"><div class="tw" style="max-height:300px"><table class="dt">
      <thead><tr><th class="no-sort">B/L No</th><th class="no-sort">Voyage</th><th class="no-sort">Field</th>
      <th class="no-sort">Kept</th><th class="no-sort">From</th><th class="no-sort">Ignored</th>
      <th class="no-sort">From</th></tr></thead><tbody>${cf}</tbody></table></div></div></div>` : ''}
    <div class="card"><h4>Merge history</h4><div class="body flush"><table class="dt">
      <thead><tr><th class="no-sort">When</th><th class="no-sort">Batch</th><th class="no-sort">Added</th>
      <th class="no-sort">Updated</th><th class="no-sort">Same</th><th class="no-sort">Cxl</th>
      <th class="no-sort">Folded</th><th class="no-sort">Total</th><th class="no-sort">Files</th>
      </tr></thead><tbody>${batches}</tbody></table></div></div>
    <div class="card" style="margin-top:14px"><h4>Row-level changes
      <span class="sub">${diffs.length > 400 ? 'first 400' : diffs.length + ' entries'}</span></h4>
      <div class="body flush"><div class="tw"><table class="dt">
      <thead><tr><th class="no-sort">When</th><th class="no-sort">Kind</th><th class="no-sort">B/L No</th>
      <th class="no-sort">Voyage</th><th class="no-sort">TEU</th><th class="no-sort">Field</th>
      <th class="no-sort">From</th><th class="no-sort">To</th></tr></thead>
      <tbody>${diffs.join('')}</tbody></table></div></div></div>`;
  }

  function referenceTab() {
    const n = N();
    const st = App.store;
    const df = (st.df || []).slice().reverse().map((d) => `<tr>
      <td><b>${esc(d.provider)}</b></td><td>${svcTag(d.svc)}</td>
      <td>${esc(d.periodLabel)}</td><td class="dim">${esc(d.period)}</td>
      <td class="n">${fmt(d.ratePerTeu)}</td><td class="n">${fmt(d.volTeu)}</td>
      <td class="n">${fmt(d.wtTon)}</td><td class="n">${fmt(d.fixedAmount)}</td>
      <td class="wrap dim">${esc(Object.keys(d.surcharges || {}).map((k) =>
        `${k} ${d.surcharges[k].rate}/${d.surcharges[k].unit}`).join('; '))}</td>
      <td class="wrap dim">${esc(String(d.maidenVoy).slice(0, 70))}</td></tr>`).join('');

    const svcs = n.SERVICE_CODES.map((c) => {
      const s = n.SERVICES[c];
      return `<tr><td>${svcTag(c)}</td><td>${esc(s.slotProvider)}</td>
        <td class="wrap mono" style="font-size:11.5px">${s.rotation.map(esc).join(' → ')}</td></tr>`;
    }).join('');

    const vsl = Object.keys(st.vesselSvc || {}).sort().map((v) =>
      `<tr><td>${esc(v)}</td><td>${svcTag(st.vesselSvc[v])}</td></tr>`).join('');

    const ports = Object.keys(n.PORTS).map((p) =>
      `<tr><td class="mono">${esc(p)}</td><td>${esc(n.PORTS[p].name)}</td>
       <td class="dim">${esc(n.PORTS[p].country)}</td></tr>`).join('');

    return `<div class="grid g2">
      <div class="card"><h4>Services and rotations</h4><div class="body flush"><table class="dt">
        <thead><tr><th class="no-sort">SVC</th><th class="no-sort">Slot provider</th>
        <th class="no-sort">Port rotation</th></tr></thead><tbody>${svcs}</tbody></table></div></div>
      <div class="card"><h4>Vessel → service <span class="sub">learned from your files</span></h4>
        <div class="body flush"><div class="tw" style="max-height:320px"><table class="dt">
        <thead><tr><th class="no-sort">Vessel</th><th class="no-sort">SVC</th></tr></thead>
        <tbody>${vsl || '<tr><td colspan="2" class="dim">none yet</td></tr>'}</tbody>
        </table></div></div></div></div>
    <div class="card" style="margin-top:14px"><h4>Dead-freight contracts
      <span class="sub">${(st.df || []).length} parsed</span></h4>
      <div class="body flush"><div class="tw" style="max-height:400px"><table class="dt">
      <thead><tr><th class="no-sort">Provider</th><th class="no-sort">SVC</th><th class="no-sort">Period</th>
      <th class="no-sort">Validity</th><th class="no-sort">Rate/TEU</th><th class="no-sort">Vol TEU</th>
      <th class="no-sort">Wt t</th><th class="no-sort">Fixed</th><th class="no-sort">Surcharges</th>
      <th class="no-sort">Maiden voyage</th></tr></thead>
      <tbody>${df || '<tr><td colspan="10" class="dim">Drop the DF calculator workbook to populate this.</td></tr>'}</tbody>
      </table></div></div></div>
    <div class="card" style="margin-top:14px"><h4>Port codes</h4>
      <div class="body flush"><div class="tw" style="max-height:300px"><table class="dt">
      <thead><tr><th class="no-sort">Code</th><th class="no-sort">Port</th><th class="no-sort">Ctry</th>
      </tr></thead><tbody>${ports}</tbody></table></div></div></div>`;
  }

  /* ------------------------------------------------------------------ *
   * filters bar
   * ------------------------------------------------------------------ */
  function filterBar() {
    const a = App.agg;
    const f = App.filters;
    const opt = (list, cur, anyLabel) =>
      `<option value="">${anyLabel}</option>` + list.map((v) =>
        `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
    const svcs = a.byService.map((s) => s.key);
    const parties = a.byParty.map((p) => p.key).slice(0, 60);
    const pols = a.byPol.map((p) => p.key);
    const pods = a.byPod.map((p) => p.key);
    return `<div class="filters">
      <label>Service <select data-f="svc">${opt(svcs, f.svc, 'All')}</select></label>
      <label>Status <select data-f="status">
        <option value="active" ${f.status === 'active' ? 'selected' : ''}>Active</option>
        <option value="cancel" ${f.status === 'cancel' ? 'selected' : ''}>Cancelled</option>
        <option value="" ${f.status === '' ? 'selected' : ''}>Both</option></select></label>
      <label>WK <input type="number" data-f="wkFrom" value="${esc(f.wkFrom)}" min="1" max="53"
        style="width:62px" placeholder="from"> –
        <input type="number" data-f="wkTo" value="${esc(f.wkTo)}" min="1" max="53"
        style="width:62px" placeholder="to"></label>
      <label>POL <select data-f="pol">${opt(pols, f.pol, 'Any')}</select></label>
      <label>F.POD <select data-f="pod">${opt(pods, f.pod, 'Any')}</select></label>
      <label>Party <select data-f="party">${opt(parties, f.party, 'Any')}</select></label>
      <input type="search" data-f="q" value="${esc(f.q)}" placeholder="Search B/L, vessel, item, customer…">
      <button class="btn sm" id="btnClearF">Reset</button>
      <span class="sp"></span>
      <label style="gap:6px"><input type="checkbox" id="expFiltered" ${App.exportFiltered ? 'checked' : ''}>
        Export only the filtered rows</label>
    </div>`;
  }

  /* ------------------------------------------------------------------ *
   * main render
   * ------------------------------------------------------------------ */
  function render() {
    renderStatus();
    const counts = {
      overview: '', voyages: App.agg.byVoyage.filter((v) => v.rows).length,
      rob: App.agg.byVoyage.filter((v) => v.rows).length,
      bookings: App.agg.all.length, changes: App.store.log.length,
      reference: (App.store.df || []).length,
    };
    const p = App.prop;
    counts.propagate = (p.agency ? 1 : 0) + (p.target ? 1 : 0);
    $('#tabs').innerHTML = [
      ['propagate', '파일 갱신'], ['overview', 'Overview'], ['voyages', 'Voyages vs BSA'],
      ['rob', 'ROB load plan'], ['bookings', 'Bookings'], ['changes', 'Changes'],
      ['reference', 'Reference'],
    ].map(([k, l]) => `<button data-tab="${k}" aria-selected="${App.tab === k}">${l}${
      k === 'propagate'
        ? `<span class="count">${counts.propagate}/2</span>`
        : (counts[k] ? `<span class="count">${fmt(counts[k])}</span>` : '')}</button>`).join('');

    const showFilters = ['overview', 'voyages', 'rob', 'bookings'].indexOf(App.tab) >= 0
      && App.agg.all.length > 0;
    $('#filters').innerHTML = showFilters ? filterBar() : '';

    let html = '';
    if (App.tab === 'propagate') html = propagateTab();
    else if (App.tab === 'overview') {
      /* Overview honours the filter by rebuilding on the filtered slice. */
      const saved = App.agg;
      const anyFilter = App.filters.svc || App.filters.q || App.filters.wkFrom || App.filters.wkTo ||
        App.filters.party || App.filters.pol || App.filters.pod || App.filters.status !== 'active';
      if (anyFilter && saved.all.length) App.agg = global.FAgg.build(App.store, filterFn());
      html = overviewTab();
      App.agg = saved;
    } else if (App.tab === 'voyages') html = voyagesTab();
    else if (App.tab === 'rob') html = robTab();
    else if (App.tab === 'bookings') html = bookingsTab();
    else if (App.tab === 'changes') html = changesTab();
    else html = referenceTab();
    $('#view').innerHTML = html;

    const dz = $('#drop');
    dz.classList.toggle('compact', App.agg.all.length > 0);
  }

  /* ------------------------------------------------------------------ *
   * events
   * ------------------------------------------------------------------ */
  function wire() {
    /* Attach only if the element exists. A single missing id used to throw here
       and abort the rest of wire(), which silently killed every click handler
       registered after it. */
    const on = (sel, ev, fn) => {
      const el = typeof sel === 'string' ? $(sel) : sel;
      if (el) el.addEventListener(ev, fn);
      else console.warn('[ui] 요소를 찾을 수 없어 이벤트를 건너뜀:', sel);
      return el;
    };
    const dz = $('#drop');
    if (!dz) { console.error('[ui] #drop 없음'); return; }
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); dz.classList.add('hot');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); if (ev === 'dragleave' && dz.contains(e.relatedTarget)) return;
      dz.classList.remove('hot');
    }));
    dz.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
    /* Guard the whole window so a stray drop doesn't navigate away. */
    ['dragover', 'drop'].forEach((ev) =>
      window.addEventListener(ev, (e) => { if (e.target.id !== 'file') e.preventDefault(); }));

    on('#file', 'change', (e) => {
      if (e.target.files.length) handleFiles(e.target.files);
      e.target.value = '';
    });
    on('#btnPick', 'click', () => $('#file').click());
    on('#btnExport', 'click', doExport);

    on('#btnSaveProj', 'click', async () => {
      const blob = new Blob([global.FMerge.toJSON(App.store)], { type: 'application/json' });
      const d = new Date(); const p = (x) => String(x).padStart(2, '0');
      const ok = await download(blob,
        `farmkogls_register_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`);
      if (ok) toast('프로젝트를 저장했습니다', '다른 PC로 옮기거나 백업할 때 이 파일을 쓰세요.', 'good');
    });

    on('#btnClear', 'click', () => {
      if (!confirm('Delete the whole register (' + App.store.records.length +
        ' bookings) and start over?\n\nThis cannot be undone. Export or save a project file first if you need it.')) return;
      App.store = global.FMerge.createStore();
      localStorage.removeItem(LS_KEY);
      App.lastReport = null;
      rebuild();
      toast('등록부를 비웠습니다', '', 'good');
    });

    on('#btnTheme', 'click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
      if (next) document.documentElement.setAttribute('data-theme', next);
      else document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem('farmkogls.theme', next); } catch (e) { /* ignore */ }
      $('#btnTheme').textContent = next === 'dark' ? '☾ Dark' : next === 'light' ? '☀ Light' : '◐ Auto';
    });

    document.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-tab]');
      if (tb) { App.tab = tb.dataset.tab; render(); return; }
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const [tbl, col] = th.dataset.sort.split(':');
        const s = App.sort[tbl];
        if (s.col === col) s.dir = -s.dir; else { s.col = col; s.dir = 1; }
        render(); return;
      }
      if (e.target.id === 'btnClearF') {
        App.filters = { svc: '', wkFrom: '', wkTo: '', voy: '', status: 'active', q: '', party: '', pol: '', pod: '' };
        render(); return;
      }
      if (e.target.id === 'btnProp') { runPropagate(); return; }
      if (e.target.id === 'btnPropDl') {
        if (App.prop.blob) {
          download(App.prop.blob, global.FProp.outName(App.prop.target.name))
            .then((ok) => { if (ok) toast('갱신된 파일을 저장했습니다', '원본은 그대로 남아 있습니다.', 'good'); });
        }
        return;
      }
    });

    /* Filter inputs — debounce the free-text box so typing stays smooth. */
    let deb = null;
    document.addEventListener('input', (e) => {
      if (e.target.id === 'expFiltered') { App.exportFiltered = e.target.checked; return; }
      const f = e.target.dataset && e.target.dataset.f;
      if (!f) return;
      App.filters[f] = e.target.value;
      if (e.target.type === 'search' || e.target.type === 'number') {
        clearTimeout(deb);
        const pos = e.target.selectionStart;
        deb = setTimeout(() => {
          render();
          const again = $(`[data-f="${f}"]`);
          if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (x) { /* number input */ } }
        }, 260);
      } else render();
    });
    document.addEventListener('change', (e) => {
      const f = e.target.dataset && e.target.dataset.f;
      if (f && e.target.tagName === 'SELECT') { App.filters[f] = e.target.value; render(); }
    });
  }

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */
  function boot() {
    try {
      const th = localStorage.getItem('farmkogls.theme');
      if (th) document.documentElement.setAttribute('data-theme', th);
      $('#btnTheme').textContent = th === 'dark' ? '☾ Dark' : th === 'light' ? '☀ Light' : '◐ Auto';
    } catch (e) { /* ignore */ }

    if (!global.FZip.hasNativeInflate) {
      $('#view').innerHTML = `<div class="card"><div class="empty">
        <h3>This browser can't open .xlsx files</h3>
        <p>The console needs <code>DecompressionStream</code>, which this browser doesn't provide.
        Please open this file in Microsoft Edge, Google Chrome, or Firefox 113 or newer.</p></div></div>`;
      return;
    }

    /* Probe local storage — it can be blocked entirely (private mode, policy). */
    App.canPersist = false;
    try {
      localStorage.setItem('farmkogls.probe', '1');
      localStorage.removeItem('farmkogls.probe');
      App.canPersist = true;
    } catch (e) { App.canPersist = false; }

    App.store = load() || global.FMerge.createStore();
    N().setRefYear(new Date().getUTCFullYear());
    wire();
    rebuild();
    if (App.store.records.length) {
      toast('등록부를 복원했습니다', `지난 세션의 부킹 ${App.store.records.length}건`, 'good');
    }
    if (!App.canPersist) {
      toast('등록부가 유지되지 않습니다',
        '이 브라우저가 저장 공간을 막고 있어 새로고침하면 사라집니다. ' +
        '작업을 마칠 때마다 “프로젝트 저장”을 눌러 주세요.', 'bad');
    }
  }

  /* Exposed so the page can also be driven programmatically (used by tests). */
  App.ingestFiles = handleFiles;
  App.doExport = doExport;
  App.rebuild = rebuild;
  App.filterFn = filterFn;

  App.boot = boot;
  global.FApp = App;

  /* Auto-start only when the shell markup is already on the page. The hosted
     build injects that markup after a PIN gate, and calls FApp.boot() itself. */
  const autoStart = () => { if (document.getElementById('drop')) boot(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoStart);
  else autoStart();
})(typeof window !== 'undefined' ? window : globalThis);
