/* Trinetri Diagnostics lab console: home-collection visits (assign phlebotomists, leave, SOS alerts). */
(function () {
  'use strict';
  var L = window.LAB; if (!L) return;
  var el = L.el, fld = L.fld, api = L.api, toast = L.toast, say = L.say, fdt = L.fdt, can = L.can;
  function btn(text, cls, fn) { return el('button', { type: 'button', class: 'btn sm ' + (cls || ''), text: text, onclick: fn }); }
  var PHS = { assigned: 'Assigned', accepted: 'Accepted', started: 'On the way', collected: 'Collected' };
  function slotText(v) { return v.slot_at ? fdt(v.slot_at) : 'Time not fixed'; }
  function phlebSelect(phlebs, cur) {
    var s = el('select', null, [el('option', { value: '', text: 'Not assigned (open for phlebotomists to pick)' })].concat(phlebs.map(function (p) {
      return el('option', { value: p.id, text: p.name + (p.on_leave ? ' (on leave today)' : ''), selected: p.id === cur });
    }))); return s;
  }
  function assign(code, id) { return api('POST', '/staff/orders/' + encodeURIComponent(code) + '/assign', { phleb: id }); }

  /* card on a home-collection order */
  L.homeCard = function (o) {
    var card = el('section', 'card', [el('h2', { text: 'Home visit' })]), body = el('div'); card.appendChild(body);
    body.appendChild(el('p', { class: 'note', text: 'Loading...' }));
    api('GET', '/staff/phlebs').then(function (d) {
      body.textContent = '';
      body.appendChild(el('p', null, [el('b', { text: 'Address: ' }), o.addr || 'Not given. Use Edit to add it.']));
      body.appendChild(el('p', null, [el('b', { text: 'Visit time: ' }), o.slot_at ? fdt(o.slot_at) : 'Not fixed']));
      body.appendChild(el('p', null, [el('b', { text: 'Phlebotomist status: ' }), o.ph_status ? (PHS[o.ph_status] || o.ph_status) : (o.ph_id ? 'Assigned' : 'Not assigned')]));
      if (o.status !== 'booked' || o.ph_status === 'collected') return;
      if (!can('assign')) return;
      var sel = phlebSelect(d.phlebs, o.ph_id || ''), ms = el('span', 'msg');
      body.appendChild(el('div', 'filters', [fld('Assign to', sel), btn('Save', '', function () {
        say(ms, 'Saving...', 'info'); assign(o.code, sel.value).then(function () { toast('Saved'); L.go('order', o.code); }).catch(function (e) { say(ms, e.message, 'err'); });
      }), ms]));
      if (!d.phlebs.length) body.appendChild(el('p', { class: 'note', text: 'No phlebotomist logins yet. Add one under Staff (role: Phlebotomist).' }));
    }).catch(function (e) { body.textContent = ''; body.appendChild(el('p', { class: 'msg err', text: e.message })); });
    return card;
  };

  /* Home visits page */
  L.views.visits = function (page, _a, done) {
    var state = 'open', list = el('div'), tabs = el('div', 'row'), side = el('div');
    var phlebs = [];
    function tab(s, t) { var b = btn(t, state === s ? '' : 'ghost', function () { state = s; draw(); load(); }); b.setAttribute('data-s', s); return b; }
    function draw() { tabs.textContent = ''; tabs.appendChild(tab('open', 'Open visits')); tabs.appendChild(tab('done', 'Completed')); }
    function row(v) {
      var sel = phlebSelect(phlebs, v.ph_id || ''), ms = el('span', 'msg');
      var right = state === 'open' ? el('div', 'filters', [sel, btn('Assign', '', function () { say(ms, 'Saving...', 'info'); assign(v.code, sel.value).then(function () { toast('Saved'); L.refreshDash(); load(); }).catch(function (e) { say(ms, e.message, 'err'); }); }), ms])
        : el('p', { class: 'note', text: 'Phlebotomist: ' + (v.ph_name || '-') });
      return el('div', 'card', [el('div', 'row', [el('b', { text: v.name }), el('a', { href: '#order/' + encodeURIComponent(v.code), text: v.code }), el('span', { class: 'badge2 b-' + (v.ph_status === 'collected' ? 'completed' : (v.ph_id ? 'processing' : 'booked')), text: v.ph_status ? (PHS[v.ph_status] || v.ph_status) : 'Not assigned' })]),
        el('p', { class: 'note', text: slotText(v) + ' - ' + (v.tests || []).join(', ') }), el('p', null, [v.addr || 'No address. Add it with Edit on the order.']),
        v.ph_name && state === 'open' ? el('p', { class: 'note', text: 'Phlebotomist: ' + v.ph_name }) : null, right]);
    }
    function load() {
      list.textContent = ''; list.appendChild(el('p', { class: 'empty', text: 'Loading...' }));
      api('GET', '/staff/visits?state=' + state).then(function (d) {
        list.textContent = ''; if (!d.visits.length) list.appendChild(el('p', { class: 'empty', text: state === 'open' ? 'No open home visits.' : 'No completed home visits yet.' }));
        d.visits.forEach(function (v) { list.appendChild(row(v)); });
      }).catch(function (e) { list.textContent = ''; list.appendChild(el('p', { class: 'msg err', text: e.message })); });
    }
    function loadSide() {
      side.textContent = '';
      api('GET', '/staff/sos').then(function (d) {
        var open = d.sos.filter(function (x) { return !x.ack_at; });
        if (open.length) {
          var c = el('div', 'card', [el('h2', { text: 'SOS alerts' })]);
          open.forEach(function (x) {
            c.appendChild(el('div', 'row', [el('b', { text: x.name }), el('span', { class: 'note', text: fdt(x.created) }),
              x.lat != null ? el('a', { href: 'https://www.google.com/maps?q=' + x.lat + ',' + x.lng, target: '_blank', rel: 'noopener', text: 'Open location' }) : el('span', { class: 'note', text: 'Location not shared' }),
              btn('Acknowledge', '', function () { api('POST', '/staff/sos/' + x.id + '/ack').then(function () { L.refreshDash(); loadSide(); }).catch(function (e) { toast(e.message); }); })]));
          });
          side.appendChild(c);
        }
      }).catch(function () { });
      api('GET', '/staff/leaves').then(function (d) {
        var c = el('div', 'card', [el('h2', { text: 'Phlebotomist leave' })]);
        if (!d.leaves.length) c.appendChild(el('p', { class: 'note', text: 'No leave planned.' }));
        d.leaves.forEach(function (x) { c.appendChild(el('p', null, [el('b', { text: x.name }), ' ' + x.from + (x.to !== x.from ? ' to ' + x.to : '') + (x.reason ? ' - ' + x.reason : '')])); });
        side.appendChild(c);
      }).catch(function () { });
    }
    draw(); page.appendChild(side); page.appendChild(el('div', 'card', [tabs, list]));
    api('GET', '/staff/phlebs').then(function (d) { phlebs = d.phlebs; load(); loadSide(); done(); }).catch(function (e) { L.fail(page, e); done(); });
    var t = setInterval(function () { if (location.hash === '#visits') { load(); loadSide(); } }, 30000); L.onLeave(function () { clearInterval(t); });
  };
})();
