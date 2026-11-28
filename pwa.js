/* Registers the app shell and shows an "Install app" bar in the browser (not inside the installed app / APK). */
(function () {
  'use strict';
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () { }); });
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true || /^android-app:/.test(document.referrer || '');
  if (standalone) return;
  var ev = null, closed = false; try { closed = localStorage.getItem('trin.pwa.closed') === '1'; } catch (e) { }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); ev = e; if (closed) return;
    var bar = document.createElement('div'); bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Install app');
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#173f44;color:#fff;border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,.25);font:15px/1.3 system-ui,sans-serif';
    var t = document.createElement('span'); t.style.flex = '1'; t.textContent = 'Install the Trinetri app for quick access to your reports.';
    var go = document.createElement('button'); go.type = 'button'; go.textContent = 'Install'; go.style.cssText = 'background:#fff;color:#173f44;border:0;border-radius:10px;padding:9px 14px;font:inherit;font-weight:700;cursor:pointer';
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×'; x.style.cssText = 'background:none;border:0;color:#cfe3e5;font-size:22px;cursor:pointer;line-height:1';
    go.onclick = function () { bar.remove(); ev.prompt(); ev.userChoice.finally(function () { ev = null; }); };
    x.onclick = function () { bar.remove(); try { localStorage.setItem('trin.pwa.closed', '1'); } catch (e) { } };
    bar.appendChild(t); bar.appendChild(go); bar.appendChild(x); document.body.appendChild(bar);
  });
})();
