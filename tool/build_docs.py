"""Render the Korean docs into one self-contained page: site/docs.html

No markdown library - the tool has no dependencies and neither does its build.
The converter below covers exactly what these documents use: ATX headings,
fenced code, GFM tables, blockquotes, lists, rules, and inline bold/code/link.

This page is reachable WITHOUT the PIN, so it must never contain the PIN.
build() asserts that before writing.
"""
import io
import json
import os
import re
import sys

from pinutil import (DOCS_SALT, ITERATIONS, assert_absent, encrypt,
                     load_admin_pin, load_pin)

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "site")

SITE_URL = "https://inu-sudo.github.io/farmkogls-console/"
REPO_URL = "https://github.com/inu-sudo/farmkogls-console"

# (source path, sidebar label, short blurb)
DOCS = [
    ("docs/00_읽는_순서.md", "문서 안내", "어느 문서를 언제 보나"),
    ("docs/01_이해한_내용.md", "1. 이해한 내용", "업무 모델과 계산 규칙"),
    ("docs/02_사용_매뉴얼.md", "2. 사용 매뉴얼", "부킹 담당자용"),
    ("docs/03_설계_지침서.md", "3. 설계 지침서", "바이브 코딩 + 설명 대본"),
    ("docs/04_기술_참고.md", "4. 기술 참고", "AI에게 붙여줄 문서"),
    ("../farmkogls-site/배포하기.md", "배포하기", "홈페이지를 올리고 고치는 법"),
]

# markdown filename -> in-page anchor
LINKS = {
    "00_읽는_순서.md": "#d0",
    "01_이해한_내용.md": "#d1",
    "02_사용_매뉴얼.md": "#d2",
    "03_설계_지침서.md": "#d3",
    "04_기술_참고.md": "#d4",
    "배포하기.md": "#d5",
    "../README.md": REPO_URL,
}

PH_OPEN, PH_CLOSE = "", ""


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def is_cjk(ch):
    o = ord(ch)
    return (0xAC00 <= o <= 0xD7A3 or 0x1100 <= o <= 0x11FF
            or 0x3130 <= o <= 0x318F or 0x4E00 <= o <= 0x9FFF
            or 0x3040 <= o <= 0x30FF)


def join_lines(lines):
    """Wrapped Korean prose must not gain a space at every fold."""
    out = lines[0].strip()
    for nxt in lines[1:]:
        nxt = nxt.strip()
        if not nxt:
            continue
        if out and is_cjk(out[-1]) and is_cjk(nxt[0]):
            out += nxt
        else:
            out += " " + nxt
    return out


def inline(text):
    codes = []

    def take_code(m):
        codes.append(m.group(1))
        return "%s%d%s" % (PH_OPEN, len(codes) - 1, PH_CLOSE)

    text = re.sub(r"`([^`]+)`", take_code, text)
    text = esc(text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)

    def link(m):
        label, href = m.group(1), m.group(2)
        href = LINKS.get(href, href)
        ext = ' target="_blank" rel="noopener"' if href.startswith("http") else ""
        return '<a href="%s"%s>%s</a>' % (esc(href), ext, label)

    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, text)
    for i, c in enumerate(codes):
        text = text.replace("%s%d%s" % (PH_OPEN, i, PH_CLOSE), "<code>%s</code>" % esc(c))
    return text


def is_table_sep(s):
    t = s.strip()
    return bool(t) and "|" in t and "-" in t and set(t) <= set("|-: ")


def cells(row):
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    return [c.strip() for c in row.split("|")]


BLOCK_START = re.compile(r"^(#{1,6}\s|```|>|\s*[-*]\s+|\s*\d+\.\s+|---+\s*$)")


