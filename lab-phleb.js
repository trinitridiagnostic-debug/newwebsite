/* Trinetri Diagnostics lab console: Phlebotomists tab (list, add, edit, delete, and how many we have in each district / taluk). */
(function () {
  'use strict';
  var L = window.LAB; if (!L) return;
  var el = L.el, fld = L.fld, api = L.api, toast = L.toast, say = L.say, can = L.can, modal = L.modal, K = window.KARNATAKA || {};
  function btn(text, cls, fn) { return el('button', { type: 'button', class: 'btn sm ' + (cls || ''), text: text, onclick: fn }); }
  var DISTRICTS = Object.keys(K).sort();
  function locPicker(d, t) {
    var ds = el('select', null, [el('option', { value: '', text: 'Select district' })].concat(DISTRICTS.map(function (x) { return el('option', { value: x, text: x, selected: x === d }); }))), ts = el('select');
    function fill() { ts.textContent = ''; ts.appendChild(el('option', { value: '', text: 'Select taluk' })); (K[ds.value] || []).forEach(function (x) { ts.appendChild(el('option', { value: x, text: x, selected: x === t })); }); ts.disabled = !ds.value; }
    ds.addEventListener('change', function () { t = ''; fill(); }); fill();
    return { ds: ds, ts: ts };
  }
  function form(p) {
    p = p || {};
    var name = el('input', { value: p.name || '', maxlength: '60', placeholder: 'Full name' }), mob = el('input', { value: p.mobile || '', inputmode: 'tel', maxlength: '10', placeholder: '10-digit mobile' }),
      user = el('input', { value: p.username || '', maxlength: '30', placeholder: 'Login username', autocapitalize: 'off' }), pw = el('input', { type: 'text', placeholder: p.id ? 'Leave empty to keep the same' : 'At least 8 characters', autocomplete: 'off' }),
      loc = locPicker(p.district || '', p.taluka || ''), act = el('select', null, [el('option', { value: '1', text: 'Active', selected: p.active !== false }), el('option', { value: '0', text: 'Inactive (cannot log in)', selected: p.active === false })]);
    mob.addEventListener('input', function () { mob.value = mob.value.replace(/\D/g, '').slice(0, 10); });
    if (p.id) user.disabled = true;
    var ms = el('span', 'msg');
    var node = el('div', 'form2', [fld('Name', name, 'full'), fld('Mobile', mob), fld('Username', user), fld('District', loc.ds), fld('Taluk', loc.ts), fld(p.id ? 'New password' : 'Password', pw), p.id ? fld('Status', act) : null, ms]);
    return { node: node, ms: ms, body: function () { var b = { name: name.value, mobile: mob.value, district: loc.ds.value, taluka: loc.ts.value, password: pw.value }; if (!p.id) b.username = user.value; else b.active = act.value === '1'; if (!b.password) delete b.password; return b; } };
  }
  L.views.phlebs = function (page, _a, done) {
    var rows = [], fd = '', ft = '', fs = '', canEdit = can('staff'), sumBox = el('div'), listBox = el('div');
    function load() {
      return api('GET', '/staff/phlebotomists').then(function (d) { rows = d.phlebotomists; draw(); }).catch(function (e) { L.fail(page, e); done(); });
    }
    function edit(p) {
      var f = form(p);
      modal(p ? 'Edit phlebotomist' : 'Add phlebotomist', f.node, [{ text: 'Cancel', cls: 'ghost' }, { text: 'Save', keep: true, fn: function (close) {
        say(f.ms, 'Saving...', 'info');
        api('POST', p ? '/staff/phlebotomists/' + encodeURIComponent(p.id) : '/staff/phlebotomists', f.body()).then(function () { close(); toast('Saved'); load(); }).catch(function (e) { say(f.ms, e.message, 'err'); });
      } }]);
    }
    function del(p) {
      L.confirmBox('Delete ' + p.name + '? Their login stops working and any unfinished visits go back to the open list. Past collected visits stay in the records.' + (p.open ? ' (' + p.open + ' unfinished visit' + (p.open > 1 ? 's' : '') + ' will be released.)' : ''), 'Delete', function () {
        api('POST', '/staff/phlebotomists/' + encodeURIComponent(p.id) + '/delete').then(function () { toast('Deleted'); load(); }).catch(function (e) { toast(e.message); });
      });
    }
    function schedule(p) {
      var box = el('div', null, [el('p', { class: 'note', text: 'Loading...' })]);
      modal('Advance schedule: ' + p.name, box, [{ text: 'Close', cls: 'ghost' }]);
      api('GET', '/staff/phlebotomists/' + encodeURIComponent(p.id) + '/schedule').then(function (d) {
        box.textContent = '';
        var yes = d.days.filter(function (x) { return x.state === 'yes'; }).length, no = d.days.filter(function (x) { return x.state === 'no'; }).length;
        box.appendChild(el('p', { class: 'note', text: yes + ' day' + (yes === 1 ? '' : 's') + ' available, ' + no + ' not available, ' + (d.days.length - yes - no) + ' not answered yet.' }));
        d.days.forEach(function (x) {
          var dt = new Date(x.day + 'T00:00:00'), label = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()] + ', ' + dt.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getMonth()];
          var slots = el('div', 'slotrow');
          if (x.state === 'yes') for (var h = d.first; h <= d.last; h++) slots.appendChild(el('span', { class: 'sl' + (x.slots.indexOf(h) >= 0 ? ' on' : ''), text: ('0' + h).slice(-2) + ':00' }));
          box.appendChild(el('div', 'schday ' + x.state, [el('div', 'sh', [el('b', { text: label }), el('span', { class: 'sb', text: x.state === 'yes' ? 'Available (' + x.slots.length + ' slots)' : x.state === 'no' ? 'Not available' : 'Not answered' }), x.on_leave ? el('span', { class: 'sb lv', text: 'Leave' }) : null]), slots]));
        });
      }).catch(function (e) { box.textContent = ''; box.appendChild(el('p', { class: 'msg err', text: e.message })); });
    }
    function counts() { var c = {}; rows.forEach(function (p) { if (p.active && p.district) c[p.district] = (c[p.district] || 0) + 1; }); return c; }
    function draw() {
      var act = rows.filter(function (p) { return p.active; }), c = counts(), keys = Object.keys(c).sort(), noLoc = act.filter(function (p) { return !p.district; }).length;
      sumBox.textContent = '';
      var chips = el('div', 'row');
      chips.appendChild(btn('All (' + act.length + ')', fd ? 'ghost' : '', function () { fd = ''; ft = ''; draw(); }));
      keys.forEach(function (k) { chips.appendChild(btn(k + ' (' + c[k] + ')', fd === k ? '' : 'ghost', function () { fd = k; ft = ''; draw(); })); });
      var talukCounts = {}; act.forEach(function (p) { if (p.district === fd && p.taluka) talukCounts[p.taluka] = (talukCounts[p.taluka] || 0) + 1; });
      var tk = fd ? Object.keys(talukCounts).sort() : [];
      var covered = keys.length, missing = DISTRICTS.filter(function (d) { return !c[d]; });
      sumBox.appendChild(el('section', 'card', [el('h2', { text: 'Where our phlebotomists are' }),
        el('p', { class: 'note', text: act.length + ' active phlebotomist' + (act.length === 1 ? '' : 's') + ' in ' + covered + ' of ' + DISTRICTS.length + ' districts' + (noLoc ? '. ' + noLoc + ' without a location set.' : '.') }), chips,
        tk.length ? el('div', 'row', [el('span', { class: 'note', text: 'Taluks in ' + fd + ':' })].concat(tk.map(function (x) { return btn(x + ' (' + talukCounts[x] + ')', ft === x ? '' : 'ghost', function () { ft = ft === x ? '' : x; draw(); }); }))) : null,
        missing.length ? el('details', null, [el('summary', { text: 'Districts with no phlebotomist (' + missing.length + ')' }), el('p', { class: 'note', text: missing.join(', ') })]) : null]));
      var shown = rows.filter(function (p) { return (!fd || p.district === fd) && (!ft || p.taluka === ft) && (!fs || p.name.toLowerCase().indexOf(fs.toLowerCase()) >= 0 || p.mobile.indexOf(fs) >= 0); });
      listBox.textContent = '';
      if (!shown.length) { listBox.appendChild(el('div', { class: 'empty', text: rows.length ? 'No phlebotomists match.' : 'No phlebotomists yet. Add the first one.' })); return; }
      var trs = shown.map(function (p) {
        return el('tr', null, [el('td', null, [el('b', { text: p.name }), el('div', { class: 'note', text: '@' + p.username })]), el('td', { text: p.mobile || '-' }), el('td', { text: p.district || '-' }), el('td', { text: p.taluka || '-' }),
          el('td', null, [el('span', { class: 'badge2 b-' + (p.active ? (p.on_leave ? 'booked' : 'completed') : 'cancelled'), text: p.active ? (p.on_leave ? 'On leave today' : 'Active') : 'Inactive' })]),
          el('td', { class: 'num', text: p.served + ' done / ' + p.open + ' open' }),
          el('td', null, [btn('Schedule' + (p.active ? ' (' + p.sched_set + '/8)' : ''), 'ghost', function () { schedule(p); })]),
          canEdit ? el('td', null, [btn('Edit', 'ghost', function () { edit(p); }), ' ', btn('Delete', 'ghost', function () { del(p); })]) : null]);
      });
      listBox.appendChild(el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, ['Name', 'Mobile', 'District', 'Taluk', 'Status', 'Visits', 'Advance schedule', canEdit ? '' : null].filter(function (h) { return h !== null; }).map(function (h) { return el('th', { text: h }); }))), el('tbody', null, trs)])));
    }
    var search = el('input', { type: 'search', placeholder: 'Search name or mobile' }); search.addEventListener('input', function () { fs = search.value; draw(); });
    page.appendChild(el('div', 'row', [search, canEdit ? btn('Add phlebotomist', '', function () { edit(null); }) : null]));
    page.appendChild(sumBox); page.appendChild(listBox);
    load().then(function () { done(); });
  };

  /* ---------- daily attendance (selfie + GPS) ---------- */
  L.views.attendance = function (page, _a, done) {
    var d = el('input', { type: 'date' }), box = el('div'), now = new Date(); d.value = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
    function thumb(r) {
      var img = el('img', { alt: 'Selfie of ' + r.name, class: 'selfie-t' }), a = el('button', { type: 'button', class: 'linkb', 'aria-label': 'Open selfie' }, [img]);
      api('GET', '/staff/attendance/selfie?id=' + r.selfie, undefined, { blob: true }).then(function (b) { var u = URL.createObjectURL(b); img.src = u; a.onclick = function () { modal(r.name + ' - ' + L.fdt(r.at), el('img', { src: u, style: 'max-width:100%;border-radius:10px', alt: '' }), [{ text: 'Close', cls: 'ghost' }]); }; }).catch(function () { });
      return a;
    }
    function load() {
      box.textContent = ''; box.appendChild(el('div', { class: 'empty', text: 'Loading...' }));
      api('GET', '/staff/attendance?day=' + encodeURIComponent(d.value)).then(function (r) {
        box.textContent = ''; var pres = r.rows.filter(function (x) { return x.present; }).length, lv = r.rows.filter(function (x) { return !x.present && x.on_leave; }).length;
        box.appendChild(el('p', { class: 'note', text: pres + ' present, ' + lv + ' on leave, ' + (r.rows.length - pres - lv) + ' not marked yet (of ' + r.rows.length + ' active phlebotomists).' }));
        if (!r.rows.length) { box.appendChild(el('div', { class: 'empty', text: 'No phlebotomists yet.' })); return; }
        var trs = r.rows.map(function (x) {
          return el('tr', null, [el('td', null, x.present ? thumb(x) : '-'), el('td', null, [el('b', { text: x.name }), el('div', { class: 'note', text: [x.taluka, x.district].filter(Boolean).join(', ') || x.mobile })]),
            el('td', null, [el('span', { class: 'badge2 b-' + (x.present ? 'completed' : (x.on_leave ? 'booked' : 'cancelled')), text: x.present ? 'Present' : (x.on_leave ? 'On leave' : 'Not marked') })]), el('td', { text: x.at ? L.fdt(x.at) : '-' }),
            el('td', null, x.lat != null ? el('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + x.lat + ',' + x.lng, target: '_blank', rel: 'noopener', text: 'Open location' + (x.acc ? ' (±' + Math.round(x.acc) + ' m)' : '') }) : '-')]);
        });
        box.appendChild(el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, ['Selfie', 'Phlebotomist', 'Status', 'Marked at', 'GPS location'].map(function (h) { return el('th', { text: h }); }))), el('tbody', null, trs)])));
      }).catch(function (e) { box.textContent = ''; box.appendChild(el('p', { class: 'msg err', text: e.message })); });
    }
    d.addEventListener('change', load); page.appendChild(el('div', 'row', [fld('Date', d)])); page.appendChild(box); load(); done();
  };
})();
