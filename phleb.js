/* Trinetri Diagnostics: Phlebotomist app (home sample collection). Talks to the same PHP server as the lab console. */
(function () {
  'use strict';
  var BASE = String((window.TRIN_PORTAL || {}).api || '').replace(/\/+$/, ''), TOKEN = '', ME = null, timer = null;
  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, a, kids) {
    var e = document.createElement(tag);
    if (typeof a === 'string') e.className = a; else if (a) Object.keys(a).forEach(function (k) {
      if (k === 'text') e.textContent = a[k]; else if (k === 'html') e.innerHTML = a[k]; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), a[k]); else if (a[k] !== false && a[k] != null) e.setAttribute(k, a[k] === true ? '' : a[k]);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  var ICON = {
    leave: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4"/>', orders: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
    served: '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 10l3 3 5-6M7 21h14V8"/>', pool: '<path d="M4 7h10M4 12h10M4 17h6M16 15l2 2 4-5"/>',
    pw: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h.01M12 12h.01M17 12h.01"/>', out: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
    back: '<path d="M15 5l-7 7 7 7"/>', home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>', call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>'
  };
  function svg(k, w) { var s = el('span', { html: '<svg viewBox="0 0 24 24" width="' + (w || 24) + '" height="' + (w || 24) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[k] + '</svg>' }); s.style.display = 'flex'; return s; }
  var toastT; function toast(m) { var t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3200); }
  function say(n, t, c) { n.textContent = t; n.className = 'msg ' + (c || ''); }
  function api(method, path, body, quiet) {
    var h = {}; if (TOKEN) { h.Authorization = 'Bearer ' + TOKEN; h['X-Portal-Token'] = TOKEN; } var init = { method: method, headers: h };
    if (body !== undefined) { h['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(BASE + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { if (r.status === 401 && TOKEN && !quiet) logout('Please log in again.'); var e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
        return j;
      });
    }, function () { throw new Error('No internet connection. Please try again.'); });
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function tm(d) { var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return p2(h) + ':' + p2(d.getMinutes()) + ' ' + ap; }
  function when(o) {
    if (!o.slot_at) return 'Time not fixed';
    var d = new Date(o.slot_at), e = new Date(o.slot_at + (o.slot_mins || 20) * 60000);
    return p2(d.getDate()) + '-' + p2(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' + tm(d) + ' - ' + tm(e);
  }
  var STLAB = { assigned: 'ASSIGNED', accepted: 'ACCEPTED', started: 'STARTED', collected: 'COLLECTED' };
  function tok(v) { try { if (v === null) localStorage.removeItem('trin.ph.tok'); else if (v) localStorage.setItem('trin.ph.tok', v); else return localStorage.getItem('trin.ph.tok') || ''; } catch (e) { } return ''; }
  function logout(msg) { TOKEN = ''; ME = null; tok(null); clearInterval(timer); $('#app').hidden = true; $('#login').hidden = false; if (msg) say($('#lmsg'), msg, 'err'); }

  /* ---------- header ---------- */
  function header(title, back) {
    var h = $('#top'); h.textContent = '';
    if (!title) {
      h.appendChild(el('div', 'av', [(ME.name || '?').charAt(0).toUpperCase()]));
      h.appendChild(el('div', 'who', ['Welcome,', el('br'), el('b', { text: ME.name })]));
    } else {
      h.appendChild(el('button', { type: 'button', 'aria-label': 'Back', onclick: function () { location.hash = back || '#home'; } }, [svg('back', 26)]));
      h.appendChild(el('h2', { text: title }));
    }
    h.appendChild(el('button', { type: 'button', class: 'sos', text: 'SOS', onclick: sos }));
    if (title) h.appendChild(el('button', { type: 'button', 'aria-label': 'Home', onclick: function () { location.hash = '#home'; } }, [svg('home', 26)]));
  }
  function sos() {
    var bg = el('div', 'modalbg'), m = el('div', 'modal', [el('h3', { text: 'Send SOS to the lab?' }), el('p', { text: 'Use this only if you are in danger or need urgent help. The lab is alerted with your location.' }),
      el('div', 'btns', [el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: function () { bg.remove(); } }), el('button', { type: 'button', class: 'btn pri', text: 'Send SOS', onclick: function () {
        bg.remove(); function send(c) { api('POST', '/staff/phleb/sos', c || {}).then(function () { toast('SOS sent. The lab has been alerted.'); }).catch(function (e) { toast(e.message); }); }
        if (navigator.geolocation) navigator.geolocation.getCurrentPosition(function (p) { send({ lat: p.coords.latitude, lng: p.coords.longitude }); }, function () { send(); }, { timeout: 6000, maximumAge: 60000 }); else send();
      } })])]);
    bg.appendChild(m); document.body.appendChild(bg);
  }

  /* ---------- screens ---------- */
  var V = {};
  V.home = function (page) {
    header(null);
    page.appendChild(el('div', 'hello', ['Quick Links']));
    var grid = el('div', 'grid'), badge = {};
    function tile(key, label, icon, hash, fn) {
      var b = el('button', { type: 'button', onclick: fn || function () { location.hash = hash; } }, [svg(icon, 30), el('span', { text: label })]); b.appendChild(el('span', { class: 'n', hidden: true })); grid.appendChild(b); badge[key] = $('.n', b);
    }
    tile('orders', 'Orders', 'orders', '#orders'); tile('served', 'Served', 'served', '#served'); tile('pool', 'Pick Order', 'pool', '#pool');
    tile('leave', 'Leave', 'leave', '#leave'); tile('pw', 'Password', 'pw', '#password'); tile('out', 'Logout', 'out', null, function () { logout(); });
    var bar = el('div', 'leavebar', ['You are on leave today. You cannot pick new visits.']); bar.hidden = true; page.appendChild(bar); page.appendChild(grid);
    function load() { api('GET', '/staff/phleb/home').then(function (d) { [['orders', d.orders], ['pool', d.pool]].forEach(function (x) { badge[x[0]].textContent = x[1]; badge[x[0]].hidden = !x[1]; }); bar.hidden = !d.on_leave; }).catch(function (e) { toast(e.message); }); }
    load(); timer = setInterval(load, 30000);
  };
  function card(o, onTap, extra) {
    var c = el(onTap ? 'button' : 'div', { class: 'card', type: onTap ? 'button' : null, onclick: onTap });
    c.appendChild(el('div', 'nm', [o.name])); c.appendChild(el('div', 'id', [o.code])); c.appendChild(el('div', 'meta', [when(o)]));
    if (o.addr) c.appendChild(el('div', 'meta', [o.addr]));
    if (o.ph_status) c.appendChild(el('span', 'st ' + o.ph_status, ['Status : ' + (STLAB[o.ph_status] || o.ph_status)]));
    if (extra) c.appendChild(extra); return c;
  }
  function listScreen(title, scope, empty, mk) {
    return function (page) {
      header(title); var box = el('div'); page.appendChild(box);
      function load() { api('GET', '/staff/phleb/orders?scope=' + scope).then(function (d) { box.textContent = ''; if (!d.orders.length) box.appendChild(el('div', 'empty', [empty])); d.orders.forEach(function (o) { box.appendChild(mk(o, load)); }); }).catch(function (e) { box.textContent = ''; box.appendChild(el('div', 'empty', [e.message])); }); }
      box.appendChild(el('div', 'empty', ['Loading...'])); load(); timer = setInterval(load, 30000);
    };
  }
  V.orders = listScreen('Visit Orders', 'mine', 'No visits assigned to you right now.', function (o) { return card(o, function () { location.hash = '#order/' + encodeURIComponent(o.code); }); });
  V.served = listScreen('Served', 'served', 'No collected samples yet.', function (o) { return card(o); });
  V.pool = listScreen('Pick Order', 'pool', 'No unassigned visits right now.', function (o, reload) {
    var b = el('button', { type: 'button', class: 'btn pri', text: 'Pick this visit', onclick: function () {
      b.disabled = true; api('POST', '/staff/phleb/orders/' + encodeURIComponent(o.code) + '/pick').then(function () { toast('Added to your orders'); reload(); }).catch(function (e) { b.disabled = false; toast(e.message); reload(); });
    } });
    return card(o, null, el('div', 'btns', [b]));
  });
  V.order = function (page, code) {
    header('Visit Order', '#orders'); var box = el('div'); page.appendChild(box);
    function act(a, label) { return function () { var btn = this; btn.disabled = true; api('POST', '/staff/phleb/orders/' + encodeURIComponent(code) + '/' + a).then(function (r) { toast(label); if (a === 'release' || a === 'collected') location.hash = a === 'release' ? '#orders' : '#served'; else draw(r.order); }).catch(function (e) { btn.disabled = false; toast(e.message); }); }; }
    function draw(o) {
      box.textContent = '';
      var dt = el('div', 'card dt'), tests = el('ul', 'tests'); o.tests.forEach(function (t) { tests.appendChild(el('li', { text: t })); }); tests.hidden = true;
      var fast = el('div', 'meta', [o.fasting ? 'Fasting of 10 to 12 hours is needed for these tests. Please confirm with the patient.' : 'No fasting is needed.']); fast.hidden = true;
      dt.appendChild(el('div', 'row', [el('div', 'grow', [el('div', 'nm', [o.name]), el('div', 'id', [o.code]), el('div', 'meta', [when(o)]), el('div', 'meta', ['1 Beneficiary' + (o.age != null ? ' - ' + o.age + ' yrs' : '') + (o.sex ? ' - ' + ({ M: 'Male', F: 'Female', O: 'Other' }[o.sex] || '') : '')])]),
        el('a', { class: 'call', href: 'tel:+91' + o.mobile, 'aria-label': 'Call patient' }, [el('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON.call + '</svg>' })])]));
      dt.appendChild(el('button', { type: 'button', class: 'link', text: 'Tests (' + o.tests.length + ')', onclick: function () { tests.hidden = !tests.hidden; } })); dt.appendChild(tests);
      dt.appendChild(el('button', { type: 'button', class: 'link', text: o.fasting ? 'Check Fasting' : 'Fasting info', onclick: function () { fast.hidden = !fast.hidden; } })); dt.appendChild(fast);
      dt.appendChild(el('div', 'addr', [o.addr || 'Address not given. Call the patient.']));
      if (o.addr) dt.appendChild(el('a', { class: 'link', href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.addr), target: '_blank', rel: 'noopener', text: 'Open in Maps' }));
      if (o.due > 0) dt.appendChild(el('div', 'meta', ['Amount to collect from the patient: Rs. ' + o.due]));
      if (o.notes) dt.appendChild(el('div', 'meta', ['Note: ' + o.notes]));
      dt.appendChild(el('span', 'st ' + (o.ph_status || ''), ['Status : ' + (STLAB[o.ph_status] || 'OPEN')]));
      var b = el('div', 'btns');
      if (o.ph_status === 'assigned') b.appendChild(el('button', { type: 'button', class: 'btn pri', text: 'Accept', onclick: act('accept', 'Accepted') }));
      if (o.ph_status === 'assigned' || o.ph_status === 'accepted') b.appendChild(el('button', { type: 'button', class: 'btn pri', text: 'Start', onclick: act('start', 'Started. Safe travels.') }));
      if (o.ph_status === 'started') b.appendChild(el('button', { type: 'button', class: 'btn go', text: 'Sample collected', onclick: function () { var self = this; if (confirm('Confirm that the sample of ' + o.name + ' has been collected?')) act('collected', 'Marked as collected').call(self); } }));
      dt.appendChild(b); box.appendChild(dt);
      if (o.ph_status !== 'collected') box.appendChild(el('button', { type: 'button', class: 'btn', style: 'width:100%', text: 'Order release', onclick: function () { var self = this; if (confirm('Release this visit back to the pool? Another phlebotomist can pick it.')) act('release', 'Released').call(self); } }));
    }
    box.appendChild(el('div', 'empty', ['Loading...']));
    api('GET', '/staff/phleb/orders?scope=mine').then(function (d) { var o = d.orders.filter(function (x) { return x.code === code; })[0]; if (!o) { box.textContent = ''; box.appendChild(el('div', 'empty', ['This visit is not in your orders any more.'])); return; } draw(o); }).catch(function (e) { box.textContent = ''; box.appendChild(el('div', 'empty', [e.message])); });
  };
  V.leave = function (page) {
    header('Leave'); var today = new Date(); var iso = today.getFullYear() + '-' + p2(today.getMonth() + 1) + '-' + p2(today.getDate());
    var f = el('input', { type: 'date', min: iso, value: iso }), t = el('input', { type: 'date', min: iso, value: iso }), r = el('input', { placeholder: 'Reason (optional)', maxlength: '150' }), ms = el('p', 'msg'), list = el('div');
    page.appendChild(el('div', 'form', [el('label', { text: 'From' }), f, el('label', { text: 'To' }), t, el('label', { text: 'Reason' }), r,
      el('button', { type: 'button', class: 'big', text: 'Apply for leave', onclick: function () { say(ms, 'Saving...', ''); api('POST', '/staff/phleb/leaves', { from: f.value, to: t.value, reason: r.value }).then(function () { say(ms, 'Leave saved. The lab can see it.', 'ok'); r.value = ''; load(); }).catch(function (e) { say(ms, e.message, 'err'); }); } }), ms]));
    page.appendChild(el('div', 'sec', ['Your upcoming leave'])); page.appendChild(list);
    function load() { api('GET', '/staff/phleb/leaves').then(function (d) { list.textContent = ''; if (!d.leaves.length) list.appendChild(el('div', 'empty', ['No leave planned.'])); d.leaves.forEach(function (x) { list.appendChild(el('div', 'card', [el('div', 'nm', [x.from === x.to ? x.from : x.from + ' to ' + x.to]), x.reason ? el('div', 'meta', [x.reason]) : null, el('div', 'btns', [el('button', { type: 'button', class: 'btn', text: 'Cancel leave', onclick: function () { api('POST', '/staff/phleb/leaves/' + x.id + '/cancel').then(load).catch(function (e) { toast(e.message); }); } })])])); }); }).catch(function (e) { toast(e.message); }); }
    load();
  };
  V.password = function (page) {
    header('Password'); var o = el('input', { type: 'password', autocomplete: 'current-password' }), n = el('input', { type: 'password', autocomplete: 'new-password' }), n2 = el('input', { type: 'password', autocomplete: 'new-password' }), ms = el('p', 'msg');
    page.appendChild(el('div', 'form', [el('label', { text: 'Current password' }), o, el('label', { text: 'New password (8+ characters)' }), n, el('label', { text: 'Repeat the new password' }), n2,
      el('button', { type: 'button', class: 'big', text: 'Change password', onclick: function () { if (n.value !== n2.value) return say(ms, 'The two new passwords do not match.', 'err'); say(ms, 'Saving...', ''); api('POST', '/staff/password', { old: o.value, new: n.value }).then(function () { o.value = n.value = n2.value = ''; say(ms, 'Password changed.', 'ok'); }).catch(function (e) { say(ms, e.message, 'err'); }); } }), ms]));
    if (window.TRIN_PWEYE) window.TRIN_PWEYE();
  };

  function route() {
    if (!ME) return; clearInterval(timer);
    var parts = location.hash.replace(/^#/, '').split('/'), v = V[parts[0]] ? parts[0] : 'home', arg = parts[1] ? decodeURIComponent(parts[1]) : '';
    var page = $('#page'); page.textContent = ''; V[v](page, arg); window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  function enter(staff, token) {
    if (staff.role !== 'phlebotomist') { TOKEN = ''; tok(null); say($('#lmsg'), staff.role === 'admin' || staff.role === 'reception' || staff.role === 'technician' ? 'This app is for phlebotomists. Staff logins use the lab console.' : 'This login cannot use this app.', 'err'); $('#login').hidden = false; return; }
    ME = staff; TOKEN = token; tok(token); $('#login').hidden = true; $('#app').hidden = false; route();
  }
  $('#fl').addEventListener('submit', function (e) {
    e.preventDefault(); var m = $('#lmsg'), u = $('#lu').value.trim(), p = $('#lp').value; if (!u || !p) return say(m, 'Enter your username and password.', 'err');
    say(m, 'Logging in...', ''); api('POST', '/staff/login', { username: u, password: p }, true).then(function (r) { $('#lp').value = ''; say(m, '', ''); enter(r.staff, r.token); }).catch(function (er) { say(m, er.message, 'err'); });
  });
  var saved = tok();
  if (saved) { TOKEN = saved; api('GET', '/staff/me', undefined, true).then(function (r) { enter(r.staff, saved); }).catch(function () { TOKEN = ''; tok(null); $('#login').hidden = false; }); } else $('#login').hidden = false;
})();