def convert(text, doc_id, headings):
    lines = text.replace("\r\n", "\n").split("\n")
    out, i, n, hcount = [], 0, len(lines), [0]

    def heading(level, body):
        hcount[0] += 1
        hid = "%s-h%d" % (doc_id, hcount[0])
        if level == 2:
            headings.append((hid, re.sub(r"[*`]", "", body).strip()))
        out.append('<h%d id="%s">%s</h%d>' % (level, hid, inline(body), level))

    while i < n:
        line = lines[i]

        if line.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append("<pre><code>%s</code></pre>" % esc("\n".join(buf)))
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            heading(len(m.group(1)), m.group(2))
            i += 1
            continue

        if re.match(r"^---+\s*$", line):
            out.append("<hr>")
            i += 1
            continue

        if "|" in line and i + 1 < n and is_table_sep(lines[i + 1]):
            head = cells(line)
            i += 2
            body = []
            while i < n and "|" in lines[i] and lines[i].strip():
                body.append(cells(lines[i]))
                i += 1
            t = ["<div class=\"tw\"><table><thead><tr>"]
            t += ["<th>%s</th>" % inline(c) for c in head]
            t.append("</tr></thead><tbody>")
            for r in body:
                t.append("<tr>" + "".join("<td>%s</td>" % inline(c) for c in r) + "</tr>")
            t.append("</tbody></table></div>")
            out.append("".join(t))
            continue

        if line.startswith(">"):
            buf = []
            while i < n and lines[i].startswith(">"):
                buf.append(re.sub(r"^>\s?", "", lines[i]))
                i += 1
            out.append("<blockquote>%s</blockquote>" % convert("\n".join(buf), doc_id, []))
            continue

        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if m:
            base = len(m.group(1))
            ordered = m.group(2) not in ("-", "*")
            items = []  # [indent, [text lines...]]
            while i < n:
                mm = re.match(r"^(\s*)(?:[-*]|\d+\.)\s+(.*)$", lines[i])
                if not mm:
                    # a wrapped item continues on an indented line
                    if items and lines[i].strip() and lines[i].startswith((" ", "\t")):
                        items[-1][1].append(lines[i])
                        i += 1
                        continue
                    break
                if len(mm.group(1)) < base:
                    break
                items.append([len(mm.group(1)), [mm.group(2)]])
                i += 1

            tag = "ol" if ordered else "ul"
            buf, nested = ["<%s>" % tag], False
            for indent, body in items:
                text = "<li>%s</li>" % inline(join_lines(body))
                if indent > base:            # one level of nesting is all these docs use
                    if not nested:
                        buf.append("<ul>")
                        nested = True
                    buf.append(text)
                else:
                    if nested:
                        buf.append("</ul>")
                        nested = False
                    buf.append(text)
            if nested:
                buf.append("</ul>")
            buf.append("</%s>" % tag)
            out.append("".join(buf))
            continue

        if not line.strip():
            i += 1
            continue

        para = [line]
        i += 1
        while i < n and lines[i].strip() and not BLOCK_START.match(lines[i]) \
                and not ("|" in lines[i] and i + 1 < n and is_table_sep(lines[i + 1])):
            para.append(lines[i])
            i += 1
        out.append("<p>%s</p>" % inline(join_lines(para)))

    return "\n".join(out)


