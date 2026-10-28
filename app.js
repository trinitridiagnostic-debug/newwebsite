/* Trinetri Diagnostics: shared behaviour for every page.
   Each block runs only if its elements exist on the current page. */
(function(){
  var $=function(s,r){return (r||document).querySelector(s)};
  var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
  var reduce=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- small storage layer (survives page changes, falls back to memory) ---------- */
  var mem={};
  function sget(k,d){try{var v=localStorage.getItem('trin.'+k);if(v!==null)return JSON.parse(v);}catch(e){}return (k in mem)?mem[k]:d;}
  function sset(k,v){mem[k]=v;try{localStorage.setItem('trin.'+k,JSON.stringify(v));}catch(e){}}
  function sdel(k){delete mem[k];try{localStorage.removeItem('trin.'+k);}catch(e){}}
  function nav2(url){window.location.href=url;}

  /* ---------- menu ---------- */
  var mb=$('#mb'),nav=$('#nav');
  if(mb&&nav){
    mb.addEventListener('click',function(){var o=nav.classList.toggle('open');mb.setAttribute('aria-expanded',o?'true':'false');});
    $$('#nav a').forEach(function(a){a.addEventListener('click',function(){nav.classList.remove('open');mb.setAttribute('aria-expanded','false');});});
  }

  /* ---------- banner carousel (home) ---------- */
  var car=$('#car');
  if(car){
    var slides=$$('.slide',car),dots=$$('.dot',car),cur=0,timer=null,DUR=6500;
    if(reduce)car.classList.add('still');
    var retrigger=function(){var d=dots[cur];d.classList.remove('on');void d.offsetWidth;d.classList.add('on');};
    var start=function(){clearInterval(timer);if(reduce)return;timer=setInterval(function(){go(cur+1);},DUR);};
    var go=function(n){
      cur=(n+slides.length)%slides.length;
      slides.forEach(function(s,k){s.classList.toggle('on',k===cur);s.setAttribute('aria-hidden',k===cur?'false':'true');});
      dots.forEach(function(d,k){d.classList.toggle('on',k===cur);d.setAttribute('aria-current',k===cur?'true':'false');});
      start();
    };
    dots.forEach(function(d,k){d.addEventListener('click',function(){if(k===cur){retrigger();start();}else go(k);});});
    $('#prev').addEventListener('click',function(){go(cur-1);});
    $('#next').addEventListener('click',function(){go(cur+1);});
    var hold=function(){car.classList.add('paused');clearInterval(timer);};
    var release=function(){car.classList.remove('paused');retrigger();start();};
    car.addEventListener('mouseenter',hold);car.addEventListener('mouseleave',release);
    car.addEventListener('focusin',hold);car.addEventListener('focusout',release);
    var sx=null;
    car.addEventListener('pointerdown',function(e){sx=e.clientX;});
    car.addEventListener('pointerup',function(e){if(sx===null)return;var dx=e.clientX-sx;sx=null;if(Math.abs(dx)>60)go(cur+(dx<0?1:-1));});
    car.addEventListener('keydown',function(e){if(e.key==='ArrowRight')go(cur+1);if(e.key==='ArrowLeft')go(cur-1);});
    start();
  }

  /* ---------- catalogue data (data.js: name, code, MRP from the price list) ---------- */
  var CATL=window.CATALOG||{};
  var HID={};(CATL.hiddenTests||[]).forEach(function(h){HID[h]=1;});
  var ED=CATL.editedTests||{};
  var RAW=(window.RAW||[]).filter(function(r){return !HID[r[0]+':'+r[1]];}).map(function(r){var e=ED[r[0]+':'+r[1]];return e?[r[0],r[1],e.n||r[2],e.m>0?e.m:r[3]]:r;}).concat((CATL.extraTests||[]).map(function(t){return ['T',t.k,t.n,t.m];}));
  var CATN={P:'Package',F:'Profile',T:'Test',O:'Out-lab test'};
  var CAT=RAW.map(function(r){return {id:r[0]+':'+r[1],c:r[0],k:r[1],n:r[2],m:r[3],l:r[2].toLowerCase(),s:(r[2]+' '+r[1]).toLowerCase()};});
  var BY={};CAT.forEach(function(it){BY[it.id]=it;});
  /* ---------- packages come from catalog.js (edited in admin.html) ---------- */
  var PKS=CATL.packages||[];
  function pkCard(p){
    var z=p.img?'<button type="button" class="zoom" data-full="'+esc(p.imgFull||p.img)+'" aria-label="View the '+esc(p.name)+' poster full size"><img src="'+esc(p.img)+'" alt="'+esc(p.name)+' poster: '+esc(inr(p.price))+(p.mrp?' instead of '+esc(inr(p.mrp)):'')+'" width="720" height="720" loading="lazy"></button>':'';
    return '<article class="card pkc pkc-feat" aria-label="'+esc(p.name)+'"><div class="pkc-body"><span class="tag" style="color:var(--teal)">'+esc(p.tag||'Offer package')+'</span><h3>'+esc(p.name)+'</h3>'+
      '<div class="price">'+(p.mrp?'<s>'+inr(p.mrp)+'</s>':'')+'<b>'+inr(p.price)+'</b><span>'+esc(p.label||'Offer price')+'</span></div>'+
      '<p class="free">'+esc(p.note||'Free home collection')+'</p><a class="btn" href="book.html" data-pick="'+esc(p.name)+'">Book this</a></div>'+z+'</article>';
  }
  $$('#pkrail,.pkfg').forEach(function(box){box.innerHTML=PKS.map(pkCard).join('');});
  ['#ts','#hq-pk'].forEach(function(q){
    var s0=$(q);if(!s0)return;
    $$('option',s0).slice(1).forEach(function(o){o.remove();});
    PKS.forEach(function(p){var o=document.createElement('option');o.textContent=p.name;s0.appendChild(o);});
  });
  function esc(s){return String(s).replace(/[&<>"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];});}
  function inr(n){try{return '\u20B9'+Number(n).toLocaleString('en-IN');}catch(e){return '\u20B9'+n;}}
  function jump(id){var t=$(id);if(t&&t.scrollIntoView)t.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});}

  var CON=[
    {k:'heart',n:'Heart',re:'lipid|cholesterol|cardiac|troponin|\\bcrp\\b|c-reactive|apolipoprotein|homocysteine|lipoprotein|triglycerid|natriuretic|heart',p:'<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'},
    {k:'diabetes',n:'Diabetes',re:'glucose|hba1c|insulin|diabet|fructosamine|microalbumin|c-peptide|sugar',p:'<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'},
    {k:'thyroid',n:'Thyroid',re:'thyroid|\\btsh\\b|ustsh|\\bt3\\b|\\bt4\\b|thyro|\\btpo\\b',p:'<path d="M12 9c-1-3-5-4-6-1s1 7 4 8l2-2 2 2c3-1 5-5 4-8s-5-2-6 1z"/>'},
    {k:'liver',n:'Liver',re:'liver|sgpt|sgot|bilirubin|\\blft\\b|hepatitis|\\bggt\\b|alkaline|albumin|hepatic',p:'<path d="M3 10c0-3 3-4 7-4h6c3 0 5 2 5 5 0 5-5 8-10 8-5 0-8-4-8-9z"/>'},
    {k:'kidney',n:'Kidney',re:'kidney|creatinine|\\burea\\b|renal|uric|urine|electrolyte|cystatin|urinary',p:'<path d="M15 4c3 0 5 3 5 7s-2 9-6 9c-3 0-3-3-5-3-3 0-4-3-3-6 1-4 5-7 9-7z"/>'},
    {k:'fever',n:'Fever and infection',re:'dengue|malari|widal|typhoid|fever|chikungunya|\\bcrp\\b|c-reactive|hemogram|\\besr\\b|procalcitonin',p:'<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/>'},
    {k:'vitamins',n:'Vitamins',re:'vitamin|b-?12|folate|folic|calcium|ferritin|\\biron\\b|zinc|magnesium',p:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'},
    {k:'women',n:"Women's health",re:'pregnan|hcg|pcos|prolactin|estradiol|progesterone|\\bfsh\\b|\\blh\\b|\\bamh\\b|\\bpap\\b|ovar|antenatal|obstetric',p:'<circle cx="12" cy="9" r="5"/><path d="M12 14v8M9 18h6"/>'}
  ];
  CON.forEach(function(c){c.rx=new RegExp(c.re,'i');});

  var POP=[
    {id:'T:FBS',x:'Blood glucose after an overnight fast, used to screen for and monitor diabetes.',f:'8 \u2013 10 hours'},
    {id:'T:PPBS',x:'Blood glucose after a meal, read together with fasting sugar.',f:'2 hours after a meal'},
    {id:'T:HBA',x:'Average blood sugar over the past three months.',f:'Not needed'},
    {id:'T:ESR',x:'Erythrocyte sedimentation rate, a general marker of inflammation.',f:'Not needed'},
    {id:'T:HSCRP',x:'High sensitivity C-reactive protein, a sensitive marker of inflammation.',f:'Not needed'},
    {id:'T:SGPT',x:'Alanine transaminase (SGPT), a liver enzyme.',f:'Not needed'},
    {id:'T:SCRE',x:'Serum creatinine, a basic kidney marker.',f:'Not needed'},
    {id:'T:URIC',x:'Uric acid level in blood.',f:'Not needed'},
    {id:'T:FERR',x:'Ferritin, the body\'s iron store.',f:'Morning sample preferred'},
    {id:'T:VITDC',x:'Total 25-OH vitamin D, linked to bone and muscle health.',f:'Not needed'},
    {id:'T:VITB',x:'Vitamin B12 level, linked to nerves and energy.',f:'Not usually needed'},
    {id:'T:NS1',x:'Dengue NS1 antigen by ELISA, for the first days of fever.',f:'Not needed'}
  ];

  /* ---------- request state shared across pages ---------- */
  var sel=sget('sel',[]);if(!Array.isArray(sel))sel=[];
  sel=sel.filter(function(id){return !CAT.length||BY[id];});
  var pkg=String(sget('pkg','')||'');
  var ts=$('#ts');
  if(ts){var ok=$$('option',ts).some(function(o){return o.value===pkg;});if(!ok){pkg='';sset('pkg','');}ts.value=pkg;}

  var toastEl=null,toastT=null;
  function toast(msg){
    if(!toastEl){toastEl=document.createElement('div');toastEl.className='toast';toastEl.setAttribute('role','status');document.body.appendChild(toastEl);}
    toastEl.textContent=msg;toastEl.classList.add('on');clearTimeout(toastT);
    toastT=setTimeout(function(){toastEl.classList.remove('on');},2400);
  }
  function toggle(id){
    var i=sel.indexOf(id),it=BY[id];
    if(i>-1){sel.splice(i,1);if(it)toast('Removed '+it.n);}
    else{sel.push(id);if(it)toast('Added '+it.n+' \u00B7 '+sel.length+' in your request');}
    sset('sel',sel);sync();
  }
  function sync(){
    $$('.add[data-k]').forEach(function(b){
      var on=sel.indexOf(b.getAttribute('data-k'))>-1,isCard=!!b.closest('.tc');
      b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);
      b.textContent=isCard?(on?'Added to request':'Add to request'):(on?'Added':'Add');
    });
    $$('.cnt').forEach(function(c){c.textContent=sel.length+(pkg?1:0);});
    var ch=$('#chips'),tot=$('#tot');
    if(ch){
      var sum=0;ch.innerHTML='';
      if(!sel.length){ch.innerHTML='<span class="muted" style="font-size:.88rem">No tests added yet.</span>';}
      sel.forEach(function(id){
        var it=BY[id];if(!it)return;sum+=it.m;
        var s=document.createElement('span');s.className='chip';
        s.innerHTML=esc(it.n)+' <em>'+inr(it.m)+'</em><button type="button" aria-label="Remove '+esc(it.n)+'">\u00D7</button>';
        $('button',s).addEventListener('click',function(){toggle(id);});ch.appendChild(s);
      });
      tot.innerHTML=sel.length?'<span>'+sel.length+' test'+(sel.length>1?'s':'')+' selected \u00B7 <button type="button" id="clrsel" class="linkbtn">Clear all</button></span><span>Total at MRP: <b>'+inr(sum)+'</b></span>':'';
    }
    refreshWA();
  }
  $$('[data-pick]').forEach(function(a){a.addEventListener('click',function(){pkg=a.getAttribute('data-pick');sset('pkg',pkg);});});
  $$('[data-t0]').forEach(function(a){a.addEventListener('click',function(){sset('q','');sset('c','');sset('t',a.getAttribute('data-t0'));});});
  $$('[data-faq]').forEach(function(a){a.addEventListener('click',function(){sset('open',a.getAttribute('data-faq'));});});
  if(ts)ts.addEventListener('change',function(){pkg=ts.value;sset('pkg',pkg);sync();});

  /* ---------- popular tests rail (home) ---------- */
  var rail=$('#rail');
  if(rail){
    POP.forEach(function(p){
      var it=BY[p.id];if(!it)return;
      var a=document.createElement('article');a.className='card tc';
      a.innerHTML='<span class="dept">'+esc(CATN[it.c])+'</span><h3>'+esc(it.n)+'</h3><p>'+esc(p.x)+'</p>'+
        '<div class="meta"><div><span>Fasting</span><b>'+esc(p.f)+'</b></div><div><span>MRP</span><b class="pv">'+inr(it.m)+'</b></div></div>'+
        '<button class="add" type="button" data-k="'+it.id+'" aria-pressed="false">Add to request</button>';
      rail.appendChild(a);
    });
    rail.addEventListener('keydown',function(e){if(e.key==='ArrowRight')rail.scrollBy({left:300,behavior:'smooth'});if(e.key==='ArrowLeft')rail.scrollBy({left:-300,behavior:'smooth'});});
    var rl=$('#rl'),rr=$('#rr');
    if(rl)rl.addEventListener('click',function(){rail.scrollBy({left:-320,behavior:reduce?'auto':'smooth'});});
    if(rr)rr.addEventListener('click',function(){rail.scrollBy({left:320,behavior:reduce?'auto':'smooth'});});
  }

  /* ---------- search and catalogue ---------- */
  var cat=$('#cat'),more=$('#more'),pills=$('#pills'),fn=$('#fn'),q1=$('#q'),q2=$('#q2'),sug=$('#sug'),cg=$('#cg');
  var state={q:'',c:'',t:''},shown=30;
  function parse(q){return q.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);}
  function match(it,toks){for(var i=0;i<toks.length;i++){if(it.s.indexOf(toks[i])<0)return false;}return true;}
  function score(it,toks){
    var s=0;
    toks.forEach(function(t){var p=it.l.indexOf(t);if(p===0)s+=0;else if(p>0&&/[^a-z0-9]/.test(it.l.charAt(p-1)))s+=1;else if(p>0)s+=3;else s+=4;});
    return s*1000+it.l.length;
  }
  function find(skipType,ignoreConcern){
    var toks=parse(state.q),cc=null;
    if(!ignoreConcern&&state.c){cc=CON.filter(function(c){return c.k===state.c;})[0].rx;}
    var out=CAT.filter(function(it){return (skipType||!state.t||it.c===state.t)&&match(it,toks)&&(!cc||cc.test(it.l));});
    if(toks.length)out.sort(function(a,b){return score(a,toks)-score(b,toks);});
    else out.sort(function(a,b){return a.n.localeCompare(b.n);});
    return out;
  }
  function addBtn(it){var on=sel.indexOf(it.id)>-1;return '<button class="add'+(on?' on':'')+'" type="button" data-k="'+it.id+'" aria-pressed="'+on+'">'+(on?'Added':'Add')+'</button>';}
  function rowHtml(it,cls){return '<div class="'+cls+'"><div class="cname"><b>'+esc(it.n)+'</b><span>'+esc(it.k)+' \u00B7 '+CATN[it.c]+'</span></div><div class="cprice">'+inr(it.m)+'</div>'+addBtn(it)+'</div>';}
  function markConcern(){if(cg)$$('.cn',cg).forEach(function(x){x.setAttribute('aria-pressed',x.dataset.k===state.c?'true':'false');});}

  if(cg){
    CON.forEach(function(c){
      var b=document.createElement('button');b.type='button';b.className='cn';b.setAttribute('aria-pressed','false');b.dataset.k=c.k;
      b.innerHTML='<span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">'+c.p+'</svg></span><span>'+c.n+'</span>';
      b.addEventListener('click',function(){
        var next=(state.c===c.k)?'':c.k;
        if(!cat){sset('q','');sset('t','');sset('c',next);nav2('tests.html');return;}
        state.c=next;state.q='';state.t='';if(q2)q2.value='';markConcern();renderCat(true);jump('#catalogue');
      });
      cg.appendChild(b);
    });
  }

  var PILL=[['','All'],['T','Tests'],['O','Out-lab']];
  function renderCat(reset){
    if(!cat)return;
    if(reset)shown=30;
    var base=find(true),counts={'':base.length,T:0,O:0};
    base.forEach(function(it){counts[it.c]++;});
    var list=state.t?base.filter(function(it){return it.c===state.t;}):base;
    pills.innerHTML=PILL.map(function(p){return '<button type="button" class="pill" aria-pressed="'+(state.t===p[0])+'" data-t="'+p[0]+'">'+p[1]+' <span>'+counts[p[0]]+'</span></button>';}).join('');
    cat.innerHTML=list.length?list.slice(0,shown).map(function(it){return rowHtml(it,'crow');}).join(''):'<div class="empty">No test matches this search. Add the test name in the notes of your booking request and we will check for you.</div>';
    var left=list.length-shown;
    more.hidden=left<=0;more.textContent='Show more ('+Math.max(left,0)+' left)';
    var bits=[];
    if(state.c)bits.push('Concern: '+CON.filter(function(c){return c.k===state.c;})[0].n);
    if(state.q.trim())bits.push('Search: "'+state.q.trim()+'"');
    fn.innerHTML=bits.length?('<span>'+list.length+' results \u00B7 '+esc(bits.join(' \u00B7 '))+'</span><button type="button" id="clr">Clear filters</button>'):('<span>'+CAT.length+' tests</span>');
  }
  function renderSug(){
    var toks=parse(state.q);
    if(!toks.length){sug.hidden=true;return;}
    var res=find(true,true),top=res.slice(0,8);
    sug.innerHTML=top.length?top.map(function(it){return rowHtml(it,'srow');}).join('')+'<button type="button" class="sall" id="sall">See all '+res.length+' results</button>':'<div class="empty muted">No match. Try another word or the test code.</div>';
    sug.hidden=false;
  }
  if(cat){
    state.q=String(sget('q','')||'');state.c=String(sget('c','')||'');state.t=String(sget('t','')||'');
    sdel('q');sdel('c');sdel('t');
    if(q2)q2.value=state.q;
    markConcern();renderCat(true);
    q2.addEventListener('input',function(){state.q=q2.value;state.c='';markConcern();renderCat(true);});
    pills.addEventListener('click',function(e){var b=e.target.closest('.pill');if(!b)return;state.t=b.getAttribute('data-t');renderCat(true);});
    more.addEventListener('click',function(){shown+=30;renderCat(false);sync();});
  }
  if(q1&&sug){
    q1.addEventListener('input',function(){state.q=q1.value;renderSug();});
    q1.addEventListener('focus',renderSug);
    q1.addEventListener('keydown',function(e){if(e.key==='Escape')sug.hidden=true;});
    $('#sf').addEventListener('submit',function(e){e.preventDefault();sset('q',q1.value);sset('c','');sset('t','');nav2('tests.html');});
  }

  document.addEventListener('click',function(e){
    var t=e.target;
    var b=t.closest&&t.closest('.add[data-k]');
    if(b){toggle(b.getAttribute('data-k'));return;}
    if(t.id==='clr'){state.q='';state.c='';state.t='';if(q2)q2.value='';markConcern();renderCat(true);return;}
    if(t.id==='clrsel'){sel=[];sset('sel',sel);sync();return;}
    if(t.id==='sall'){sset('q',state.q);sset('c','');sset('t','');nav2('tests.html');return;}
    if(sug&&!sug.hidden&&!sug.contains(t)&&t!==q1)sug.hidden=true;
  });

  /* ---------- FAQ deep link ---------- */
  var want=sget('open','');
  if(want){sdel('open');var dd=$('details[data-id="'+want+'"]');if(dd){dd.open=true;setTimeout(function(){try{dd.scrollIntoView({block:'center'});}catch(e){}},80);}}

  /* ---------- booking via WhatsApp ---------- */
  var WA='919187315972';
  var PKGP={};PKS.forEach(function(p){PKGP[p.name]='offer price Rs '+Number(p.price).toLocaleString('en-IN')+', free home collection';});
  var bk=$('#bk'),d=$('#dt'),out=$('#out'),st=$('#st'),wa=$('#wa'),cp=$('#cp'),ol=$('#ol'),lastMsg='';
  function say(m,c){st.style.color=c;st.textContent=m;}
  function build(){
    var nm=$('#nm').value.trim(),ph=$('#ph').value.replace(/\D/g,'');
    if(!nm)return {err:'Enter the patient name.'};
    if(ph.length<10)return {err:'Enter a 10-digit mobile number.'};
    if(!pkg&&!sel.length)return {err:'Pick a package or add at least one test.'};
    var sum=0,lines=sel.map(function(id){var it=BY[id];sum+=it.m;return '- '+it.n+' ('+it.k+') '+inr(it.m);});
    return {msg:'Home collection request - Trinetri Diagnostics\nName: '+nm+'\nMobile: '+ph+
      '\nPackage: '+(pkg?pkg+(PKGP[pkg]?' ('+PKGP[pkg]+')':''):'-')+'\nTests: '+(lines.length?'\n'+lines.join('\n'):'-')+
      (sel.length?'\nTotal at MRP: '+inr(sum):'')+
      '\nDate: '+d.value+'\nSlot: '+$('#sl').value+'\nAddress: '+($('#ad').value.trim()||'-')};
  }
  /* ---------- online payment (Razorpay Checkout; prices are re-checked on the server) ---------- */
  var PAYCFG=window.TRIN_PAY||{},PKGRS={'Advance Health Package':1199,'Lipid Profile':250,'Double Marker Test':2300,'NT-proBNP':1800,'Trinetri Care Package':799,'Advance+ Health Package':1499,'Basic Health Package':499,'HbA1c Test':280,'Comprehensive Health Package':3199,'Cancer Screening Male':657,'Diabetic Health Package':1199};
  var DEMO=!PAYCFG.key||!PAYCFG.api;
  var payb=$('#pay'),paynote=$('#paynote'),paying=false,payRS=0,paidDone=false;
  function payInfo(){
    var amt=0;
    if(pkg){if(PKGRS[pkg]===undefined)return {ok:false,amt:0,why:'This package is priced when you book. Send the request on WhatsApp and pay at collection.'};amt+=PKGRS[pkg];}
    sel.forEach(function(id){if(BY[id])amt+=BY[id].m;});
    if(amt<=0)return {ok:false,amt:0,why:'Add a test or pick a priced package to pay online.'};
    return {ok:true,amt:amt,why:'Pay securely with UPI, card or net banking. Home collection is free.'};
  }
  function refreshPay(){
    if(!payb)return;
    var p=payInfo();payRS=p.amt;
    payb.textContent=p.ok?'Pay online \u20b9'+p.amt.toLocaleString('en-IN'):'Pay online';
    payb.disabled=!p.ok||paying||paidDone;
    if(paidDone){payb.textContent='Paid';if(paynote)paynote.textContent='Payment received. Send the booking details on WhatsApp above.';return;}
    if(paynote)paynote.textContent=p.ok&&DEMO?'Demo preview: the payment window is simulated and no real money is charged.':p.why;
  }
  function loadRzp(){
    return new Promise(function(res,rej){
      if(window.Razorpay)return res();
      var sc=document.createElement('script');sc.src='https://checkout.razorpay.com/v1/checkout.js';
      sc.onload=function(){window.Razorpay?res():rej();};sc.onerror=function(){rej();};document.head.appendChild(sc);
    });
  }
  function postJSON(path,body){
    return fetch(PAYCFG.api.replace(/\/+$/,'')+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Request failed');return j;});});
  }
  function paidPanel(amt,pid,msg,demo){
    var box=$('#paid');
    if(!box){box=document.createElement('div');box.id='paid';box.className='paid';box.setAttribute('role','status');bk.insertBefore(box,payb);}
    var link='https://wa.me/'+WA+'?text='+encodeURIComponent(msg);
    box.innerHTML='<h3>'+(demo?'Demo payment complete':'Payment received')+'</h3><p>\u20b9'+amt.toLocaleString('en-IN')+(demo?' (demo, no money was charged).':' paid.')+' Payment ID: <code></code></p>'+
      '<p>Last step: tap the button to send your booking details to the lab on WhatsApp so they can schedule your collection.</p>'+
      '<a class="btn" target="_blank" rel="noopener">Send booking details on WhatsApp</a>';
    box.querySelector('code').textContent=pid;box.querySelector('a').href=link;box.hidden=false;
    try{box.scrollIntoView({block:'center',behavior:'smooth'});}catch(e){}
  }
  function demoPay(r,amt){
    var old=$('#dm');if(old)old.remove();
    var m=document.createElement('div');m.id='dm';m.className='dm';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');m.setAttribute('aria-label','Demo payment');
    var rs='\u20b9'+amt.toLocaleString('en-IN');
    m.innerHTML='<div class="dm-box"><div class="dm-top"><b>Trinetri Diagnostics</b><span class="dm-tag">DEMO</span></div>'+
      '<div class="dm-amt"><small>Amount to pay</small><b>'+rs+'</b></div>'+
      '<div class="dm-tabs" role="radiogroup" aria-label="Payment method">'+
      '<label><input type="radio" name="dmm" value="upi" checked><span>UPI</span></label>'+
      '<label><input type="radio" name="dmm" value="card"><span>Card</span></label>'+
      '<label><input type="radio" name="dmm" value="net"><span>Net banking</span></label></div>'+
      '<div class="dm-f" data-m="upi"><label>UPI ID</label><input value="demo@upi" readonly></div>'+
      '<div class="dm-f" data-m="card" hidden><label>Card number</label><input value="4111 1111 1111 1111" readonly><div class="dm-2"><input value="12 / 30" readonly><input value="123" readonly></div></div>'+
      '<div class="dm-f" data-m="net" hidden><label>Bank</label><input value="Demo Bank" readonly></div>'+
      '<button class="btn pay" id="dmpay" type="button">Pay '+rs+'</button>'+
      '<button class="btn ghost" id="dmx" type="button">Cancel</button>'+
      '<p class="dm-note">Demo only. This window is simulated and no real payment is taken.</p></div>';
    document.body.appendChild(m);
    var prev=document.activeElement;
    function close(){m.remove();document.removeEventListener('keydown',esc);try{prev&&prev.focus();}catch(e){}}
    function esc(e){if(e.key==='Escape')close();}
    document.addEventListener('keydown',esc);
    $$('input[name=dmm]',m).forEach(function(i){i.addEventListener('change',function(){
      $$('.dm-f',m).forEach(function(f){f.hidden=f.getAttribute('data-m')!==i.value;});});});
    $('#dmx',m).addEventListener('click',close);
    m.addEventListener('click',function(e){if(e.target===m)close();});
    var go=$('#dmpay',m);go.focus();
    go.addEventListener('click',function(){
      go.disabled=true;go.innerHTML='<span class="dm-spin"></span> Processing...';$('#dmx',m).hidden=true;
      setTimeout(function(){
        var pid='demo_'+Math.random().toString(36).slice(2,10);
        m.querySelector('.dm-box').innerHTML='<div class="dm-ok"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.2 3.2L17 9"/></svg><b>Payment successful</b><small>'+rs+' (demo)</small></div>';
        setTimeout(function(){
          close();
          paidPanel(amt,pid,r.msg+'\nDEMO PAYMENT (no money charged): Rs '+amt+', ID '+pid,true);
          say('','var(--ok)');
        },1300);
      },1700);
    });
  }
  function startPay(){
    var r=build();
    if(r.err){say(r.err,'var(--flag)');return;}
    var p=payInfo();if(!p.ok){say(p.why,'var(--flag)');return;}
    if(DEMO){say('','var(--muted)');demoPay(r,p.amt);return;}
    paying=true;refreshPay();say('Starting secure payment...','var(--muted)');
    var nm=$('#nm').value.trim(),ph=$('#ph').value.replace(/\D/g,'');
    function fail(m){paying=false;refreshPay();say(m,'var(--flag)');}
    postJSON('/create-order',{package:pkg||'',tests:sel.map(function(id){return BY[id].k;}),name:nm,phone:ph})
      .then(function(o){
        return loadRzp().then(function(){
          var rz=new window.Razorpay({
            key:PAYCFG.key,order_id:o.order_id,amount:o.amount,currency:o.currency||'INR',
            name:'Trinetri Diagnostics',description:'Home collection booking',
            prefill:{name:nm,contact:ph},theme:{color:'#3f7b82'},
            modal:{ondismiss:function(){fail('Payment was not completed. You can try again or send the request on WhatsApp.');}},
            handler:function(resp){
              say('Confirming your payment...','var(--muted)');
              postJSON('/verify-payment',resp).then(function(v){
                paying=false;refreshPay();
                if(!v.verified){say('We could not confirm this payment. If money was deducted, send the request on WhatsApp with your payment ID '+resp.razorpay_payment_id+'.','var(--flag)');return;}
                say('','var(--ok)');paidDone=true;refreshPay();
                paidPanel(o.amount/100,resp.razorpay_payment_id,r.msg+'\nPAID ONLINE: Rs '+(o.amount/100)+' (Razorpay payment ID '+resp.razorpay_payment_id+')');
              }).catch(function(){paying=false;refreshPay();say('Payment went through but confirmation failed. Send the request on WhatsApp with payment ID '+resp.razorpay_payment_id+'.','var(--flag)');});
            }
          });
          rz.on('payment.failed',function(e){fail('Payment failed'+(e&&e.error&&e.error.description?': '+e.error.description:'')+'. You can try again.');});
          rz.open();
        });
      })
      .catch(function(e){fail(e&&e.message&&!/fetch|Failed|undefined/i.test(e.message)?e.message:'Could not reach the payment service right now. Send the request on WhatsApp and pay at collection.');});
  }
  function refreshWA(){
    if(!bk||!wa)return;
    refreshPay();
    var r=build();
    if(r.err){out.hidden=true;ol.hidden=true;cp.hidden=true;wa.href='https://wa.me/'+WA;return;}
    lastMsg=r.msg;wa.href='https://wa.me/'+WA+'?text='+encodeURIComponent(r.msg);
    out.textContent=r.msg;out.hidden=false;ol.hidden=false;cp.hidden=false;
  }
  function selOut(){try{var r=document.createRange();r.selectNodeContents(out);var s=getSelection();s.removeAllRanges();s.addRange(r);}catch(y){}}
  if(bk){
    try{var t0d=new Date();t0d.setDate(t0d.getDate()+1);d.min=new Date().toISOString().slice(0,10);d.value=t0d.toISOString().slice(0,10);}catch(e){}
    ['input','change'].forEach(function(ev){bk.addEventListener(ev,refreshWA);});
    if(payb)payb.addEventListener('click',startPay);
    wa.addEventListener('click',function(e){
      var r=build();
      if(r.err){e.preventDefault();say(r.err,'var(--flag)');return;}
      lastMsg=r.msg;wa.href='https://wa.me/'+WA+'?text='+encodeURIComponent(r.msg);
      out.hidden=false;out.textContent=r.msg;cp.hidden=false;
      say('WhatsApp is opening with your request filled in. Tap Send in WhatsApp to deliver it to the lab. If nothing opened, copy the message below and send it to +91 91873 15972.','var(--teal)');
    });
    bk.addEventListener('submit',function(e){e.preventDefault();var r=build();if(r.err)say(r.err,'var(--flag)');else say('Details look good. Tap "Send request on WhatsApp".','var(--muted)');});
    cp.addEventListener('click',function(){
      try{navigator.clipboard.writeText(lastMsg).then(function(){say('Message copied. Paste it in WhatsApp and send it to +91 91873 15972.','var(--ok)');},selOut);}catch(x){selOut();}
    });
  }



  /* ---------- homepage banner: quick booking form (sends to WhatsApp) ---------- */
  var hq=$('#hq');
  if(hq){
    var hw=$('#hq-wa'),hs=$('#hq-st'),hd=$('#hq-dt');
    try{var t1=new Date();t1.setDate(t1.getDate()+1);hd.min=new Date().toISOString().slice(0,10);hd.value=t1.toISOString().slice(0,10);}catch(e){}
    var hsay=function(m,c){hs.style.color=c;hs.textContent=m;};
    var hbuild=function(){
      var nm=$('#hq-nm').value.trim(),ph=$('#hq-ph').value.replace(/\D/g,''),pk=$('#hq-pk').value;
      if(!nm)return {err:'Enter the patient name.'};
      if(ph.length<10)return {err:'Enter a 10-digit mobile number.'};
      if(!hd.value)return {err:'Choose a date.'};
      return {msg:'Home collection request - Trinetri Diagnostics\nName: '+nm+'\nMobile: '+ph+
        '\nPackage: '+(pk?pk+(PKGP[pk]?' ('+PKGP[pk]+')':''):'Not chosen - please advise')+
        '\nDate: '+hd.value+'\nSlot: '+$('#hq-sl').value};
    };
    hw.addEventListener('click',function(e){
      var r=hbuild();
      if(r.err){e.preventDefault();hsay(r.err,'var(--flag)');return;}
      hw.href='https://wa.me/'+WA+'?text='+encodeURIComponent(r.msg);
      hsay('WhatsApp is opening with your request filled in. Tap Send in WhatsApp to deliver it to the lab.','var(--teal)');
    });
    hq.addEventListener('submit',function(e){e.preventDefault();});
  }

  /* ---------- contact page: message to WhatsApp ---------- */
  var cf=$('#cf');
  if(cf){
    var cs=$('#cs'),cst=$('#cst');
    function cmsg(){
      var n=$('#cn').value.trim(),p=$('#cp2').value.replace(/\D/g,''),m=$('#cm').value.trim();
      if(!n)return {err:'Enter your name.'};
      if(p.length<10)return {err:'Enter a 10-digit mobile number.'};
      if(!m)return {err:'Write a short message.'};
      return {msg:'Message for Trinetri Diagnostics\nName: '+n+'\nMobile: '+p+'\nTopic: '+$('#ct').value+'\n'+m};
    }
    cs.addEventListener('click',function(e){
      var r=cmsg();
      if(r.err){e.preventDefault();cst.style.color='var(--flag)';cst.textContent=r.err;return;}
      cs.href='https://wa.me/'+WA+'?text='+encodeURIComponent(r.msg);
      cst.style.color='var(--teal)';cst.textContent='WhatsApp is opening with your message filled in. Tap Send there to deliver it to the lab.';
    });
    cf.addEventListener('submit',function(e){e.preventDefault();});
  }
  /* ---------- count-up (about page) ---------- */
  if('IntersectionObserver' in window&&!reduce){
    var io=new IntersectionObserver(function(es){es.forEach(function(en){
      if(!en.isIntersecting)return;io.unobserve(en.target);
      var el=en.target,to=+el.getAttribute('data-to'),t0=null;
      function step(ts2){if(!t0)t0=ts2;var p=Math.min(1,(ts2-t0)/1100);el.textContent=Math.round(to*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(step);}
      el.textContent='0';requestAnimationFrame(step);
    });},{threshold:.5});
    $$('.num').forEach(function(n){io.observe(n);});
  }

  /* ---------- package slider (home) ---------- */
  var pkr=$('#pkrail');
  if(pkr){
    var pcards=$$('#pkrail>*'),pdots=$('#pkdots'),pi=0,ptimer=null,pheld=false,pvisible=true;
    var offsetOf=function(i){return pkr.scrollLeft+pcards[i].getBoundingClientRect().left-pkr.getBoundingClientRect().left;};
    var pgo=function(i){pi=(i+pcards.length)%pcards.length;pkr.scrollTo({left:offsetOf(pi),behavior:reduce?'auto':'smooth'});mark();};
    var mark=function(){$$('button',pdots).forEach(function(b,k){b.setAttribute('aria-current',k===pi?'true':'false');});};
    pcards.forEach(function(c,k){
      var b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Show package '+(k+1));b.innerHTML='<i></i>';
      b.addEventListener('click',function(){pgo(k);});pdots.appendChild(b);
    });
    var pl=$('#pl'),pr=$('#pr');
    if(pl)pl.addEventListener('click',function(){pgo(pi-1);});
    if(pr)pr.addEventListener('click',function(){pgo(pi+1);});
    var sT=null;
    pkr.addEventListener('scroll',function(){
      clearTimeout(sT);sT=setTimeout(function(){
        var best=0,bd=1e9;pcards.forEach(function(c,k){var d=Math.abs(c.getBoundingClientRect().left-pkr.getBoundingClientRect().left);if(d<bd){bd=d;best=k;}});
        pi=best;mark();
      },90);
    },{passive:true});
    var pstart=function(){clearInterval(ptimer);if(reduce)return;ptimer=setInterval(function(){if(!pheld&&pvisible)pgo(pi+1);},5500);};
    var phold=function(){pheld=true;};var prel=function(){pheld=false;pstart();};
    pkr.addEventListener('mouseenter',phold);pkr.addEventListener('mouseleave',prel);
    pkr.addEventListener('focusin',phold);pkr.addEventListener('focusout',prel);
    pkr.addEventListener('touchstart',phold,{passive:true});pkr.addEventListener('touchend',function(){setTimeout(prel,4000);},{passive:true});
    pkr.addEventListener('keydown',function(e){if(e.key==='ArrowRight')pgo(pi+1);if(e.key==='ArrowLeft')pgo(pi-1);});
    if('IntersectionObserver' in window){new IntersectionObserver(function(es){pvisible=es[0].isIntersecting;},{threshold:.3}).observe(pkr);}
    mark();pstart();
  }

  /* ---------- poster lightbox ---------- */
  var zooms=$$('.zoom');
  if(zooms.length){
    var lb=null,lbImg=null,lbX=null,lbFrom=null;
    var closeLb=function(){if(!lb)return;lb.hidden=true;document.removeEventListener('keydown',lbKey);if(lbFrom&&lbFrom.focus)lbFrom.focus();};
    var lbKey=function(e){if(e.key==='Escape')closeLb();};
    var openLb=function(btn){
      if(!lb){
        lb=document.createElement('div');lb.className='lb';lb.setAttribute('role','dialog');lb.setAttribute('aria-modal','true');lb.setAttribute('aria-label','Package poster');
        lb.innerHTML='<button type="button" class="lb-x" aria-label="Close poster">\u00D7</button><img alt="">';
        document.body.appendChild(lb);lbImg=$('img',lb);lbX=$('.lb-x',lb);
        lb.addEventListener('click',closeLb);
      }
      lbFrom=btn;lbImg.src=btn.getAttribute('data-full');lbImg.alt=$('img',btn).alt;lb.hidden=false;
      document.addEventListener('keydown',lbKey);lbX.focus();
    };
    zooms.forEach(function(b){b.addEventListener('click',function(){openLb(b);});});
  }

  renderCat(true);sync();
})();
