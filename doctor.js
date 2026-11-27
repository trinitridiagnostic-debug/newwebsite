/* Trinetri Diagnostics: Doctor partner app. Book home visits for patients, pay the lab's B2B share by UPI QR, keep the rest as commission. */
(function () {
  'use strict';
  var BASE = String((window.TRIN_PORTAL || {}).api || '').replace(/\/+$/, ''), TOKEN = '', ME = null, timer = null, PRICES = null;
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
    plus: '<path d="M12 5v14M5 12h14"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', tag: '<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
    pw: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h.01M12 12h.01M17 12h.01"/>', out: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>', back: '<path d="M15 5l-7 7 7 7"/>', home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
    call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>'
  };
  function svg(k, w) { return el('span', { html: '<svg viewBox="0 0 24 24" width="' + (w || 24) + '" height="' + (w || 24) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[k] + '</svg>' }); }
  var toastT; function toast(m) { var t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3200); }
  function say(n, t, c) { n.textContent = t; n.className = 'msg ' + (c || ''); }
  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function tok(v) { try { if (v === null) localStorage.removeItem('trin.dr.tok'); else if (v) localStorage.setItem('trin.dr.tok', v); else return localStorage.getItem('trin.dr.tok') || ''; } catch (e) { } return ''; }
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
  function when(ms) { if (!ms) return 'Time not fixed'; var d = new Date(ms), h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return p2(d.getDate()) + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p2(h) + ':' + p2(d.getMinutes()) + ' ' + ap; }
  /* MRP only (safe to show the patient) or MRP + B2B + commission (doctor's own view). Remembered on this phone. */
  function getView() { try { return localStorage.getItem('trin.dr.view') === 'mrp' ? 'mrp' : 'b2b'; } catch (e) { return 'b2b'; } }
  function setView(v) { try { localStorage.setItem('trin.dr.view', v); } catch (e) { } }
  function viewSwitch(onchange) {
    var w = el('div', 'vsw'), cur = getView();
    [['mrp', 'MRP'], ['b2b', 'B2B']].forEach(function (x) {
      var lab = el('label', { class: cur === x[0] ? 'on' : '' }), r = el('input', { type: 'radio', name: 'vw', value: x[0], checked: cur === x[0] });
      r.addEventListener('change', function () { setView(x[0]); [].forEach.call(w.children, function (c) { c.classList.toggle('on', c.firstChild.checked); }); onchange(x[0]); });
      lab.appendChild(r); lab.appendChild(el('span', null, [el('b', { text: x[1] })])); w.appendChild(lab);
    });
    return w;
  }
  function pshow(p, v) { return v === 'mrp' ? (p.mrp > 0 ? inr(p.mrp) : '-') : (p.mrp > 0 ? 'MRP ' + inr(p.mrp) + ' \u00B7 B2B ' + inr(p.price) : 'B2B ' + inr(p.price)); }
  var STAGE = { awaiting_payment: 'Waiting for your payment', confirmed: 'Confirmed - lab will assign a phlebotomist', phlebo_assigned: 'Phlebotomist assigned', collected: 'Sample collected', processing: 'Testing in progress', completed: 'Report ready', report_ready: 'Report ready', cancelled: 'Cancelled', booked: 'Confirmed' };
  function stageOf(b) { return b.status === 'confirmed' ? (b.stage || 'confirmed') : b.status; }
  function logout(msg) { TOKEN = ''; ME = null; PRICES = null; tok(null); clearInterval(timer); $('#app').hidden = true; $('#login').hidden = false; if (msg) say($('#lmsg'), msg, 'err'); }

  function header(title, back) {
    var h = $('#top'); h.textContent = '';
    if (!title) { h.appendChild(el('div', 'av', [(ME.name || '?').charAt(0).toUpperCase()])); h.appendChild(el('div', 'who', ['Welcome,', el('br'), el('b', { text: ME.name })])); }
    else { h.appendChild(el('button', { type: 'button', 'aria-label': 'Back', onclick: function () { location.hash = back || '#home'; } }, [svg('back', 26)])); h.appendChild(el('h2', { text: title })); h.appendChild(el('button', { type: 'button', 'aria-label': 'Home', onclick: function () { location.hash = '#home'; } }, [svg('home', 26)])); }
  }
  function loadPrices() { if (PRICES) return Promise.resolve(PRICES); return api('GET', '/staff/dr/prices').then(function (r) { PRICES = r.prices; return PRICES; }); }
  function bookingCard(b) {
    var c = el('button', { type: 'button', class: 'card', onclick: function () { location.hash = b.status === 'awaiting_payment' ? '#pay/' + b.id : '#b/' + b.id; } }, [
      el('div', 'nm', [b.name]), el('div', 'meta', [when(b.slot_at)]), el('div', 'meta', [b.tests.map(function (t) { return t.name; }).join(', ')]),
      el('div', 'meta', ['Patient pays ', el('b', { text: inr(b.price) }), '  ·  Your commission ', el('b', { text: inr(b.commission) })]), el('span', { class: 'stg ' + stageOf(b), text: STAGE[stageOf(b)] || stageOf(b) })]);
    return c;
  }

  var V = {};
  V.home = function (page) {
    header(null);
    page.appendChild(el('button', { type: 'button', class: 'newbtn', onclick: function () { location.hash = '#new'; } }, [svg('plus', 24), 'New home visit booking']));
    var box = el('div'); page.appendChild(box);
    var grid = el('div', 'grid'); function tile(label, icon, fn) { grid.appendChild(el('button', { type: 'button', onclick: fn }, [svg(icon, 30), el('span', { text: label })])); }
    tile('My bookings', 'list', function () { location.hash = '#bookings'; }); tile('Price list', 'tag', function () { location.hash = '#prices'; }); tile('Password', 'pw', function () { location.hash = '#password'; });
    page.appendChild(grid); page.appendChild(el('div', 'sec', ['Recent bookings'])); var rec = el('div'); page.appendChild(rec);
    page.appendChild(el('button', { type: 'button', class: 'btn', style: 'width:100%;margin-top:12px', text: 'Log out', onclick: function () { logout(); } }));
    api('GET', '/staff/dr/home').then(function (h) {
      var e = h.earnings;
      box.appendChild(el('div', 'earn', [el('div', 'hi', [el('span', { text: 'Your commission this month' }), el('b', { text: inr(e.month_commission) }), el('span', { text: e.month_bookings + ' paid booking' + (e.month_bookings === 1 ? '' : 's') })]),
        el('div', null, [el('b', { text: inr(e.commission) }), el('span', { text: 'Total commission' })]), el('div', null, [el('b', { text: String(e.awaiting) }), el('span', { text: 'Waiting for your payment' })])]));
      if (!h.prices) box.appendChild(el('div', 'leavebar', ['The lab has not uploaded the partner price list yet. You can book once it is added.']));
      if (!h.recent.length) rec.appendChild(el('p', 'empty', ['No bookings yet. Tap the green button to book a home visit.'])); h.recent.forEach(function (b) { rec.appendChild(bookingCard(b)); });
    }).catch(function (e) { rec.appendChild(el('p', 'empty', [e.message])); });
  };

  V.new = function (page) {
    header('New home visit', '#home'); var sel = [], sex = '';
    var nm = el('input', { maxlength: '60', autocomplete: 'off' }), mb = el('input', { inputmode: 'numeric', maxlength: '10', placeholder: '10-digit mobile' }), age = el('input', { inputmode: 'numeric', maxlength: '3' });
    var ad = el('textarea', { rows: '3', placeholder: 'House no, street, landmark, town' }), dt = el('input', { type: 'datetime-local' }), nt = el('input', { maxlength: '200', placeholder: 'Optional: fasting, special instructions' });
    var now = new Date(Date.now() + 3600000); dt.value = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate()) + 'T' + p2(now.getHours()) + ':00'; dt.min = dt.value;
    var sexRow = el('div', 'sexrow'); [['M', 'Male'], ['F', 'Female'], ['O', 'Other']].forEach(function (x) { var b = el('button', { type: 'button', text: x[1], onclick: function () { sex = x[0]; [].forEach.call(sexRow.children, function (c) { c.classList.toggle('on', c === b); }); } }); sexRow.appendChild(b); });
    var q = el('input', { placeholder: 'Type a test or package name', autocomplete: 'off', 'aria-label': 'Search tests' }), sug = el('div', 'sug', []); sug.hidden = true; var chips = el('div', 'chips');
    var charge = el('input', { inputmode: 'numeric', 'aria-label': 'Amount you charge the patient' }), sum = el('div', 'sum'), ms = el('p', 'msg'), go = el('button', { type: 'button', class: 'big', text: 'Continue to payment' });
    function b2b() { return sel.reduce(function (a, t) { return a + t.price; }, 0); }
    function mrpTot() { return sel.reduce(function (a, t) { return a + (t.mrp || 0); }, 0); }
    function mrpAll() { return sel.length && sel.every(function (t) { return t.mrp > 0; }); }
    function defCharge() { return mrpAll() ? mrpTot() : b2b(); }
    function render() {
      if (typeof foot !== 'undefined') foot.hidden = getView() === 'mrp';
      chips.textContent = ''; sel.forEach(function (t, i) { chips.appendChild(el('div', 'chip', [el('span', { text: t.name }), el('b', { text: pshow(t, getView()) }), el('button', { type: 'button', 'aria-label': 'Remove', text: '×', onclick: function () { sel.splice(i, 1); autoCharge = true; setCharge(); } })])); });
      var t = b2b(), c = Math.round(Number(charge.value) || 0), gain = c - t, v = getView(); sum.textContent = '';
      if (!sel.length) { sum.appendChild(el('div', 'l', [el('span', { text: 'Choose tests to see the price.' })])); go.disabled = true; return; }
      if (mrpAll()) sum.appendChild(el('div', 'l', [el('span', { text: 'Total MRP' }), el('b', { text: inr(mrpTot()) })]));
      if (v === 'mrp') {
        sum.appendChild(el('div', 'l t', [el('span', { text: 'Patient pays' }), el('b', { text: inr(c) })]));
        if (gain < 0) sum.appendChild(el('div', 'l', [el('span', { class: 'lose', text: 'This amount is too low. Please increase it.' })]));
      } else {
        sum.appendChild(el('div', 'l', [el('span', { text: 'Lab price (B2B) you pay now' }), el('b', { text: inr(t) })]));
        sum.appendChild(el('div', 'l', [el('span', { text: 'You charge the patient' }), el('b', { text: inr(c) })]));
        sum.appendChild(el('div', 'l t', [el('span', { text: 'Your commission' }), el('span', { class: gain >= 0 ? 'gain' : 'lose', text: gain >= 0 ? inr(gain) : 'Below lab price' })]));
      }
      go.disabled = gain < 0;
    }
    var autoCharge = true;
    function setCharge() { if (autoCharge) charge.value = String(defCharge()); render(); }
    charge.addEventListener('input', function () { autoCharge = false; render(); });
    function suggest() {
      var terms = q.value.toLowerCase().split(/\s+/).filter(Boolean); sug.textContent = ''; if (!terms.length || !PRICES) { sug.hidden = true; return; }
      var n = 0; for (var i = 0; i < PRICES.length && n < 30; i++) {
        var p = PRICES[i], hay = p.name.toLowerCase(); if (!terms.every(function (w) { return hay.indexOf(w) >= 0; })) continue; n++;
        (function (p) { sug.appendChild(el('button', { type: 'button', onclick: function () { if (!sel.some(function (s) { return s.key === p.key; })) sel.push(p); q.value = ''; sug.hidden = true; var was = autoCharge; setCharge(); autoCharge = was; } }, [el('span', { text: p.name }), el('small', { text: pshow(p, getView()) })])); })(p);
      }
      if (!n) sug.appendChild(el('div', { class: 'empty', style: 'padding:14px', text: 'No test found. Check the spelling or call the lab.' })); sug.hidden = false;
    }
    q.addEventListener('input', suggest);
    go.onclick = function () {
      var slot = new Date(dt.value).getTime(); if (!slot) return say(ms, 'Choose the visit date and time.', 'err');
      go.disabled = true; say(ms, 'Creating booking...', '');
      api('POST', '/staff/dr/bookings', { name: nm.value, mobile: mb.value, age: age.value, sex: sex, address: ad.value, slot: slot, notes: nt.value, tests: sel.map(function (s) { return s.key; }), price: Number(charge.value) || 0 })
        .then(function (r) { location.hash = '#pay/' + r.booking.id; }).catch(function (e) { go.disabled = false; say(ms, e.message, 'err'); });
    };
    page.appendChild(el('div', 'form', [el('label', { text: 'Patient name' }), nm, el('label', { text: 'Mobile number' }), mb, el('div', 'row2', [el('div', null, [el('label', { text: 'Age' }), age]), el('div', null, [el('label', { text: 'Gender' }), sexRow])]),
      el('label', { text: 'Home address' }), ad, el('label', { text: 'Visit date and time' }), dt, el('label', { text: 'Price view' }), viewSwitch(function () { suggest(); render(); }), el('label', { text: 'Tests / packages' }), q, sug, chips,
      el('label', { text: 'Amount the patient pays (₹)' }), charge, sum, el('label', { text: 'Notes' }), nt, go, ms]));
    var foot = el('p', { class: 'meta', style: 'color:#6b7385;font-size:.88rem;margin:10px 4px', text: 'You collect the amount from the patient. You pay the lab only the lab price, by UPI QR on the next screen. The difference is your commission.' }); page.appendChild(foot);
    render(); loadPrices().then(function () { if (!PRICES.length) say(ms, 'The lab has not uploaded the partner price list yet.', 'err'); }).catch(function (e) { say(ms, e.message, 'err'); });
  };

  V.pay = function (page, id) {
    header('Pay lab charges', '#home'); var box = el('div'); page.appendChild(box); var stop = false; timer = null;
    function paid(b) {
      clearInterval(timer); box.textContent = ''; header('Booking confirmed', '#home');
      box.appendChild(el('div', 'okwrap', [el('span', { class: 'vbig', html: '<svg viewBox="0 0 52 52" width="110" height="110"><circle class="tc" cx="26" cy="26" r="23" fill="#e6f5ec"/><path class="tk" fill="none" d="M14 27l8 8 16-17"/></svg>' }),
        el('h2', { style: 'margin:8px 0 2px', text: 'Home visit booked' }), el('div', 'meta', [b.name + ' · ' + when(b.slot_at)]), el('div', 'meta', ['Lab order ' + (b.order_code || '')])]));
      box.appendChild(el('div', 'split', [el('div', 'l', [el('span', { text: 'Collect from patient' }), el('b', { text: inr(b.price) })]), el('div', 'l', [el('span', { text: 'Paid to lab' }), el('b', { text: inr(b.b2b) })]), el('div', 'l', [el('span', { text: 'Your commission' }), el('b', { style: 'color:#2e9e5b', text: inr(b.commission) })])]));
      if (b.pin) box.appendChild(el('div', 'pinbox', [el('span', { text: 'Tell the patient this PIN. They give it to the phlebotomist on arrival.' }), el('b', { text: b.pin })]));
      box.appendChild(el('p', { class: 'meta', style: 'color:#6b7385;margin:10px 2px', text: 'The lab will assign a phlebotomist shortly. The phlebotomist will not collect any money from the patient.' }));
      box.appendChild(el('div', 'btns', [el('button', { type: 'button', class: 'btn', text: 'All bookings', onclick: function () { location.hash = '#bookings'; } }), el('button', { type: 'button', class: 'btn pri', text: 'New booking', onclick: function () { location.hash = '#new'; } })]));
    }
    function showQr(b, qr) {
      box.textContent = ''; var st = el('p', 'msg');
      box.appendChild(el('div', 'meta', [b.name + ' · ' + when(b.slot_at)]));
      var qb = el('div', 'qrbox', [el('div', { class: 'meta', text: 'Scan with any UPI app to pay the lab' }), el('div', 'amt', [inr(qr.amount)]), el('img', { src: qr.image_url, alt: 'UPI QR code' }), el('div', 'wait', [el('i'), 'Waiting for payment...'])]); box.appendChild(qb);
      box.appendChild(el('div', 'split', [el('div', 'l', [el('span', { text: 'Patient pays you' }), el('b', { text: inr(b.price) })]), el('div', 'l', [el('span', { text: 'You pay the lab now' }), el('b', { text: inr(b.b2b) })]), el('div', 'l', [el('span', { text: 'Your commission' }), el('b', { style: 'color:#2e9e5b', text: inr(b.commission) })])]));
      box.appendChild(el('div', 'btns', [el('button', { type: 'button', class: 'btn', text: 'New QR', onclick: function () { start(true); } }), el('button', { type: 'button', class: 'btn', text: 'Cancel booking', onclick: function () { if (!confirm('Cancel this booking?')) return; api('POST', '/staff/dr/bookings/' + id + '/cancel').then(function () { toast('Booking cancelled'); location.hash = '#bookings'; }).catch(function (e) { toast(e.message); }); } })])); box.appendChild(st);
      clearInterval(timer); timer = setInterval(function () { if (location.hash !== '#pay/' + id) { clearInterval(timer); return; } api('GET', '/staff/dr/bookings/' + id + '/status', undefined, true).then(function (r) { if (r.paid) paid(r.booking); else if (r.booking.status === 'cancelled') { clearInterval(timer); location.hash = '#bookings'; } }).catch(function () { }); }, 4000);
    }
    function start() {
      box.textContent = ''; box.appendChild(el('p', 'empty', ['Making the payment QR...']));
      api('GET', '/staff/dr/bookings/' + id).then(function (r) {
        var b = r.booking; if (b.status === 'confirmed') return paid(b); if (b.status === 'cancelled') { box.textContent = ''; box.appendChild(el('p', 'empty', ['This booking was cancelled.'])); return; }
        return api('POST', '/staff/dr/bookings/' + id + '/qr').then(function (x) { showQr(b, x.qr); });
      }).catch(function (e) { box.textContent = ''; box.appendChild(el('p', 'empty', [e.message])); box.appendChild(el('button', { type: 'button', class: 'big', text: 'Try again', onclick: start })); });
    }
    start();
  };

  V.bookings = function (page) {
    header('My bookings', '#home'); var list = el('div'); page.appendChild(list); list.appendChild(el('p', 'empty', ['Loading...']));
    api('GET', '/staff/dr/bookings').then(function (r) {
      list.textContent = ''; var e = r.earnings;
      list.appendChild(el('div', 'earn', [el('div', null, [el('b', { text: inr(e.commission) }), el('span', { text: 'Total commission' })]), el('div', null, [el('b', { text: String(e.bookings) }), el('span', { text: 'Paid bookings' })])]));
      if (!r.bookings.length) list.appendChild(el('p', 'empty', ['No bookings yet.'])); r.bookings.forEach(function (b) { list.appendChild(bookingCard(b)); });
    }).catch(function (e) { list.textContent = ''; list.appendChild(el('p', 'empty', [e.message])); });
  };

  V.b = function (page, id) {
    header('Booking', '#bookings'); var box = el('div'); page.appendChild(box);
    api('GET', '/staff/dr/bookings/' + id).then(function (r) {
      var b = r.booking; box.appendChild(el('div', 'card dt', [el('div', 'row', [el('div', 'grow', [el('div', 'nm', [b.name]), el('div', 'meta', [(b.age ? b.age + ' yrs ' : '') + (b.sex || '')]), el('div', 'addr', [b.address])]), el('a', { class: 'call', href: 'tel:+91' + b.mobile, 'aria-label': 'Call' }, [svg('call', 22)])]),
        el('div', 'meta', [when(b.slot_at)]), el('ul', 'tests', b.tests.map(function (t) { return el('li', null, [t.name + ' - ' + inr(t.b2b)]); })), el('span', { class: 'stg ' + stageOf(b), text: STAGE[stageOf(b)] || stageOf(b) })]));
      box.appendChild(el('div', 'split', [el('div', 'l', [el('span', { text: 'Patient pays you' }), el('b', { text: inr(b.price) })]), el('div', 'l', [el('span', { text: 'Paid to lab' }), el('b', { text: inr(b.b2b) })]), el('div', 'l', [el('span', { text: 'Your commission' }), el('b', { style: 'color:#2e9e5b', text: inr(b.commission) })])]));
      if (b.order_code) box.appendChild(el('p', { class: 'meta', style: 'margin:10px 2px;color:#6b7385', text: 'Lab order ' + b.order_code }));
      if (b.pin) box.appendChild(el('div', 'pinbox', [el('span', { text: 'Patient PIN for the phlebotomist' }), el('b', { text: b.pin })]));
      if (b.status === 'awaiting_payment') box.appendChild(el('button', { type: 'button', class: 'big', text: 'Pay ' + inr(b.b2b) + ' now', onclick: function () { location.hash = '#pay/' + b.id; } }));
    }).catch(function (e) { box.appendChild(el('p', 'empty', [e.message])); });
  };

  V.prices = function (page) {
    header('Price list', '#home'); var q = el('input', { class: 'srch', placeholder: 'Search tests or packages', 'aria-label': 'Search' }), list = el('div', 'plist'), ALL = []; page.appendChild(viewSwitch(function () { draw(ALL); })); page.appendChild(q); page.appendChild(list);
    function draw(all) { list.textContent = ''; var t = q.value.toLowerCase().split(/\s+/).filter(Boolean), n = 0; all.forEach(function (p) { if (n >= 150) return; var h = p.name.toLowerCase(); if (t.every(function (w) { return h.indexOf(w) >= 0; })) { n++; list.appendChild(el('div', 'p', [el('span', { text: p.name }), el('b', { text: pshow(p, getView()) })])); } }); if (!n) list.appendChild(el('p', 'empty', ['Nothing found.'])); }
    loadPrices().then(function (all) { ALL = all; draw(all); q.addEventListener('input', function () { draw(all); }); }).catch(function (e) { list.appendChild(el('p', 'empty', [e.message])); });
  };

  V.password = function (page) {
    header('Password', '#home'); var o = el('input', { type: 'password', autocomplete: 'current-password' }), n = el('input', { type: 'password', autocomplete: 'new-password' }), n2 = el('input', { type: 'password', autocomplete: 'new-password' }), ms = el('p', 'msg');
    page.appendChild(el('div', 'form', [el('label', { text: 'Current password' }), o, el('label', { text: 'New password (8+ characters)' }), n, el('label', { text: 'Repeat the new password' }), n2,
      el('button', { type: 'button', class: 'big', text: 'Change password', onclick: function () { if (n.value !== n2.value) return say(ms, 'The two new passwords do not match.', 'err'); say(ms, 'Saving...', ''); api('POST', '/staff/password', { old: o.value, new: n.value }).then(function () { o.value = n.value = n2.value = ''; say(ms, 'Password changed.', 'ok'); }).catch(function (e) { say(ms, e.message, 'err'); }); } }), ms]));
    if (window.TRIN_PWEYE) window.TRIN_PWEYE();
  };

  function route() {
    if (!ME) return; clearInterval(timer); var parts = location.hash.replace(/^#/, '').split('/'), v = parts[0] || 'home'; if (!V[v]) v = 'home';
    var page = $('#page'); page.textContent = ''; window.scrollTo(0, 0); V[v](page, parts[1] || '');
  }
  window.addEventListener('hashchange', route);
  function enter(staff, token) {
    if (staff.role !== 'doctor') { TOKEN = ''; tok(null); say($('#lmsg'), staff.role === 'phlebotomist' ? 'This is the doctor app. Phlebotomists use the phlebotomist app.' : 'This app is for doctor partners. Staff logins use the lab console.', 'err'); $('#login').hidden = false; $('#app').hidden = true; return; }
    ME = staff; TOKEN = token; tok(token); $('#login').hidden = true; $('#app').hidden = false; route();
  }
  $('#fl').addEventListener('submit', function (e) {
    e.preventDefault(); var m = $('#lmsg'), u = $('#lu').value.trim(), p = $('#lp').value; if (!u || !p) return say(m, 'Enter your username and password.', 'err');
    say(m, 'Logging in...', ''); api('POST', '/staff/login', { username: u, password: p }, true).then(function (r) { $('#lp').value = ''; say(m, '', ''); enter(r.staff, r.token); }).catch(function (er) { say(m, er.message, 'err'); });
  });
  var saved = tok();
  if (saved) { TOKEN = saved; api('GET', '/staff/me', undefined, true).then(function (r) { enter(r.staff, saved); }).catch(function () { TOKEN = ''; tok(null); $('#login').hidden = false; }); } else $('#login').hidden = false;
})();