CSS = """
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#f7f6f3; --panel:#fffefb; --ink:#1c1a17; --dim:#6a655c; --line:#e2ddd3;
  --accent:#0f5c4a; --accent-soft:#e6f0ec; --code-bg:#efece5; --mark:#b45309;
  --sans:"Malgun Gothic","맑은 고딕",-apple-system,"Segoe UI",system-ui,sans-serif;
  --mono:"Cascadia Mono",Consolas,"D2Coding",ui-monospace,monospace;
}
@media (prefers-color-scheme:dark){
  :root{--bg:#14161a;--panel:#1b1e24;--ink:#e8e6e1;--dim:#9a958c;--line:#2c3037;
        --accent:#5fd0ac;--accent-soft:#17302a;--code-bg:#22262e;--mark:#f0b429}
}
:root[data-theme=dark]{--bg:#14161a;--panel:#1b1e24;--ink:#e8e6e1;--dim:#9a958c;
  --line:#2c3037;--accent:#5fd0ac;--accent-soft:#17302a;--code-bg:#22262e;--mark:#f0b429}
:root[data-theme=light]{--bg:#f7f6f3;--panel:#fffefb;--ink:#1c1a17;--dim:#6a655c;
  --line:#e2ddd3;--accent:#0f5c4a;--accent-soft:#e6f0ec;--code-bg:#efece5;--mark:#b45309}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.75;-webkit-text-size-adjust:100%}
body.locked{overflow:hidden}
.gate-back{margin-top:9px!important}
.gate-back a{color:var(--g-ink-2);text-decoration:none;font-size:11.5px}
.gate-back a:hover{text-decoration:underline}
a{color:var(--accent)}
.wrap{display:grid;grid-template-columns:270px minmax(0,1fr);gap:0;
  max-width:1240px;margin:0 auto;min-height:100vh}
#side{border-right:1px solid var(--line);background:var(--panel);
  padding:22px 18px 40px;position:sticky;top:0;height:100vh;overflow-y:auto}
.brand{display:block;font-weight:700;font-size:15px;letter-spacing:.02em;
  text-decoration:none;color:var(--ink);margin-bottom:2px}
.brand small{display:block;font-weight:400;color:var(--dim);font-size:11.5px;
  letter-spacing:.14em;text-transform:uppercase;margin-bottom:5px}
.addr{margin:14px 0 18px;padding:11px 12px;border:1px solid var(--line);
  border-radius:9px;background:var(--bg)}
.addr b{display:block;font-size:10.5px;letter-spacing:.12em;color:var(--dim);
  text-transform:uppercase;font-weight:600;margin-bottom:5px}
.addr a{font-family:var(--mono);font-size:11.5px;word-break:break-all;line-height:1.5}
.addr p{margin:7px 0 0;font-size:11.5px;color:var(--dim);line-height:1.5}
#side nav{display:flex;flex-direction:column;gap:2px}
#side .doc{display:block;padding:8px 11px;border-radius:8px;text-decoration:none;
  color:var(--ink);font-weight:600;font-size:13.5px;border:1px solid transparent}
#side .doc span{display:block;font-weight:400;font-size:11.5px;color:var(--dim)}
#side .doc:hover{background:var(--accent-soft)}
#side .doc[aria-current=true]{background:var(--accent-soft);border-color:var(--accent);
  color:var(--accent)}
#side .toc{display:none;margin:2px 0 8px;padding-left:12px;
  border-left:2px solid var(--line);flex-direction:column;gap:1px}
#side .toc.on{display:flex}
#side .toc a{padding:4px 9px;border-radius:6px;text-decoration:none;color:var(--dim);
  font-size:12.5px;line-height:1.45}
#side .toc a:hover{background:var(--accent-soft);color:var(--accent)}
#main{padding:34px 44px 100px;min-width:0}
.doc-body{display:none;max-width:78ch}
.doc-body.on{display:block}
.doc-body h1{font-size:26px;line-height:1.35;margin:0 0 22px;letter-spacing:-.01em;
  text-wrap:balance}
.doc-body h2{font-size:19px;margin:44px 0 14px;padding-top:18px;
  border-top:1px solid var(--line);text-wrap:balance}
.doc-body h3{font-size:16px;margin:30px 0 10px;color:var(--accent);text-wrap:balance}
.doc-body h4{font-size:14.5px;margin:22px 0 8px}
.doc-body p{margin:0 0 14px}
.doc-body ul,.doc-body ol{margin:0 0 14px;padding-left:22px}
.doc-body li{margin:4px 0}
.doc-body hr{border:0;border-top:1px solid var(--line);margin:34px 0}
.doc-body code{font-family:var(--mono);font-size:.88em;background:var(--code-bg);
  padding:1.5px 5px;border-radius:4px;word-break:break-word}
.doc-body pre{background:var(--code-bg);border:1px solid var(--line);border-radius:9px;
  padding:14px 16px;overflow-x:auto;margin:0 0 16px;line-height:1.55}
.doc-body pre code{background:none;padding:0;font-size:12.5px;white-space:pre}
.doc-body blockquote{margin:0 0 16px;padding:12px 16px;border-left:3px solid var(--accent);
  background:var(--accent-soft);border-radius:0 8px 8px 0}
.doc-body blockquote> :last-child{margin-bottom:0}
.tw{overflow-x:auto;margin:0 0 18px;border:1px solid var(--line);border-radius:9px}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line);
  vertical-align:top;line-height:1.6}
th{background:var(--code-bg);font-weight:600;white-space:nowrap}
tr:last-child td{border-bottom:0}
td code{font-size:.86em}
.doc-body li>ul{margin:4px 0 0;padding-left:20px}
@media (max-width:860px){
  .wrap{grid-template-columns:1fr}
  #side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);
    padding:16px 18px 20px}
  #side .toc{display:none!important}
  #main{padding:24px 18px 80px}
  .doc-body h1{font-size:22px}
}
"""

