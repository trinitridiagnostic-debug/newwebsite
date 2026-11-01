/* Trinetri Diagnostics lab console: core (login, navigation, dashboard, orders, results).
   More screens are in lab2.js. Talks to the PHP server set in portal-config.js. */
(function () {
  'use strict';
  var BASE = String((window.TRIN_PORTAL || {}).api || '').replace(/\/+$/, '');
  var TOKEN = '', ME = null, DASH = null;
  var LAB = window.LAB = { views: {}, titles: {}, plans: [] };

  /* ---------- helpers ---------- */
  var uid = 0;
  function add(e, k) { if (k == null || k === false) return; if (Array.isArray(k)) k.forEach(function (x) { add(e, x); }); else e.appendChild(k.nodeType ? k : document.createTextNode(String(k))); }
  function el(tag, a, kids) {
    var e = document.createElement(tag);
    if (a) { if (typeof a === 'string') e.className = a; else for (var k in a) { var v = a[k]; if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else if (k === 'checked' || k === 'disabled' || k === 'selected') e[k] = !!v; else e.setAttribute(k, v === true ? '' : v); } }
    add(e, kids); return e;
  }
  function $(s, r) { return (r || document).querySelector(s); }
  function fld(label, input, cls) { var id = 'f' + (++uid); input.id = id; return el('div', 'f ' + (cls || ''), [el('label', { for: id, text: label }), input]); }
  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fdate(ts) { var d = new Date(ts); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }
  function ftime(ts) { var d = new Date(ts), h = d.getHours(), m = ('0' + d.getMinutes()).slice(-2); return (h % 12 || 12) + ':' + m + ' ' + (h < 12 ? 'am' : 'pm'); }
  function fdt(ts) { return fdate(ts) + ', ' + ftime(ts); }
  function dayStart(off) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + (off || 0)); return d.getTime(); }
  var toastT; function toast(m) { var t = $('.toast2') || document.body.appendChild(el('div', 'toast2')); t.setAttribute('role', 'status'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3200); }
  function say(n, t, c) { n.textContent = t; n.className = 'msg ' + (c || ''); }
  function mob(s) { var d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
  var STLAB = { booked: 'Booked', collected: 'Sample collected', processing: 'In progress', completed: 'Completed' };
  function badge(st, txt) { return el('span', 'badge2 b-' + st, txt || STLAB[st] || st); }
  function can(p) { return !!(ME && ME.can && ME.can.indexOf(p) >= 0); }
  function modal(title, body, buttons) {
    var ov = el('div', 'ovl'), box = el('div', { class: 'mdl', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }), acts = el('div', 'acts');
    function close() { ov.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    (buttons || []).forEach(function (b) { acts.appendChild(el('button', { type: 'button', class: 'btn sm ' + (b.cls || ''), text: b.text, onclick: function () { var r = b.fn ? b.fn(close) : null; if (!b.keep && r !== false) close(); } })); });
    box.appendChild(el('h2', { text: title })); add(box, body); box.appendChild(acts); ov.appendChild(box);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); }); document.addEventListener('keydown', esc);
    document.body.appendChild(ov); var f = box.querySelector('input,select,textarea,button'); if (f) f.focus();
    return { close: close, box: box };
  }
  function confirmBox(msg, okText, fn) { modal('Please confirm', el('p', { text: msg }), [{ text: 'Cancel', cls: 'ghost' }, { text: okText || 'OK', cls: 'danger', fn: fn }]); }

  /* ---------- api ---------- */
  function api(method, path, body, opt) {
    opt = opt || {}; var h = {}; if (TOKEN) h.Authorization = 'Bearer ' + TOKEN; var init = { method: method, headers: h };
    if (opt.raw) init.body = opt.raw; else if (body !== undefined) { h['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(BASE + path, init).then(function (r) {
      if (r.ok && opt.blob) return r.blob();
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { if (r.status === 401 && TOKEN && !opt.quiet) logout('Please log in again.'); var e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
        return j;
      });
    }, function () { throw new Error('Cannot reach the server. Check the internet connection.'); });
  }
  function openPdf(path) {
    var w = window.open('', '_blank');
    api('GET', path, undefined, { blob: true }).then(function (b) { var u = URL.createObjectURL(b); if (w) w.location = u; else location.href = u; setTimeout(function () { URL.revokeObjectURL(u); }, 120000); })
      .catch(function (e) { if (w) w.close(); toast(e.message); });
  }
  Object.assign(LAB, { el: el, add: add, $: $, fld: fld, inr: inr, fdate: fdate, ftime: ftime, fdt: fdt, dayStart: dayStart, toast: toast, say: say, mob: mob, badge: badge, can: can, modal: modal, confirmBox: confirmBox, api: api, openPdf: openPdf, STLAB: STLAB, base: BASE });

  /* ---------- catalog (same data the website and the catalog admin use) ---------- */
  var CATL = window.CATALOG || {}, HID = {}, ED = CATL.editedTests || {};
  (CATL.hiddenTests || []).forEach(function (h) { HID[h] = 1; });
  var TESTS = (window.RAW || []).filter(function (r) { return !HID[r[0] + ':' + r[1]]; }).map(function (r) { var e = ED[r[0] + ':' + r[1]]; return { key: r[0] + ':' + r[1], name: (e && e.n) || r[2], price: e && e.m > 0 ? e.m : r[3] }; })
    .concat((CATL.extraTests || []).map(function (t) { return { key: 'T:' + t.k, name: t.n, price: t.m }; }));
  var PKGS = (CATL.packages || []).map(function (p) { return { key: 'K:' + p.id, name: p.name, price: p.price, pkg: true }; });
  LAB.packages = PKGS;
  LAB.search = function (q) {
    var terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean); if (!terms.length) return [];
    var out = [];
    for (var i = 0; i < PKGS.concat(TESTS).length && out.length < 40; i++) {
      var t = i < PKGS.length ? PKGS[i] : TESTS[i - PKGS.length], hay = (t.name + ' ' + t.key).toLowerCase();
      if (terms.every(function (w) { return hay.indexOf(w) >= 0; })) out.push(t);
    }
    return out;
  };

  /* ---------- auth + shell ---------- */
  var NAV = [
    ['dash', 'Dashboard', null, 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10'],
    ['new', 'New order', 'billing', 'M12 5v14M5 12h14'],
    ['bookings', 'Bookings', 'billing', 'M7 3v3M17 3v3M4 8h16M5 5h14v15H5V5zM9 13l2 2 4-4'],
    ['orders', 'Orders', 'view', 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'],
    ['patients', 'Patients', 'view', 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c1-4 4-6 8-6s7 2 8 6'],
    ['inbox', 'Inbox', 'inbox', 'M4 5h16v11H8l-4 4V5z'],
    ['reports', 'Reports', 'billing', 'M5 20V10M12 20V4M19 20v-7'],
    ['stock', 'Stock', 'stock', 'M4 8l8-4 8 4v8l-8 4-8-4V8zM4 8l8 4 8-4M12 12v8'],
    ['templates', 'Result templates', 'results', 'M6 3h9l4 4v14H6V3zM9 12h7M9 16h7'],
    ['staff', 'Staff', 'staff', 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z'],
    ['acct', 'My account', null, 'M12 8m-4 0a4 4 0 108 0 4 4 0 10-8 0M5 21c1-4 4-6 7-6s6 2 7 6']
  ];
  var TITLES = { dash: 'Dashboard', new: 'New order', bookings: 'Website bookings', orders: 'Orders', order: 'Order', patients: 'Patients', inbox: 'Inbox', reports: 'Reports', stock: 'Stock', templates: 'Result templates', staff: 'Staff', acct: 'My account' };
  var ROLES = { admin: 'Admin', reception: 'Reception', technician: 'Technician', doctor: 'Doctor / Pathologist' };
  LAB.roles = ROLES;
  function tok(v) { try { if (v === null) sessionStorage.removeItem('trin.lab.tok'); else if (v) sessionStorage.setItem('trin.lab.tok', v); else return sessionStorage.getItem('trin.lab.tok') || ''; } catch (e) { } return ''; }
  function logout(msg) { TOKEN = ''; ME = null; tok(null); clearInterval(pollT); $('#app').hidden = true; $('#auth').hidden = false; boot(msg); }
  var pollT = null;
  function showApp(staff, token) {
    ME = staff; TOKEN = token; tok(token); $('#auth').hidden = true; $('#app').hidden = false;
    $('#wn').textContent = ME.name; $('#wr').textContent = ROLES[ME.role] || ME.role;
    var menu = $('#menu'); menu.textContent = '';
    NAV.forEach(function (n) {
      if (n[2] && !can(n[2])) return;
      var svg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + n[3] + '"/></svg>';
      var b = el('button', { type: 'button', class: 'nv', 'data-v': n[0], onclick: function () { go(n[0]); closeNav(); } }); b.innerHTML = svg; b.appendChild(el('span', { text: n[1] })); b.appendChild(el('span', { class: 'dot', hidden: true })); menu.appendChild(b);
    });
    refreshDash(); clearInterval(pollT); pollT = setInterval(refreshDash, 30000);
    route();
  }
  function refreshDash() {
    api('GET', '/staff/dashboard?since=' + dayStart(0) + '&tz=' + (-new Date().getTimezoneOffset()), undefined, { quiet: true }).then(function (d) {
      DASH = d; LAB.dash = d;
      var n = { bookings: d.bookings || 0, inbox: d.inbox.tickets + d.inbox.chats + d.inbox.members, stock: d.stock ? d.stock.low : 0, orders: d.pipeline.awaiting };
      $$('#menu .nv').forEach(function (b) { var c = n[b.getAttribute('data-v')], dot = $('.dot', b); if (dot) { dot.hidden = !c; dot.textContent = c || ''; } });
    }).catch(function () { });
  }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  LAB.refreshDash = refreshDash;
  function closeNav() { $('#side').classList.remove('open'); $('#scrim').hidden = true; $('#burger').setAttribute('aria-expanded', 'false'); }

  function go(view, arg) { var h = '#' + view + (arg != null && arg !== '' ? '/' + encodeURIComponent(arg) : ''); if (location.hash === h) route(); else location.hash = h; }
  LAB.go = go;
  var cleanup = null;
  LAB.onLeave = function (f) { cleanup = f; };
  function route() {
    if (!ME) return;
    if (cleanup) { try { cleanup(); } catch (e) { } cleanup = null; }
    var parts = location.hash.replace(/^#/, '').split('/'), view = parts[0] || 'dash', arg = parts[1] ? decodeURIComponent(parts[1]) : '';
    var nv = NAV.filter(function (n) { return n[0] === view; })[0];
    if (!LAB.views[view] || (nv && nv[2] && !can(nv[2]))) { view = 'dash'; arg = ''; }
    $$('#menu .nv').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === (view === 'order' ? 'orders' : view)); });
    $('#vt').textContent = TITLES[view] || view; $('#topact').textContent = '';
    var page = $('#page'); page.textContent = ''; page.appendChild(el('p', { class: 'empty', text: 'Loading...' }));
    var holder = el('div'); LAB.views[view](holder, arg, function () { page.textContent = ''; page.appendChild(holder); });
    document.title = (TITLES[view] || 'Lab') + ' | Trinetri Lab Console';
  }
  window.addEventListener('hashchange', route);
  LAB.fail = function (page, e) { page.textContent = ''; page.appendChild(el('div', 'card', [el('p', { class: 'msg err', text: e.message || 'Something went wrong.' })])); };

  function boot(msg) {
    var nosrv = $('#nosrv'), fl = $('#fl'), fs = $('#fs'); fl.hidden = fs.hidden = true; nosrv.hidden = true;
    if (!BASE) { nosrv.hidden = false; return; }
    var saved = tok();
    function toLogin(needsSetup) { fl.hidden = needsSetup; fs.hidden = !needsSetup; if (msg) say($('#lmsg'), msg, 'err'); }
    if (saved && !msg) {
      TOKEN = saved; api('GET', '/staff/me', undefined, { quiet: true }).then(function (r) { showApp(r.staff, saved); }).catch(function () { TOKEN = ''; tok(null); boot(); }); return;
    }
    api('GET', '/staff/status').then(function (r) { toLogin(r.needsSetup); }).catch(function (e) { nosrv.hidden = false; nosrv.textContent = e.message; });
  }
  $('#fl').addEventListener('submit', function (e) {
    e.preventDefault(); var m = $('#lmsg'), u = $('#lu').value.trim(), p = $('#lp').value; if (!u || !p) return say(m, 'Enter your username and password.', 'err');
    say(m, 'Logging in...', 'info'); api('POST', '/staff/login', { username: u, password: p }, { quiet: true }).then(function (r) { $('#lp').value = ''; say(m, '', ''); showApp(r.staff, r.token); }).catch(function (er) { say(m, er.message, 'err'); });
  });
  $('#fs').addEventListener('submit', function (e) {
    e.preventDefault(); var m = $('#smsg');
    api('POST', '/staff/setup', { name: $('#sn').value, title: $('#st').value, username: $('#su').value, password: $('#sp').value, setup_code: $('#sc').value }, { quiet: true })
      .then(function (r) { $('#sp').value = $('#sc').value = ''; showApp(r.staff, r.token); }).catch(function (er) { say(m, er.message, 'err'); });
  });
  $('#out').addEventListener('click', function () { logout(); });
  $('#burger').addEventListener('click', function () { var o = $('#side').classList.toggle('open'); $('#scrim').hidden = !o; $('#burger').setAttribute('aria-expanded', String(o)); });
  $('#scrim').addEventListener('click', closeNav);

  /* ---------- dashboard ---------- */
  function kpi(val, label, sub, go2, warn) { return el('button', { type: 'button', class: 'kpi' + (warn ? ' warn' : ''), onclick: go2 || null }, [el('b', { text: val }), el('span', { text: label }), sub ? el('small', { text: sub }) : null]); }
  LAB.views.dash = function (page, _a, done) {
    api('GET', '/staff/dashboard?since=' + dayStart(0) + '&tz=' + (-new Date().getTimezoneOffset())).then(function (d) {
      DASH = d; var p = d.pipeline;
      page.appendChild(el('h2', { text: 'Today' }));
      page.appendChild(el('div', 'grid4', [kpi(String(d.today.orders), 'Orders today', null, function () { go('orders'); }), kpi(inr(d.today.billed), 'Billed today'), kpi(inr(d.today.paid), 'Collected today'),
        kpi(inr(d.dues.amount), 'Pending dues', d.dues.orders + ' orders', function () { go('orders', '?due'); }, d.dues.orders > 0)]));
      page.appendChild(el('h2', { text: 'Work in progress' }));
      var g = el('div', 'grid4');
      [['booked', 'Waiting for sample', p.booked], ['collected', 'Sample collected', p.collected], ['processing', 'Testing in progress', p.processing], ['awaiting', 'Awaiting approval', p.awaiting]].forEach(function (x) { g.appendChild(kpi(String(x[2]), x[1], null, function () { go('orders', '?s=' + x[0]); }, x[0] === 'awaiting' && x[2] > 0)); });
      page.appendChild(g);
      if (can('inbox') || can('stock')) {
        page.appendChild(el('h2', { text: 'Needs attention' })); var g2 = el('div', 'grid4');
        if (can('inbox')) { g2.appendChild(kpi(String(d.inbox.tickets), 'Open tickets', null, function () { go('inbox'); }, d.inbox.tickets > 0)); g2.appendChild(kpi(String(d.inbox.chats), 'Unread chats', null, function () { go('inbox'); }, d.inbox.chats > 0)); g2.appendChild(kpi(String(d.inbox.members), 'Membership requests', null, function () { go('inbox'); }, d.inbox.members > 0)); }
        if (can('billing')) g2.appendChild(kpi(String(d.bookings || 0), 'New website bookings', null, function () { go('bookings'); }, (d.bookings || 0) > 0));
        if (can('stock')) g2.appendChild(kpi(String(d.stock.low), 'Low stock items', null, function () { go('stock'); }, d.stock.low > 0));
        page.appendChild(g2);
      }
      return api('GET', '/staff/orders?limit=8').then(function (r) {
        var c = el('section', 'card', [el('h2', { text: 'Latest orders' })]); c.appendChild(ordersTable(r.orders)); page.appendChild(c); done();
      });
    }).catch(function (e) { LAB.fail($('#page'), e); });
  };

  /* ---------- orders list ---------- */
  function resBadge(o) { return o.res_status === 'approved' ? el('span', 'tag', 'Report approved') : o.res_status === 'entered' ? el('span', 'badge2 b-requested', 'Awaiting approval') : null; }
  function ordersTable(list) {
    if (!list.length) return el('p', { class: 'empty', text: 'No orders found.' });
    var tb = el('tbody');
    list.forEach(function (o) {
      tb.appendChild(el('tr', { class: 'click', tabindex: 0, onclick: function () { go('order', o.code); }, onkeydown: function (e) { if (e.key === 'Enter') go('order', o.code); } }, [
        el('td', null, [el('b', { text: o.code }), el('div', { class: 'upd', text: fdt(o.created) })]),
        el('td', null, [el('div', { text: o.name }), el('div', { class: 'upd', text: o.mobile + (o.age != null ? ' · ' + o.age + (o.sex || '') : '') })]),
        el('td', 'hide-s', o.tests.map(function (t) { return t.name; }).join(', ').slice(0, 70)),
        el('td', 'num', [el('div', { text: inr(o.amount) }), o.due > 0 ? el('div', { class: 'upd', style: 'color:#b3261e', text: 'Due ' + inr(o.due) }) : el('div', { class: 'upd', text: 'Paid' })]),
        el('td', null, [badge(o.status), ' ', resBadge(o)])
      ]));
    });
    return el('div', 'tbl-wrap', [el('table', 'tbl', [el('thead', null, el('tr', null, [el('th', { text: 'Order' }), el('th', { text: 'Patient' }), el('th', { class: 'hide-s', text: 'Tests' }), el('th', { class: 'num', text: 'Amount' }), el('th', { text: 'Status' })])), tb])]);
  }
  LAB.ordersTable = ordersTable;
  LAB.views.orders = function (page, arg, done) {
    var st = { q: '', s: '', due: false, range: '', off: 0 }, m = /^\?(.*)$/.exec(arg || '');
    if (m) { if (m[1] === 'due') st.due = true; else { var mm = /^s=(\w+)$/.exec(m[1]); if (mm) st.s = mm[1]; var qq = /^q=(\d+)$/.exec(m[1]); if (qq) st.q = qq[1]; } }
    var q = el('input', { type: 'search', placeholder: 'Order ID, name or mobile', value: st.q });
    var s = el('select', null, [['', 'All statuses'], ['booked', 'Booked'], ['collected', 'Sample collected'], ['processing', 'In progress'], ['awaiting', 'Awaiting approval'], ['completed', 'Completed']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === st.s }); }));
    var r = el('select', null, [['', 'Any date'], ['0', 'Today'], ['-6', 'Last 7 days'], ['-29', 'Last 30 days']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    var d = el('input', { type: 'checkbox', checked: st.due, style: 'width:auto' });
    var body = el('div'), pager = el('div', 'row');
    function load() {
      var u = '/staff/orders?limit=25&offset=' + st.off + (st.q ? '&q=' + encodeURIComponent(st.q) : '') + (st.s ? '&status=' + st.s : '') + (st.due ? '&due=1' : '') + (st.range !== '' ? '&from=' + dayStart(Number(st.range)) : '');
      api('GET', u).then(function (x) {
        body.textContent = ''; body.appendChild(ordersTable(x.orders)); pager.textContent = '';
        pager.appendChild(el('span', { class: 'upd', text: x.total + ' orders' }));
        if (st.off > 0) pager.appendChild(el('button', { type: 'button', class: 'btn sm ghost', text: 'Previous', onclick: function () { st.off = Math.max(0, st.off - 25); load(); } }));
        if (st.off + 25 < x.total) pager.appendChild(el('button', { type: 'button', class: 'btn sm ghost', text: 'Next', onclick: function () { st.off += 25; load(); } }));
        done();
      }).catch(function (e) { LAB.fail($('#page'), e); });
    }
    var t; q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { st.q = q.value.trim(); st.off = 0; load(); }, 300); });
    s.addEventListener('change', function () { st.s = s.value; st.off = 0; load(); }); r.addEventListener('change', function () { st.range = r.value; st.off = 0; load(); });
    d.addEventListener('change', function () { st.due = d.checked; st.off = 0; load(); });
    page.appendChild(el('div', 'card', [el('div', 'filters', [fld('Search', q), fld('Status', s), fld('Date', r), el('label', 'row note', [d, ' Only with dues'])]), body, pager]));
    load();
  };

  /* ---------- receipt + whatsapp ---------- */
  var SITE = function () { return new URL('customer.html', location.href).href; };
  LAB.receipt = function (o, pin) {
    var box = $('#rcpt'); box.textContent = '';
    var rows = o.tests.map(function (t) { return el('tr', null, [el('td', { text: t.name }), el('td', { class: 'r', text: inr(t.price) })]); });
    add(box, [el('h1', { text: 'TRINETRI DIAGNOSTICS' }), el('div', { text: 'K C Rani Road, 3rd Cross Rd, Betageri, Karnataka 582101' }), el('div', { text: 'Phone / WhatsApp: +91 91873 15972' }), el('hr'),
      el('table', null, [el('tr', null, [el('td', { text: 'Order ID' }), el('td', { class: 'r', text: o.code })]), el('tr', null, [el('td', { text: 'Date' }), el('td', { class: 'r', text: fdt(o.created) })]),
        el('tr', null, [el('td', { text: 'Patient' }), el('td', { class: 'r', text: o.name + (o.age != null ? ', ' + o.age + (o.sex || '') : '') })]), el('tr', null, [el('td', { text: 'Mobile' }), el('td', { class: 'r', text: o.mobile })]),
        o.ref_doctor ? el('tr', null, [el('td', { text: 'Referred by' }), el('td', { class: 'r', text: o.ref_doctor })]) : null]), el('hr'),
      el('table', null, rows), el('hr'),
      el('table', null, [el('tr', null, [el('td', { text: 'Sub total' }), el('td', { class: 'r', text: inr(o.subtotal) })]), o.discount ? el('tr', null, [el('td', { text: 'Discount' }), el('td', { class: 'r', text: '- ' + inr(o.discount) })]) : null,
        el('tr', null, [el('td', null, el('b', { text: 'Total' })), el('td', { class: 'r' }, el('b', { text: inr(o.amount) }))]), el('tr', null, [el('td', { text: 'Paid' + (o.pay_mode ? ' (' + o.pay_mode + ')' : '') }), el('td', { class: 'r', text: inr(o.paid) })]),
        el('tr', null, [el('td', null, el('b', { text: 'Balance due' })), el('td', { class: 'r' }, el('b', { text: inr(o.due) }))])]), el('hr'),
      pin ? el('div', null, [el('div', { text: 'Report PIN (keep it private):' }), el('div', { class: 'pin', text: pin })]) : el('div', { text: 'Ask the lab for your report PIN.' }),
      el('div', { text: 'View live status and download reports: ' + SITE() }), el('div', { text: 'Login with your mobile number, then add this Order ID and PIN.' }), el('hr'), el('div', { text: 'Thank you. Get well soon.' })]);
    window.print();
  };
  LAB.waLink = function (o, pin) {
    var msg = 'Hello ' + o.name + ', your Trinetri Diagnostics order ' + o.code + ' is registered (total ' + inr(o.amount) + (o.due > 0 ? ', balance due ' + inr(o.due) : ', paid') + ').\nTrack the sample and download your report: ' + SITE() + '\nOrder ID: ' + o.code + (pin ? '\nReport PIN: ' + pin : '') + '\nLogin with this mobile number, then add the Order ID and PIN.';
    return 'https://wa.me/91' + o.mobile + '?text=' + encodeURIComponent(msg);
  };

  /* ---------- order detail ---------- */
  var STEPS = ['booked', 'collected', 'processing', 'completed'];
  LAB.views.order = function (page, code, done) {
    function load() {
      api('GET', '/staff/orders/' + encodeURIComponent(code)).then(function (r) { page.textContent = ''; render(r.order); done(); }).catch(function (e) { LAB.fail($('#page'), e); });
    }
    function render(o) {
      LAB.cur = o;
      var tools = el('div', 'row');
      tools.appendChild(el('button', { type: 'button', class: 'btn sm ghost', text: 'Print receipt', onclick: function () { LAB.receipt(o, null); } }));
      if (can('billing')) tools.appendChild(el('button', { type: 'button', class: 'btn sm ghost', text: 'New PIN + WhatsApp', onclick: function () { api('POST', '/staff/orders/' + encodeURIComponent(o.code) + '/pin').then(function (r) { pinModal(r.order, r.pin); }).catch(function (e) { toast(e.message); }); } }));
      tools.appendChild(el('a', { class: 'btn sm ghost', href: 'https://wa.me/91' + o.mobile, target: '_blank', rel: 'noopener', text: 'WhatsApp patient' }));
      if (can('billing')) tools.appendChild(el('button', { type: 'button', class: 'btn sm ghost', text: 'Edit patient details', onclick: function () { editModal(o); } }));
      page.appendChild(el('div', 'card', [el('div', 'row', [el('h2', { text: o.code, style: 'margin:0' }), badge(o.status), resBadge(o)]),
        el('p', null, [el('b', { text: o.name }), ' · ' + o.mobile + (o.age != null ? ' · ' + o.age + ' yrs' : '') + (o.sex ? ' · ' + ({ M: 'Male', F: 'Female', O: 'Other' }[o.sex]) : '') + (o.ref_doctor ? ' · Ref: ' + o.ref_doctor : '') + ' · ' + (o.kind === 'home' ? 'Home collection' : 'Walk-in')]),
        el('p', { class: 'upd', text: 'Created ' + fdt(o.created) + (o.created_by ? ' by ' + o.created_by : '') + (o.notes ? ' · Note: ' + o.notes : '') }), tools]));

      /* progress */
      var idx = STEPS.indexOf(o.status), trk = el('div', 'trk');
      STEPS.forEach(function (k, i) { var cls = i < idx || (i === idx && o.status === 'completed') ? 'done' : i === idx ? 'now' : 'todo'; trk.appendChild(el('div', 'tstep ' + cls, [el('i', { text: cls === 'done' ? '✓' : String(i + 1) }), el('div', null, [el('b', { text: STLAB[k] }), el('small', { text: o.times && o.times[k] ? fdt(o.times[k]) : '-' })])])); });
      var pc = el('section', 'card', [el('h2', { text: 'Sample progress (customers see this live)' }), trk]);
      if (can('status') && o.status !== 'completed') {
        var r = el('div', 'row'); if (o.status === 'booked') r.appendChild(el('button', { type: 'button', class: 'btn sm', text: 'Mark sample collected', onclick: function () { setStatus('collected'); } }));
        if (o.status !== 'processing') r.appendChild(el('button', { type: 'button', class: 'btn sm', text: 'Mark in progress', onclick: function () { setStatus('processing'); } }));
        r.appendChild(el('span', { class: 'upd', text: 'Completed is set automatically when the report is approved.' })); pc.appendChild(r);
      }
      page.appendChild(pc);
      function setStatus(s) { api('POST', '/staff/orders/' + encodeURIComponent(o.code) + '/status', { status: s }).then(function () { toast('Updated'); LAB.refreshDash(); route(); }).catch(function (e) { toast(e.message); }); }

      /* billing */
      var trs = o.tests.map(function (t) { return el('tr', null, [el('td', { text: t.name }), el('td', 'num', inr(t.price))]); });
      var bc = el('section', 'card', [el('h2', { text: 'Billing' }), el('div', 'tbl-wrap', el('table', 'tbl', el('tbody', null, trs))),
        el('div', 'sum', [el('span', { text: 'Sub total' }), el('b', { text: inr(o.subtotal) }), o.discount ? el('span', { text: 'Discount' }) : null, o.discount ? el('b', { text: '- ' + inr(o.discount) }) : null, el('span', 'gt', 'Total'), el('b', { class: 'gt', text: inr(o.amount) }),
          el('span', { text: 'Paid' + (o.pay_mode ? ' (' + o.pay_mode + ')' : '') }), el('b', { text: inr(o.paid) }), el('span', { text: 'Balance due' }), el('b', { style: o.due > 0 ? 'color:#b3261e' : '', text: inr(o.due) })])]);
      if (can('billing') && o.due > 0) {
        var amt = el('input', { type: 'number', min: 1, max: o.due, value: o.due }), mode = el('select', null, ['cash', 'upi', 'card'].map(function (x) { return el('option', { value: x, text: x.toUpperCase() }); }));
        bc.appendChild(el('div', 'filters', [fld('Amount received', amt), fld('Mode', mode), el('button', { type: 'button', class: 'btn sm', text: 'Collect payment', onclick: function () { api('POST', '/staff/orders/' + encodeURIComponent(o.code) + '/payment', { amount: Number(amt.value), mode: mode.value }).then(function () { toast('Payment recorded'); LAB.refreshDash(); route(); }).catch(function (e) { toast(e.message); }); } })]));
      }
      page.appendChild(bc);

      /* report + results */
      page.appendChild(resultsCard(o));
    }
    function pinModal(o, pin) {
      modal('New report PIN', el('div', null, [el('p', { text: 'Give this PIN to ' + o.name + '. The old PIN stops working. It will not be shown again.' }), el('div', { class: 'pin', text: pin })]), [
        { text: 'Print receipt', cls: 'ghost', keep: true, fn: function () { LAB.receipt(o, pin); } }, { text: 'Send on WhatsApp', keep: true, fn: function () { window.open(LAB.waLink(o, pin), '_blank'); } }, { text: 'Done', cls: 'ghost' }]);
    }
    function editModal(o) {
      var n = el('input', { value: o.name }), mb = el('input', { value: o.mobile, inputmode: 'tel' }), ag = el('input', { type: 'number', min: 0, max: 120, value: o.age == null ? '' : o.age }), sx = el('select', null, [['', 'Sex'], ['M', 'Male'], ['F', 'Female'], ['O', 'Other']].map(function (x) { return el('option', { value: x[0], text: x[1], selected: x[0] === (o.sex || '') }); }));
      var dc = el('input', { value: o.ref_doctor || '' }), kd = el('select', null, [['walk-in', 'Walk-in'], ['home', 'Home collection']].map(function (x) { return el('option', { value: x[0], text: x[1], selected: x[0] === o.kind }); })), nt = el('textarea', { text: o.notes || '' }); nt.value = o.notes || '';
      var ms = el('span', 'msg');
      modal('Edit patient details', el('div', 'form2', [fld('Name', n, 'full'), fld('Mobile', mb), fld('Age', ag), fld('Sex', sx), fld('Collection', kd), fld('Referred by', dc, 'full'), fld('Notes', nt, 'full'), ms]), [{ text: 'Cancel', cls: 'ghost' }, {
        text: 'Save', keep: true, fn: function (close) {
          api('POST', '/staff/orders/' + encodeURIComponent(o.code) + '/update', { name: n.value, mobile: mb.value, age: ag.value, sex: sx.value, ref_doctor: dc.value, kind: kd.value, notes: nt.value }).then(function () { close(); toast('Saved'); route(); }).catch(function (e) { say(ms, e.message, 'err'); });
        }
      }]);
    }
    load();
  };

  /* ---------- results editor ---------- */
  var TPL = null;
  LAB.templates = function () { return TPL ? Promise.resolve(TPL) : api('GET', '/staff/templates').then(function (r) { TPL = r.templates; return TPL; }); };
  LAB.resetTemplates = function () { TPL = null; };
  function findTpl(t) {
    if (!TPL) return null; var up = String(t.name).toUpperCase(), i, hit = null;
    for (i = 0; i < TPL.length; i++) if (t.key && TPL[i].key === t.key) return TPL[i];
    for (i = 0; i < TPL.length && !hit; i++) (TPL[i].match || []).forEach(function (w) { if (!hit && up.indexOf(w) >= 0) hit = TPL[i]; });
    for (i = 0; i < TPL.length && !hit; i++) if (TPL[i].key.indexOf('T:') === 0 && TPL[i].name.length >= 3 && up.indexOf(TPL[i].name.toUpperCase()) >= 0) hit = TPL[i];
    return hit;
  }
  function rowsFrom(tpl, sex) {
    return tpl.params.map(function (p) { var f = sex === 'F' && (p.flo != null || p.fhi != null); return { name: p.name, value: '', unit: p.unit || '', low: f ? p.flo : p.low, high: f ? p.fhi : p.high, ref: p.ref || '', flag: '' }; });
  }
  function calcFlag(r) {
    var v = String(r.value).trim(); if (v === '') return ''; var n = Number(v.replace(/,/g, '').replace(/^[<>]=?\s*/, ''));
    var lo = r.low === '' || r.low == null ? null : Number(r.low), hi = r.high === '' || r.high == null ? null : Number(r.high);
    if (!isNaN(n) && v.replace(/,/g, '').replace(/^[<>]=?\s*/, '') !== '' && (lo !== null || hi !== null)) return lo !== null && n < lo ? 'L' : (hi !== null && n > hi ? 'H' : '');
    return r.flag || '';
  }
  function resultsCard(o) {
    var card = el('section', 'card', [el('h2', { text: 'Results and report' })]);
    var canEnter = can('results'), canApprove = can('approve');
    if (o.res_status === 'approved') {
      card.appendChild(el('div', 'row', [el('span', 'badge2 b-completed', 'Approved by ' + (o.approved_by || '-') + (o.approved_at ? ' on ' + fdt(o.approved_at) : '')),
        el('button', { type: 'button', class: 'btn sm', text: 'View final report (PDF)', onclick: function () { openPdf('/staff/orders/' + encodeURIComponent(o.code) + '/report'); } })]));
      card.appendChild(el('p', { class: 'note', text: 'The customer can see and download this report in their dashboard once they add the order with the PIN.' }));
      if (canApprove) card.appendChild(el('p', null, [el('button', { type: 'button', class: 'btn sm ghost', text: 'Edit results again', onclick: function () { card.textContent = ''; card.appendChild(el('h2', { text: 'Results and report' })); edit(); } }), ' Editing needs approval again before the customer sees the changes.']));
      if (canApprove) card.appendChild(uploadRow(o));
      return card;
    }
    if (!canEnter && !canApprove) { card.appendChild(el('p', { class: 'note', text: o.res_status === 'entered' ? 'Results entered, waiting for approval.' : 'No results yet.' })); return card; }
    function edit() {
      card.appendChild(el('p', { class: 'empty', text: 'Loading templates...' }));
      LAB.templates().then(function () { card.removeChild(card.lastChild); buildEditor(card, o); }).catch(function (e) { card.appendChild(el('p', { class: 'msg err', text: e.message })); });
    }
    edit();
    return card;
  }
  function uploadRow(o) {
    var file = el('input', { type: 'file', accept: 'application/pdf,.pdf', style: 'max-width:280px' }), ms = el('span', 'msg');
    return el('div', 'filters', [el('div', 'f', [el('label', { text: 'Or attach a ready PDF (from your analyser or other software), max 3 MB' }), file]), el('button', { type: 'button', class: 'btn sm ghost', text: 'Upload and publish PDF', onclick: function () {
      var f = file.files[0]; if (!f) return say(ms, 'Choose a PDF file first.', 'err'); if (f.size > 3 * 1024 * 1024) return say(ms, 'The file is over 3 MB.', 'err');
      say(ms, 'Uploading...', 'info'); api('PUT', '/staff/orders/' + encodeURIComponent(o.code) + '/upload?name=' + encodeURIComponent(f.name), undefined, { raw: f }).then(function () { toast('Report published to the customer'); LAB.refreshDash(); route(); }).catch(function (e) { say(ms, e.message, 'err'); });
    } }), ms]);
  }
  function buildEditor(card, o) {
    var secs = (o.results && o.results.length) ? JSON.parse(JSON.stringify(o.results)) : o.tests.map(function (t) { var tp = findTpl(t); return { key: tp ? tp.key : (t.key || ''), title: tp ? tp.name : t.name, rows: tp ? rowsFrom(tp, o.sex) : [], comment: '' }; });
    var wrap = el('div'), ms = el('span', 'msg'), dirty = false;
    function rowEl(sec, r, i) {
      var fl = el('select', { 'aria-label': 'Flag' }, [['', '-'], ['H', 'H'], ['L', 'L'], ['A', 'A']].map(function (x) { return el('option', { value: x[0], text: x[1], selected: x[0] === (r.flag || '') }); }));
      var flv = el('span', { class: 'fl ' + calcFlag(r), text: calcFlag(r) });
      function inp(k, ph, cls, type) { var e = el('input', { value: r[k] == null ? '' : r[k], placeholder: ph, 'aria-label': ph, class: cls || '', type: type || 'text', step: 'any' }); e.addEventListener('input', function () { r[k] = e.value; dirty = true; var c = calcFlag(r); flv.textContent = c; flv.className = 'fl ' + c; if (k !== 'name' && k !== 'unit' && k !== 'ref') fl.value = c; }); return e; }
      fl.addEventListener('change', function () { r.flag = fl.value; dirty = true; var c = calcFlag(r); flv.textContent = c; flv.className = 'fl ' + c; });
      var nm = inp('name', 'Parameter'); var row = el('div', 'rrow', [el('div', 'nm', nm), inp('value', 'Result', 'val'), inp('unit', 'Unit'), inp('low', 'Low', '', 'number'), inp('high', 'High', '', 'number'), inp('ref', 'Reference text'), fl, el('button', { type: 'button', class: 'x', 'aria-label': 'Remove row', text: '×', onclick: function () { sec.rows.splice(i, 1); dirty = true; draw(); } })]);
      return row;
    }
    function draw() {
      wrap.textContent = '';
      secs.forEach(function (sec, si) {
        var title = el('input', { value: sec.title, 'aria-label': 'Section title' }); title.addEventListener('input', function () { sec.title = title.value; dirty = true; });
        var s = el('div', 'sec', [el('div', 'hd', [title, el('button', { type: 'button', class: 'x', title: 'Remove this section', 'aria-label': 'Remove section', text: '×', onclick: function () { secs.splice(si, 1); dirty = true; draw(); } })]),
          el('div', 'rrow h', [el('span', { text: 'Parameter' }), el('span', { text: 'Result' }), el('span', { text: 'Unit' }), el('span', { text: 'Low' }), el('span', { text: 'High' }), el('span', { text: 'Reference text' }), el('span', { text: 'Flag' }), el('span')])]);
        sec.rows.forEach(function (r, i) { s.appendChild(rowEl(sec, r, i)); });
        var cm = el('input', { value: sec.comment || '', placeholder: 'Comment / interpretation (optional)', style: 'margin-top:8px' }); cm.addEventListener('input', function () { sec.comment = cm.value; dirty = true; });
        s.appendChild(el('div', 'row', [el('button', { type: 'button', class: 'btn sm ghost', text: '+ Add row', onclick: function () { sec.rows.push({ name: '', value: '', unit: '', low: '', high: '', ref: '', flag: '' }); dirty = true; draw(); } })])); s.appendChild(cm);
        wrap.appendChild(s);
      });
      var sel = el('select', null, [el('option', { value: '', text: 'Add a panel from template...' })].concat(TPL.map(function (t) { return el('option', { value: t.key, text: t.name }); })));
      sel.addEventListener('change', function () { var t = TPL.filter(function (x) { return x.key === sel.value; })[0]; if (t) { secs.push({ key: t.key, title: t.name, rows: rowsFrom(t, o.sex), comment: '' }); dirty = true; draw(); } });
      wrap.appendChild(el('div', 'filters', [el('div', 'f', sel), el('button', { type: 'button', class: 'btn sm ghost', text: '+ Blank section', onclick: function () { secs.push({ key: '', title: 'Result', rows: [{ name: '', value: '', unit: '', low: '', high: '', ref: '', flag: '' }], comment: '' }); draw(); } })]));
    }
    function save() { return api('POST', '/staff/orders/' + encodeURIComponent(o.code) + '/results', { sections: secs }).then(function (r) { dirty = false; return r.order; }); }
    function btn(text, cls, fn) { return el('button', { type: 'button', class: 'btn sm ' + cls, text: text, onclick: function (e) { var b = e.currentTarget; b.disabled = true; say(ms, 'Please wait...', 'info'); Promise.resolve().then(fn).then(function () { b.disabled = false; }, function (er) { b.disabled = false; say(ms, er.message, 'err'); }); } }); }
    var actions = el('div', 'row', [
      btn('Save draft', '', function () { return save().then(function () { say(ms, 'Saved. Customers see "In progress" until you approve.', 'ok'); LAB.refreshDash(); }); }),
      btn('Preview PDF', 'ghost', function () { return save().then(function () { openPdf('/staff/orders/' + encodeURIComponent(o.code) + '/report?draft=1'); say(ms, 'Draft saved. Preview opened in a new tab.', 'ok'); }); })]);
    if (can('approve')) actions.appendChild(btn('Approve and publish to customer', 'danger', function () {
      return save().then(function () { return api('POST', '/staff/orders/' + encodeURIComponent(o.code) + '/approve'); }).then(function () { toast('Report approved and published'); LAB.refreshDash(); route(); });
    }));
    else actions.appendChild(el('span', { class: 'upd', text: 'A doctor or admin approves the report before customers can see it.' }));
    card.appendChild(el('p', { class: 'note', text: 'Enter the values. Low/High come from the template and drive the H / L flags. Customers cannot see anything until the report is approved.' }));
    draw(); card.appendChild(wrap); card.appendChild(actions); card.appendChild(ms);
    if (can('approve')) card.appendChild(uploadRow(o));
    LAB.onLeave(function () { window.onbeforeunload = null; });
    window.onbeforeunload = function () { return dirty ? 'You have unsaved results.' : undefined; };
  }

  boot();
})();
