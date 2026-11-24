/* Puts the Trinetri letterhead around a PDF made by the lab's standalone software.
   The software's own pages are kept untouched (only scaled to fit); a header with patient details and a footer with
   the pathologist and page numbers are added on every page. Runs in the browser with pdf-lib. */
(function () {
  'use strict';
  var LAB = window.LAB, A4W = 595.28, A4H = 841.89, MM = 2.8346;
  var LAB_NAME = 'TRINETRI DIAGNOSTICS', ADDR = 'K C Rani Road, 3rd Cross Rd, Betageri, Karnataka 582101', CONTACT = 'Phone / WhatsApp: +91 91873 15972  |  trinetridiagnostics.com';

  function latin(s) {
    return String(s == null ? '' : s).replace(/₹/g, 'Rs.').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  }
  function dt(ms, withTime) {
    if (!ms) return '-'; var d = new Date(Number(ms)), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + (withTime ? ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) : '');
  }
  function fitText(font, text, size, maxW) { text = latin(text); while (text.length > 3 && font.widthOfTextAtSize(text, size) > maxW) text = text.slice(0, -2); return text; }

  /* o = order (from the server), src = ArrayBuffer of the lab software's PDF,
     opt = { cropTop, cropBottom (mm), draft (bool), by, title, at (ms) } -> Uint8Array */
  async function compose(o, src, opt) {
    var P = window.PDFLib; if (!P) throw new Error('The PDF tool did not load. Refresh the page and try again.');
    opt = opt || {};
    var srcDoc; try { srcDoc = await P.PDFDocument.load(src, { ignoreEncryption: true }); } catch (e) { throw new Error('This PDF could not be opened. Export it again from the lab software.'); }
    var n = srcDoc.getPageCount(); if (!n) throw new Error('This PDF has no pages.');
    var out = await P.PDFDocument.create();
    var F = await out.embedFont(P.StandardFonts.Helvetica), FB = await out.embedFont(P.StandardFonts.HelveticaBold);
    var logo = null; try { var r = await fetch('icon.png'); if (r.ok) logo = await out.embedPng(await r.arrayBuffer()); } catch (e) { logo = null; }
    var teal = P.rgb(0.05, 0.45, 0.45), ink = P.rgb(0.1, 0.12, 0.14), grey = P.rgb(0.4, 0.43, 0.46), line = P.rgb(0.8, 0.85, 0.86);
    var cT = Math.max(0, Number(opt.cropTop) || 0) * MM, cB = Math.max(0, Number(opt.cropBottom) || 0) * MM, FOOT = 56;
    var pages = [];
    for (var i = 0; i < n; i++) {
      var sp = srcDoc.getPage(i), sz = sp.getSize(), bbH = sz.height - cT - cB; if (bbH < 40) bbH = sz.height, cT = 0, cB = 0;
      var emb = await out.embedPage(sp, { left: 0, bottom: cB, right: sz.width, top: sz.height - cT });
      var page = out.addPage([A4W, A4H]); pages.push(page);
      var HEAD = i === 0 ? 156 : 58, aw = A4W - 40, ah = A4H - HEAD - FOOT - 8, s = Math.min(aw / sz.width, ah / bbH);
      page.drawPage(emb, { x: (A4W - sz.width * s) / 2, y: A4H - HEAD - 4 - bbH * s, xScale: s, yScale: s });
      /* header */
      var top = A4H - 28;
      if (logo) page.drawImage(logo, { x: 40, y: top - 40, width: 42, height: 40 });
      var tx = logo ? 92 : 40;
      if (i === 0) {
        page.drawText(LAB_NAME, { x: tx, y: top - 17, size: 19, font: FB, color: teal });
        page.drawText(latin(ADDR), { x: tx, y: top - 29, size: 8, font: F, color: grey });
        page.drawText(latin(CONTACT), { x: tx, y: top - 39, size: 8, font: F, color: grey });
        var tag = 'LABORATORY REPORT'; page.drawText(tag, { x: A4W - 40 - FB.widthOfTextAtSize(tag, 10.5), y: top - 14, size: 10.5, font: FB, color: ink });
        page.drawLine({ start: { x: 40, y: top - 48 }, end: { x: A4W - 40, y: top - 48 }, thickness: 1.4, color: teal });
        var by = top - 54, bh = 58;
        page.drawRectangle({ x: 40, y: by - bh, width: A4W - 80, height: bh, borderColor: line, borderWidth: 0.8, color: P.rgb(0.97, 0.985, 0.985) });
        var ageSex = [o.age != null ? o.age + ' Y' : '', o.sex ? ({ M: 'Male', F: 'Female', male: 'Male', female: 'Female' }[o.sex] || o.sex) : ''].filter(Boolean).join(' / ') || '-';
        var L = [['Patient', o.name || '-'], ['Age / Sex', ageSex], ['Referred by', o.ref_doctor || 'Self']];
        var R = [['Order ID', o.code], ['Registered', dt(o.created, true)], ['Reported', dt(opt.at || Date.now(), true)]];
        L.forEach(function (x, k) { var y = by - 16 - k * 16; page.drawText(x[0] + ':', { x: 50, y: y, size: 8.5, font: F, color: grey }); page.drawText(fitText(FB, x[1], 10, 190), { x: 112, y: y, size: 10, font: FB, color: ink }); });
        R.forEach(function (x, k) { var y = by - 16 - k * 16; page.drawText(x[0] + ':', { x: 322, y: y, size: 8.5, font: F, color: grey }); page.drawText(fitText(FB, x[1], 10, 150), { x: 388, y: y, size: 10, font: FB, color: ink }); });
      } else {
        page.drawText(LAB_NAME, { x: tx, y: top - 14, size: 13, font: FB, color: teal });
        var sub = latin((o.name || '') + '   |   Order ' + o.code); page.drawText(fitText(F, sub, 9, 380), { x: tx, y: top - 28, size: 9, font: F, color: grey });
        page.drawLine({ start: { x: 40, y: top - 44 }, end: { x: A4W - 40, y: top - 44 }, thickness: 1.2, color: teal });
      }
    }
    var total = pages.length;
    pages.forEach(function (page, i) {
      page.drawLine({ start: { x: 40, y: FOOT - 4 }, end: { x: A4W - 40, y: FOOT - 4 }, thickness: 0.8, color: line });
      page.drawText('Trinetri Diagnostics', { x: 40, y: FOOT - 18, size: 9, font: FB, color: ink });
      var pg = 'Page ' + (i + 1) + ' of ' + total; page.drawText(pg, { x: A4W - 40 - F.widthOfTextAtSize(pg, 9), y: FOOT - 18, size: 9, font: F, color: grey });
      var l2 = 'This is an electronically generated report from Trinetri Diagnostics. ' + ADDR + '.'; page.drawText(fitText(F, l2, 7, A4W - 80), { x: 40, y: FOOT - 31, size: 7, font: F, color: grey });
    });
    out.setTitle('Lab report ' + o.code + ' - Trinetri Diagnostics'); out.setAuthor('Trinetri Diagnostics'); out.setCreator('Trinetri Diagnostics');
    return out.save();
  }
  LAB.brandReport = compose;
})();