GATE_HTML = """
<div id="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
  <div class="gate-field" aria-hidden="true">
    <svg class="gate-rot" viewBox="0 0 1200 300" preserveAspectRatio="none" focusable="false">
      <path d="M0 210 C 180 210, 220 120, 400 120 S 620 60, 800 60 S 1040 150, 1200 150"
            fill="none" stroke="currentColor" stroke-width="1.25" vector-effect="non-scaling-stroke"/>
      <path d="M0 250 C 220 250, 260 180, 470 180 S 700 130, 900 130 S 1080 200, 1200 200"
            fill="none" stroke="currentColor" stroke-width="1" opacity=".5"
            vector-effect="non-scaling-stroke"/>
      <g class="gate-calls">
        <circle cx="0" cy="210" r="3.5"/><circle cx="400" cy="120" r="3.5"/>
        <circle cx="800" cy="60" r="3.5"/><circle cx="1200" cy="150" r="3.5"/>
      </g>
    </svg>
  </div>

  <section class="gate-card">
    <div class="gate-loops" aria-hidden="true">
      <i data-svc="CSC"></i><i data-svc="NWX"></i><i data-svc="CCS"></i><i data-svc="SKS"></i>
    </div>

    <header class="gate-head">
      <p class="gate-eyebrow">FARMKOGLS &middot; 팜코지엘에스</p>
      <h1 id="gate-title">문서 &mdash; 관리자 전용</h1>
      <p class="gate-sub">
        사용설명서 &middot; 설계 지침서 &middot; 기술 참고 &middot; 배포 안내
        <span>관리자 PIN이 필요합니다</span>
      </p>
    </header>

    <form class="gate-form" id="gate-form" novalidate>
      <label class="gate-label" for="pin-proxy">관리자 PIN 4자리</label>
      <div class="gate-cells" id="gate-cells">
        <span class="cell" data-i="0"></span><span class="cell" data-i="1"></span>
        <span class="cell" data-i="2"></span><span class="cell" data-i="3"></span>
      </div>
      <input id="pin-proxy" class="gate-proxy" type="text" inputmode="numeric"
             autocomplete="off" autocapitalize="off" spellcheck="false"
             maxlength="4" aria-describedby="gate-msg" aria-label="관리자 PIN 4자리 입력">
      <p class="gate-msg" id="gate-msg" role="status" aria-live="polite">숫자 4자리를 입력하세요</p>
      <div class="gate-pad" id="gate-pad">
        <button type="button" data-k="1">1</button><button type="button" data-k="2">2</button>
        <button type="button" data-k="3">3</button><button type="button" data-k="4">4</button>
        <button type="button" data-k="5">5</button><button type="button" data-k="6">6</button>
        <button type="button" data-k="7">7</button><button type="button" data-k="8">8</button>
        <button type="button" data-k="9">9</button>
        <button type="button" data-k="clear" class="wide">지우기</button>
        <button type="button" data-k="0">0</button>
        <button type="button" data-k="back" aria-label="한 자 지우기">&#9003;</button>
      </div>
    </form>

    <footer class="gate-foot">
      <p>문서 본문은 PIN으로 암호화되어 있습니다. 올바른 번호를 넣어야 열립니다.</p>
      <p class="gate-back"><a href="./">&larr; 도구로 돌아가기</a></p>
    </footer>
  </section>
</div>
"""

