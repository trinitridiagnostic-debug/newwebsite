/* Trinetri Diagnostics customer dashboard.
   Live mode talks to the portal server (portal-config.js api). Demo mode uses sample data kept in this browser only. */
(function () {
  'use strict';
  var CFG = window.TRIN_PORTAL || {};
  var BASE = String(CFG.api || '').replace(/\/+$/, '');
  var LIVE = !!BASE;
  var isDemo = false, A = null, TOKEN = '', me = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function say(node, t, c) { node.textContent = t; node.className = 'msg ' + (c || ''); }
  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fdate(ts) { var d = new Date(ts); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }
  function ftime(ts) { var d = new Date(ts), h = d.getHours(), m = ('0' + d.getMinutes()).slice(-2); return (h % 12 || 12) + ':' + m + ' ' + (h < 12 ? 'am' : 'pm'); }
  function fdt(ts) { return fdate(ts) + ', ' + ftime(ts); }
  var toastT = null;
  function toast(m) { var t = $('.toast2') || document.body.appendChild(el('div', 'toast2')); t.setAttribute('role', 'status'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3200); }
  function mob(s) { var d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }

  var STEPS = [{ k: 'booked', l: 'Booked' }, { k: 'collected', l: 'Sample collected' }, { k: 'processing', l: 'In progress' }, { k: 'completed', l: 'Test completed' }];
  var STLAB = { booked: 'Booked', collected: 'Sample collected', processing: 'In progress', completed: 'Completed' };

  /* ======================= live API ======================= */
  function http(method, path, body) {
    var h = {}; if (TOKEN) h.Authorization = 'Bearer ' + TOKEN;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    return fetch(BASE + path, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
        return j;
      });
    }, function () { var e = new Error('Cannot reach the server. Check your internet connection.'); e.net = true; throw e; });
  }
  var live = {
    register: function (b) { return http('POST', '/auth/register', b); },
    login: function (b) { return http('POST', '/auth/login', b); },
    me: function () { return http('GET', '/me'); },
    orders: function () { return http('GET', '/orders').then(function (j) { return j.orders; }); },
    link: function (code, pin) { return http('POST', '/orders/link', { code: code, pin: pin }).then(function (j) { return j.order; }); },
    report: function (code) {
      return fetch(BASE + '/orders/' + encodeURIComponent(code) + '/report', { headers: { Authorization: 'Bearer ' + TOKEN } }).then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || 'Could not load the report.'); });
        return r.blob();
      });
    },
    tickets: function () { return http('GET', '/tickets').then(function (j) { return j.tickets; }); },
    newTicket: function (b) { return http('POST', '/tickets', b).then(function (j) { return j.ticket; }); },
    reply: function (id, message) { return http('POST', '/tickets/' + encodeURIComponent(id) + '/reply', { message: message }).then(function (j) { return j.ticket; }); },
    chat: function (after) { return http('GET', '/chat?after=' + (after || 0)).then(function (j) { return j.messages; }); },
    send: function (body) { return http('POST', '/chat', { body: body }).then(function (j) { return j.messages; }); },
    plans: function () { return http('GET', '/plans').then(function (j) { return j.plans; }); },
    select: function (tier) { return http('POST', '/membership', { tier: tier }).then(function (j) { return j.user; }); }
  };

  /* ======================= demo API (sample data in this browser) ======================= */
  var PLANS = [
    { id: 'bronze', name: 'Bronze', price: 499, period: 'year', perks: ['5% off every test', 'Free home collection', 'Reports on WhatsApp'] },
    { id: 'silver', name: 'Silver', price: 999, period: 'year', perks: ['10% off every test', 'Free home collection', 'Priority slots', 'Reports on WhatsApp'] },
    { id: 'gold', name: 'Gold', price: 1999, period: 'year', perks: ['15% off every test', 'Free home collection', 'Priority slots', '1 free basic health package a year', 'Family members can use it (up to 3)'] },
    { id: 'platinum', name: 'Platinum', price: 3999, period: 'year', perks: ['20% off every test', 'Free home collection', 'Fastest priority slots', '2 free health packages a year', 'Family members can use it (up to 5)', 'Dedicated support contact'] }
  ];
  function makePdf(lines) {
    function esc(s) { return String(s).replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&'); }
    var content = 'BT /F1 12 Tf 50 790 Td 17 TL\n' + lines.map(function (l) { return '(' + esc(l) + ') Tj T*'; }).join('\n') + '\nET';
    var o = [null,
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    var out = '%PDF-1.4\n', off = [];
    for (var i = 1; i < o.length; i++) { off[i] = out.length; out += i + ' 0 obj\n' + o[i] + '\nendobj\n'; }
    var x = out.length; out += 'xref\n0 ' + o.length + '\n0000000000 65535 f \n';
    for (i = 1; i < o.length; i++) out += ('0000000000' + off[i]).slice(-10) + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + o.length + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF';
    return new Blob([out], { type: 'application/pdf' });
  }
  var DKEY = 'trin.portal.demo.v2';
  function dload() { try { var s = JSON.parse(localStorage.getItem(DKEY)); if (s && s.v === 2) return s; } catch (e) { } return null; }
  function dsave(s) { try { localStorage.setItem(DKEY, JSON.stringify(s)); } catch (e) { } }
  function dstate() {
    var s = dload(); if (s) return s;
    var n = Date.now(), H = 36e5, D = 24 * H;
    s = { v: 2, user: { id: 'demo', name: 'Demo Customer', mobile: '9000000000', membership: null }, t0: n,
      orders: [
        { id: 'd1', code: 'TD-DEMO-0001', tests: [{ name: 'COMPLETE BLOOD COUNT (CBC)', price: 300 }, { name: 'LIPID PROFILE', price: 250 }], amount: 550, status: 'completed', created: n - 20 * D, times: { booked: n - 20 * D, collected: n - 20 * D + 2 * H, processing: n - 20 * D + 4 * H, completed: n - 20 * D + 9 * H }, hasReport: true },
        { id: 'd2', code: 'TD-DEMO-0002', tests: [{ name: 'THYROID PROFILE (T3, T4, TSH)', price: 450 }, { name: 'HBA1C', price: 280 }], amount: 730, status: 'processing', created: n - 5 * H, times: { booked: n - 5 * H, collected: n - 3 * H, processing: n - 1 * H }, hasReport: false },
        { id: 'd3', code: 'TD-DEMO-0003', tests: [{ name: '25-OH VITAMIN D (TOTAL)', price: 1300 }], amount: 1300, status: 'collected', created: n - 10 * 6e4, times: { booked: n - 30 * 6e4, collected: n - 10 * 6e4 }, hasReport: false, sim: true }
      ],
      unlinked: [{ id: 'd4', code: 'TD-DEMO-0004', pin: '246810', tests: [{ name: 'FASTING BLOOD SUGAR', price: 80 }, { name: 'URINE ROUTINE', price: 100 }], amount: 180, status: 'completed', created: n - 3 * D, times: { booked: n - 3 * D, collected: n - 3 * D + H, processing: n - 3 * D + 3 * H, completed: n - 3 * D + 6 * H }, hasReport: true }],
      tickets: [], chat: [], pw: null };
    dsave(s); return s;
  }
  function dsim(s) {   // makes order 3 move through the stages so live tracking can be seen
    var o = s.orders.filter(function (x) { return x.sim; })[0]; if (!o) return;
    var e = Date.now() - s.t0, n = Date.now();
    if (e > 90000 && o.status !== 'completed') { o.status = 'completed'; o.times.processing = o.times.processing || n - 30000; o.times.completed = n; o.hasReport = true; dsave(s); }
    else if (e > 40000 && o.status === 'collected') { o.status = 'processing'; o.times.processing = n; dsave(s); }
  }
  function ok(v) { return Promise.resolve(JSON.parse(JSON.stringify(v === undefined ? null : v))); }
  var demo = {
    orders: function () { var s = dstate(); dsim(s); return ok(s.orders.slice().sort(function (a, b) { return b.created - a.created; })); },
    link: function (code, pin) {
      var s = dstate(), i = -1; s.unlinked.forEach(function (u, k) { if (u.code === String(code).toUpperCase() && u.pin === pin) i = k; });
      if (i < 0) return Promise.reject(new Error('We could not match that Order ID and PIN. In the demo, try TD-DEMO-0004 with PIN 246810.'));
      var o = s.unlinked.splice(i, 1)[0]; delete o.pin; s.orders.push(o); dsave(s); return ok(o);
    },
    report: function (code) {
      var s = dstate(), o = s.orders.filter(function (x) { return x.code === code; })[0];
      if (!o || !o.hasReport) return Promise.reject(new Error('The report is not ready yet.'));
      var L = ['TRINETRI DIAGNOSTICS', 'K C Rani Road, 3rd Cross Rd, Betageri, Karnataka 582101', '', 'DEMO REPORT - SAMPLE DATA ONLY, NOT A REAL RESULT', '', 'Order ID : ' + o.code, 'Patient  : ' + s.user.name, 'Date     : ' + fdate(o.created), '', 'Test                              Result        Reference'];
      o.tests.forEach(function (t) { L.push(t.name.slice(0, 32) + '   (sample value)   (sample range)'); });
      L.push('', 'This file is generated in your browser for the demo.', 'A real report is signed by the consultant pathologist.');
      return Promise.resolve(makePdf(L));
    },
    tickets: function () { return ok(dstate().tickets.slice().sort(function (a, b) { return b.updated - a.updated; })); },
    newTicket: function (b) {
      var s = dstate(), t = { id: 'TK' + (1000 + s.tickets.length + 1), subject: b.subject, category: b.category, status: 'open', created: Date.now(), updated: Date.now(), msgs: [{ from: 'customer', body: b.message, ts: Date.now() }] };
      s.tickets.push(t); dsave(s); return ok(t);
    },
    reply: function (id, message) {
      var s = dstate(), t = s.tickets.filter(function (x) { return x.id === id; })[0]; if (!t) return Promise.reject(new Error('Ticket not found.'));
      t.msgs.push({ from: 'customer', body: message, ts: Date.now() }); t.status = 'open'; t.updated = Date.now(); dsave(s); return ok(t);
    },
    chat: function (after) { var s = dstate(), n = Date.now(); s.chat.forEach(function (m) { if (m.pending && m.pending <= n) { delete m.pending; m.ts = n; } }); dsave(s); return ok(s.chat.filter(function (m) { return !m.pending && m.ts > (after || 0); })); },
    send: function (body) {
      var s = dstate(), n = Date.now(), mine = { id: 'm' + n, from: 'customer', body: body, ts: n, label: '' };
      s.chat.push(mine);
      s.chat.push({ id: 'a' + n, from: 'staff', body: 'Demo reply: in the real portal our team answers here during lab hours (Mon to Sat 7 am to 10 pm, Sun 7 am to 2 pm).', ts: n + 2500, label: 'Trinetri Support', pending: n + 2500 });
      dsave(s); return ok([mine]);
    },
    plans: function () { return ok(PLANS); },
    select: function (tier) { var s = dstate(); s.user.membership = { tier: tier, status: 'requested' }; dsave(s); return ok(s.user); }
  };

  /* ======================= auth screens ======================= */
  var authBox = $('#auth'), appBox = $('#app');
  function sw(t) {
    $$('#atabs button').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-t') === t ? 'true' : 'false'); });
    $('#fl').hidden = t !== 'login'; $('#fr').hidden = t !== 'reg';
  }
  $$('#atabs button').forEach(function (b) { b.addEventListener('click', function () { sw(b.getAttribute('data-t')); }); });
  if (!LIVE) { $('#livenote').hidden = false; $('#lgo').disabled = true; $('#rgo').disabled = true; }
  function store(tok, keep) { try { (keep ? localStorage : sessionStorage).setItem('trin.portal.tok', tok); (keep ? sessionStorage : localStorage).removeItem('trin.portal.tok'); } catch (e) { } }
  function clearTok() { try { sessionStorage.removeItem('trin.portal.tok'); localStorage.removeItem('trin.portal.tok'); } catch (e) { } }
  function enter(user, demoMode) {
    me = user; isDemo = !!demoMode; A = demoMode ? demo : live;
    authBox.hidden = true; appBox.hidden = false; $('#demobar').hidden = !isDemo;
    $('#wn').textContent = me.name; $('#wm').textContent = isDemo ? 'Demo account' : '+91 ' + me.mobile;
    buildMenu(); var h = (location.hash || '').replace('#', ''); show(VIEWS[h] ? h : 'home');
  }
  $('#fl').addEventListener('submit', function (e) {
    e.preventDefault(); var m = $('#lmsg'), mo = mob($('#lm').value), pw = $('#lpw').value;
    if (!mo) { say(m, 'Enter your 10-digit mobile number.', 'err'); return; } if (!pw) { say(m, 'Enter your password.', 'err'); return; }
    var b = $('#lgo'); b.disabled = true; say(m, 'Logging in...', 'info');
    live.login({ mobile: mo, password: pw }).then(function (j) { TOKEN = j.token; store(TOKEN, $('#keep').checked); $('#lpw').value = ''; say(m, '', ''); enter(j.user, false); })
      .catch(function (err) { say(m, err.message, 'err'); }).then(function () { b.disabled = !LIVE; });
  });
  $('#fr').addEventListener('submit', function (e) {
    e.preventDefault(); var m = $('#rmsg'), n = $('#rn').value.trim(), mo = mob($('#rm').value), p = $('#rp').value;
    if (n.length < 2) { say(m, 'Enter your name.', 'err'); return; } if (!/^[6-9]\d{9}$/.test(mo)) { say(m, 'Enter a valid 10-digit mobile number.', 'err'); return; }
    if (p.length < 8) { say(m, 'Use a password of at least 8 characters.', 'err'); return; } if (p !== $('#rp2').value) { say(m, 'The two passwords do not match.', 'err'); return; }
    var b = $('#rgo'); b.disabled = true; say(m, 'Creating your account...', 'info');
    live.register({ name: n, mobile: mo, password: p }).then(function (j) { TOKEN = j.token; store(TOKEN, false); $('#rp').value = ''; $('#rp2').value = ''; say(m, '', ''); enter(j.user, false); })
      .catch(function (err) { say(m, err.message, 'err'); }).then(function () { b.disabled = !LIVE; });
  });
  $('#demobtn').addEventListener('click', function () { var s = dstate(); enter(s.user, true); });
  $('#out').addEventListener('click', function () {
    clearTok(); TOKEN = ''; me = null; stopTimers(); sw('login'); appBox.hidden = true; authBox.hidden = false; $('#page').textContent = ''; try { history.replaceState(null, '', location.pathname); } catch (e) { }
  });

  /* ======================= shell, drawer, navigation ======================= */
  var ICON = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    orders: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
    track: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    reports: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    tickets: '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 6v12" stroke-dasharray="2 3"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    plans: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.2 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'
  };
  var VIEWS = { home: 'Overview', orders: 'My tests', track: 'Live tracking', reports: 'Reports', tickets: 'Support tickets', chat: 'Live chat', plans: 'Membership' };
  var cur = 'home', timers = [], cache = { orders: [], tickets: [] };
  function buildMenu() {
    var m = $('#menu'); m.textContent = '';
    Object.keys(VIEWS).forEach(function (k) {
      var b = el('button', 'nv'); b.type = 'button'; b.setAttribute('data-view', k);
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON[k] + '</svg>';
      b.appendChild(el('span', '', VIEWS[k])); b.appendChild(el('span', 'dot')); b.lastChild.hidden = true;
      b.addEventListener('click', function () { show(k); }); m.appendChild(b);
    });
  }
  function badges() {
    var act = cache.orders.filter(function (o) { return o.status !== 'completed'; }).length, rep = cache.orders.filter(function (o) { return o.hasReport; }).length;
    [['track', act], ['reports', rep]].forEach(function (p) { var d = $('.nv[data-view=' + p[0] + '] .dot'); if (d) { d.textContent = p[1]; d.hidden = !p[1]; } });
  }
  function openDrawer() { $('#side').classList.add('open'); $('#scrim').hidden = false; $('#burger').setAttribute('aria-expanded', 'true'); }
  function closeDrawer() { $('#side').classList.remove('open'); $('#scrim').hidden = true; $('#burger').setAttribute('aria-expanded', 'false'); }
  $('#burger').addEventListener('click', function () { $('#side').classList.contains('open') ? closeDrawer() : openDrawer(); });
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  function stopTimers() { timers.forEach(clearInterval); timers = []; }
  function every(ms, fn) { timers.push(setInterval(function () { if (!document.hidden) fn(); }, ms)); }
  function show(v) {
    if (!VIEWS[v]) v = 'home'; cur = v; stopTimers();
    $$('.menu .nv').forEach(function (b) { var on = b.getAttribute('data-view') === v; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('#vt').textContent = VIEWS[v]; closeDrawer();
    try { history.replaceState(null, '', '#' + v); } catch (e) { }
    var page = $('#page'); page.textContent = ''; window.scrollTo(0, 0);
    RENDER[v](page);
  }
  function fail(node, err) {
    if (err && err.status === 401 && !isDemo) { clearTok(); TOKEN = ''; stopTimers(); appBox.hidden = true; authBox.hidden = false; say($('#lmsg'), 'Your session ended. Please log in again.', 'err'); return; }
    say(node, err && err.message || 'Something went wrong.', 'err');
  }
  function loadOrders() { return A.orders().then(function (o) { cache.orders = o; badges(); return o; }); }

  /* ======================= shared pieces ======================= */
  function statusBadge(st) { return el('span', 'badge2 b-' + st, STLAB[st] || st); }
  function stepper(o) {
    var idx = STEPS.map(function (s) { return s.k; }).indexOf(o.status), box = el('div', 'trk');
    STEPS.forEach(function (s, i) {
      var cls = i < idx || (i === idx && o.status === 'completed') ? 'done' : i === idx ? 'now' : 'todo';
      var d = el('div', 'tstep ' + cls), ic = el('i', '', cls === 'done' ? '✓' : String(i + 1)), tx = el('div');
      tx.appendChild(el('b', '', s.l)); tx.appendChild(el('small', '', o.times && o.times[s.k] ? fdt(o.times[s.k]) : (cls === 'now' ? 'Happening now' : 'Waiting')));
      d.appendChild(ic); d.appendChild(tx); box.appendChild(d);
    });
    return box;
  }
  function orderHead(o) {
    var hd = el('div', 'hd'), l = el('div'), r = el('div');
    l.appendChild(el('div', 'code', o.code)); l.appendChild(el('div', 'upd', 'Booked ' + fdt(o.created)));
    r.appendChild(statusBadge(o.status)); hd.appendChild(l); hd.appendChild(r); return hd;
  }
  function chips(o) { var c = el('div', 'chips'); o.tests.forEach(function (t) { c.appendChild(el('span', 'chip', t.name)); }); return c; }
  function openReport(o, download, msgNode) {
    var w = null; if (!download) { try { w = window.open('', '_blank'); } catch (e) { } }
    A.report(o.code).then(function (blob) {
      var url = URL.createObjectURL(blob);
      if (download || !w) { var a = document.createElement('a'); a.href = url; a.download = o.code + '-report.pdf'; document.body.appendChild(a); a.click(); a.remove(); if (w) w.close(); }
      else { w.location = url; }
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }).catch(function (err) { if (w) w.close(); fail(msgNode, err); });
  }
  function linkCard(after) {
    var c = el('section', 'card'), f = el('form', 'form2'), msg = el('span', 'msg');
    f.noValidate = true; c.appendChild(el('h2', '', 'Add a test order'));
    c.appendChild(el('p', 'note', 'Enter the Order ID and the 6-digit report PIN printed on your receipt or sent on WhatsApp. This keeps your reports private.'));
    var a = el('div', 'f'), al = el('label', '', 'Order ID'), ai = el('input'); ai.placeholder = 'TD-250101-AB12'; ai.autocapitalize = 'characters'; ai.autocomplete = 'off'; al.htmlFor = ai.id = 'lk-c'; a.appendChild(al); a.appendChild(ai);
    var b = el('div', 'f'), bl = el('label', '', 'Report PIN'), bi = el('input'); bi.inputMode = 'numeric'; bi.maxLength = 6; bi.placeholder = '6 digits'; bi.autocomplete = 'off'; bl.htmlFor = bi.id = 'lk-p'; b.appendChild(bl); b.appendChild(bi);
    var rw = el('div', 'row full'), bt = el('button', 'btn sm', 'Add order'); bt.type = 'submit'; rw.appendChild(bt); rw.appendChild(msg);
    f.appendChild(a); f.appendChild(b); f.appendChild(rw); c.appendChild(f);
    if (isDemo) c.appendChild(el('p', 'note', 'Demo: use Order ID TD-DEMO-0004 and PIN 246810.'));
    f.addEventListener('submit', function (e) {
      e.preventDefault(); var code = ai.value.trim().toUpperCase(), pin = bi.value.replace(/\D/g, '');
      if (!code || pin.length !== 6) { say(msg, 'Enter the Order ID and the 6-digit PIN.', 'err'); return; }
      bt.disabled = true; say(msg, 'Checking...', 'info');
      A.link(code, pin).then(function () { toast('Order ' + code + ' added'); after(); }).catch(function (err) { fail(msg, err); bt.disabled = false; });
    });
    return c;
  }
  function empty(t) { return el('div', 'empty', t); }

  /* ======================= views ======================= */
  var RENDER = {};

  RENDER.home = function (p) {
    var hi = el('section', 'card'); hi.appendChild(el('h2', '', 'Hello, ' + me.name.split(' ')[0])); hi.appendChild(el('p', 'note', 'Track your samples, download reports, get help and manage your membership here.')); p.appendChild(hi);
    var kp = el('div', 'grid4'); p.appendChild(kp); var holder = el('div'); p.appendChild(holder);
    function paint() {
      var o = cache.orders, act = o.filter(function (x) { return x.status !== 'completed'; }), rep = o.filter(function (x) { return x.hasReport; });
      kp.textContent = '';
      [['track', act.length, 'Tests in progress'], ['reports', rep.length, 'Reports ready'], ['orders', o.length, 'Total tests ordered'], ['plans', me.membership ? (PLANS.filter(function (x) { return x.id === me.membership.tier; })[0] || {}).name || '-' : 'None', 'Membership' + (me.membership ? ' (' + me.membership.status + ')' : '')]].forEach(function (k) {
        var b = el('button', 'kpi'); b.type = 'button'; b.appendChild(el('b', '', String(k[1]))); b.appendChild(el('span', '', k[2])); b.addEventListener('click', function () { show(k[0]); }); kp.appendChild(b);
      });
      holder.textContent = '';
      if (act.length) { var c = el('section', 'card'); c.appendChild(el('h2', '', 'Latest test in progress')); var x = act[0]; c.appendChild(orderHead(x)); c.appendChild(chips(x)); c.appendChild(stepper(x)); holder.appendChild(c); }
      holder.appendChild(linkCard(function () { loadOrders().then(paint); }));
    }
    loadOrders().then(paint).catch(function (err) { fail(holder, err); });
    every(15000, function () { loadOrders().then(paint).catch(function () { }); });
  };

  RENDER.orders = function (p) {
    var top = el('section', 'card'); top.appendChild(el('h2', '', 'Test history')); var f = el('div', 'row');
    var q = el('input'); q.placeholder = 'Search by test name or Order ID'; q.setAttribute('aria-label', 'Search tests'); q.style.flex = '1 1 220px';
    var s = el('select'); s.setAttribute('aria-label', 'Filter by status'); [['', 'All statuses']].concat(STEPS.map(function (x) { return [x.k, x.l]; })).forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; s.appendChild(op); });
    f.appendChild(q); f.appendChild(s); top.appendChild(f); var list = el('div'); top.appendChild(list); p.appendChild(top); p.appendChild(linkCard(function () { show('orders'); }));
    function paint() {
      var qq = q.value.trim().toLowerCase(), st = s.value, rows = cache.orders.filter(function (o) { return (!st || o.status === st) && (!qq || o.code.toLowerCase().indexOf(qq) > -1 || o.tests.some(function (t) { return t.name.toLowerCase().indexOf(qq) > -1; })); });
      list.textContent = ''; if (!rows.length) { list.appendChild(empty(cache.orders.length ? 'No tests match your search.' : 'No tests yet. Add an order below using the Order ID and PIN from your receipt.')); return; }
      var t = el('table', 'tbl'), th = el('thead'), tr = el('tr'); ['Date', 'Order ID', 'Tests', 'Amount', 'Status', ''].forEach(function (h, i) { var c = el('th', i === 3 ? 'hide-s' : '', h); tr.appendChild(c); }); th.appendChild(tr); t.appendChild(th);
      var tb = el('tbody');
      rows.forEach(function (o) {
        var r = el('tr'); r.appendChild(el('td', '', fdate(o.created))); r.appendChild(el('td', '', o.code));
        var td = el('td'); td.textContent = o.tests.map(function (x) { return x.name; }).join(', '); r.appendChild(td);
        r.appendChild(el('td', 'hide-s', o.amount ? inr(o.amount) : '-'));
        var sd = el('td'); sd.appendChild(statusBadge(o.status)); r.appendChild(sd);
        var ac = el('td'); var b = el('button', 'btn sm ghost', o.hasReport ? 'Report' : 'Track'); b.type = 'button'; b.addEventListener('click', function () { show(o.hasReport ? 'reports' : 'track'); }); ac.appendChild(b); r.appendChild(ac);
        tb.appendChild(r);
      });
      t.appendChild(tb); list.appendChild(t);
    }
    q.addEventListener('input', paint); s.addEventListener('change', paint);
    loadOrders().then(paint).catch(function (err) { fail(list, err); });
  };

  RENDER.track = function (p) {
    var hd = el('section', 'card'); hd.appendChild(el('h2', '', 'Live tracking'));
    var row = el('div', 'row'), upd = el('span', 'upd'), rb = el('button', 'btn sm ghost', 'Refresh'); rb.type = 'button'; row.appendChild(upd); row.appendChild(rb);
    hd.appendChild(el('p', 'note', 'See where each sample is right now. This page updates by itself.')); hd.appendChild(row); p.appendChild(hd);
    var box = el('div'); p.appendChild(box);
    function paint() {
      var act = cache.orders.slice().sort(function (a, b) { return (a.status === 'completed') - (b.status === 'completed') || b.created - a.created; });
      box.textContent = ''; if (!act.length) { var c = el('section', 'card'); c.appendChild(empty('No tests to track yet. Add an order from the Overview page.')); box.appendChild(c); }
      act.slice(0, 8).forEach(function (o) {
        var c = el('div', 'ord'); c.appendChild(orderHead(o)); c.appendChild(chips(o)); c.appendChild(stepper(o));
        if (o.hasReport) { var r = el('div', 'row'); var v = el('button', 'btn sm', 'View report'); v.type = 'button'; v.addEventListener('click', function () { show('reports'); }); r.appendChild(v); c.appendChild(r); }
        box.appendChild(c);
      });
      upd.textContent = 'Last updated ' + ftime(Date.now());
    }
    function go() { return loadOrders().then(paint).catch(function (err) { fail(upd, err); }); }
    rb.addEventListener('click', go); go(); every(8000, go);
  };

  RENDER.reports = function (p) {
    var hd = el('section', 'card'); hd.appendChild(el('h2', '', 'Test reports')); hd.appendChild(el('p', 'note', 'Open a report to read it here, or download it as a PDF.')); var msg = el('span', 'msg'); hd.appendChild(msg); p.appendChild(hd);
    var box = el('div'); p.appendChild(box);
    function paint() {
      box.textContent = ''; var done = cache.orders.filter(function (o) { return o.status === 'completed'; });
      if (!done.length) { var c = el('section', 'card'); c.appendChild(empty('No completed tests yet. Your reports appear here as soon as they are ready.')); box.appendChild(c); return; }
      done.forEach(function (o) {
        var c = el('div', 'ord'); c.appendChild(orderHead(o)); c.appendChild(chips(o)); var r = el('div', 'row');
        if (o.hasReport) {
          var v = el('button', 'btn sm', 'View report'); v.type = 'button'; v.addEventListener('click', function () { openReport(o, false, msg); });
          var d = el('button', 'btn sm ghost', 'Download PDF'); d.type = 'button'; d.addEventListener('click', function () { openReport(o, true, msg); });
          r.appendChild(v); r.appendChild(d); if (o.times && o.times.completed) r.appendChild(el('span', 'upd', 'Completed ' + fdt(o.times.completed)));
        } else r.appendChild(el('span', 'upd', 'Your test is complete. The signed report is being finalised and will appear here.'));
        c.appendChild(r); box.appendChild(c);
      });
    }
    loadOrders().then(paint).catch(function (err) { fail(msg, err); }); every(20000, function () { loadOrders().then(paint).catch(function () { }); });
  };

  RENDER.tickets = function (p) {
    var nf = el('section', 'card'); nf.appendChild(el('h2', '', 'Submit a ticket')); var f = el('form', 'form2'); f.noValidate = true;
    var c1 = el('div', 'f'), l1 = el('label', '', 'Category'), s1 = el('select'); ['Report query', 'Payment or billing', 'Home collection', 'Membership', 'Other'].forEach(function (x) { s1.appendChild(el('option', '', x)); }); l1.htmlFor = s1.id = 'tk-c'; c1.appendChild(l1); c1.appendChild(s1);
    var c2 = el('div', 'f'), l2 = el('label', '', 'Subject'), i2 = el('input'); i2.maxLength = 100; l2.htmlFor = i2.id = 'tk-s'; c2.appendChild(l2); c2.appendChild(i2);
    var c3 = el('div', 'f full'), l3 = el('label', '', 'Describe the problem'), t3 = el('textarea'); t3.maxLength = 2000; l3.htmlFor = t3.id = 'tk-m'; c3.appendChild(l3); c3.appendChild(t3);
    var rw = el('div', 'row full'), bt = el('button', 'btn sm', 'Submit ticket'), msg = el('span', 'msg'); bt.type = 'submit'; rw.appendChild(bt); rw.appendChild(msg);
    f.appendChild(c1); f.appendChild(c2); f.appendChild(c3); f.appendChild(rw); nf.appendChild(f); p.appendChild(nf);
    var box = el('div'); p.appendChild(box);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); if (i2.value.trim().length < 3) { say(msg, 'Enter a subject.', 'err'); return; } if (t3.value.trim().length < 5) { say(msg, 'Describe the problem in a few words.', 'err'); return; }
      bt.disabled = true; say(msg, 'Submitting...', 'info');
      A.newTicket({ category: s1.value, subject: i2.value.trim(), message: t3.value.trim() }).then(function (t) { i2.value = ''; t3.value = ''; say(msg, 'Ticket ' + t.id + ' submitted. We will reply here.', 'ok'); return load(); }).catch(function (err) { fail(msg, err); }).then(function () { bt.disabled = false; });
    });
    function paint() {
      box.textContent = ''; var h = el('section', 'card'); h.appendChild(el('h2', '', 'Your tickets')); box.appendChild(h);
      if (!cache.tickets.length) { h.appendChild(empty('No tickets yet.')); return; }
      cache.tickets.forEach(function (t) {
        var d = el('details', 'ord'), sm = el('summary'); sm.style.cssText = 'cursor:pointer;display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap';
        var a = el('span'); a.appendChild(el('b', '', t.subject)); a.appendChild(el('span', 'upd', '  ' + t.id + ' · ' + t.category + ' · ' + fdt(t.updated))); sm.appendChild(a); sm.appendChild(el('span', 'badge2 b-' + t.status, t.status.charAt(0).toUpperCase() + t.status.slice(1))); d.appendChild(sm);
        var th = el('div', 'thread'); t.msgs.forEach(function (m) { var b = el('div', 'bub ' + (m.from === 'customer' ? 'me' : 'them'), m.body); b.appendChild(el('small', '', (m.from === 'customer' ? 'You' : 'Trinetri Support') + ' · ' + fdt(m.ts))); th.appendChild(b); }); d.appendChild(th);
        if (t.status !== 'closed') {
          var rf = el('form'); rf.style.cssText = 'display:flex;gap:8px;padding:0'; rf.noValidate = true; var ri = el('input'); ri.placeholder = 'Write a reply'; ri.setAttribute('aria-label', 'Reply to ' + t.id); var rb = el('button', 'btn sm', 'Send'); rb.type = 'submit'; rf.appendChild(ri); rf.appendChild(rb); d.appendChild(rf);
          rf.addEventListener('submit', function (e) { e.preventDefault(); if (ri.value.trim().length < 2) return; rb.disabled = true; A.reply(t.id, ri.value.trim()).then(function () { return load(); }).catch(function (err) { fail(msg, err); rb.disabled = false; }); });
        }
        if (cache.openId === t.id) d.open = true; d.addEventListener('toggle', function () { if (d.open) cache.openId = t.id; });
        h.appendChild(d);
      });
    }
    function load() { return A.tickets().then(function (t) { cache.tickets = t; paint(); }).catch(function (err) { fail(msg, err); }); }
    load(); every(30000, function () { if (!document.activeElement || document.activeElement.tagName !== 'INPUT') load(); });
  };

  RENDER.chat = function (p) {
    var c = el('section', 'card chat'); c.appendChild(el('h2', '', 'Live chat with Trinetri Support'));
    c.appendChild(el('p', 'note', 'Our team replies here during lab hours (Mon to Sat 7 am to 10 pm, Sun 7 am to 2 pm). For urgent help call +91 91873 15972.'));
    var th = el('div', 'thread'); th.setAttribute('aria-live', 'polite'); c.appendChild(th); var msg = el('span', 'msg'); c.appendChild(msg);
    var f = el('form'); f.noValidate = true; var i = el('input'); i.maxLength = 500; i.placeholder = 'Type your message'; i.setAttribute('aria-label', 'Message'); var b = el('button', 'btn sm', 'Send'); b.type = 'submit'; f.appendChild(i); f.appendChild(b); c.appendChild(f); p.appendChild(c);
    var seen = {}, last = 0;
    function add(m) {
      if (seen[m.id]) return; seen[m.id] = 1; last = Math.max(last, m.ts);
      var d = el('div', 'bub ' + (m.from === 'customer' ? 'me' : 'them'), m.body); d.appendChild(el('small', '', (m.from === 'customer' ? 'You' : (m.label || 'Trinetri Support')) + ' · ' + ftime(m.ts))); th.appendChild(d); th.scrollTop = th.scrollHeight;
    }
    function poll() { return A.chat(last).then(function (ms) { ms.sort(function (a, b) { return a.ts - b.ts; }).forEach(add); if (!th.children.length) th.appendChild(el('div', 'empty', 'Say hello. We are here to help.')); else { var e = $('.empty', th); if (e && th.children.length > 1) e.remove(); } }).catch(function (err) { if (err.status === 401) fail(msg, err); }); }
    f.addEventListener('submit', function (e) {
      e.preventDefault(); var t = i.value.trim(); if (!t) return; b.disabled = true; i.value = '';
      A.send(t).then(function (ms) { var e2 = $('.empty', th); if (e2) e2.remove(); ms.forEach(add); return poll(); }).catch(function (err) { i.value = t; fail(msg, err); }).then(function () { b.disabled = false; i.focus(); });
    });
    poll(); every(3000, poll);
  };

  RENDER.plans = function (p) {
    var hd = el('section', 'card'); hd.appendChild(el('h2', '', 'Membership plans'));
    hd.appendChild(el('p', 'note', 'Sample plan details for preview. Final prices and benefits will be confirmed by the lab. Choosing a plan sends a request: it becomes active after the lab confirms your payment.'));
    var msg = el('span', 'msg'); hd.appendChild(msg); p.appendChild(hd); var grid = el('div', 'plans'); p.appendChild(grid);
    function paint(plans) {
      grid.textContent = ''; var mb = me.membership;
      plans.forEach(function (pl) {
        var c = el('div', 'plan t-' + pl.id + (mb && mb.tier === pl.id ? ' cur' : '')); c.appendChild(el('h3', '', pl.name));
        var pr = el('div', 'pr', inr(pl.price)); pr.appendChild(el('small', '', ' / ' + pl.period)); c.appendChild(pr);
        var ul = el('ul'); pl.perks.forEach(function (x) { ul.appendChild(el('li', '', x)); }); c.appendChild(ul);
        if (mb && mb.tier === pl.id) { c.appendChild(el('span', 'badge2 b-' + (mb.status === 'active' ? 'active' : 'requested'), mb.status === 'active' ? 'Your current plan' : 'Requested, awaiting lab confirmation')); }
        else { var b = el('button', 'btn sm', 'Choose ' + pl.name); b.type = 'button'; b.addEventListener('click', function () {
          if (!confirm('Request the ' + pl.name + ' plan (' + inr(pl.price) + ' per ' + pl.period + ')? The lab will confirm it after payment.')) return;
          b.disabled = true; A.select(pl.id).then(function (u) { me = u; toast(pl.name + ' plan requested'); say(msg, 'Request sent. The lab will contact you to confirm and collect payment.', 'ok'); paint(plans); }).catch(function (err) { fail(msg, err); b.disabled = false; });
        }); c.appendChild(b); }
        grid.appendChild(c);
      });
    }
    A.plans().then(paint).catch(function (err) { fail(msg, err); });
  };

  /* ======================= start ======================= */
  document.addEventListener('visibilitychange', function () { });
  var saved = ''; try { saved = sessionStorage.getItem('trin.portal.tok') || localStorage.getItem('trin.portal.tok') || ''; } catch (e) { }
  if (LIVE && saved) { TOKEN = saved; live.me().then(function (j) { enter(j.user, false); }).catch(function () { clearTok(); TOKEN = ''; }); }
})();
