/* Referring doctors list + the 'Referred by' picker used when creating or editing an order. To add a doctor, add a line [name, mobile] to the list. */
(function () {
  var DOCTORS = [["Dr. ANIL TAMMANNAVAR (DR007)","9448236254"],["Dr. ARUN KUMAR DABALI (AKD01)","8904239278"],["Dr. ARUNKUMAR S SARAVI (ASS01)","9482933244"],["Dr. ARVIND KAMBALI (AK0017)","8867163205"],["Dr. ASHOK K P (TD00A1)","9964279521"],["Dr. B D TALAVAR (BD003)","9742058739"],["Dr. BASAVARAJ C (BC004)","9900192627"],["Dr. BASAVARAJ M M (BMM001)","8310524598"],["Dr. G S PALLED (GSP-GADAG)","7676353451"],["Dr. HANUMANTHA (DR000)","9448001054"],["Dr. HASEENA B (HB 01)","9686000973"],["Dr. I B HALEMANI (TD00H)","9448337840"],["Dr. I S KANAVI (ISK001)","9480092678"],["Dr. KRISHNA KALASAPUR AAM (K007)","7090528765"],["Dr. M V SOBAGIN (MRS004)","9986349888"],["Dr. MANJUNATH GUNDALLI (MG001)","7204123979"],["Dr. MANJUNATH KUDRI (DMK-GADAG)","9742037006"],["Dr. NAGARAJ C SATIGERI (NCS002)","9742562762"],["Dr. NAGARAJ MUNAVALLI (DR009)","9886969980"],["Dr. PRAKASH HOSAMANI (PH002)","9739749581"],["Dr. PRAVEEN ANAGOUDAR (PA008)","9845318864"],["Dr. PRAVEEN SARVADE (PS0016)","9886946048"],["Dr. RANJANA P TERDAL (RPT0018)","9370057773"],["Dr. RASHMI R WADONE (DRW-01)","9742860714"],["Dr. RAVI B KAVALUR (RBK2110)","9886742308"],["Dr. S C SARVI (SCS004)","9880270904"],["Dr. S S HIREMATH (SSH004)","6364141425"],["Dr. SAYED S KOPPAL (SSK004)","9448235997"],["Dr. SHAMBU PURAD (DSP001)","9916718093"],["Dr. SUNIL HABIB (SH004)","8277658591"],["Dr. VENKATESH R MBBS MD (VR001)","9916142278"],["Dr. VIJETH (VD004)","8867390334"],["Dr. VINAY V JOSHI (VJ001)","9980517351"]];
  window.TRIN_DOCTORS = DOCTORS;
  /* returns { node, get() }; get() gives { name, mobile } ('' name means Self) */
  window.docPicker = function (L, name, mobile) {
    var el = L.el, sel = el('select'), num = el('input', { readonly: 'readonly', placeholder: "Doctor's number", 'aria-label': "Doctor's number" }),
      on = el('input', { placeholder: 'Doctor name' }), om = el('input', { placeholder: 'Doctor mobile number', inputmode: 'tel', maxlength: '10' }), other = el('div', 'form2'), node = el('div');
    sel.appendChild(el('option', { value: 'self', text: 'Self' }));
    DOCTORS.forEach(function (d, i) { sel.appendChild(el('option', { value: String(i), text: d[0] })); });
    sel.appendChild(el('option', { value: 'other', text: 'Other (type name and number)' }));
    other.appendChild(L.fld('Doctor name', on)); other.appendChild(L.fld('Doctor mobile', om));
    node.appendChild(sel); node.appendChild(num); node.appendChild(other);
    function show() {
      var v = sel.value; other.hidden = v !== 'other'; num.hidden = v === 'self' || v === 'other';
      num.value = v !== 'self' && v !== 'other' ? 'Mobile: ' + DOCTORS[Number(v)][1] : '';
    }
    sel.addEventListener('change', show);
    om.addEventListener('input', function () { om.value = om.value.replace(/\D/g, '').slice(0, 10); });
    var idx = -1; DOCTORS.forEach(function (d, i) { if (d[0].toLowerCase() === String(name || '').trim().toLowerCase()) idx = i; });
    if (!name || /^self$/i.test(name)) sel.value = 'self'; else if (idx >= 0) sel.value = String(idx); else { sel.value = 'other'; on.value = name; om.value = mobile || ''; }
    show();
    return { node: node, get: function () {
      var v = sel.value; if (v === 'self') return { name: '', mobile: '' };
      if (v === 'other') return { name: on.value.trim(), mobile: om.value };
      return { name: DOCTORS[Number(v)][0], mobile: DOCTORS[Number(v)][1] };
    } };
  };
})();
