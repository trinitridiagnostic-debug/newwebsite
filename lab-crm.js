/* Trinetri Diagnostics lab console: customer-care CRM (leads, import, team, integrations). */
(function () {
  'use strict';
  var L = window.LAB; if (!L) return;
  var el = L.el, fld = L.fld, api = L.api, toast = L.toast, say = L.say, can = L.can, modal = L.modal;
  var ST = [['new', 'New'], ['contacted', 'Contacted'], ['interested', 'Interested'], ['follow_up', 'Follow-up'], ['booked', 'Booked'], ['not_interested', 'Not interested'], ['wrong_number', 'Wrong number'], ['lost', 'Lost']];
  var SRC = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'], ['justdial', 'Justdial'], ['website', 'Website'], ['excel', 'Excel upload'], ['manual', 'Manual'], ['referral', 'Referral'], ['walkin', 'Walk-in'], ['other', 'Other']];
  var RL = { telecaller: 'Telecaller', marketing: 'Digital marketing', teamlead: 'Team leader', manager: 'Manager', admin: 'Super admin' };
  function lab(list, k) { for (var i = 0; i < list.length; i++) if (list[i][0] === k) return list[i][1]; return k; }
  function btn(text, cls, fn) { return el('button', { type: 'button', class: 'btn sm ' + (cls || ''), text: text, onclick: fn }); }
  function opts(list, cur, first) { var o = first ? [el('option', { value: '', text: first })] : []; list.forEach(function (x) { o.push(el('option', { value: x[0], text: x[1], selected: x[0] === cur })); }); return o; }
  function ago(ts) { var m = Math.round((Date.now() - ts) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; if (m < 1440) return Math.round(m / 60) + ' h ago'; return Math.round(m / 1440) + ' d ago'; }
  function srcBadge(s) { return el('span', { class: 'lsrc s-' + s, text: lab(SRC, s) }); }
  function stBadge(s) { return el('span', { class: 'lst st-' + s, text: lab(ST, s) }); }
  function csv(rows) { return rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n'); }
  function download(name, text) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  var people = null;
  function loadPeople() { return people ? Promise.resolve(people) : api('GET', '/staff/crm/users').then(function (d) { people = d; return d; }); }
  function assignable(d) { return d.users.filter(function (u) { return u.active && (u.role === 'telecaller' || u.role === 'teamlead' || u.role === 'manager'); }).map(function (u) { return [u.id, u.name + ' (' + RL[u.role] + ')']; }); }

  /* ======================= LEADS ======================= */
  L.views.crm = function (page, _a, done) {
    var f = { status: '', source: '', assignee: '', q: '', due: false, offset: 0 }, LIM = 50, total = 0, leads = [], sel = {}, statBox = el('div'), listBox = el('div'), barBox = el('div'), pg = el('div', 'row');
    loadPeople().then(function (pd) {
      var canAssign = can('crm_assign'), wide = can('crm_all') || can('crm_team');
      var q = el('input', { type: 'search', placeholder: 'Search name, mobile, city' }), stS = el('select', null, opts(ST, '', 'All statuses').concat([el('option', { value: 'open', text: 'All open' })])), soS = el('select', null, opts(SRC, '', 'All sources')),
        asS = wide ? el('select', null, [el('option', { value: '', text: 'Anyone' }), el('option', { value: 'none', text: 'Not assigned' })].concat(assignable(pd).map(function (x) { return el('option', { value: x[0], text: x[1] }); }))) : null;
      var timer = null; q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { f.q = q.value; f.offset = 0; load(); }, 300); });
      stS.addEventListener('change', function () { f.status = stS.value; f.offset = 0; load(); }); soS.addEventListener('change', function () { f.source = soS.value; f.offset = 0; load(); }); if (asS) asS.addEventListener('change', function () { f.assignee = asS.value; f.offset = 0; load(); });
      var dueB = btn('Follow-ups due', 'ghost', function () { f.due = !f.due; dueB.className = 'btn sm ' + (f.due ? '' : 'ghost'); f.offset = 0; load(); });
      var bar = [q, stS, soS, asS, dueB, can('crm_add') ? btn('+ Add lead', '', function () { edit(null, pd); }) : null, can('crm_import') ? btn('Import Excel / CSV', 'ghost', function () { importer(pd); }) : null, btn('Export CSV', 'ghost', exportCsv)].filter(Boolean);
      page.appendChild(statBox); page.appendChild(el('div', 'row crmbar', bar)); page.appendChild(barBox); page.appendChild(listBox); page.appendChild(pg);
      function qs(extra) { var p = []; ['status', 'source', 'assignee', 'q'].forEach(function (k) { if (f[k]) p.push(k + '=' + encodeURIComponent(f[k])); }); if (f.due) p.push('due=1'); return p.concat(extra || []).join('&'); }
      function stats() {
        api('GET', '/staff/crm/summary').then(function (s) {
          statBox.textContent = ''; var cards = [['New today', s.today, function () { stS.value = ''; f.status = ''; }], ['Follow-ups due', s.due, function () { f.due = true; dueB.className = 'btn sm'; }], ['Not assigned', s.unassigned, function () { if (asS) { asS.value = 'none'; f.assignee = 'none'; } }], ['Booked this month', s.booked_month, function () { stS.value = 'booked'; f.status = 'booked'; }], ['Total leads', s.total, function () { }]];
          var row = el('div', 'crmstats'); cards.forEach(function (c) { row.appendChild(el('button', { type: 'button', class: 'cst', onclick: function () { c[2](); f.offset = 0; load(); } }, [el('b', { text: String(c[1]) }), el('span', { text: c[0] })])); }); statBox.appendChild(row);
          var chips = el('div', 'row'); Object.keys(s.by_source).forEach(function (k) { chips.appendChild(el('button', { type: 'button', class: 'lsrc s-' + k, text: lab(SRC, k) + ' ' + s.by_source[k], onclick: function () { soS.value = k; f.source = k; f.offset = 0; load(); } })); }); statBox.appendChild(chips);
        }).catch(function () { });
      }
      function selCount() { return Object.keys(sel).filter(function (k) { return sel[k]; }).length; }
      function drawBar() {
        barBox.textContent = ''; var n = selCount(); if (!n) return;
        var as = el('select', null, [el('option', { value: '', text: 'Assign to...' })].concat(assignable(pd).map(function (x) { return el('option', { value: x[0], text: x[1] }); }))), ss = el('select', null, opts(ST, '', 'Set status...'));
        barBox.appendChild(el('div', 'row bulkbar', [el('b', { text: n + ' selected' }), canAssign ? as : null, canAssign ? btn('Assign', '', function () { if (as.value) bulk({ action: 'assign', to: as.value }); }) : null, ss, btn('Set status', 'ghost', function () { if (ss.value) bulk({ action: 'status', status: ss.value }); }),
          can('crm_delete') ? btn('Delete', 'danger', function () { L.confirmBox('Delete ' + n + ' lead' + (n > 1 ? 's' : '') + ' for good?', 'Delete', function () { bulk({ action: 'delete' }); }); }) : null, btn('Clear', 'ghost', function () { sel = {}; drawList(); drawBar(); })].filter(Boolean)));
      }
      function bulk(b) { b.ids = Object.keys(sel).filter(function (k) { return sel[k]; }); api('POST', '/staff/crm/bulk', b).then(function (r) { toast(r.changed + ' lead' + (r.changed === 1 ? '' : 's') + ' updated'); sel = {}; load(); }).catch(function (e) { toast(e.message); }); }
      function drawList() {
        listBox.textContent = '';
        if (!leads.length) { listBox.appendChild(el('div', { class: 'empty', text: 'No leads here yet.' })); return; }
        var now = Date.now(), all = el('input', { type: 'checkbox', 'aria-label': 'Select all' }); all.addEventListener('change', function () { leads.forEach(function (l) { sel[l.id] = all.checked; }); drawList(); drawBar(); });
        var trs = leads.map(function (l) {
          var cb = el('input', { type: 'checkbox', checked: !!sel[l.id], 'aria-label': 'Select ' + l.name }); cb.addEventListener('change', function () { sel[l.id] = cb.checked; drawBar(); }); cb.addEventListener('click', function (e) { e.stopPropagation(); });
          var fu = l.next_follow ? el('span', { class: 'fu' + (l.next_follow < now && ['booked', 'not_interested', 'wrong_number', 'lost'].indexOf(l.status) < 0 ? ' late' : ''), text: L.fdt(l.next_follow) }) : '-';
          var tr = el('tr', { class: 'clk', onclick: function () { open(l.id, pd); } }, [el('td', null, [cb]), el('td', null, [el('b', { text: l.name }), el('div', { class: 'note' }, [el('a', { href: 'tel:+91' + l.mobile, text: l.mobile, onclick: function (e) { e.stopPropagation(); } }), ' ', el('a', { href: 'https://wa.me/91' + l.mobile, target: '_blank', rel: 'noopener', text: 'WhatsApp', onclick: function (e) { e.stopPropagation(); } })]), l.interest ? el('div', { class: 'note', text: l.interest }) : null]),
            el('td', null, [srcBadge(l.source), l.campaign ? el('div', { class: 'note', text: l.campaign }) : null]), el('td', null, [stBadge(l.status)]), el('td', { text: l.assignee || 'Not assigned' }), el('td', null, [fu]), el('td', { text: ago(l.created) })]);
          return tr;
        });
        listBox.appendChild(el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, [el('th', null, [all])].concat(['Lead', 'Source', 'Status', 'Assigned to', 'Next follow-up', 'Added'].map(function (h) { return el('th', { text: h }); })))), el('tbody', null, trs)])));
      }
      function drawPg() { pg.textContent = ''; var to = Math.min(total, f.offset + LIM); pg.appendChild(el('span', { class: 'note', text: total ? (f.offset + 1) + ' to ' + to + ' of ' + total : '' })); if (f.offset > 0) pg.appendChild(btn('Previous', 'ghost', function () { f.offset -= LIM; load(); })); if (to < total) pg.appendChild(btn('Next', 'ghost', function () { f.offset += LIM; load(); })); }
      function load() { api('GET', '/staff/crm/leads?' + qs(['limit=' + LIM, 'offset=' + f.offset])).then(function (r) { leads = r.leads; total = r.total; drawList(); drawPg(); drawBar(); stats(); }).catch(function (e) { listBox.textContent = ''; listBox.appendChild(el('p', { class: 'msg err', text: e.message })); }); }
      function exportCsv() { api('GET', '/staff/crm/leads?' + qs(['limit=5000'])).then(function (r) { download('leads-' + new Date().toISOString().slice(0, 10) + '.csv', csv([['Name', 'Mobile', 'Email', 'City', 'Source', 'Campaign', 'Interest', 'Status', 'Assigned to', 'Next follow-up', 'Added']].concat(r.leads.map(function (l) { return [l.name, l.mobile, l.email, l.city, lab(SRC, l.source), l.campaign, l.interest, lab(ST, l.status), l.assignee, l.next_follow ? L.fdt(l.next_follow) : '', L.fdt(l.created)]; })))); }).catch(function (e) { toast(e.message); }); }
      L.crmReload = load; load(); done();
    }).catch(function (e) { L.fail(page, e); done(); });
  };

  /* add / edit form */
  /* test / package search dropdown for the Interested-in box: type to search, click to pick, comma for several */
  function testPick(inp) {
    var wrap = el('div', { class: 'tpick' }), list = el('div', { class: 'tlist', hidden: true });
    inp.setAttribute('autocomplete', 'off'); inp.placeholder = 'Type a test or package name, then pick';
    function cur() { var p = inp.value.split(','); return p[p.length - 1].trim(); }
    function show() {
      var q = cur(), res = q ? L.search(q) : (L.packages || []).slice(0, 12); list.textContent = '';
      if (!res.length) { list.hidden = true; return; }
      res.slice(0, 30).forEach(function (t) {
        var b = el('button', { type: 'button', class: 'topt' }, [el('span', { text: t.name }), el('small', { text: (t.pkg ? 'Package · ' : '') + (t.price ? '₹' + t.price : '') })]);
        b.addEventListener('mousedown', function (e) { e.preventDefault(); var p = inp.value.split(','); p[p.length - 1] = ' ' + t.name; inp.value = p.join(',').replace(/^\s+/, '') + ', '; list.hidden = true; inp.focus(); });
        list.appendChild(b);
      });
      list.hidden = false;
    }
    inp.addEventListener('input', show); inp.addEventListener('focus', show); inp.addEventListener('blur', function () { setTimeout(function () { list.hidden = true; inp.value = inp.value.replace(/[,\s]+$/, ''); }, 150); });
    wrap.appendChild(inp); wrap.appendChild(list); return wrap;
  }
  function edit(l, pd, after) {
    l = l || {}; var n = el('input', { value: l.name || '', maxlength: '80' }), mb = el('input', { value: l.mobile || '', inputmode: 'tel', maxlength: '14' }), em = el('input', { value: l.email || '', type: 'email' }), ct = el('input', { value: l.city || '' }), it = el('input', { value: l.interest || '', placeholder: 'Test or package they asked about' }),
      sr = el('select', null, opts(SRC, l.source || 'manual')), cp = el('input', { value: l.campaign || '' }), fu = el('input', { type: 'datetime-local' }), ms = el('span', 'msg'); fu.value = L.toLocalInput(l.next_follow);
    var as = can('crm_assign') ? el('select', null, opts(assignable(pd), l.assigned_to || '', 'Not assigned')) : null;
    modal(l.id ? 'Edit lead' : 'Add lead', el('div', 'form2', [fld('Name', n), fld('Mobile', mb), fld('Email', em), fld('City', ct), fld('Interested in', testPick(it), 'full'), fld('Source', sr), fld('Campaign', cp), fld('Next follow-up', fu), as && !l.id ? fld('Assign to', as) : null, ms]), [{ text: 'Cancel', cls: 'ghost' }, { text: 'Save', keep: true, fn: function (close) {
      var b = { name: n.value, mobile: mb.value, email: em.value, city: ct.value, interest: it.value, source: sr.value, campaign: cp.value, next_follow: L.fromLocalInput(fu.value) }; if (as && !l.id) b.assigned_to = as.value;
      say(ms, 'Saving...', 'info'); api('POST', l.id ? '/staff/crm/leads/' + l.id : '/staff/crm/leads', b).then(function () { close(); toast('Saved'); if (after) after(); else if (L.crmReload) L.crmReload(); }).catch(function (e) { say(ms, e.message, 'err'); });
    } }]);
  }

  /* lead detail with timeline */
  function open(id, pd) {
    var box = el('div', null, [el('p', { class: 'note', text: 'Loading...' })]);
    modal('Lead', box, [{ text: 'Close', cls: 'ghost' }]);
    function draw(keep) {
      api('GET', '/staff/crm/leads/' + id).then(function (d) {
        var l = d.lead; box.textContent = '';
        var stS = el('select', { disabled: !d.can_edit }, opts(ST, l.status)), fu = el('input', { type: 'datetime-local', disabled: !d.can_edit }); fu.value = L.toLocalInput(l.next_follow); if (keep) { stS.value = keep.status; fu.value = keep.fu; }
        var as = d.can_assign ? el('select', null, opts(assignable(pd), l.assigned_to || '', 'Not assigned')) : null, ms = el('span', 'msg'); if (keep && as && keep.as != null) as.value = keep.as;
        box.appendChild(el('div', 'lhead', [el('div', null, [el('h3', { text: l.name }), el('div', { class: 'note', text: [l.city, l.email].filter(Boolean).join(' · ') }), l.interest ? el('div', { text: 'Interested in: ' + l.interest }) : null, el('div', 'row', [srcBadge(l.source), l.campaign ? el('span', { class: 'note', text: l.campaign }) : null])]),
          el('div', 'lact', [el('a', { class: 'btn sm', href: 'tel:+91' + l.mobile, text: 'Call ' + l.mobile }), el('a', { class: 'btn sm ghost', href: 'https://wa.me/91' + l.mobile, target: '_blank', rel: 'noopener', text: 'WhatsApp' })])]));
        box.appendChild(el('div', 'form2', [fld('Status', stS), fld('Next follow-up', fu), as ? fld('Assigned to', as, 'full') : el('div', { class: 'note full', text: 'Assigned to: ' + (l.assignee || 'nobody') }), el('div', 'row full', [d.can_edit ? btn('Save changes', '', function () {
          say(ms, 'Saving...', 'info'); api('POST', '/staff/crm/leads/' + id, { status: stS.value, next_follow: L.fromLocalInput(fu.value) }).then(function () { return as && as.value !== (l.assigned_to || '') ? api('POST', '/staff/crm/leads/' + id + '/assign', { to: as.value }) : null; }).then(function () { say(ms, 'Saved.', 'ok'); if (L.crmReload) L.crmReload(); draw(); }).catch(function (e) { say(ms, e.message, 'err'); });
        }) : (as ? btn('Save assignment', '', function () { api('POST', '/staff/crm/leads/' + id + '/assign', { to: as.value }).then(function () { toast('Assigned'); if (L.crmReload) L.crmReload(); draw(); }).catch(function (e) { toast(e.message); }); }) : null), d.can_edit ? btn('Edit details', 'ghost', function () { edit(l, pd, function () { if (L.crmReload) L.crmReload(); draw(); }); }) : null,
          d.can_delete ? btn('Delete', 'danger', function () { L.confirmBox('Delete ' + l.name + '? This cannot be undone.', 'Delete', function () { api('POST', '/staff/crm/leads/' + id + '/delete').then(function () { toast('Deleted'); var o = document.querySelector('.ovl'); if (o) o.remove(); if (L.crmReload) L.crmReload(); }).catch(function (e) { toast(e.message); }); }); }) : null, ms])]));
        var nt = el('input', { placeholder: 'Add a note: what did the customer say?', maxlength: '500' });
        function addNote() { if (!nt.value.trim()) return; api('POST', '/staff/crm/leads/' + id + '/note', { text: nt.value }).then(function () { draw({ status: stS.value, fu: fu.value, as: as ? as.value : null }); }).catch(function (e) { toast(e.message); }); }
        nt.addEventListener('keydown', function (e) { if (e.key === 'Enter') addNote(); });
        box.appendChild(el('div', 'row', [nt, btn('Add note', 'ghost', addNote)]));
        box.appendChild(el('div', 'tline', d.log.map(function (g) { return el('div', 'tl k-' + g.kind, [el('div', { class: 'tt', text: g.text }), el('div', { class: 'note', text: g.who + ' · ' + L.fdt(g.at) })]); })));
      }).catch(function (e) { box.textContent = ''; box.appendChild(el('p', { class: 'msg err', text: e.message })); });
    }
    draw();
  }

  /* Excel / CSV import */
  function importer(pd) {
    var FIELDS = [['name', 'Name', /name|customer|patient|lead/i], ['mobile', 'Mobile', /mobile|phone|contact|whatsapp|number|cell/i], ['email', 'Email', /mail/i], ['city', 'City', /city|town|location|area|place/i], ['source', 'Source', /source|channel|platform/i], ['interest', 'Interested in', /interest|test|service|enquiry|query|product|category|package/i], ['campaign', 'Campaign', /campaign|ad ?name|form ?name|adset|ad ?set/i]];
    var file = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' }), box = el('div'), ms = el('span', 'msg'), data = null, maps = {}, defSrc = el('select', null, opts(SRC, 'excel')), as = can('crm_assign') ? el('select', null, opts(assignable(pd), '', 'Leave unassigned')) : null, go;
    box.appendChild(el('p', { class: 'note', text: 'Choose an Excel (.xlsx or .xls) or CSV file. The first row must be the column headings. Numbers already in the CRM are skipped.' }));
    box.appendChild(el('div', 'row', [file, btn('Download blank template', 'ghost', function () { download('lead-template.csv', csv([['Name', 'Mobile', 'Email', 'City', 'Source', 'Interested in', 'Campaign'], ['Ravi Kumar', '9845012345', '', 'Gadag', 'Justdial', 'Lipid profile', '']])); })]));
    var pv = el('div'); box.appendChild(pv); box.appendChild(ms);
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return; if (!window.XLSX) { say(ms, 'The Excel reader did not load. Reload the page (Ctrl+F5).', 'err'); return; }
      var rd = new FileReader(); rd.onload = function () {
        try {
          var wb = XLSX.read(rd.result, { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]], rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
          rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); }); if (rows.length < 2) { say(ms, 'The file has no data rows.', 'err'); return; }
          data = { head: rows[0].map(function (h) { return String(h).trim(); }), rows: rows.slice(1) }; maps = {};
          FIELDS.forEach(function (fl) { var best = -1; data.head.forEach(function (h, i) { if (best < 0 && fl[2].test(h)) best = i; }); if (fl[0] === 'name') data.head.forEach(function (h, i) { if (best < 0 && /name/i.test(h)) best = i; }); maps[fl[0]] = best; });
          pv.textContent = ''; var sels = FIELDS.map(function (fl) { var s = el('select', null, [el('option', { value: '-1', text: '(skip)' })].concat(data.head.map(function (h, i) { return el('option', { value: String(i), text: h || 'Column ' + (i + 1), selected: maps[fl[0]] === i }); }))); s.addEventListener('change', function () { maps[fl[0]] = Number(s.value); sample(); }); return fld(fl[1] + (fl[0] === 'mobile' || fl[0] === 'name' ? ' *' : ''), s); });
          pv.appendChild(el('p', { class: 'note', text: data.rows.length + ' rows found. Check that the columns match:' })); pv.appendChild(el('div', 'form2', sels.concat([fld('If no source column, use', defSrc), as ? fld('Assign all to', as) : null]))); var sm = el('div'); pv.appendChild(sm);
          function sample() { sm.textContent = ''; var t = data.rows.slice(0, 3).map(function (r) { return el('tr', null, FIELDS.map(function (fl) { return el('td', { text: maps[fl[0]] >= 0 ? String(r[maps[fl[0]]] || '') : '' }); })); }); sm.appendChild(el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, FIELDS.map(function (fl) { return el('th', { text: fl[1] }); }))), el('tbody', null, t)]))); }
          sample(); go.disabled = false; say(ms, '', '');
        } catch (e) { say(ms, 'Could not read that file. Save it as .xlsx or .csv and try again.', 'err'); }
      }; rd.readAsArrayBuffer(f);
    });
    modal('Import leads', box, [{ text: 'Cancel', cls: 'ghost' }, { text: 'Import', keep: true, fn: function (close) {
      if (!data) { say(ms, 'Choose a file first.', 'err'); return; } if (maps.mobile < 0 || maps.name < 0) { say(ms, 'Pick the Name and Mobile columns.', 'err'); return; }
      go.disabled = true; var list = data.rows.map(function (r) { var o = {}; FIELDS.forEach(function (fl) { if (maps[fl[0]] >= 0) o[fl[0]] = String(r[maps[fl[0]]] == null ? '' : r[maps[fl[0]]]).trim(); }); return o; }), tot = { added: 0, duplicates: 0, invalid: 0, problems: [] }, i = 0;
      (function next() {
        if (i >= list.length) { say(ms, 'Done: ' + tot.added + ' added, ' + tot.duplicates + ' already in the CRM, ' + tot.invalid + ' skipped (bad number).' + (tot.problems.length ? ' ' + tot.problems.slice(0, 3).join(' ') : ''), 'ok'); if (L.crmReload) L.crmReload(); return; }
        say(ms, 'Importing ' + Math.min(i + 400, list.length) + ' of ' + list.length + '...', 'info');
        api('POST', '/staff/crm/import', { rows: list.slice(i, i + 400), source: defSrc.value, assign_to: as ? as.value : '' }).then(function (r) { tot.added += r.added; tot.duplicates += r.duplicates; tot.invalid += r.invalid; tot.problems = tot.problems.concat(r.problems || []); i += 400; next(); }).catch(function (e) { say(ms, e.message, 'err'); });
      })(); return false;
    } }]);
    go = { disabled: true };
  }

  /* ======================= CRM TEAM ======================= */
  L.views.crmteam = function (page, _a, done) {
    people = null; var first = true;
    function load() {
      api('GET', '/staff/crm/users').then(function (d) {
        page.textContent = '';
        var cre = d.creatable;
        if (cre.length) {
          var nn = el('input'), un = el('input', { autocapitalize: 'none', autocomplete: 'off' }), pw = el('input', { type: 'text', autocomplete: 'off', placeholder: 'At least 8 characters' }), mo = el('input', { inputmode: 'tel', maxlength: '10' }), rs = el('select', null, cre.map(function (r) { return el('option', { value: r, text: RL[r] }); })), tl = el('select', null, [el('option', { value: '', text: 'No team leader' })].concat(d.team_leads.map(function (t) { return el('option', { value: t.id, text: t.name }); }))), ms = el('span', 'msg');
          var tlf = fld('Team leader', tl); function sh() { tlf.hidden = rs.value !== 'telecaller' || cre.length === 1 && cre[0] === 'telecaller'; } rs.addEventListener('change', sh); sh();
          page.appendChild(el('div', 'card', [el('h2', { text: 'Add CRM staff' }), el('div', 'form2', [fld('Name', nn), fld('Username', un), fld('Role', rs), tlf, fld('Mobile', mo), fld('Password', pw)]), el('div', 'row', [btn('Create login', '', function () {
            api('POST', '/staff/crm/users', { name: nn.value, username: un.value, role: rs.value, team_lead: tl.value, mobile: mo.value, password: pw.value }).then(function () { toast('Login created'); load(); }).catch(function (e) { say(ms, e.message, 'err'); });
          }), ms])]));
        }
        var rows = d.users.map(function (u) {
          return el('tr', null, [el('td', null, [el('b', { text: u.name }), el('div', { class: 'note', text: '@' + u.username })]), el('td', { text: RL[u.role] || u.role }), el('td', { text: u.team_lead_name || '-' }), el('td', { text: u.mobile || '-' }), el('td', { class: 'num', text: String(u.open) }),
            el('td', null, [el('span', { class: 'badge2 b-' + (u.active ? 'completed' : 'cancelled'), text: u.active ? 'Active' : 'Disabled' })]), el('td', null, [btn('Edit', 'ghost', function () { editUser(u, d); })])]);
        });
        page.appendChild(el('div', 'card', [el('h2', { text: 'CRM team' }), rows.length ? el('div', 'tbl-wrap', el('table', 'tbl', [el('thead', null, el('tr', null, ['Name', 'Role', 'Team leader', 'Mobile', 'Open leads', 'Status', ''].map(function (h) { return el('th', { text: h }); }))), el('tbody', null, rows)])) : el('div', { class: 'empty', text: 'No CRM staff yet.' })]));
        if (first) { first = false; done(); }
      }).catch(function (e) { L.fail(page, e); if (first) { first = false; done(); } });
    }
    function editUser(u, d) {
      var nn = el('input', { value: u.name }), mo = el('input', { value: u.mobile, maxlength: '10' }), ac = el('select', null, [el('option', { value: '1', text: 'Active', selected: u.active }), el('option', { value: '0', text: 'Disabled (cannot log in, open leads go back to unassigned)', selected: !u.active })]), pw = el('input', { type: 'text', placeholder: 'Leave empty to keep', autocomplete: 'off' }), ms = el('span', 'msg');
      var tl = u.role === 'telecaller' && can('crm_all') ? el('select', null, [el('option', { value: '', text: 'No team leader' })].concat(d.team_leads.map(function (t) { return el('option', { value: t.id, text: t.name, selected: t.id === u.team_lead }); }))) : null;
      modal('Edit ' + u.name, el('div', 'form2', [fld('Name', nn), fld('Mobile', mo), tl ? fld('Team leader', tl) : null, fld('Status', ac), fld('New password', pw), ms]), [{ text: 'Cancel', cls: 'ghost' }, { text: 'Save', keep: true, fn: function (close) {
        var b = { name: nn.value, mobile: mo.value, active: ac.value === '1' }; if (tl) b.team_lead = tl.value; if (pw.value) b.password = pw.value;
        api('POST', '/staff/crm/users/' + u.id, b).then(function () { close(); toast('Saved'); load(); }).catch(function (e) { say(ms, e.message, 'err'); });
      } }]);
    }
    load();
  };

  /* ======================= INTEGRATIONS ======================= */
  L.views.crmset = function (page, _a, done) {
    api('GET', '/staff/crm/settings').then(function (s) {
      var key = s.intake_key, base = s.base;
      function copy(t, b) { b.addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Copied'); }).catch(function () { window.prompt('Copy this:', t); }); }); return b; }
      function urlRow(label, u, help) { return el('div', 'urlrow', [el('b', { text: label }), el('code', { text: u }), copy(u, btn('Copy', 'ghost', function () { })), help ? el('div', { class: 'note', text: help }) : null]); }
      var aa = el('input', { type: 'checkbox', checked: s.auto_assign }); aa.addEventListener('change', function () { api('POST', '/staff/crm/settings', { auto_assign: aa.checked }).then(function () { toast(aa.checked ? 'New leads will be shared out automatically' : 'Automatic assignment is off'); }).catch(function (e) { toast(e.message); }); });
      page.appendChild(el('div', 'card', [el('h2', { text: 'Assigning new leads' }), el('label', 'chk', [aa, ' Share new leads automatically among active telecallers (the one with the fewest open leads gets the next lead)'])]));
      page.appendChild(el('div', 'card', [el('h2', { text: 'Lead links for each channel' }), el('p', { class: 'note', text: 'Give each link to the tool that sends you leads. Anything it sends (name, mobile, city, interest) lands in the CRM with the right source. The same mobile number is never added twice.' }),
        urlRow('Justdial', base + '/crm/in/justdial?key=' + key, 'Send this to your Justdial account manager as the "lead push URL" (GET or POST).'),
        urlRow('Facebook (via Zapier, Make, Pabbly or Meta CRM link)', base + '/crm/in/facebook?key=' + key, 'Use as the webhook URL of a Facebook Lead Ads connection.'),
        urlRow('Instagram', base + '/crm/in/instagram?key=' + key), urlRow('Website forms', base + '/crm/in/website?key=' + key), urlRow('Anything else', base + '/crm/in/other?key=' + key),
        el('div', 'row', [btn('Make a new key (old links stop working)', 'ghost', function () { L.confirmBox('Make a new key? Every link above changes and the old ones stop working.', 'Make new key', function () { api('POST', '/staff/crm/settings', { new_key: true }).then(function () { toast('New key made'); location.reload(); }).catch(function (e) { toast(e.message); }); }); })])]));
      page.appendChild(el('div', 'card', [el('h2', { text: 'Direct Facebook and Instagram Lead Ads' }), el('p', { class: 'note', text: 'For leads straight from Meta with no extra tool: in your Meta app add a Webhooks "Page" subscription for the leadgen field.' }),
        urlRow('Callback URL', base + '/crm/meta'), urlRow('Verify token', key), el('p', { class: 'note', text: s.meta_ready ? 'Page access token is set in config.php. Ready.' : 'Not ready: add meta_page_token (and meta_app_secret) to config.php. See SETUP.md.' })]));
      page.appendChild(el('div', 'card', [el('h2', { text: 'WhatsApp' }), el('p', { class: 'note', text: 'Every new person who messages the lab\'s WhatsApp Business number becomes a lead (source WhatsApp), using the webhook already set up for the lab: ' + base + '/wa/webhook' })]));
      done();
    }).catch(function (e) { L.fail(page, e); done(); });
  };
})();