GATE_JS = """
(function(){
  'use strict';
  var SALT = '@@SALT@@', ITER = @@ITER@@, TAG = '@@TAG@@', DATA = '@@DATA@@', LEN = 4;
  var gate = document.getElementById('gate');
  var cells = [].slice.call(document.querySelectorAll('#gate-cells .cell'));
  var proxy = document.getElementById('pin-proxy');
  var msg = document.getElementById('gate-msg');
  var busy = false, wrong = 0;

  function digits(){ return (proxy.value||'').replace(/\\D/g,'').slice(0,LEN); }
  function paint(){
    var d = digits();
    cells.forEach(function(c,i){
      var had = c.classList.contains('filled'), has = i < d.length;
      c.textContent = has ? '\\u2022' : '';
      c.classList.toggle('filled', has);
      c.classList.toggle('active', i === d.length && !has);
      if (has && !had){ c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
    });
  }
  function b64(s){
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i=0;i<raw.length;i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function hex(s){
    var out = new Uint8Array(s.length/2);
    for (var i=0;i<out.length;i++) out[i] = parseInt(s.substr(i*2,2),16);
    return out;
  }
  async function deriveKey(pin){
    var enc = new TextEncoder();
    var km = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      {name:'PBKDF2', salt: enc.encode(SALT), iterations: ITER, hash:'SHA-256'}, km, 256);
    return new Uint8Array(bits);
  }
  async function stream(key, n){
    var out = new Uint8Array(Math.ceil(n/32)*32);
    for (var i=0, ctr=0; i<out.length; i+=32, ctr++){
      var buf = new Uint8Array(key.length + 8);
      buf.set(key, 0);
      new DataView(buf.buffer).setUint32(key.length + 4, ctr);
      out.set(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), i);
    }
    return out.subarray(0, n);
  }
  async function unlock(pin){
    var key = await deriveKey(pin);
    var ct = b64(DATA);
    var hk = await crypto.subtle.importKey('raw', key, {name:'HMAC', hash:'SHA-256'},
                                           false, ['verify']);
    if (!(await crypto.subtle.verify('HMAC', hk, hex(TAG), ct))) return null;
    var ks = await stream(key, ct.length), out = new Uint8Array(ct.length);
    for (var i=0;i<ct.length;i++) out[i] = ct[i] ^ ks[i];
    return new TextDecoder().decode(out);
  }
  async function check(){
    var d = digits();
    if (d.length < LEN || busy) return;
    busy = true;
    msg.textContent = '\\uD655\\uC778\\uD558\\uB294 \\uC911\\u2026';
    var text = null;
    try { text = await unlock(d); } catch (e) { text = null; }
    if (text){
      gate.classList.remove('bad'); gate.classList.add('ok');
      msg.textContent = '\\uD655\\uC778\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4. \\uC5EC\\uB294 \\uC911\\u2026';
      var payload = JSON.parse(text);
      document.querySelector('#side nav').innerHTML = payload.nav;
      document.getElementById('main').innerHTML = payload.body;
      gate.classList.add('leaving');
      setTimeout(function(){ gate.remove(); document.body.classList.remove('locked'); }, 320);
      window.initDocs();
      return;
    }
    wrong += 1; busy = false;
    gate.classList.remove('ok'); gate.classList.add('bad');
    msg.textContent = 'PIN\\uC774 \\uB9DE\\uC9C0 \\uC54A\\uC2B5\\uB2C8\\uB2E4.';
    setTimeout(function(){
      proxy.value = ''; paint(); gate.classList.remove('bad');
      msg.textContent = '\\uC22B\\uC790 4\\uC790\\uB9AC\\uB97C \\uC785\\uB825\\uD558\\uC138\\uC694';
      focusProxy();
    }, 620);
  }
  function sync(){
    var d = digits();
    if (proxy.value !== d) proxy.value = d;
    paint();
    if (d.length === LEN) check();
  }
  function focusProxy(){
    try { proxy.focus({preventScroll:true}); } catch(e){ proxy.focus(); }
  }
  proxy.addEventListener('input', sync);
  proxy.addEventListener('blur', function(){
    if (document.getElementById('gate')) setTimeout(function(){
      if (document.getElementById('gate')) focusProxy();
    }, 40);
  });
  document.getElementById('gate-form').addEventListener('submit', function(e){
    e.preventDefault(); check();
  });
  document.getElementById('gate-pad').addEventListener('click', function(e){
    var b = e.target.closest('button[data-k]');
    if (!b) return;
    var k = b.dataset.k;
    if (k === 'clear') proxy.value = '';
    else if (k === 'back') proxy.value = digits().slice(0,-1);
    else if (digits().length < LEN) proxy.value = digits() + k;
    sync(); focusProxy();
  });
  document.addEventListener('keydown', function(e){
    if (!document.getElementById('gate')) return;
    if (e.key === 'Enter'){ e.preventDefault(); check(); return; }
    if (e.target === proxy) return;
    if (/^\\d$/.test(e.key)){
      if (digits().length < LEN) proxy.value = digits() + e.key;
      sync();
    } else if (e.key === 'Backspace'){
      proxy.value = digits().slice(0,-1); sync();
    }
  });
  paint(); focusProxy();
})();
"""

