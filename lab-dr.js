/* Trinetri Diagnostics lab console: doctor partners (B2B price list upload, doctor bookings and margin). */
(function () {
  'use strict';
  var L = window.LAB; if (!L) return;
  var el = L.el, fld = L.fld, api = L.api, toast = L.toast, say = L.say, modal = L.modal;
  function btn(text, cls, fn) { return el('button', { type: 'button', class: 'btn sm ' + (cls || ''), text: text, onclick: fn }); }
  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function norm(s) { return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(test|tests|profile|estimation|serum|blood|level|levels)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 34); }
  function price(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isFinite(n) ? Math.round(n) : 0; }
  var STG = { awaiting_payment: 'Awaiting payment', confirmed: 'Confirmed', cancelled: 'Cancelled', phlebo_assigned: 'Phlebotomist assigned', collected: 'Collected', processing: 'Testing', completed: 'Report ready', report_ready: 'Report ready' };

  /* ---------- B2B price list ---------- */
  L.views.b2b = function (page, _a, done) {
    var catMap = {}, catPrice = {}; (L.catalog || []).forEach(function (t) { var k = norm(t.name); if (k && !catMap[k]) catMap[k] = t.key; catPrice[t.key] = t.price || 0; });
    var data = null, cur = [], q = el('input', { placeholder: 'Search the saved price list', style: 'max-width:340px' }), tb = el('tbody'), sum = el('p', 'note');
    var up = el('div', 'card'), file = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' }), pv = el('div'), ms = el('span', 'msg'), rep = el('input', { type: 'checkbox' });
    up.appendChild(el('h2', { text: 'Upload B2B prices' }));
    up.appendChild(el('p', { class: 'note', text: 'Choose your Excel (.xlsx / .xls) or CSV file. Use the sample template and keep its three headings exactly as they are: Test Name, MRP, B2B Price. Fill in one test per row, with both the MRP (what the patient normally pays) and the B2B price (what the doctor pays you). Doctors then see only these tests and prices.' }));
    up.appendChild(el('div', 'row', [file, btn('Download sample Excel template', 'ghost', function () {
      var rows = [['Test Name', 'MRP', 'B2B Price'], ['Complete Blood Count (CBC)', 350, 150], ['LIPID PROFILE', 900, 400], ['Thyroid Function Test - T3, T4, TSH', 500, 250]], a = document.createElement('a'), name = 'b2b-price-template.xlsx';
      try { var ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 44 }, { wch: 12 }, { wch: 12 }]; var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'B2B prices'); var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }); a.href = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); }
      catch (e) { name = 'b2b-price-template.csv'; a.href = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(function (r) { return r.join(','); }).join('\n')], { type: 'text/csv' })); }
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
    })]));
    up.appendChild(pv); up.appendChild(ms);
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return; if (!window.XLSX) { say(ms, 'The Excel reader did not load. Reload the page (Ctrl+F5).', 'err'); return; }
      var rd = new FileReader(); rd.onload = function () {
        try {
          var wb = XLSX.read(rd.result, { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]], rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
          rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); }); if (rows.length < 2) { say(ms, 'The file has no data rows.', 'err'); return; }
          var hi = 0; for (var i = 0; i < Math.min(rows.length, 10); i++) if (rows[i].some(function (c) { return /price|rate|amount|b2b|mrp|cost/i.test(c); }) && rows[i].some(function (c) { return /test|name|investigation|description|parameter|profile/i.test(c); })) { hi = i; break; }
          var head = rows[hi].map(function (h, i) { return String(h).trim() || 'Column ' + (i + 1); }), body = rows.slice(hi + 1);
          var nc = -1, pc = -1, mc = -1; head.forEach(function (h, i) { if (mc < 0 && /mrp|m\.r\.p|retail|patient price|selling/i.test(h)) mc = i; }); head.forEach(function (h, i) { if (nc < 0 && /test|investigation|name|description|parameter/i.test(h) && !/code/i.test(h)) nc = i; });
          [/b2b|partner|doctor|lab rate|net/i, /price|rate|amount|cost/i].forEach(function (re) { if (pc < 0) head.forEach(function (h, i) { if (pc < 0 && i !== mc && re.test(h)) pc = i; }); }); if (pc < 0) pc = head.map(function (h, i) { return i; }).filter(function (i) { return i !== mc && i !== nc; })[0] || 0;
          if (nc < 0) nc = 0; data = { head: head, body: body };
          var ns = el('select', null, head.map(function (h, i) { return el('option', { value: String(i), text: h, selected: i === nc }); })), ps = el('select', null, head.map(function (h, i) { return el('option', { value: String(i), text: h, selected: i === pc }); }));
          var ms2 = el('select', null, [el('option', { value: '-1', text: '(use my catalog price)' })].concat(head.map(function (h, i) { return el('option', { value: String(i), text: h, selected: i === mc }); }))), sm = el('div'), go = btn('Save prices', '', save);
          function build() { var out = [], un = 0, seen = {}; data.body.forEach(function (r) { var n = String(r[+ns.value] || '').trim(), p = price(r[+ps.value]); if (!n || p < 1) return; var k = catMap[norm(n)]; if (!k) { k = 'X:' + slug(n); un++; } if (seen[k]) return; seen[k] = 1; var mrp = +ms2.value >= 0 ? price(r[+ms2.value]) : (catPrice[k] || 0); out.push({ key: k, name: n, price: p, mrp: mrp, matched: !k.indexOf('X:') ? 0 : 1 }); }); return { rows: out, un: un }; }
          function show() { var b = build(); sm.textContent = ''; sm.appendChild(el('p', { class: 'note', text: b.rows.length + ' prices ready' + (b.un ? ' (' + b.un + ' not found in your catalog; they will still be saved under the name in your file)' : ' (all matched to your catalog)') + '.' }));
            var t = el('table', 'tbl', [el('thead', null, [el('tr', null, [el('th', { text: 'Test (from your file)' }), el('th', { text: 'MRP' }), el('th', { text: 'B2B price' }), el('th', { text: 'In catalog' })])]), el('tbody', null, b.rows.slice(0, 6).map(function (r) { return el('tr', null, [el('td', { text: r.name }), el('td', { text: r.mrp ? inr(r.mrp) : '-' }), el('td', { text: inr(r.price) }), el('td', { text: r.matched ? 'Yes' : 'No' })]); }))]); sm.appendChild(t); go.disabled = !b.rows.length; }
          ns.onchange = ps.onchange = ms2.onchange = show;
          function save() {
            var b = build(); if (!b.rows.length) return; if (rep.checked && !confirm('This replaces the whole saved price list with this file. Continue?')) return; go.disabled = true;
            var rowsAll = b.rows.map(function (r) { return { key: r.key, name: r.name, price: r.price, mrp: r.mrp }; }), i = 0, total = 0;
            (function next() { if (i >= rowsAll.length) { say(ms, 'Saved ' + total + ' prices. Doctors can see them now.', 'ok'); pv.textContent = ''; file.value = ''; load(); return; }
              say(ms, 'Saving ' + Math.min(i + 1000, rowsAll.length) + ' of ' + rowsAll.length + '...', 'info');
              api('POST', '/staff/b2b', { rows: rowsAll.slice(i, i + 1000), replace: rep.checked && i === 0 }).then(function (r) { total += r.saved; i += 1000; next(); }).catch(function (e) { go.disabled = false; say(ms, e.message, 'err'); }); })();
          }
          pv.textContent = ''; pv.appendChild(el('div', 'form2', [fld('Test name column', ns), fld('B2B price column', ps), fld('MRP column (what the patient normally pays)', ms2, 'full')])); pv.appendChild(sm);
          pv.appendChild(el('label', { class: 'chk', style: 'margin:8px 0' }, [rep, el('span', { text: 'Replace the whole saved list (untick to just add and update)' })])); pv.appendChild(el('div', 'row', [go])); show(); say(ms, '', '');
        } catch (e) { say(ms, 'Could not read that file. Save it as .xlsx or .csv and try again.', 'err'); }
      }; rd.readAsArrayBuffer(f);
    });
    var list = el('div', 'card', [el('h2', { text: 'Saved B2B prices' }), sum, el('div', 'row', [q]), el('div', 'tblwrap', [el('table', 'tbl', [el('thead', null, [el('tr', null, [el('th', { text: 'Test / package' }), el('th', { text: 'MRP' }), el('th', { text: 'B2B price' }), el('th', { text: '' })])]), tb])])]);
    function draw() { var t = q.value.toLowerCase().split(/\s+/).filter(Boolean), n = 0; tb.textContent = ''; cur.forEach(function (r) { if (n >= 200) return; var h = r.name.toLowerCase(); if (!t.every(function (w) { return h.indexOf(w) >= 0; })) return; n++;
      tb.appendChild(el('tr', null, [el('td', { text: r.name }), el('td', { text: r.mrp ? inr(r.mrp) : '-' }), el('td', { text: inr(r.price) }), el('td', null, [btn('Remove', 'danger', function () { L.confirmBox('Remove ' + r.name + ' from the partner price list?', 'Remove', function () { api('POST', '/staff/b2b/delete', { key: r.key }).then(function () { load(); }).catch(function (e) { toast(e.message); }); }); })])])); });
      if (!n) tb.appendChild(el('tr', null, [el('td', { colspan: '4', class: 'empty', text: cur.length ? 'Nothing matches.' : 'No prices yet. Upload your B2B Excel above.' })])); }
    q.addEventListener('input', draw);
    function load() { return api('GET', '/staff/b2b').then(function (r) { cur = r.rows; sum.textContent = r.count + ' tests and packages' + (r.updated ? ' · last updated ' + L.fdt(r.updated) : '') + (r.count > 200 ? ' · showing the first 200 matches' : ''); draw(); }); }
    page.appendChild(up); page.appendChild(list); load().then(function () { done(); }).catch(function (e) { L.fail(page, e); });
  };

  /* ---------- doctor bookings and margin ---------- */
  L.views.drbk = function (page, _a, done) {
    api('GET', '/staff/drbookings').then(function (r) {
      page.appendChild(el('div', 'card', [el('h2', { text: 'Doctor partners' }), el('p', { class: 'note', text: 'Only paid bookings are counted. "Paid to lab" is the B2B money received by Razorpay. Margin is what the doctor keeps from the patient.' }),
        el('div', 'tblwrap', [el('table', 'tbl', [el('thead', null, [el('tr', null, ['Doctor', 'Paid bookings', 'Doctors collected', 'Paid to lab', 'Doctor margin'].map(function (h) { return el('th', { text: h }); }))]),
          el('tbody', null, r.doctors.length ? r.doctors.map(function (d) { return el('tr', null, [el('td', null, [el('b', { text: d.name || '-' })]), el('td', { text: String(d.bookings) }), el('td', { text: inr(d.collected) }), el('td', { text: inr(d.paid_to_lab) }), el('td', { text: inr(d.commission) })]); }) : [el('tr', null, [el('td', { colspan: '5', class: 'empty', text: 'No paid doctor bookings yet.' })])])])])]));
      page.appendChild(el('div', 'card', [el('h2', { text: 'Recent doctor bookings' }), el('div', 'tblwrap', [el('table', 'tbl', [el('thead', null, [el('tr', null, ['Doctor', 'Patient', 'Visit', 'Tests', 'Lab price', 'Patient pays', 'Margin', 'Status', 'Order'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', null, r.bookings.length ? r.bookings.map(function (b) { return el('tr', null, [el('td', { text: b.doctor || '-' }), el('td', null, [el('b', { text: b.name }), el('div', 'note', [b.mobile])]), el('td', { text: b.slot_at ? L.fdt(b.slot_at) : '-' }), el('td', { text: b.tests.map(function (t) { return t.name; }).join(', ') }),
          el('td', { text: inr(b.b2b) }), el('td', { text: inr(b.price) }), el('td', { text: inr(b.commission) }), el('td', null, [el('span', { class: 'tag', text: STG[b.status === 'confirmed' ? (b.stage || 'confirmed') : b.status] || b.status })]), el('td', null, [b.order_code ? el('a', { href: '#order/' + encodeURIComponent(b.order_code), text: b.order_code }) : '-'])]); }) : [el('tr', null, [el('td', { colspan: '9', class: 'empty', text: 'No bookings yet.' })])])])])]));
      done();
    }).catch(function (e) { L.fail(page, e); });
  };
})();
