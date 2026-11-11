/* Builds the animated left panel for the login screens. <script src="login-fx.js" data-mode="lab|customer|admin"> */
(function () {
  var me = document.currentScript, mode = (me && me.getAttribute('data-mode')) || 'lab';
  var COPY = {
    lab: { h: 'Every sample tracked, from collection to report.', p: 'Orders, results, approvals and reports in one place for your whole lab team.', pills: ['Live sample status', 'Role based access', 'One tap PDF reports'] },
    customer: { h: 'Your health reports, always with you.', p: 'Track your sample live, download reports, chat with the lab and manage your membership.', pills: ['Live tracking', 'PDF reports', 'Secure login'] },
    admin: { h: 'Keep your tests and prices up to date.', p: 'Edit packages, tests and prices once and your website updates at once.', pills: ['Packages and tests', 'Price list upload', 'Instant publish'] }
  }[mode] || {};
  var A = [['Haematology', 'Complete Blood Count', 92], ['Biochemistry', 'Lipid Profile', 74], ['Hormones', 'Thyroid Profile', 83], ['Diabetes', 'HbA1c', 66], ['Vitamins', 'Vitamin D, B12', 58], ['Liver', 'Liver Function Test', 88],
    ['Kidney', 'Renal Function Test', 71], ['Infection', 'Dengue and Malaria', 63], ['Cardiac', 'CRP and Troponin', 79], ['Urine', 'Urine Routine', 95]];
  var B = [['Home collection', 'Sample at your door', 80], ['Reports', 'Digital PDF reports', 90], ['Tracking', 'Collected, in process, ready', 68], ['Packages', 'Advance Health Package', 77], ['Allergy', 'Allergy Panel', 55], ['Fertility', 'Hormone Profile', 61],
    ['Coagulation', 'PT, INR and APTT', 72], ['Serology', 'Widal and Typhoid', 84], ['Pathologist', 'Reviewed and approved', 93], ['Support', 'Chat with the lab', 87]];
  function cards(list) { var h = ''; list.concat(list).forEach(function (c) { h += '<div class="lfx-card"><em>' + c[0] + '</em><b>' + c[1] + '</b><u style="--w:' + c[2] + '%"></u></div>'; }); return h; }
  function art() {
    var a = document.createElement('aside'); a.className = 'lfx-art'; a.setAttribute('aria-hidden', 'false');
    var words = (COPY.h || '').split(' '), hh = '';
    words.forEach(function (w, i) { hh += '<span style="animation-delay:' + (0.45 + i * 0.09).toFixed(2) + 's">' + w + '</span> '; });
    var bub = '', S = [[22, 6, 17, 0], [14, 14, 22, 4], [30, 24, 26, 9], [10, 33, 15, 2], [18, 42, 20, 7], [26, 52, 24, 12], [12, 61, 16, 5], [34, 70, 28, 1], [16, 79, 19, 10], [22, 88, 23, 6], [10, 95, 14, 3], [28, 8, 30, 15]];
    S.forEach(function (b) { bub += '<s class="lfx-bub" style="--s:' + b[0] + 'px;--x:' + b[1] + '%;--t:' + b[2] + 's;--dl:-' + b[3] + 's"></s>'; });
    var hx = ''; for (var i = 0; i < 24; i++) hx += '<i style="--d:-' + (i * 0.11).toFixed(2) + 's"><b></b><b></b></i>';
    a.innerHTML = bub + '<div class="lfx-helix">' + hx + '</div>' +
      '<div class="lfx-logo"><i></i><i></i><i></i><span><img src="icon.png" alt="Trinetri Diagnostics"></span></div>' +
      '<h2>' + hh + '</h2><p>' + (COPY.p || '') + '</p><div class="lfx-pills">' + (COPY.pills || []).map(function (t) { return '<b>' + t + '</b>'; }).join('') + '</div>' +
      '<div class="lfx-cols"><div class="lfx-col">' + cards(A) + '</div><div class="lfx-col">' + cards(B) + '</div></div>';
    return a;
  }
  function split(host) {
    var box = host.querySelector('.box'); if (!box || host.classList.contains('lfx')) return;
    host.classList.add('lfx');
    var form = document.createElement('div'); form.className = 'lfx-form'; host.insertBefore(form, box); form.appendChild(box);
    host.insertBefore(art(), form);
  }
  function init() {
    if (mode === 'admin') {
      var conn = document.getElementById('conn'); if (!conn) return;
      var s = document.createElement('section'); s.className = 'auth'; s.id = 'adm-auth';
      s.innerHTML = '<div class="box"><div class="brand2"><img src="icon.png" alt="" width="44" height="44"><div><h1>Trinetri Diagnostics</h1><span class="note">Catalog admin</span></div></div></div>';
      s.querySelector('.box').appendChild(conn); document.body.appendChild(s); split(s);
      document.body.classList.add('adm-out');
      var out = document.getElementById('out');   // the Log out button is shown only while logged in
      function sync() { document.body.classList.toggle('adm-out', !out || out.hidden); }
      if (out) new MutationObserver(sync).observe(out, { attributes: true, attributeFilter: ['hidden'] }); sync();
    } else split(document.getElementById('auth'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
