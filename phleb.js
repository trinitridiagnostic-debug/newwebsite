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
    sched: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18M8 14h3M13 14h3M8 18h3"/>', leave: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4"/>', orders: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
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
    tile('sched', 'Schedule', 'sched', '#schedule'); tile('leave', 'Leave', 'leave', '#leave'); tile('pw', 'Password', 'pw', '#password'); tile('out', 'Logout', 'out', null, function () { logout(); });
    var bar = el('div', 'leavebar', ['You are on leave today. You cannot pick new visits.']); bar.hidden = true; page.appendChild(bar); var sb = el('a', { class: 'schedbar', href: '#schedule' }); sb.hidden = true; page.appendChild(sb); page.appendChild(grid);
    function load() { api('GET', '/staff/phleb/home').then(function (d) { [['orders', d.orders], ['pool', d.pool]].forEach(function (x) { badge[x[0]].textContent = x[1]; badge[x[0]].hidden = !x[1]; }); bar.hidden = !d.on_leave; sb.hidden = !d.sched_unset; sb.textContent = 'Tell us your availability for ' + d.sched_unset + ' more day' + (d.sched_unset > 1 ? 's' : '') + '. Tap to set your schedule.'; }).catch(function (e) { toast(e.message); }); }
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
  V.served = listScreen('Served', 'served', 'No collected samples yet.', function (o) { return card(o, function () { location.hash = '#order/' + encodeURIComponent(o.code); }, o.due > 0 ? el('div', 'meta', ['Payment due: Rs. ' + o.due]) : (o.pay_mode === 'online' ? el('div', 'meta', ['Paid online']) : null)); });
  V.pool = listScreen('Pick Order', 'pool', 'No unassigned visits right now.', function (o, reload) {
    var b = el('button', { type: 'button', class: 'btn pri', text: 'Pick this visit', onclick: function () {
      b.disabled = true; api('POST', '/staff/phleb/orders/' + encodeURIComponent(o.code) + '/pick').then(function () { toast('Added to your orders'); reload(); }).catch(function (e) { b.disabled = false; toast(e.message); reload(); });
    } });
    return card(o, null, el('div', 'btns', [b]));
  });
  function tick(sz) { return el('span', { class: 'tick', html: '<svg viewBox="0 0 52 52" width="' + sz + '" height="' + sz + '"><circle class="tc" cx="26" cy="26" r="23" fill="none"/><path class="tk" fill="none" d="M14 27l8 8 16-17"/></svg>' }); }
  function pinCard(o, after) {
    var c = el('div', 'card pin'), inp = el('input', { class: 'pininp', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6', placeholder: '------', autocomplete: 'one-time-code', 'aria-label': 'Patient PIN' }), msg = el('p', 'msg'),
      go = el('button', { type: 'button', class: 'btn pri', style: 'width:100%', text: 'Verify PIN' });
    inp.addEventListener('input', function () { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); });
    c.appendChild(el('div', 'nm', ['Collect the patient PIN'])); c.appendChild(el('div', 'meta', ['Ask the patient or family for the 6-digit PIN the lab gave them. Verify it before taking the sample.'])); c.appendChild(inp); c.appendChild(go); c.appendChild(msg);
    function submit() {
      if (inp.value.length !== 6) { say(msg, 'Enter the 6-digit PIN.', 'err'); return; }
      go.disabled = true; inp.disabled = true; say(msg, 'Checking...', '');
      api('POST', '/staff/phleb/orders/' + encodeURIComponent(o.code) + '/verifypin', { pin: inp.value }).then(function (r) {
        c.textContent = ''; c.appendChild(el('div', 'verified', [el('span', { class: 'vbig', html: '<svg viewBox="0 0 52 52" width="96" height="96"><circle class="tc" cx="26" cy="26" r="23" fill="none"/><path class="tk" fill="none" d="M14 27l8 8 16-17"/></svg>' }), el('div', 'nm', ['PIN verified']), el('div', 'meta', ['You can collect the sample now.'])]));
        setTimeout(function () { after(r.order); }, 1500);
      }).catch(function (e) { go.disabled = false; inp.disabled = false; inp.value = ''; inp.focus(); say(msg, e.message, 'err'); });
    }
    go.addEventListener('click', submit); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); }); return c;
  }
  function payCard(o) {
    var c = el('div', 'card pay'), area = el('div'), poll = null;
    function stop() { clearInterval(poll); poll = null; }
    function done() { stop(); c.textContent = ''; c.appendChild(el('div', 'nm', ['Paid online'])); c.appendChild(el('div', 'paid', ['Payment received. The invoice has been sent to the patient on WhatsApp.'])); }
    if (o.due < 1) { c.appendChild(el('div', 'nm', [o.pay_mode === 'online' ? 'Paid online' : 'Payment received'])); c.appendChild(el('div', 'meta', ['Rs. ' + o.paid + ' paid for ' + o.code + '.'])); return c; }
    c.appendChild(el('div', 'nm', ['Payment due: Rs. ' + o.due])); c.appendChild(el('div', 'meta', ['Show the QR to the patient. Any UPI app works. It is marked paid here as soon as the payment arrives.']));
    var msg = el('p', 'msg'), btn = el('button', { type: 'button', class: 'btn pri', style: 'width:100%', text: 'Show payment QR', onclick: function () {
      btn.disabled = true; say(msg, 'Making the QR...', '');
      api('POST', '/staff/phleb/orders/' + encodeURIComponent(o.code) + '/payqr').then(function (r) {
        say(msg, '', ''); area.textContent = '';
        area.appendChild(el('img', { class: 'qr', src: r.qr.image_url, alt: 'UPI payment QR for Rs. ' + r.qr.amount })); area.appendChild(el('div', 'meta', ['Scan to pay Rs. ' + r.qr.amount + '. Waiting for the payment...']));
        area.appendChild(el('button', { type: 'button', class: 'btn', style: 'width:100%;margin-top:8px', text: 'New QR', onclick: function () { stop(); btn.disabled = false; btn.click(); } }));
        stop(); poll = setInterval(function () {
          if (!document.body.contains(c)) { stop(); return; }
          api('GET', '/staff/phleb/orders/' + encodeURIComponent(o.code) + '/paystatus', undefined, true).then(function (s) { if (s.paid_online) done(); else if (s.order.due < 1) { stop(); area.textContent = ''; area.appendChild(el('div', 'paid', ['Payment received.'])); } }).catch(function () { });
        }, 4000);
      }).catch(function (e) { btn.disabled = false; say(msg, e.message, 'err'); });
    } });
    c.appendChild(btn); c.appendChild(msg); c.appendChild(area); return c;
  }
  V.order = function (page, code) {
    header('Visit Order', '#orders'); var box = el('div'); page.appendChild(box);
    function act(a, label) { return function () { var btn = this; btn.disabled = true; api('POST', '/staff/phleb/orders/' + encodeURIComponent(code) + '/' + a).then(function (r) { toast(label); if (a === 'release') location.hash = '#orders'; else draw(r.order); }).catch(function (e) { btn.disabled = false; toast(e.message); }); }; }
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
      if (o.ph_status === 'started' && o.pin_ok) b.appendChild(el('button', { type: 'button', class: 'btn go', text: 'Sample collected', onclick: function () { var self = this; if (confirm('Confirm that the sample of ' + o.name + ' has been collected?')) act('collected', 'Marked as collected').call(self); } }));
      dt.appendChild(b); box.appendChild(dt);
      if (o.ph_status === 'started' && !o.pin_ok) box.appendChild(pinCard(o, draw)); else if (o.ph_status === 'started' || (o.ph_status === 'collected' && o.pin_ok)) dt.insertBefore(el('div', 'pinok', [tick(22), 'Patient PIN verified']), b);
      if (o.ph_status === 'collected') box.appendChild(payCard(o));
      if (o.ph_status !== 'collected') box.appendChild(el('button', { type: 'button', class: 'btn', style: 'width:100%', text: 'Order release', onclick: function () { var self = this; if (confirm('Release this visit back to the pool? Another phlebotomist can pick it.')) act('release', 'Released').call(self); } }));
    }
    box.appendChild(el('div', 'empty', ['Loading...']));
    api('GET', '/staff/phleb/orders/' + encodeURIComponent(code)).then(function (d) { draw(d.order); }).catch(function (e) { box.textContent = ''; box.appendChild(el('div', 'empty', [e.message])); });
  };
  V.schedule = function (page) {
    header('Schedule', true);
    var data = null, sel = '', picked = {}, strip = el('div', 'dstrip'), body = el('div'), ms = el('p', 'msg');
    var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function parts(d) { var a = d.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
    function longd(d) { var x = parts(d); return p2(x.getDate()) + '-' + MON[x.getMonth()] + '-' + x.getFullYear(); }
    function hh(h) { return p2(h) + ':00'; }
    function cur() { return data.days.filter(function (x) { return x.day === sel; })[0]; }
    function pickDay(d) { sel = d; var c = cur(); picked = {}; if (c.state === 'yes') c.slots.forEach(function (h) { picked[h] = true; }); say(ms, '', ''); draw(); }
    function allSlots() { var o = {}; for (var h = data.first; h <= data.last; h++) o[h] = true; return o; }
    function save(avail, slots, jump) {
      say(ms, 'Saving...', '');
      api('POST', '/staff/phleb/schedule', { day: sel, available: avail, slots: slots }).then(function (r) {
        data = r; say(ms, '', ''); toast(avail ? 'Slots confirmed for ' + longd(sel) : 'Marked not available on ' + longd(sel));
        var nxt = data.days.filter(function (x) { return x.state === 'unset'; })[0]; pickDay(jump && nxt ? nxt.day : sel);
      }).catch(function (e) { say(ms, e.message, 'err'); });
    }
    function draw() {
      strip.textContent = '';
      data.days.forEach(function (d) {
        var x = parts(d.day); strip.appendChild(el('button', { type: 'button', class: 'dchip ' + d.state + (d.day === sel ? ' cur' : ''), onclick: function () { pickDay(d.day); } }, [el('span', 'dw', [DOW[x.getDay()]]), el('b', { text: p2(x.getDate()) }), el('span', 'dm', [MON[x.getMonth()]])]));
      });
      var c = cur(); body.textContent = '';
      var yes = el('button', { type: 'button', class: 'yn yes' + (c.state === 'yes' || Object.keys(picked).length ? ' on' : ''), text: 'YES', onclick: function () { picked = allSlots(); c.state = 'yes'; draw(); } }),
        no = el('button', { type: 'button', class: 'yn no' + (c.state === 'no' ? ' on' : ''), text: 'NO', onclick: function () { save(false, [], true); } });
      body.appendChild(el('div', 'qrow', [el('span', 'q', ['Are you available on']), el('b', { text: longd(sel) }), yes, no]));
      if (c.on_leave) body.appendChild(el('div', 'leavebar', ['You have leave applied on this date.']));
      if (c.state === 'no') body.appendChild(el('div', 'empty', ['You marked not available on this date.']));
      if (c.state === 'yes') {
        var g = el('div', 'slots');
        for (var h = data.first; h <= data.last; h++) (function (h) { g.appendChild(el('button', { type: 'button', class: 'slot' + (picked[h] ? ' on' : ''), text: hh(h), onclick: function () { if (picked[h]) delete picked[h]; else picked[h] = true; draw(); } })); })(h);
        body.appendChild(el('div', 'selrow', [el('span', { class: 'note', text: Object.keys(picked).length + ' of ' + (data.last - data.first + 1) + ' slots selected' }), el('button', { type: 'button', class: 'link', text: Object.keys(picked).length === data.last - data.first + 1 ? 'Clear all' : 'Select all', onclick: function () { picked = Object.keys(picked).length === data.last - data.first + 1 ? {} : allSlots(); draw(); } })]));
        body.appendChild(g);
        body.appendChild(el('button', { type: 'button', class: 'big', style: 'margin-top:14px', text: 'Confirm Slots', onclick: function () { var s = Object.keys(picked).map(Number); if (!s.length) { say(ms, 'Choose at least one slot, or tap NO.', 'err'); return; } save(true, s, true); } }));
      }
    }
    page.appendChild(el('div', 'note2', ['Tell the lab which days and hours you can take home visits in the next 8 days.']));
    page.appendChild(strip); page.appendChild(body); page.appendChild(ms);
    api('GET', '/staff/phleb/schedule').then(function (d) { data = d; var first = d.days.filter(function (x) { return x.state === 'unset'; })[0] || d.days[0]; pickDay(first.day); }).catch(function (e) { say(ms, e.message, 'err'); });
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
    ME = staff; TOKEN = token; tok(token); $('#login').hidden = true; $('#app').hidden = false; route(); checkAttendance();
  }
  /* ---------- daily attendance: selfie + GPS, asked on the first open of each day ---------- */
  var attOpen = false;
  function checkAttendance() {
    if (!ME || attOpen) return;
    api('GET', '/staff/phleb/home', undefined, true).then(function (h) { if (!h.attendance && !h.on_leave) attendance(); }).catch(function () { });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkAttendance(); });
  var PIN_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  var CAM_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  var OK_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg>';
  var FACE = '<svg viewBox="0 0 64 64" width="96" height="96" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><circle cx="32" cy="24" r="11"/><path d="M10 58c2-13 12-19 22-19s20 6 22 19"/></svg>';
  function attendance() {
    attOpen = true; var shot = '', pos = null, stream = null, busy = false, clock = null;
    var ov = el('div', 'att'), msg = el('p', 'msg'), video = el('video', { autoplay: '', playsinline: '', muted: '' }), main = el('button', { type: 'button', class: 'btn', text: 'Capture Selfie' }),
      file = el('input', { type: 'file', accept: 'image/*', capture: 'user', hidden: 'hidden' }), photo = el('img', { alt: 'Your selfie' }), frame = el('div', 'frame'), faceEl = el('span', { class: 'face', html: FACE }),
      sCam = el('div', 'step on', [el('span', { class: 'ic', html: CAM_SVG }), 'Selfie']), sLoc = el('div', 'step', [el('span', { class: 'ic', html: PIN_SVG }), el('span', { class: 'lt', text: 'Location' })]), sOk = el('div', 'step', [el('span', { class: 'ic', html: OK_SVG }), 'Mark']);
    video.muted = true; video.hidden = true; photo.hidden = true;
    for (var i = 0; i < 9; i++) ov.appendChild(el('i', { class: 'bub b' + i }));
    var hr = new Date().getHours(), hi = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening', tEl = el('div', 'tm'), dEl = el('div', 'dt');
    function tick() { var d = new Date(); tEl.textContent = tm(d); dEl.textContent = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }
    tick(); clock = setInterval(tick, 20000);
    frame.appendChild(el('div', 'ring')); frame.appendChild(el('div', 'inner', [faceEl, video, photo, el('div', 'scan')]));
    var sheet = el('div', 'sheet', [el('div', 'steps', [sCam, el('span', 'ln'), sLoc, el('span', 'ln'), sOk]), msg, main, file]);
    ov.appendChild(el('div', 'atop', [el('div', 'hi', [hi + ',']), el('div', 'nm2', [ME.name]), tEl, dEl])); ov.appendChild(frame); ov.appendChild(el('div', 'hint', ['Mark your attendance to start your day'])); ov.appendChild(sheet); document.body.appendChild(ov);
    function stopCam() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } }
    function done(el_) { el_.classList.add('on'); }
    function locate() {
      pos = null; sLoc.className = 'step busy'; sLoc.querySelector('.lt').textContent = 'Locating...';
      if (!navigator.geolocation) { sLoc.className = 'step bad'; say(msg, 'This phone cannot share its location.', 'err'); return; }
      navigator.geolocation.getCurrentPosition(function (p) { pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; sLoc.className = 'step on'; sLoc.querySelector('.lt').textContent = 'Location locked'; ready(); }, function (e) {
        sLoc.className = 'step bad'; sLoc.querySelector('.lt').textContent = 'Location needed';
        say(msg, e.code === 1 ? 'Allow location access for this site in the browser settings, then tap Retake.' : 'Could not get your location. Switch on GPS and tap Retake.', 'err'); retake();
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    }
    function useImage(img) {
      var w = img.videoWidth || img.naturalWidth, h = img.videoHeight || img.naturalHeight, k = Math.min(1, 480 / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); shot = c.toDataURL('image/jpeg', 0.7); stopCam(); video.hidden = true; faceEl.hidden = true; photo.src = shot; photo.hidden = false; frame.className = 'frame done';
      main.textContent = 'Getting location...'; main.disabled = true; say(msg, '', ''); locate();
    }
    function ready() { if (!shot || !pos) return; say(msg, '', ''); main.disabled = false; main.textContent = 'Proceed'; main.className = 'btn pri'; main.onclick = send; retake(); }
    function retake() {
      if (ov.querySelector('.rt')) return;
      sheet.appendChild(el('button', { type: 'button', class: 'rt', text: 'Retake selfie', onclick: function () { shot = ''; pos = null; photo.hidden = true; faceEl.hidden = false; frame.className = 'frame'; main.className = 'btn'; main.disabled = false; main.textContent = 'Capture Selfie'; main.onclick = capture; sLoc.className = 'step'; sLoc.querySelector('.lt').textContent = 'Location'; sOk.className = 'step'; var r = ov.querySelector('.rt'); if (r) r.remove(); say(msg, '', ''); } }));
    }
    function send() {
      if (busy) return; busy = true; main.disabled = true; say(msg, 'Saving your attendance...', '');
      api('POST', '/staff/phleb/attendance', { selfie: shot, lat: pos.lat, lng: pos.lng, acc: pos.acc }).then(function () {
        done(sOk); clearInterval(clock); ov.classList.add('ok'); frame.className = 'frame done';
        ov.appendChild(el('div', 'okpop', [el('span', { class: 'vbig', html: '<svg viewBox="0 0 52 52" width="110" height="110"><circle class="tc" cx="26" cy="26" r="23" fill="#e6f5ec"/><path class="tk" fill="none" d="M14 27l8 8 16-17"/></svg>' }), el('div', 'nm3', ['Attendance marked']), el('div', 'meta2', ['Have a safe day, ' + ME.name.split(' ')[0] + '.'])]));
        setTimeout(function () { ov.remove(); attOpen = false; route(); }, 1900);
      }).catch(function (e) { busy = false; main.disabled = false; say(msg, e.message, 'err'); });
    }
    function capture() {
      locate();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { file.click(); return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(function (s) {
        stream = s; video.srcObject = s; video.hidden = false; faceEl.hidden = true; frame.className = 'frame live'; video.play().catch(function () { }); main.textContent = 'Take photo'; main.className = 'btn pri'; main.disabled = false;
        main.onclick = function () { if (!video.videoWidth) return; useImage(video); };
      }).catch(function () { file.click(); });
    }
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return; var u = URL.createObjectURL(f), im = new Image();
      im.onload = function () { useImage(im); URL.revokeObjectURL(u); }; im.onerror = function () { say(msg, 'Could not read that photo. Please try again.', 'err'); }; im.src = u;
    });
    main.onclick = capture;
  }

  $('#fl').addEventListener('submit', function (e) {
    e.preventDefault(); var m = $('#lmsg'), u = $('#lu').value.trim(), p = $('#lp').value; if (!u || !p) return say(m, 'Enter your username and password.', 'err');
    say(m, 'Logging in...', ''); api('POST', '/staff/login', { username: u, password: p }, true).then(function (r) { $('#lp').value = ''; say(m, '', ''); enter(r.staff, r.token); }).catch(function (er) { say(m, er.message, 'err'); });
  });
  var saved = tok();
  if (saved) { TOKEN = saved; api('GET', '/staff/me', undefined, true).then(function (r) { enter(r.staff, saved); }).catch(function () { TOKEN = ''; tok(null); $('#login').hidden = false; }); } else $('#login').hidden = false;
})();
