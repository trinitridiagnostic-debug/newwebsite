/* Adds a show/hide eye button to every password box on the page (also boxes added later). */
(function () {
  var css = '.pwx{position:relative;display:block}.pwx>input{width:100%;padding-right:44px!important;box-sizing:border-box}' +
    '.pwx-b{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;background:transparent;cursor:pointer;color:#5b6b73;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0}' +
    '.pwx-b:hover{color:#0e5a63;background:rgba(14,90,99,.08)}.pwx-b:focus-visible{outline:2px solid #0e8a96;outline-offset:1px}.pwx-b svg{width:20px;height:20px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12A3 3 0 1 1 9.88 9.88"/><path d="M1 1l22 22"/></svg>';
  function wrap(inp) {
    if (inp.dataset.pwx || !inp.parentNode) return; inp.dataset.pwx = '1';
    var w = document.createElement('span'); w.className = 'pwx';
    inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pwx-b'; b.innerHTML = EYE;
    b.setAttribute('aria-label', 'Show password'); b.setAttribute('aria-pressed', 'false'); b.title = 'Show password';
    b.addEventListener('click', function () {
      var show = inp.type === 'password'; inp.type = show ? 'text' : 'password';
      b.innerHTML = show ? OFF : EYE; b.setAttribute('aria-pressed', show ? 'true' : 'false');
      var t = show ? 'Hide password' : 'Show password'; b.setAttribute('aria-label', t); b.title = t; inp.focus();
    });
    w.appendChild(b);
  }
  function scan(root) { var l = (root.querySelectorAll ? root : document).querySelectorAll('input[type=password]'); for (var i = 0; i < l.length; i++) wrap(l[i]); }
  scan(document);
  new MutationObserver(function (ms) {
    ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches && n.matches('input[type=password]')) wrap(n); else scan(n); } }); });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
