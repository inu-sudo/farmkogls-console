/* ============================================================================
   gate.js — PIN gate for the hosted build, plus the "download the tool" path.

   This gate only checks whether the PIN is right: what it guards is an empty
   tool, since booking data never leaves the visitor's own browser. The docs
   page needs more than that — the documents themselves are the asset — so it
   encrypts its content with its own admin PIN instead. See build_docs.py.
   ========================================================================= */
(function () {
  'use strict';

  var PIN_HASH = '__PIN_HASH__';          // sha-256 of SALT + ':' + pin
  var SALT = '__PIN_SALT__';
  var LEN = 4;

  // sessionStorage, NOT localStorage: the unlock must not outlive the browsing
  // session. It used to persist, so anyone opening the link afterwards on that
  // machine walked straight in and the PIN looked switched off. A refresh
  // during work still does not re-prompt; closing the tab or the browser does.
  var UNLOCK_KEY = 'farmkogls.gate.unlocked.v2';
  var store = null;
  try { store = window.sessionStorage; } catch (e) { store = null; }

  var gate = document.getElementById('gate');
  var cells = Array.prototype.slice.call(document.querySelectorAll('#gate-cells .cell'));
  var proxy = document.getElementById('pin-proxy');
  var msg = document.getElementById('gate-msg');
  var pad = document.getElementById('gate-pad');
  var form = document.getElementById('gate-form');
  var wrong = 0;
  var busy = false;

  /* ---- pin ------------------------------------------------------------ */
  function digits() { return (proxy.value || '').replace(/\D/g, '').slice(0, LEN); }

  function paint() {
    var d = digits();
    cells.forEach(function (c, i) {
      var had = c.classList.contains('filled');
      var has = i < d.length;
      c.textContent = has ? '•' : '';
      c.classList.toggle('filled', has);
      c.classList.toggle('active', i === d.length && !has);
      if (has && !had) {
        c.classList.remove('pop');
        void c.offsetWidth;
        c.classList.add('pop');
      }
    });
  }

  async function sha256Hex(text) {
    var buf = new TextEncoder().encode(text);
    var hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.prototype.map
      .call(new Uint8Array(hash), function (b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  }

  async function check() {
    var d = digits();
    if (d.length < LEN || busy) return;
    busy = true;
    var ok = false;
    try { ok = (await sha256Hex(SALT + ':' + d)) === PIN_HASH; }
    catch (e) { ok = false; }

    if (ok) {
      wrong = 0;
      gate.classList.remove('bad');
      gate.classList.add('ok');
      msg.textContent = '확인되었습니다. 여는 중…';
      try { if (store) store.setItem(UNLOCK_KEY, '1'); } catch (e) { /* private mode */ }
      setTimeout(open, 260);
      return;
    }

    wrong += 1;
    busy = false;
    gate.classList.remove('ok');
    gate.classList.add('bad');
    msg.textContent = wrong >= 5
      ? 'PIN이 맞지 않습니다. 번호를 아는 담당자에게 확인해 주세요.'
      : 'PIN이 맞지 않습니다. 다시 입력해 주세요.';
    setTimeout(function () {
      proxy.value = '';
      paint();
      gate.classList.remove('bad');
      msg.textContent = '숫자 4자리를 입력하세요';
      focusProxy();
    }, wrong >= 5 ? 1200 : 620);
  }

  function sync() {
    var d = digits();
    if (proxy.value !== d) proxy.value = d;
    paint();
    if (d.length === LEN) check();
  }

  function focusProxy() {
    try { proxy.focus({ preventScroll: true }); } catch (e) { proxy.focus(); }
  }

  proxy.addEventListener('input', sync);
  proxy.addEventListener('blur', function () {
    if (!gate.hidden) setTimeout(function () { if (!gate.hidden) focusProxy(); }, 40);
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); check(); });

  pad.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-k]');
    if (!b) return;
    var k = b.dataset.k;
    if (k === 'clear') proxy.value = '';
    else if (k === 'back') proxy.value = digits().slice(0, -1);
    else if (digits().length < LEN) proxy.value = digits() + k;
    sync();
    focusProxy();
  });

  document.addEventListener('keydown', function (e) {
    if (gate.hidden) return;
    if (e.key === 'Enter') { e.preventDefault(); check(); return; }
    if (e.target === proxy) return;                 // the input handles itself
    if (/^\d$/.test(e.key)) {
      if (digits().length < LEN) proxy.value = digits() + e.key;
      sync();
    } else if (e.key === 'Backspace') {
      proxy.value = digits().slice(0, -1);
      sync();
    }
  });

  /* ---- open the console ------------------------------------------------ */
  var opened = false;
  function open() {
    if (opened) return;
    opened = true;
    var app = document.getElementById('app');
    var tpl = document.getElementById('app-shell');
    app.innerHTML = tpl.innerHTML;
    app.hidden = false;

    gate.classList.add('leaving');
    var finish = function () {
      gate.hidden = true;
      gate.classList.remove('leaving', 'ok', 'bad');
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setTimeout(finish, 340);

    try { window.FApp.boot(); } catch (e) {
      app.innerHTML = '<div style="padding:40px;text-align:center">' +
        '<h3>화면을 여는 중 문제가 생겼습니다</h3><p>' + String(e && e.message) + '</p></div>';
      return;
    }
    addHostedChrome();
    var h = document.querySelector('#app h3, #app .logo b');
    if (h) h.setAttribute('tabindex', '-1'), h.focus({ preventScroll: true });
  }

  /* ---- hosted-only buttons -------------------------------------------- */
  function addHostedChrome() {
    var foot = document.querySelector('#app .foot');
    if (foot && !document.getElementById('btnGetTool')) {
      var get = document.createElement('button');
      get.className = 'btn hosted-btn';
      get.id = 'btnGetTool';
      get.innerHTML = '⬇ 도구 내려받기 (.html)';
      get.title = '엑셀 파일로 저장하려면 이 도구를 받아 PC에서 여세요';
      foot.insertBefore(get, foot.children[1] || null);
      get.addEventListener('click', downloadTool);
    }
    var top = document.querySelector('#app .top-in');
    if (top && !document.getElementById('lockBtn')) {
      var lock = document.createElement('button');
      lock.className = 'btn ghost sm';
      lock.id = 'lockBtn';
      lock.textContent = '☒ 잠그기';
      top.appendChild(lock);
      lock.addEventListener('click', relock);
    }
  }

  function relock() {
    try { if (store) store.removeItem(UNLOCK_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  /* ---- rebuild the standalone tool from this page --------------------- */
  function buildStandalone() {
    var css = document.getElementById('tool-css').textContent;
    var js = document.getElementById('tool-js').textContent;
    var shell = document.getElementById('app-shell').innerHTML;
    var close = '<\/' + 'script>';
    return [
      '<!doctype html>',
      '<html lang="ko">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Farmkogls Booking Console</title>',
      '<!--',
      '  이 파일은 그 자체로 완결된 도구입니다. 더블클릭해서 여세요.',
      '  설치도 인터넷 연결도 필요 없고, 넣은 엑셀은 이 PC를 벗어나지 않습니다.',
      '-->',
      '<style>', css, '</style>',
      '</head>',
      '<body>',
      shell,
      '<script>', js, close,
      '</body>',
      '</html>',
    ].join('\n');
  }

  function say(title, body, kind) {
    var box = document.getElementById('toasts');
    if (!box) { alert(title + '\n' + (body || '')); return; }
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = '<b></b><span></span>';
    el.firstChild.textContent = title;
    el.lastChild.textContent = body || '';
    box.appendChild(el);
    setTimeout(function () { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; },
      kind === 'bad' ? 9000 : 5000);
    setTimeout(function () { el.remove(); }, kind === 'bad' ? 9500 : 5500);
  }

  async function downloadTool() {
    var btn = document.getElementById('btnGetTool');
    if (btn) { btn.disabled = true; btn.textContent = '준비 중…'; }
    var html = buildStandalone();
    var name = 'Farmkogls_Booking_Console.html';
    try {
      var cd = window.claude && window.claude.downloads;
      if (cd) {
        try {
          await cd.save({ filename: name, data: html });
          say('도구를 저장했습니다', '받은 파일을 더블클릭하면 엑셀 저장까지 전부 됩니다.', 'good');
          return;
        } catch (err) {
          var code = err && err.code;
          if (code === 'declined') { say('저장을 취소했습니다', '', ''); return; }
          if (code === 'extension_not_enabled' || code === 'rejected_extension') {
            await cd.save({ filename: 'Farmkogls_Booking_Console.txt', data: html });
            say('.txt로 저장했습니다',
              '파일 이름 끝을 .txt 에서 .html 로 바꾼 뒤 더블클릭하세요.', 'good');
            return;
          }
          if (code === 'rate_limited') {
            say('잠시 후 다시 눌러주세요', '저장 요청이 이미 열려 있습니다.', 'bad'); return;
          }
          throw err;
        }
      }
      var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      say('도구를 내려받았습니다', '받은 파일을 더블클릭하면 엑셀 저장까지 전부 됩니다.', 'good');
    } catch (e) {
      say('도구를 저장하지 못했습니다', String((e && e.message) || e), 'bad');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '⬇ 도구 내려받기 (.html)'; }
    }
  }

  /* ---- start ----------------------------------------------------------- */
  var already = false;
  try { already = !!store && store.getItem(UNLOCK_KEY) === '1'; } catch (e) { already = false; }
  // clear the old persistent flag so an earlier unlock cannot keep letting people in
  try { localStorage.removeItem('farmkogls.gate.unlocked.v1'); } catch (e) { /* ignore */ }
  if (already) open();
  else { paint(); focusProxy(); }
})();
