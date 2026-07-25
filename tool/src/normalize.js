/* ============================================================================
   normalize.js — Farmkogls domain vocabulary and canonical value handling.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Services — the four trade loops Farmkogls buys slots on.
   * ------------------------------------------------------------------ */
  const SERVICES = {
    CSC: {
      code: 'CSC', slotProvider: 'GFS', colour: '#5b8ff9',
      rotation: ['KRPUS', 'KRKAN', 'CNSHA', 'MYPKW', 'INNSA', 'INMUN', 'PKKHI', 'MYPKW', 'KRPUS'],
    },
    NWX: {
      code: 'NWX', slotProvider: 'XPRESS', colour: '#61ddaa',
      rotation: ['CNTAO', 'KRPUS', 'MYPKN', 'INNSA', 'INPAV', 'INMUN', 'PKKHI', 'CNTAO', 'KRPUS'],
    },
    CCS: {
      code: 'CCS', slotProvider: 'BTL', colour: '#f6bd16',
      rotation: ['CNTAO', 'KRPUS', 'CNSHA', 'MYPKW', 'MYPKN', 'INMAA', 'INKAT', 'MYPKN', 'CNTAO', 'KRPUS'],
    },
    SKS: {
      code: 'SKS', slotProvider: 'BTL', colour: '#ff9d4d',
      rotation: ['MYPKW', 'MYPKN', 'INCCU', 'MYPKW', 'MYPKN'],
    },
  };
  const SERVICE_CODES = Object.keys(SERVICES);

  /* ------------------------------------------------------------------ *
   * Ports — canonical UN/LOCODE plus every alias and typo seen in the files.
   * ------------------------------------------------------------------ */
  const PORTS = {
    KRPUS: { name: 'Busan',        country: 'KR' },
    KRKAN: { name: 'Gwangyang',    country: 'KR' },
    KRKWA: { name: 'Gwangyang(KWA)', country: 'KR' },
    KRINC: { name: 'Incheon',      country: 'KR' },
    CNTAO: { name: 'Qingdao',      country: 'CN' },
    CNSHA: { name: 'Shanghai',     country: 'CN' },
    CNNGB: { name: 'Ningbo',       country: 'CN' },
    CNSHK: { name: 'Shekou',       country: 'CN' },
    TWKHH: { name: 'Kaohsiung',    country: 'TW' },
    TWTXG: { name: 'Taichung',     country: 'TW' },
    MYPKW: { name: 'Port Klang (West)',  country: 'MY' },
    MYPKN: { name: 'Port Klang (North)', country: 'MY' },
    MYPGU: { name: 'Pasir Gudang', country: 'MY' },
    MYBTU: { name: 'Bintulu',      country: 'MY' },
    SGSIN: { name: 'Singapore',    country: 'SG' },
    INNSA: { name: 'Nhava Sheva',  country: 'IN' },
    INMUN: { name: 'Mundra',       country: 'IN' },
    INMAA: { name: 'Chennai',      country: 'IN' },
    INKAT: { name: 'Kattupalli',   country: 'IN' },
    INCCU: { name: 'Kolkata',      country: 'IN' },
    INPAV: { name: 'Pipavav',      country: 'IN' },
    PKKHI: { name: 'Karachi',      country: 'PK' },
  };

  const PORT_ALIAS = {
    // Port Klang, in all its spellings
    'MYPKG(W)': 'MYPKW', 'MYPKG(WEST)': 'MYPKW', 'MYPKGW': 'MYPKW', 'WPKL': 'MYPKW',
    'PKGW': 'MYPKW', 'PKLW': 'MYPKW', 'WSP': 'MYPKW', 'MYWSP': 'MYPKW',
    'MYPKG(N)': 'MYPKN', 'MYPKG(NORTH)': 'MYPKN', 'MYPKGN': 'MYPKN', 'NPKL': 'MYPKN',
    'PKGN': 'MYPKN', 'PKLN': 'MYPKN', 'NP': 'MYPKN', 'MYNP': 'MYPKN',
    'MPYKG(N)': 'MYPKN', 'MYPKG(N))': 'MYPKN',
    'MYPKG': 'MYPKW', 'PKG': 'MYPKW', 'PKL': 'MYPKW', 'PORT KELANG': 'MYPKW', 'PORT KLANG': 'MYPKW',
    // Korea
    'PUS': 'KRPUS', 'BUS': 'KRPUS', 'BUSAN': 'KRPUS', 'KPRUS': 'KRPUS', 'KRPUS ': 'KRPUS',
    'KAN': 'KRKAN', 'KWA': 'KRKWA', 'INC': 'KRINC',
    // China / Taiwan
    'TAO': 'CNTAO', 'QINGDAO': 'CNTAO', 'SHA': 'CNSHA', 'SHANGHAI': 'CNSHA',
    'CHSHA': 'CNSHA', 'CNSHAI': 'CNSHA', 'CHTAO': 'CNTAO',
    'NGB': 'CNNGB', 'SHK': 'CNSHK', 'KHH': 'TWKHH', 'TXG': 'TWTXG',
    // SE Asia
    'SIN': 'SGSIN', 'SGP': 'SGSIN', 'PGU': 'MYPGU', 'SKU': 'MYBTU', 'BTU': 'MYBTU',
    // India / Pakistan
    'NSA': 'INNSA', 'INSSA': 'INNSA', 'IINNSA': 'INNSA', 'NHAVA SHEVA': 'INNSA',
    'MUN': 'INMUN', 'MUNDRA': 'INMUN',
    'MAA': 'INMAA', 'CHENNAI': 'INMAA', 'MADRAS': 'INMAA',
    'KAT': 'INKAT', 'INKTP': 'INKAT', 'KTP': 'INKAT', 'KATTUPALLI': 'INKAT',
    'CCU': 'INCCU', 'INNCU': 'INCCU', 'KOLKATA': 'INCCU', 'CALCUTTA': 'INCCU',
    'PAV': 'INPAV', 'PIPAVAV': 'INPAV',
    'KHI': 'PKKHI', 'INPKHI': 'PKKHI', 'KARACHI': 'PKKHI',
  };

  function canonPort(raw) {
    if (raw == null) return '';
    let s = String(raw).trim().toUpperCase().replace(/\s+/g, ' ');
    if (!s) return '';
    // Drop trailing noise like "(DIR)" or "(T/S)" but keep the (N)/(W) qualifier.
    s = s.replace(/\s*\((?:DIR|DIRECT|T\/S|TS)\)\s*$/, '').trim();
    if (PORTS[s]) return s;
    if (PORT_ALIAS[s]) return PORT_ALIAS[s];
    const nospace = s.replace(/\s|-/g, '');
    if (PORTS[nospace]) return nospace;
    if (PORT_ALIAS[nospace]) return PORT_ALIAS[nospace];
    return s;                       // unknown — keep verbatim so nothing is silently lost
  }

  function portLabel(code) {
    const p = PORTS[code];
    return p ? `${code} ${p.name}` : (code || '');
  }

  /* ------------------------------------------------------------------ *
   * Vessels — seed map; extended at runtime from whatever the data says.
   * ------------------------------------------------------------------ */
  const VESSEL_SVC_SEED = {
    // CSC (GFS)
    'ZHONG GU ZI AN': 'CSC', 'ZHONG GU LAN ZHOU': 'CSC', 'ZHONG GU HANG ZHOU': 'CSC',
    'ZHONG GU XI AN': 'CSC', 'MELBOURNE BRIDGE': 'CSC', 'GFS GALAXY': 'CSC',
    'GFS GISELLE': 'CSC', 'BEIJING BRIDGE': 'CSC', 'GRACE BRIDGE': 'CSC', 'VARADA': 'CSC',
    // NWX (X-Press)
    'X-PRESS CASSIOPEIA': 'NWX', 'X-PRESS PHOENIX': 'NWX', 'X-PRESS CARINA': 'NWX',
    // CCS (BTL)
    'INTERASIA HORIZON': 'CCS', 'INTERASIA INSPIRATION': 'CCS',
    'WAN HAI 501': 'CCS', 'WAN HAI 510': 'CCS', 'WAN HAI 521': 'CCS',
    'WAN HAI 522': 'CCS', 'WAN HAI 372': 'CCS',
    'TIGER CHENNAI': 'CCS', 'KMTC JEBEL ALI': 'CCS',
    // SKS (BTL)
    'MTT SEMPORNA': 'SKS', 'MTT SAMALAJU': 'SKS', 'MTT LIMBANG': 'SKS',
    'MTT LABUAN': 'SKS', 'MTT LAMBUAN': 'SKS', 'GLORY RIGHT': 'SKS', 'GLORY LIGHT': 'SKS',
    'YANG GUANG': 'SKS', 'XIN HONG SHENG 37': 'SKS', 'XIN HONG SHENG': 'SKS',
    'IMKE SCHEPERS': 'SKS', 'IMKE SCHEPER': 'SKS', 'HAI FENG': 'SKS', 'HONG JIA 17': 'SKS',
  };

  /* Common misspellings observed in the source files. */
  const VESSEL_FIX = {
    'MLEBORUNE BRIDGE': 'MELBOURNE BRIDGE',
    'MELBORUNE BRIDGE': 'MELBOURNE BRIDGE',
    'MELBOURNE BRDIGE': 'MELBOURNE BRIDGE',
    'MELBOUNE BRIDGE': 'MELBOURNE BRIDGE',
    'INTERASIAI INSPIRATION': 'INTERASIA INSPIRATION',
    'INTERASIA INSPIRATON': 'INTERASIA INSPIRATION',
    'ZHONG GH HANG ZHOU': 'ZHONG GU HANG ZHOU',
    'MTT LAMBUAN': 'MTT LABUAN',
    'GLORY LIGHT': 'GLORY RIGHT',
    'IMKE SCHEPER': 'IMKE SCHEPERS',
    'YANG GU ANG': 'YANG GUANG',
    'XIN HONG SHENG37': 'XIN HONG SHENG 37',
    'HONGJIA 17': 'HONG JIA 17',
    'MTT SAMALAJU ': 'MTT SAMALAJU',
  };

  function canonVessel(raw) {
    if (raw == null) return '';
    let s = String(raw).trim().toUpperCase().replace(/\s+/g, ' ');
    s = s.replace(/[.,]+$/, '').trim();
    return VESSEL_FIX[s] || s;
  }

  /* Does this token look like a voyage number rather than part of a ship's name? */
  const VOY_TOKEN = /^(?=.*\d)[A-Z0-9/\-]{3,12}$/;
  function isVoyToken(tok) {
    if (!tok || !VOY_TOKEN.test(tok)) return false;
    return /[EWNS]$/.test(tok) || /^[EW]\d/.test(tok);
  }

  /**
   * Split a combined "VESSEL VOY" string.
   * "TIGER CHENNAI 2602W" -> { vessel:'TIGER CHENNAI', voy:'2602W' }
   * "WAN HAI 522"         -> { vessel:'WAN HAI 522',   voy:'' }
   */
  function splitVesselVoy(raw) {
    const s = canonVessel(raw);
    if (!s) return { vessel: '', voy: '' };
    const toks = s.split(' ');
    if (toks.length >= 2 && isVoyToken(toks[toks.length - 1])) {
      const voy = toks.pop();
      return { vessel: canonVessel(toks.join(' ')), voy };
    }
    return { vessel: s, voy: '' };
  }

  function canonVoy(raw) {
    if (raw == null) return '';
    return String(raw).trim().toUpperCase().replace(/\s+/g, '');
  }

  /** Stable identifier for a vessel+voyage pair. */
  function voyageKey(vessel, voy) {
    return (canonVessel(vessel) + '|' + canonVoy(voy)).replace(/\|$/, '|');
  }

  function canonSvc(raw) {
    if (raw == null) return '';
    const s = String(raw).trim().toUpperCase().replace(/[^A-Z]/g, '');
    return SERVICES[s] ? s : (s || '');
  }

  /* ------------------------------------------------------------------ *
   * Numbers, dates, weeks
   * ------------------------------------------------------------------ */
  function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v instanceof Date) return 0;
    const s = String(v).replace(/,/g, '').replace(/\s/g, '');
    if (!s || s === '-') return 0;
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }

  function str(v) {
    if (v == null) return '';
    if (v instanceof Date) return isoDate(v);
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    return String(v).replace(/ /g, ' ').trim();
  }

  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) return global.FXlsxRead.serialToDate(v);
      return null;
    }
    const s = String(v).trim();
    if (!s || /^(SKIP|T\/S|TS|TBN|T\.B\.N|PHASE OUT|N\/A|-)$/i.test(s)) return null;
    // yyyy-mm-dd | yyyy/mm/dd
    let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    // mm/dd (assume the year in scope) — used in BK sheet headers
    m = s.match(/^(\d{1,2})[-./](\d{1,2})$/);
    if (m) {
      const y = REF_YEAR;
      return new Date(Date.UTC(y, +m[1] - 1, +m[2]));
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  /* Year used to complete bare mm/dd values. Overridable by the app. */
  let REF_YEAR = new Date().getUTCFullYear();
  function setRefYear(y) { if (y > 1990 && y < 2200) REF_YEAR = y; }
  function getRefYear() { return REF_YEAR; }

  function isoDate(d) {
    if (!(d instanceof Date) || isNaN(d)) return '';
    return d.toISOString().slice(0, 10);
  }

  /** Excel WEEKNUM(date, 1): week 1 contains Jan 1, weeks start Sunday. */
  function excelWeekNum(d) {
    const dt = toDate(d);
    if (!dt) return 0;
    const y = dt.getUTCFullYear();
    const jan1 = Date.UTC(y, 0, 1);
    const dow = new Date(jan1).getUTCDay();               // 0 = Sunday
    const dayOfYear = Math.floor((Date.UTC(y, dt.getUTCMonth(), dt.getUTCDate()) - jan1) / 86400000);
    return Math.floor((dayOfYear + dow) / 7) + 1;
  }

  /* ------------------------------------------------------------------ *
   * Containers and TEU
   * ------------------------------------------------------------------ */
  const TARE = { ft20: 2.3, ft40: 3.7 };

  /** Column order matches the source workbooks. `void` counts as 1 TEU. */
  const BOX_FIELDS = [
    { key: 'c20dv', label: "20'DV", teu: 1, size: 20, empty: false },
    { key: 'c20mt', label: "20'MT", teu: 1, size: 20, empty: true },
    { key: 'c40hc', label: "40'HC", teu: 2, size: 40, empty: false },
    { key: 'c40mt', label: "40'MT", teu: 2, size: 40, empty: true },
    { key: 'c20fr', label: "20'FR", teu: 1, size: 20, empty: false },
    { key: 'c40fr', label: "40'FR", teu: 2, size: 40, empty: false },
    { key: 'cvoid', label: 'Void',  teu: 1, size: 0,  empty: false },
  ];

  /** TEU = 20' boxes + Void + 2 × 40' boxes — matches the sheet formulas exactly. */
  function computeTeu(r) {
    let t = 0;
    for (const f of BOX_FIELDS) t += num(r[f.key]) * f.teu;
    return t;
  }

  function boxCount(r) {
    let n = 0;
    for (const f of BOX_FIELDS) if (f.key !== 'cvoid') n += num(r[f.key]);
    return n;
  }

  /** Estimated tare, used when VGM weight is absent (mirrors their fallback formulas). */
  function tareWeight(r) {
    return (num(r.c20dv) + num(r.c20mt) + num(r.c20fr)) * TARE.ft20 +
           (num(r.c40hc) + num(r.c40mt) + num(r.c40fr)) * TARE.ft40;
  }

  function isEmptyRepo(r) {
    const hay = `${r.blNo || ''} ${r.remark || ''} ${r.item || ''} ${r.customer || ''}`.toUpperCase();
    if (/EMPTY\s*REPO|^MT$|\bMT\b/.test(hay)) return true;
    return num(r.c20mt) + num(r.c40mt) > 0 && num(r.c20dv) + num(r.c40hc) === 0;
  }

  /* ------------------------------------------------------------------ *
   * Misc helpers
   * ------------------------------------------------------------------ */
  /* Booking parties. Overseas agencies and Korean forwarders both land here;
     only obvious spelling variants of the same house are folded together. */
  const PARTY_ALIAS = {
    '팜코': 'FARMKO', 'FARMKOGLS': 'FARMKO', 'FARMKO GLS': 'FARMKO', '팜코지엘에스': 'FARMKO',
    'GREATLUCK': 'GREAT LUCK', 'QUICK&SURE': 'QUICK & SURE',
  };

  /** Returns {party, partySvc} — a trailing "(SKS)" marks the service, not the house. */
  function canonParty(raw) {
    let s = String(raw == null ? '' : raw).replace(/ /g, ' ').trim().replace(/\s+/g, ' ');
    if (!s) return { party: '', partySvc: '' };
    let partySvc = '';
    const m = s.match(/^(.*?)\s*\((CSC|NWX|CCS|SKS)\)\s*$/i);
    if (m) { s = m[1].trim(); partySvc = m[2].toUpperCase(); }
    const up = s.toUpperCase();
    if (PARTY_ALIAS[up]) return { party: PARTY_ALIAS[up], partySvc };
    if (PARTY_ALIAS[s]) return { party: PARTY_ALIAS[s], partySvc };
    /* Latin names go uppercase; Korean names keep their original casing. */
    return { party: /^[\x00-\x7F]+$/.test(s) ? up : s, partySvc };
  }

  const DIR_TS = { DIR: 'DIR', DIRECT: 'DIR', TS: 'TS', 'T/S': 'TS', TRANSSHIP: 'TS' };
  function canonDirTs(raw) {
    const s = String(raw == null ? '' : raw).trim().toUpperCase();
    return DIR_TS[s] || (s ? s : '');
  }

  /**
   * Rows whose "B/L" is a note rather than a document number. These cannot be
   * matched between files by reference, so they get a shape-based identity.
   */
  const BL_PLACEHOLDER = new Set([
    '', '-', '--', 'MT', 'FULL', 'TBN', 'T.B.N', 'T.B.N.', 'TBA', 'N/A', 'NA',
    'PENDING', 'NIL', 'X', '0',
  ]);
  function isPlaceholderBl(bl) {
    const s = String(bl == null ? '' : bl).trim().toUpperCase();
    if (BL_PLACEHOLDER.has(s)) return true;
    return /^EMPTY\s*REPO/.test(s) || /^MT\b/.test(s) || /^FULL\b/.test(s) ||
           /^(BK|BOOKING)\s*(PENDING|미정)/.test(s);
  }

  /**
   * Effective service for a booking: the voyage schedule's answer when it
   * contradicts a hand-typed sheet header, otherwise what the source stated.
   * Always use this for grouping and reporting; `svc1` is the raw source value.
   */
  function svcOf(r) {
    return (r && (r.svcEff || r.svc1)) || '';
  }

  function slug(s) {
    return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, ' ');
  }

  global.FNorm = {
    SERVICES, SERVICE_CODES, PORTS, PORT_ALIAS, BOX_FIELDS, TARE,
    VESSEL_SVC_SEED,
    canonPort, portLabel, canonVessel, canonVoy, canonSvc, canonDirTs, canonParty,
    splitVesselVoy, voyageKey, isVoyToken,
    num, str, toDate, isoDate, excelWeekNum, setRefYear, getRefYear,
    computeTeu, boxCount, tareWeight, isEmptyRepo, isPlaceholderBl, slug, svcOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
