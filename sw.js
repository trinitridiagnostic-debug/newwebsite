/* Trinetri customer app: keeps the app shell available when the network is slow or offline. Never touches the portal API or reports. */
var V = 'trinetri-app-v2';
var SHELL = ['/customer.html', '/style.css', '/portal.css', '/login-fx.css', '/portal-config.js', '/pw-eye.js', '/login-fx.js', '/portal.js', '/pwa.js', '/icon.png', '/splash.mp4', '/splash-poster.jpg', '/app-192.png', '/app-512.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(V).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () { }); })); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.indexOf('/portal-api') === 0) return;
  var p = u.pathname; if (SHELL.indexOf(p) < 0 && p !== '/') return;
  /* network first so updates show at once; the saved copy is only a fallback */
  e.respondWith(fetch(r).then(function (res) { if (res && res.ok) { var cp = res.clone(); caches.open(V).then(function (c) { c.put(r, cp); }); } return res; }).catch(function () { return caches.match(r, { ignoreSearch: true }); }));
});
