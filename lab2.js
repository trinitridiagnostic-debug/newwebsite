/* Trinetri Diagnostics lab console: part 2 (new order, patients, inbox, reports, stock, templates, staff, account). */
(function () {
  'use strict';
  var L = window.LAB; if (!L) return;
  var el = L.el, add = L.add, fld = L.fld, api = L.api, inr = L.inr, toast = L.toast, say = L.say, badge = L.badge, can = L.can, modal = L.modal, fdt = L.fdt, fdate = L.fdate, $ = L.$;
  function btn(text, cls, fn) { return el('button', { type: 'button', class: 'btn sm ' + (cls || ''), text: text, onclick: fn }); }
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function opts(list, sel) { return list.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === sel }); }); }

  /* ======================= NEW ORDER (registration + billing) ======================= */
  L.views.new = function (page, _a, done) {
    var items = [], pct = 0, discTouched = false;
    var mobile = el('input', { inputmode: 'tel', placeholder: '10-digit mobile', autocomplete: 'off' }), name = el('input', { autocomplete: 'off' }), age = el('input', { type: 'number', min: 0, max: 120 });
    var sex = el('select', null, opts([['', 'Select'], ['M', 'Male'], ['F', 'Female'], ['O', 'Other']], '')), doc = el('input', { placeholder: 'Doctor name (optional)' }), kind = el('select', null, opts([['walk-in', 'Walk-in'], ['home', 'Home collection']], 'walk-in')), notes = el('input', { placeholder: 'Optional' });
    var info = el('div', 'note');
    function lookup() {
      var m = L.mob(mobile.value); info.textContent = ''; pct = 0; if (m.length !== 10) return;
      api('GET', '/staff/patient?mobile=' + m).then(function (r) {
        if (!r.found) { info.textContent = 'New patient.' + (r.hasAccount ? '' : ''); return; }
        if (!name.value) name.value = r.name || ''; if (!age.value && r.age != null) age.value = r.age; if (!sex.value && r.sex) sex.value = r.sex;
        pct = r.discountPct || 0;
        info.textContent = 'Returning patient (' + r.orders + ' earlier order' + (r.orders === 1 ? '' : 's') + ')' + (r.hasAccount ? ', has an online account' : ', no online account yet') + (r.membership ? ', membership ' + r.membership.tier + ' (' + r.membership.status + ')' : '') + (pct ? '. ' + pct + '% member discount available.' : '.');
        autoDisc(); draw();
      }).catch(function () { });
    }
    mobile.addEventListener('change', lookup); mobile.addEventListener('blur', lookup);

    var q = el('input', { type: 'search', placeholder: 'Search tests or packages (e.g. thyroid, CBC, HbA1c)', autocomplete: 'off' }), sugg = el('div', 'sugg', null); sugg.hidden = true;
    q.addEventListener('input', function () {
      var r = L.search(q.value); sugg.textContent = ''; sugg.hidden = !r.length;
      r.forEach(function (t) { sugg.appendChild(el('button', { type: 'button', onclick: function () { addItem(t); } }, [el('span', { text: (t.pkg ? '[Package] ' : '') + t.name }), el('span', { text: inr(t.price) })])); });
    });
    function addItem(t) { if (items.some(function (x) { return x.key === t.key && x.name === t.name; })) { toast('Already added'); return; } items.push({ key: t.key, name: t.name, price: t.price }); q.value = ''; sugg.hidden = true; q.focus(); autoDisc(); draw(); }
    var chips = el('div', 'pkchips'); L.packages.forEach(function (p) { chips.appendChild(el('button', { type: 'button', text: p.name + ' ' + inr(p.price), onclick: function () { addItem(p); } })); });

    var cn = el('input', { placeholder: 'Test not in the list, e.g. CBC' }), cp = el('input', { type: 'number', min: 0, placeholder: 'Price' });
    var custom = el('div', 'filters', [fld('Custom test name', cn), fld('Price (\u20B9)', cp), btn('Add custom test', 'ghost', function () { if (cn.value.trim().length < 2) return toast('Enter the test name'); addItem({ key: '', name: cn.value.trim(), price: Math.max(0, num(cp.value)) }); cn.value = cp.value = ''; })]);
    var tbody = el('tbody'), sum = el('div', 'sum');
    var disc = el('input', { type: 'number', min: 0, value: 0 }), paid = el('input', { type: 'number', min: 0, value: 0 }), mode = el('select', null, opts([['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card']], 'cash'));
    var memBtn = btn('Apply member discount', 'ghost', function () { discTouched = false; autoDisc(true); draw(); }); memBtn.hidden = true;
    function subtotal() { return items.reduce(function (a, i) { return a + num(i.price); }, 0); }
    function autoDisc(force) { if (pct && (force || !discTouched)) disc.value = Math.round(subtotal() * pct / 100); if (!pct && !discTouched) disc.value = 0; }
    disc.addEventListener('input', function () { discTouched = true; draw(); }); paid.addEventListener('input', draw);
    function totals() { var s = subtotal(), d = Math.min(s, Math.max(0, num(disc.value))), t = s - d, p = Math.min(t, Math.max(0, num(paid.value))); return { s: s, d: d, t: t, p: p, due: t - p }; }
    function draw() {
      tbody.textContent = '';
      items.forEach(function (it, i) {
        var pr = el('input', { type: 'number', min: 0, value: it.price, style: 'width:100px', 'aria-label': 'Price' }); pr.addEventListener('input', function () { it.price = Math.max(0, num(pr.value)); autoDisc(); sumDraw(); });
        tbody.appendChild(el('tr', null, [el('td', { text: it.name }), el('td', 'num', pr), el('td', 'num', el('button', { type: 'button', class: 'x', 'aria-label': 'Remove ' + it.name, text: '×', onclick: function () { items.splice(i, 1); autoDisc(); draw(); } }))]));
      });
      if (!items.length) tbody.appendChild(el('tr', null, el('td', { colspan: 3, class: 'empty', text: 'No tests added yet.' })));
      memBtn.hidden = !pct || !items.length; memBtn.textContent = 'Apply ' + pct + '% member discount'; sumDraw();
    }
    function sumDraw() { var t = totals(); sum.textContent = ''; add(sum, [el('span', { text: 'Sub total' }), el('b', { text: inr(t.s) }), el('span', { text: 'Discount' }), el('b', { text: '- ' + inr(t.d) }), el('span', 'gt', 'Total'), el('b', { class: 'gt', text: inr(t.t) }), el('span', { text: 'Paid now' }), el('b', { text: inr(t.p) }), el('span', { text: 'Balance due' }), el('b', { style: t.due > 0 ? 'color:#b3261e' : '', text: inr(t.due) })]); }
    var ms = el('span', 'msg'), go = btn('Create order', '', create);
    function create() {
      var m = L.mob(mobile.value); if (m.length !== 10) return say(ms, 'Enter a valid 10-digit mobile number.', 'err'); if (name.value.trim().length < 2) return say(ms, 'Enter the patient name.', 'err'); if (!items.length) return say(ms, 'Add at least one test.', 'err');
      var t = totals(); go.disabled = true; say(ms, 'Creating...', 'info');
      api('POST', '/staff/orders', { name: name.value, mobile: m, age: age.value, sex: sex.value, ref_doctor: doc.value, kind: kind.value, notes: notes.value, tests: items, discount: t.d, paid: t.p, pay_mode: t.p ? mode.value : '' })
        .then(function (r) { L.refreshDash(); success(r.order, r.pin); }).catch(function (e) { go.disabled = false; say(ms, e.message, 'err'); });
    }
    function success(o, pin) {
      page.textContent = '';
      page.appendChild(el('section', 'card', [el('h2', { text: 'Order created' }), el('p', null, [el('b', { text: o.code }), ' for ' + o.name + ' (' + o.mobile + ')']),
        el('p', { class: 'note', text: 'Report PIN (shown only now. Give it to the patient. They need it to see reports online):' }), el('div', { class: 'pin', text: pin }),
        el('div', 'sum', [el('span', { text: 'Total' }), el('b', { text: inr(o.amount) }), el('span', { text: 'Paid' }), el('b', { text: inr(o.paid) }), el('span', { text: 'Balance due' }), el('b', { text: inr(o.due) })]),
        el('div', 'row', [btn('Print receipt', '', function () { L.receipt(o, pin); }), btn('Send on WhatsApp', 'ghost', function () { window.open(L.waLink(o, pin), '_blank'); }), btn('Open order', 'ghost', function () { L.go('order', o.code); }), btn('New order', 'ghost', function () { L.go('new'); })])]));
    }
    page.appendChild(el('div', 'card', [el('h2', { text: '1. Patient' }), el('div', 'form2', [fld('Mobile number', mobile), fld('Patient name', name), fld('Age', age), fld('Sex', sex), fld('Referred by', doc), fld('Collection', kind), fld('Notes', notes, 'full'), info])]));
    page.appendChild(el('div', 'card', [el('h2', { text: '2. Tests' }), fld('Add test or package', q), sugg, el('p', { class: 'upd', text: 'Quick packages:' }), chips, custom,
      el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, [el('th', { text: 'Test' }), el('th', { class: 'num', text: 'Price' }), el('th')])), tbody]))]));
    page.appendChild(el('div', 'card', [el('h2', { text: '3. Billing' }), el('div', 'filters', [fld('Discount (₹)', disc), memBtn, fld('Paid now (₹)', paid), fld('Payment mode', mode), btn('Paid in full', 'ghost', function () { paid.value = totals().t; draw(); })]), sum, el('div', 'row', [go, ms])]));
    draw(); done(); mobile.focus();
  };

  /* ======================= PATIENTS ======================= */
  L.views.patients = function (page, _a, done) {
    var q = el('input', { type: 'search', placeholder: 'Search by name or mobile' }), body = el('div');
    function load() {
      api('GET', '/staff/patients?q=' + encodeURIComponent(q.value.trim())).then(function (r) {
        body.textContent = ''; if (!r.patients.length) body.appendChild(el('p', { class: 'empty', text: 'No patients found.' }));
        else body.appendChild(el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, ['Patient', 'Mobile', 'Orders', 'Last visit', 'Billed', 'Due', 'Membership'].map(function (h, i) { return el('th', { class: i > 1 && i < 6 ? 'num' : '', text: h }); }))),
          el('tbody', null, r.patients.map(function (p) {
            return el('tr', { class: 'click', tabindex: 0, onclick: function () { L.go('orders', '?q=' + p.mobile); }, onkeydown: function (e) { if (e.key === 'Enter') L.go('orders', '?q=' + p.mobile); } }, [el('td', null, [el('b', { text: p.name }), el('div', { class: 'upd', text: (p.age != null ? p.age + ' yrs ' : '') + (p.sex || '') })]), el('td', { text: p.mobile }), el('td', 'num', String(p.orders)), el('td', 'num', fdate(p.last)),
              el('td', 'num', inr(p.billed)), el('td', 'num', p.due > 0 ? el('span', { style: 'color:#b3261e', text: inr(p.due) }) : '-'), el('td', null, p.membership ? [el('span', 'tag', p.membership.tier), ' ', badge(p.membership.status)] : '-')]);
          }))])));
        done();
      }).catch(function (e) { L.fail($('#page'), e); });
    }
    var t; q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 300); });
    page.appendChild(el('div', 'card', [el('div', 'filters', fld('Search', q)), body, el('p', { class: 'upd', text: 'Click a patient to see all their orders.' })])); load();
  };

  /* ======================= INBOX (tickets, chat, memberships) ======================= */
  L.views.inbox = function (page, arg, done) {
    var tab = arg || 'tickets', pane = el('div'), tabs = el('div', 'tabs2'), timers = [];
    L.onLeave(function () { timers.forEach(clearInterval); });
    [['tickets', 'Support tickets'], ['chat', 'Live chat'], ['members', 'Memberships']].forEach(function (t) { tabs.appendChild(el('button', { type: 'button', 'aria-selected': String(t[0] === tab), text: t[1], onclick: function () { L.go('inbox', t[0]); } })); });
    page.appendChild(tabs); page.appendChild(pane);
    function bubbles(list, me) { return list.map(function (m) { return el('div', 'bub ' + (m.from === me ? 'me' : 'them'), [m.body, el('small', { text: (m.label ? m.label + ' · ' : '') + fdt(m.ts) })]); }); }

    if (tab === 'tickets') {
      var filt = el('select', null, opts([['active', 'Open and answered'], ['open', 'Waiting for us'], ['closed', 'Closed'], ['', 'All']], 'active')), list = el('div', 'list'), view = el('div'), cur = '';
      function loadList() {
        api('GET', '/staff/tickets?status=' + filt.value).then(function (r) {
          list.textContent = ''; if (!r.tickets.length) list.appendChild(el('p', { class: 'empty', text: 'No tickets.' }));
          r.tickets.forEach(function (t) { list.appendChild(el('button', { type: 'button', class: t.id === cur ? 'on' : '', onclick: function () { cur = t.id; show(t); loadList(); } }, [el('b', { text: t.subject }), el('small', { text: t.name + ' · ' + t.id + ' · ' + fdt(t.updated) }), ' ', badge(t.status)])); });
          done();
        }).catch(function (e) { L.fail($('#page'), e); });
      }
      function show(t) {
        view.textContent = ''; var reply = el('textarea', { placeholder: 'Write a reply...', 'aria-label': 'Reply' }), ms = el('span', 'msg');
        function send(close) { api('POST', '/staff/tickets/' + t.id + '/reply', { message: reply.value, close: close }).then(function (r) { toast(close ? 'Ticket closed' : 'Reply sent'); L.refreshDash(); show(r.ticket); loadList(); }).catch(function (e) { say(ms, e.message, 'err'); }); }
        view.appendChild(el('div', 'card', [el('div', 'row', [el('h3', { text: t.subject, style: 'margin:0' }), badge(t.status)]), el('p', { class: 'upd', text: t.name + ' · ' + t.mobile + ' · ' + t.category + ' · ' + t.id }), el('div', 'thread', bubbles(t.msgs, 'staff')), reply,
          el('div', 'row', [btn('Send reply', '', function () { if (!reply.value.trim()) return say(ms, 'Write a reply first.', 'err'); send(false); }), btn('Send and close', 'ghost', function () { send(true); }), t.status !== 'closed' ? btn('Close without reply', 'ghost', function () { reply.value = ''; send(true); }) : null, ms])]));
      }
      filt.addEventListener('change', loadList);
      pane.appendChild(el('div', 'split', [el('div', null, [fld('Show', filt), list]), view])); loadList(); timers.push(setInterval(loadList, 20000));
    } else if (tab === 'chat') {
      var clist = el('div', 'list'), cview = el('div'), active = '', after = 0, seen = {}, thread, ptimer;
      function loadChats() {
        api('GET', '/staff/chats').then(function (r) {
          clist.textContent = ''; if (!r.chats.length) clist.appendChild(el('p', { class: 'empty', text: 'No chats yet.' }));
          r.chats.forEach(function (c) { clist.appendChild(el('button', { type: 'button', class: c.mobile === active ? 'on' : '', onclick: function () { open(c); } }, [el('b', null, [c.name, c.unread ? el('span', 'unread') : null]), el('small', { text: (c.from === 'staff' ? 'You: ' : '') + c.preview })])); });
          done();
        }).catch(function (e) { L.fail($('#page'), e); });
      }
      function pull() { if (!active) return; api('GET', '/staff/chats/' + active + '?after=' + after, undefined, { quiet: true }).then(function (r) { r.messages.forEach(append); }).catch(function () { }); }
      function append(m) { if (seen[m.id]) return; seen[m.id] = 1; after = Math.max(after, m.ts); var near = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80; thread.appendChild(bubbles([m], 'staff')[0]); if (near) thread.scrollTop = thread.scrollHeight; }
      function open(c) {
        active = c.mobile; after = 0; seen = {}; cview.textContent = ''; thread = el('div', 'thread'); var inp = el('input', { placeholder: 'Type a message', maxlength: 500, 'aria-label': 'Message' }), ms = el('span', 'msg');
        var form = el('form', null, [inp, btn('Send', '', null)]); form.lastChild.type = 'submit'; form.lastChild.onclick = null;
        form.addEventListener('submit', function (e) { e.preventDefault(); var v = inp.value.trim(); if (!v) return; api('POST', '/staff/chats/' + active, { body: v }).then(function (r) { inp.value = ''; append(r.message); L.refreshDash(); }).catch(function (er) { say(ms, er.message, 'err'); }); });
        cview.appendChild(el('div', 'card chat', [el('h3', { text: c.name + ' · ' + c.mobile }), thread, form, ms]));
        api('GET', '/staff/chats/' + active + '?after=0').then(function (r) { r.messages.forEach(append); thread.scrollTop = thread.scrollHeight; L.refreshDash(); loadChats(); }).catch(function (e) { say(ms, e.message, 'err'); });
        clearInterval(ptimer); ptimer = setInterval(pull, 4000); timers.push(ptimer);
      }
      pane.appendChild(el('div', 'split', [clist, cview])); loadChats(); timers.push(setInterval(loadChats, 15000));
    } else {
      var fs = el('select', null, opts([['requested', 'Requests'], ['active', 'Active members'], ['cancelled', 'Cancelled'], ['', 'All']], 'requested')), body = el('div');
      function loadM() {
        Promise.all([api('GET', '/staff/members?status=' + fs.value), api('GET', '/plans')]).then(function (x) {
          var pl = {}; x[1].plans.forEach(function (p) { pl[p.id] = p; }); body.textContent = '';
          if (!x[0].members.length) body.appendChild(el('p', { class: 'empty', text: 'Nobody here.' }));
          else body.appendChild(el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, ['Customer', 'Plan', 'Status', 'Since', ''].map(function (h) { return el('th', { text: h }); }))), el('tbody', null, x[0].members.map(function (m) {
            var p = pl[m.membership.tier] || { name: m.membership.tier, price: 0, discount: 0 };
            function set(st) { api('POST', '/staff/members', { mobile: m.mobile, tier: m.membership.tier, status: st }).then(function () { toast('Updated'); L.refreshDash(); loadM(); }).catch(function (e) { toast(e.message); }); }
            return el('tr', null, [el('td', null, [el('b', { text: m.name }), el('div', { class: 'upd', text: m.mobile })]), el('td', null, [el('span', 'tag t-' + p.id, p.name), el('div', { class: 'upd', text: inr(p.price) + '/yr · ' + p.discount + '% off' })]), el('td', null, badge(m.membership.status)),
              el('td', { text: m.membership.since ? fdate(m.membership.since) : (m.membership.requested ? 'Requested ' + fdate(m.membership.requested) : '-') }), el('td', 'row', [m.membership.status !== 'active' ? btn('Activate (payment received)', '', function () { set('active'); }) : null, m.membership.status !== 'cancelled' ? btn('Cancel', 'ghost', function () { set('cancelled'); }) : null])]);
          }))])));
          done();
        }).catch(function (e) { L.fail($('#page'), e); });
      }
      fs.addEventListener('change', loadM); pane.appendChild(el('div', 'card', [el('div', 'filters', fld('Show', fs)), body, el('p', { class: 'note', text: 'Collect the plan fee first (counter, UPI or WhatsApp), then press Activate. Active members get their discount suggested automatically when you bill them.' })])); loadM();
    }
  };

  /* ======================= REPORTS ======================= */
  L.views.reports = function (page, _a, done) {
    var range = el('select', null, opts([['0', 'Today'], ['-1', 'Yesterday'], ['-6', 'Last 7 days'], ['-29', 'Last 30 days'], ['m', 'This month'], ['c', 'Custom dates']], '-6'));
    var f = el('input', { type: 'date' }), t = el('input', { type: 'date' }), body = el('div'), last = null;
    function bounds() {
      var v = range.value, now = L.dayStart(0), DAY = 86400000;
      if (v === '0') return [now, now + DAY]; if (v === '-1') return [L.dayStart(-1), now]; if (v === 'm') { var d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return [d.getTime(), now + DAY]; }
      if (v === 'c') { if (!f.value || !t.value) return null; var a = new Date(f.value + 'T00:00:00').getTime(), b = new Date(t.value + 'T00:00:00').getTime() + DAY; return [a, b]; }
      return [L.dayStart(Number(v)), now + DAY];
    }
    function dayLabel(d) { var x = new Date(d * 86400000); return x.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()]; }
    function load() {
      var b = bounds(); f.parentNode.hidden = t.parentNode.hidden = range.value !== 'c'; if (!b) { body.textContent = ''; return; }
      api('GET', '/staff/summary?from=' + b[0] + '&to=' + b[1] + '&tz=' + (-new Date().getTimezoneOffset())).then(function (r) {
        last = r; body.textContent = '';
        body.appendChild(el('div', 'grid4', [el('div', 'kpi', [el('b', { text: String(r.orders) }), el('span', { text: 'Orders' })]), el('div', 'kpi', [el('b', { text: inr(r.billed) }), el('span', { text: 'Billed' })]), el('div', 'kpi', [el('b', { text: inr(r.paid) }), el('span', { text: 'Collected' })]), el('div', 'kpi warn', [el('b', { text: inr(r.due) }), el('span', { text: 'Not yet collected' })])]));
        var max = Math.max.apply(null, r.by_day.map(function (d) { return d.billed; }).concat([1]));
        body.appendChild(el('section', 'card', [el('h2', { text: 'Billing by day' })].concat(r.by_day.length ? r.by_day.map(function (d) { return el('div', 'bar', [el('span', { text: dayLabel(d.day) }), el('i', { style: 'width:' + Math.max(1, Math.round(d.billed / max * 60)) + '%' }), el('span', { text: inr(d.billed) + ' · ' + d.orders + ' orders' })]); }) : [el('p', { class: 'empty', text: 'No orders in this period.' })])));
        var modes = Object.keys(r.by_mode);
        body.appendChild(el('section', 'card', [el('h2', { text: 'Money received by mode' }), modes.length ? el('div', 'chips', modes.map(function (m) { return el('span', 'chip', m.toUpperCase() + ': ' + inr(r.by_mode[m])); })) : el('p', { class: 'empty', text: 'Nothing collected.' })]));
        body.appendChild(el('section', 'card', [el('h2', { text: 'Most billed tests' }), r.top_tests.length ? el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, [el('th', { text: 'Test' }), el('th', { class: 'num', text: 'Count' }), el('th', { class: 'num', text: 'Revenue' })])),
          el('tbody', null, r.top_tests.map(function (x) { return el('tr', null, [el('td', { text: x.name }), el('td', 'num', String(x.count)), el('td', 'num', inr(x.revenue))]); }))])) : el('p', { class: 'empty', text: 'No data.' })]));
        done();
      }).catch(function (e) { if (e.status === 400) { body.textContent = ''; body.appendChild(el('p', { class: 'msg err', text: e.message })); done(); } else L.fail($('#page'), e); });
    }
    function csv() {
      if (!last) return; var rows = [['Date', 'Orders', 'Billed']].concat(last.by_day.map(function (d) { return [dayLabel(d.day), d.orders, d.billed]; })).concat([[], ['Test', 'Count', 'Revenue']]).concat(last.top_tests.map(function (x) { return [x.name, x.count, x.revenue]; }));
      var text = rows.map(function (r) { return r.map(function (c) { c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
      var a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: 'trinetri-report.csv' }); document.body.appendChild(a); a.click(); a.remove();
    }
    [range, f, t].forEach(function (x) { x.addEventListener('change', load); });
    page.appendChild(el('div', 'card', [el('div', 'filters', [fld('Period', range), fld('From', f), fld('To', t), btn('Download CSV', 'ghost', csv)])])); page.appendChild(body); load();
  };

  /* ======================= STOCK ======================= */
  L.views.stock = function (page, _a, done) {
    var body = el('div');
    function load() {
      api('GET', '/staff/stock').then(function (r) {
        body.textContent = ''; if (!r.items.length) body.appendChild(el('p', { class: 'empty', text: 'No stock items yet. Add reagents, tubes, gloves and so on below.' }));
        else body.appendChild(el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, [el('th', { text: 'Item' }), el('th', { class: 'num', text: 'In stock' }), el('th', { class: 'num', text: 'Alert at' }), el('th', { text: 'Updated' }), el('th')])), el('tbody', null, r.items.map(function (i) {
          return el('tr', { class: i.low ? 'lowrow' : '' }, [el('td', null, [el('b', { text: i.name }), i.low ? [' ', el('span', 'badge2 b-open', 'Low')] : null]), el('td', 'num', i.qty + ' ' + i.unit), el('td', 'num', i.min + ' ' + i.unit), el('td', { text: fdate(i.updated) }),
            el('td', 'row', [btn('Adjust', '', function () { adjust(i); }), btn('History', 'ghost', function () { hist(i); }), btn('Edit', 'ghost', function () { edit(i); })])]);
        }))])));
        done();
      }).catch(function (e) { L.fail($('#page'), e); });
    }
    function adjust(i) {
      var d = el('input', { type: 'number', step: 1, placeholder: 'e.g. 10 or -2' }), n = el('input', { placeholder: 'e.g. Purchase, used for CBC' }), ms = el('span', 'msg');
      modal('Adjust stock: ' + i.name, el('div', null, [el('p', { class: 'note', text: 'Now ' + i.qty + ' ' + i.unit + '. Enter a positive number when stock arrives and a negative number when it is used.' }), fld('Change', d), fld('Note', n), ms]), [{ text: 'Cancel', cls: 'ghost' }, { text: 'Save', keep: true, fn: function (close) { api('POST', '/staff/stock/' + i.id + '/adjust', { delta: d.value, note: n.value }).then(function () { close(); toast('Stock updated'); L.refreshDash(); load(); }).catch(function (e) { say(ms, e.message, 'err'); }); } }]);
    }
    function hist(i) { api('GET', '/staff/stock/' + i.id + '/log').then(function (r) { modal('History: ' + i.name, r.log.length ? el('table', 'tbl', el('tbody', null, r.log.map(function (l) { return el('tr', null, [el('td', { text: fdt(l.ts) }), el('td', 'num', (l.delta > 0 ? '+' : '') + l.delta), el('td', { text: (l.note || '') + (l.by ? ' (' + l.by + ')' : '') })]); }))) : el('p', { text: 'No history.' }), [{ text: 'Close', cls: 'ghost' }]); }).catch(function (e) { toast(e.message); }); }
    function edit(i) {
      var n = el('input', { value: i.name }), u = el('input', { value: i.unit }), m = el('input', { type: 'number', min: 0, value: i.min }), ms = el('span', 'msg');
      modal('Edit item', el('div', 'form2', [fld('Name', n, 'full'), fld('Unit', u), fld('Alert when stock is at or below', m), ms]), [{ text: 'Remove item', cls: 'danger', keep: true, fn: function (close) { api('POST', '/staff/stock', { id: i.id, name: n.value, unit: u.value, min: m.value, remove: true }).then(function () { close(); L.refreshDash(); load(); }).catch(function (e) { say(ms, e.message, 'err'); }); } }, { text: 'Cancel', cls: 'ghost' },
        { text: 'Save', keep: true, fn: function (close) { api('POST', '/staff/stock', { id: i.id, name: n.value, unit: u.value, min: m.value }).then(function () { close(); L.refreshDash(); load(); }).catch(function (e) { say(ms, e.message, 'err'); }); } }]);
    }
    var nn = el('input', { placeholder: 'e.g. EDTA tubes' }), nu = el('input', { placeholder: 'box, pcs, ml' }), nq = el('input', { type: 'number', min: 0, value: 0 }), nm = el('input', { type: 'number', min: 0, value: 0 }), ms = el('span', 'msg');
    page.appendChild(el('div', 'card', [el('h2', { text: 'Add an item' }), el('div', 'filters', [fld('Item', nn), fld('Unit', nu), fld('Quantity now', nq), fld('Alert at or below', nm), btn('Add', '', function () { api('POST', '/staff/stock', { name: nn.value, unit: nu.value, qty: nq.value, min: nm.value }).then(function () { nn.value = nu.value = ''; nq.value = nm.value = 0; say(ms, '', ''); toast('Added'); L.refreshDash(); load(); }).catch(function (e) { say(ms, e.message, 'err'); }); }), ms])]));
    page.appendChild(el('div', 'card', [el('h2', { text: 'Stock' }), body])); load();
  };

  /* ======================= RESULT TEMPLATES ======================= */
  L.views.templates = function (page, arg, done) {
    var canEdit = can('templates'), list = el('div', 'list'), view = el('div'), search = el('input', { type: 'search', placeholder: 'Search templates' }), all = [], cur = arg || '';
    function drawList() {
      var q = search.value.toLowerCase(); list.textContent = '';
      all.filter(function (t) { return !q || (t.name + t.key).toLowerCase().indexOf(q) >= 0; }).forEach(function (t) { list.appendChild(el('button', { type: 'button', class: t.key === cur ? 'on' : '', onclick: function () { cur = t.key; drawList(); editor(t); } }, [el('b', { text: t.name }), el('small', { text: t.key + ' · ' + t.params.length + ' parameters' })])); });
    }
    function editor(t) {
      view.textContent = ''; var isNew = !t; t = t || { key: '', name: '', params: [{ name: '', unit: '', low: null, high: null, flo: null, fhi: null, ref: '' }], match: [] };
      var key = el('input', { value: t.key, placeholder: 'T:CODE (price-list test) or P:NAME or C:CUSTOM', disabled: !isNew }), name = el('input', { value: t.name }), match = el('input', { value: (t.match || []).join(', '), placeholder: 'words in a billed test name that select this template, e.g. CBC, HEMOGRAM' }), ms = el('span', 'msg');
      var ps = JSON.parse(JSON.stringify(t.params)), rows = el('div');
      function nv(v) { return v == null ? '' : v; }
      function draw() {
        rows.textContent = ''; rows.appendChild(el('div', 'trow h', ['Parameter', 'Unit', 'Low', 'High', 'F low', 'F high', 'Reference text', ''].map(function (h) { return el('span', { text: h }); })));
        ps.forEach(function (p, i) { function inp(k, ph, type) { var e = el('input', { value: nv(p[k]), placeholder: ph, 'aria-label': ph, type: type || 'text', step: 'any', disabled: !canEdit }); e.addEventListener('input', function () { p[k] = e.value; }); return e; }
          rows.appendChild(el('div', 'trow', [inp('name', 'Parameter'), inp('unit', 'Unit'), inp('low', 'Low', 'number'), inp('high', 'High', 'number'), inp('flo', 'Female low', 'number'), inp('fhi', 'Female high', 'number'), inp('ref', 'Reference text'), canEdit ? el('button', { type: 'button', class: 'x', 'aria-label': 'Remove', text: '×', onclick: function () { ps.splice(i, 1); draw(); } }) : el('span')])); });
        if (canEdit) rows.appendChild(btn('+ Add parameter', 'ghost', function () { ps.push({ name: '', unit: '', low: null, high: null, flo: null, fhi: null, ref: '' }); draw(); }));
      }
      draw();
      var acts = el('div', 'row');
      if (canEdit) {
        acts.appendChild(btn('Save template', '', function () { api('POST', '/staff/templates', { key: key.value, name: name.value, params: ps, match: match.value.split(',') }).then(function () { L.resetTemplates(); cur = key.value.toUpperCase(); toast('Template saved'); L.go('templates', cur); }).catch(function (e) { say(ms, e.message, 'err'); }); }));
        if (!isNew) acts.appendChild(btn('Delete', 'danger', function () { L.confirmBox('Delete the template "' + t.name + '"?', 'Delete', function () { api('POST', '/staff/templates/delete', { key: t.key }).then(function () { L.resetTemplates(); toast('Deleted'); L.go('templates'); }).catch(function (e) { toast(e.message); }); }); }));
      }
      acts.appendChild(ms);
      view.appendChild(el('div', 'card', [el('h2', { text: isNew ? 'New template' : t.name }), el('div', 'form2', [fld('Key', key), fld('Name shown on the report', name), fld('Auto-select words', match, 'full')]), el('div', 'tbl-wrap', rows), acts,
        el('p', { class: 'note', text: 'Low and High drive the H and L flags. "F low / F high" are used instead for female patients. Ranges depend on your analyser and kits. Have your pathologist review them before issuing reports.' })]));
    }
    api('GET', '/staff/templates').then(function (r) {
      all = r.templates; search.addEventListener('input', drawList); drawList();
      page.appendChild(el('div', 'split', [el('div', null, [fld('Search', search), canEdit ? el('p', null, btn('+ New template', '', function () { cur = ''; drawList(); editor(null); })) : null, list]), view]));
      var t = all.filter(function (x) { return x.key === cur; })[0]; if (t) editor(t); else view.appendChild(el('p', { class: 'empty', text: 'Choose a template to view or edit.' })); done();
    }).catch(function (e) { L.fail($('#page'), e); });
  };

  /* ======================= STAFF ======================= */
  L.views.staff = function (page, _a, done) {
    var body = el('div');
    function load() {
      api('GET', '/staff/users').then(function (r) {
        body.textContent = ''; body.appendChild(el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, ['Name', 'Username', 'Role', 'Status', ''].map(function (h) { return el('th', { text: h }); }))), el('tbody', null, r.users.map(function (u) {
          return el('tr', null, [el('td', null, [el('b', { text: u.name }), u.title ? el('div', { class: 'upd', text: u.title }) : null]), el('td', { text: u.username }), el('td', { text: L.roles[u.role] || u.role }), el('td', null, u.active ? badge('active', 'Active') : badge('closed', 'Disabled')), el('td', null, btn('Edit', 'ghost', function () { edit(u); }))]);
        }))]))); done();
      }).catch(function (e) { L.fail($('#page'), e); });
    }
    function roleSel(v) { return el('select', null, opts([['reception', 'Reception: register, bill, inbox, memberships'], ['technician', 'Technician: samples, enter results, stock'], ['doctor', 'Doctor / Pathologist: results, approve reports, templates'], ['admin', 'Admin: everything incl. staff']], v)); }
    function edit(u) {
      var n = el('input', { value: u.name }), t = el('input', { value: u.title || '' }), r = roleSel(u.role), a = el('select', null, opts([['1', 'Active'], ['0', 'Disabled (cannot log in)']], u.active ? '1' : '0')), pw = el('input', { type: 'password', placeholder: 'Leave empty to keep', autocomplete: 'new-password' }), ms = el('span', 'msg');
      modal('Edit ' + u.username, el('div', 'form2', [fld('Name', n), fld('Title on reports', t), fld('Role', r, 'full'), fld('Status', a), fld('New password', pw), ms]), [{ text: 'Cancel', cls: 'ghost' }, { text: 'Save', keep: true, fn: function (close) {
        var b = { name: n.value, title: t.value, role: r.value, active: a.value === '1' }; if (pw.value) b.password = pw.value;
        api('POST', '/staff/users/' + u.id, b).then(function () { close(); toast('Saved'); load(); }).catch(function (e) { say(ms, e.message, 'err'); });
      } }]);
    }
    var un = el('input', { autocapitalize: 'none', autocomplete: 'off' }), nn = el('input'), tt = el('input', { placeholder: 'e.g. MD Pathology, KMC Reg. No. 12345' }), rr = roleSel('reception'), pp = el('input', { type: 'password', autocomplete: 'new-password' }), ms = el('span', 'msg');
    page.appendChild(el('div', 'card', [el('h2', { text: 'Add a staff login' }), el('div', 'form2', [fld('Name', nn), fld('Username', un), fld('Role', rr, 'full'), fld('Title on reports (doctors)', tt), fld('Password (8+ characters)', pp)]),
      el('div', 'row', [btn('Create login', '', function () { api('POST', '/staff/users', { name: nn.value, username: un.value, role: rr.value, title: tt.value, password: pp.value }).then(function () { nn.value = un.value = tt.value = pp.value = ''; say(ms, 'Login created.', 'ok'); load(); }).catch(function (e) { say(ms, e.message, 'err'); }); }), ms])]));
    page.appendChild(el('div', 'card', [el('h2', { text: 'Staff' }), body])); load();
  };

  /* ======================= MY ACCOUNT ======================= */
  L.views.acct = function (page, _a, done) {
    api('GET', '/staff/me').then(function (r) {
      var s = r.staff, o = el('input', { type: 'password', autocomplete: 'current-password' }), n = el('input', { type: 'password', autocomplete: 'new-password' }), ms = el('span', 'msg');
      page.appendChild(el('div', 'card', [el('h2', { text: s.name }), el('p', { text: (L.roles[s.role] || s.role) + ' · username ' + s.username }), s.title ? el('p', { class: 'note', text: 'Shown on approved reports: ' + s.title }) : null]));
      page.appendChild(el('div', 'card', [el('h2', { text: 'Change password' }), el('div', 'form2', [fld('Current password', o), fld('New password (8+ characters)', n)]), el('div', 'row', [btn('Change password', '', function () { api('POST', '/staff/password', { old: o.value, new: n.value }).then(function () { o.value = n.value = ''; say(ms, 'Password changed.', 'ok'); }).catch(function (e) { say(ms, e.message, 'err'); }); }), ms])]));
      done();
    }).catch(function (e) { L.fail($('#page'), e); });
  };
})();