JS = """
window.initDocs = function(){
  var docs = [].slice.call(document.querySelectorAll('.doc-body'));
  var tabs = [].slice.call(document.querySelectorAll('#side .doc'));
  function show(id, push){
    var found = false;
    docs.forEach(function(d){
      var on = ('#' + d.id) === id;
      d.classList.toggle('on', on);
      if (on) found = true;
    });
    if (!found){ return show('#' + docs[0].id, push); }
    tabs.forEach(function(t){
      var on = t.getAttribute('href') === id;
      t.setAttribute('aria-current', on ? 'true' : 'false');
      var toc = t.nextElementSibling;
      if (toc && toc.classList.contains('toc')) toc.classList.toggle('on', on);
    });
    if (push && location.hash !== id) history.replaceState(null, '', id);
    window.scrollTo(0, 0);
  }
  tabs.forEach(function(t){
    t.addEventListener('click', function(e){
      e.preventDefault();
      show(t.getAttribute('href'), true);
    });
  });
  document.querySelectorAll('#side .toc a').forEach(function(a){
    a.addEventListener('click', function(e){
      var el = document.getElementById(a.getAttribute('href').slice(1));
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({behavior:'smooth', block:'start'});
    });
  });
  show(location.hash && document.querySelector(location.hash + '.doc-body')
       ? location.hash : '#' + docs[0].id, false);
};
"""


def read(rel):
    with io.open(os.path.join(ROOT, rel), "r", encoding="utf-8") as fh:
        return fh.read()


def main():
    bodies, nav = [], []
    for idx, (path, label, blurb) in enumerate(DOCS):
        doc_id = "d%d" % idx
        headings = []
        html = convert(read(path), doc_id, headings)
        bodies.append('<article class="doc-body" id="%s">%s</article>' % (doc_id, html))
        toc = "".join('<a href="#%s">%s</a>' % (h, esc(t)) for h, t in headings)
        nav.append(
            '<a class="doc" href="#%s">%s<span>%s</span></a>'
            '<div class="toc">%s</div>' % (doc_id, esc(label), esc(blurb), toc))

    # The documents are the thing being protected, so they cannot be sitting in
    # the markup for "view source" to read. Ship ciphertext; the admin PIN is
    # the decryption key, so a wrong PIN yields nothing rather than being told
    # "no" by a check it could simply be edited out of.
    admin_pin = load_admin_pin()
    payload = json.dumps({"nav": "".join(nav), "body": "".join(bodies)},
                         ensure_ascii=False)
    data, tag = encrypt(admin_pin, DOCS_SALT, payload)

    gate_js = (GATE_JS
               .replace("@@SALT@@", DOCS_SALT)
               .replace("@@ITER@@", str(ITERATIONS))
               .replace("@@TAG@@", tag)
               .replace("@@DATA@@", data))

    # NOTE: %-formatting is not usable here — the CSS is full of "100%".
    template = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>Farmkogls Booking Console - 문서</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%93%98%3C/text%3E%3C/svg%3E">
<style>@@GATECSS@@</style>
<style>@@CSS@@</style>
</head>
<body class="locked">
@@GATE@@
<div class="wrap">
<aside id="side">
  <a class="brand" href="./"><small>Farmkogls &middot; 팜코지엘에스</small>Booking Console 문서</a>
  <div class="addr">
    <b>사이트 주소</b>
    <a href="@@URL@@">@@URL@@</a>
    <p>PIN 4자리를 입력하면 도구가 열립니다.<br>번호는 담당자에게 확인하세요.</p>
  </div>
  <nav></nav>
</aside>
<main id="main"></main>
</div>
<script>@@JS@@</script>
<script>@@GATEJS@@</script>
</body>
</html>
"""
    page = (template
            .replace("@@GATECSS@@", read("hosted/gate.css"))
            .replace("@@CSS@@", CSS)
            .replace("@@GATE@@", GATE_HTML)
            .replace("@@URL@@", SITE_URL)
            .replace("@@JS@@", JS)
            .replace("@@GATEJS@@", gate_js))

    # neither PIN may be spelled out, and none of the prose may survive in clear
    assert_absent(load_pin(), page, "site/docs.html")
    assert_absent(admin_pin, page, "site/docs.html")
    for probe in ("팜코지엘에스의 업무", "부킹 담당자", "Peak TEU", "WEEKNUM"):
        if probe in page:
            raise SystemExit("document text %r survived unencrypted" % probe)

    if not os.path.isdir(SITE):
        os.makedirs(SITE)
    out = os.path.join(SITE, "docs.html")
    with io.open(out, "w", encoding="utf-8") as fh:
        fh.write(page)
    print("built %s  (%.0f KB, %d docs encrypted)"
          % (out, os.path.getsize(out) / 1024.0, len(DOCS)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
