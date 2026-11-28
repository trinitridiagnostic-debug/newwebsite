/* Animated sample-vial icons. TVIAL.html(testName, px) -> small SVG (cap + liquid + rising bubbles in the cap colour), or '' when the test has no vial. */
(function () {
  var COL = { 'yellow': ['#F4C20D', '#FBE08A'], 'yellow(special)': ['#D99A00', '#F3CE6B'], 'white': ['#FFFFFF', '#E3EAEE'], 'purple': ['#7B3FA0', '#C9A6DD'], 'sky blue': ['#2FA8E0', '#A9DDF4'], 'ash colour': ['#8E979C', '#D0D6D9'], 'black': ['#262626', '#9A9A9A'], 'green': ['#2E9E4F', '#A5DDB6'] };
  var NAMES = { 'yellow': 'Yellow cap (serum/gel)', 'yellow(special)': 'Yellow cap (special)', 'white': 'White cap', 'purple': 'Purple cap (EDTA)', 'sky blue': 'Sky blue cap (citrate)', 'ash colour': 'Ash cap', 'black': 'Black cap', 'green': 'Green cap' };
  var n = 0;
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function css() {
    if (document.getElementById('tvial-css')) return; var s = document.createElement('style'); s.id = 'tvial-css';
    s.textContent = '.tvial{display:inline-block;vertical-align:middle;flex:none}.tvial .bb{animation:tvup 2.6s ease-in infinite;opacity:0;transform-box:fill-box}.tvial .wv{animation:tvwv 2.2s ease-in-out infinite alternate}' +
      '@keyframes tvup{0%{transform:translateY(0);opacity:0}15%{opacity:.95}85%{opacity:.9}100%{transform:translateY(-27px);opacity:0}}@keyframes tvwv{from{transform:translateX(-1.5px)}to{transform:translateX(1.5px)}}' +
      '@media (prefers-reduced-motion:reduce){.tvial .bb,.tvial .wv{animation:none}.tvial .bb{opacity:.8}}';
    document.head.appendChild(s);
  }
  function svg(colour, px) {
    css(); var c = COL[String(colour).toLowerCase()]; if (!c) return ''; var id = 'tv' + (++n), w = Math.round((px || 44) * 0.42), h = px || 44, cap = c[0], liq = c[1];
    var edge = colour.toLowerCase() === 'white' ? '#9AA7AE' : 'rgba(0,0,0,.25)', bub = colour.toLowerCase() === 'white' ? '#B7C4CB' : cap;
    var bubbles = [[14, 0], [20, .9], [26, .45], [17, 1.6], [23, 2.1]].map(function (b, i) { return '<circle class="bb" cx="' + b[0] + '" cy="' + (88 - (i % 2) * 2) + '" r="' + (1.6 + (i % 3) * .5) + '" fill="' + bub + '" stroke="' + (bub === '#B7C4CB' ? '#8396A0' : 'none') + '" stroke-width=".5" style="animation-delay:' + b[1] + 's"/>'; }).join('');
    return '<svg class="tvial" width="' + w + '" height="' + h + '" viewBox="0 0 40 96" role="img" aria-label="' + NAMES[String(colour).toLowerCase()] + '"><title>' + NAMES[String(colour).toLowerCase()] + '</title>' +
      '<defs><clipPath id="' + id + '"><path d="M10 16h20v66a10 10 0 0 1-20 0z"/></clipPath></defs>' +
      '<path d="M10 16h20v66a10 10 0 0 1-20 0z" fill="#F6FAFC" fill-opacity=".9"/>' +
      '<g clip-path="url(#' + id + ')"><g class="wv"><rect x="6" y="63" width="30" height="40" fill="' + liq + '"/></g>' + bubbles + '</g>' +
      '<path d="M10 16h20v66a10 10 0 0 1-20 0z" fill="none" stroke="' + edge + '" stroke-width="1.6"/>' +
      '<rect x="7" y="2" width="26" height="15" rx="3.5" fill="' + cap + '" stroke="' + edge + '" stroke-width="1.2"/><path d="M11 6v7M15 6v7M19 6v7M23 6v7M27 6v7" stroke="rgba(0,0,0,.18)" stroke-width="1"/>' +
      '<path d="M14 24v50" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  window.TVIAL = { colour: function (name) { return (window.VIALMAP || {})[norm(name)] || ''; }, svg: svg, name: function (c) { return NAMES[String(c).toLowerCase()] || ''; },
    html: function (name, px) { var c = this.colour(name); return c ? svg(c, px) : ''; },
    node: function (name, px) { var h = this.html(name, px); if (!h) return null; var d = document.createElement('span'); d.innerHTML = h; return d.firstChild; } };
})();
