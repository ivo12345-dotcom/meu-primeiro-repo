#pragma once
// Página de radar servida ao telemóvel em http://192.168.4.1

static const char WEB_PAGE[] PROGMEM = R"HTML(<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="theme-color" content="#000000">
<title>Radar</title>
<style>
:root{--bg:#000;--fg:#d6f5d6;--dim:#4f6b4f;--grid:#1d3b1d;--ok:#3ddc65;--bad:#e5484d;--warn:#ff9f1a;--tg:#ff3b3b}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;overflow:hidden}
#wrap{display:flex;flex-direction:column;height:100%;border:4px solid transparent;transition:border-color .15s}
#wrap.flash{border-color:var(--tg)}
#wrap.rcwl{border-color:var(--warn)}
#top{display:flex;gap:6px;padding:8px 10px;align-items:center;flex-wrap:wrap;font-size:13px}
.chip{padding:3px 8px;border-radius:10px;background:#111;color:var(--dim);border:1px solid #222}
.chip.ok{color:var(--ok);border-color:#1f5a2c}.chip.bad{color:var(--bad);border-color:#5a1f22}
.chip.warn{color:var(--warn);border-color:#5a3d12}
#sp{flex:1}
button{background:#111;color:var(--fg);border:1px solid #2a2a2a;border-radius:10px;padding:8px 12px;font-size:15px}
button:active{background:#222}
#cv{flex:1;width:100%;min-height:0;display:block;touch-action:none}
#bottom{padding:8px 12px 14px;text-align:center;min-height:64px}
#count{font-size:28px;font-weight:700}
#rc{font-size:15px;margin-top:4px;color:var(--dim)}
#rc.on{color:var(--warn);font-weight:700}
#panel{position:fixed;inset:0;background:rgba(0,0,0,.94);overflow:auto;padding:16px;display:none}
#panel.open{display:block}
#panel h2{margin:4px 0 12px;font-size:20px}
#panel h3{margin:18px 0 6px;font-size:15px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #1a1a1a;gap:10px}
.row input[type=number]{width:80px;background:#111;color:var(--fg);border:1px solid #333;border-radius:8px;padding:6px;font-size:15px}
.row input[type=range]{flex:1;max-width:180px}
input[type=checkbox]{width:24px;height:24px}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
#raw{font-family:monospace;font-size:12px;white-space:pre-wrap;color:var(--dim)}
.hint{font-size:13px;color:var(--dim);margin:6px 0}
</style>
</head>
<body>
<div id="wrap">
  <div id="top">
    <span class="chip" id="cLink">LIGAÇÃO</span>
    <span id="radChips"></span>
    <span class="chip" id="cImu">IMU</span>
    <span class="chip" id="cStill">—</span>
    <span id="sp"></span>
    <button id="bZero" title="Alinhar frente">⟲</button>
    <button id="bCfg" title="Definições">⚙</button>
  </div>
  <canvas id="cv"></canvas>
  <div id="bottom">
    <div id="count">—</div>
    <div id="rc"> </div>
  </div>
</div>

<div id="panel">
  <h2>Definições</h2>
  <h3>Alertas (sem som)</h3>
  <div class="row"><span>Vibrar com alvo novo</span><input type="checkbox" id="oVib"></div>
  <div class="row"><span>Piscar o ecrã com alvo novo</span><input type="checkbox" id="oFlash"></div>
  <h3>Ecrã</h3>
  <div class="row"><span>Memória dos alvos: <b id="vFade"></b> s</span><input type="range" id="oFade" min="0" max="10" step="1"></div>
  <div class="row"><span>Alcance mostrado: <b id="vRange"></b> m</span><input type="range" id="oRange" min="3" max="8" step="1"></div>
  <div class="row"><span>Compensar rotação da cabeça</span><input type="checkbox" id="oComp"></div>
  <h3>Capacete</h3>
  <div class="row"><span>Ignorar alvos a menos de (m)</span><input type="number" id="dMin" step="0.1" min="0.3" max="2"></div>
  <div class="row"><span>Inverter rotação da cabeça</span><input type="checkbox" id="dInv"></div>
  <div id="radCfg"></div>
  <p class="hint">Espelhar: se uma pessoa anda para a direita do radar e o ponto vai para a esquerda, liga “espelhar” nesse radar.</p>
  <div class="btns">
    <button id="bSave">Guardar</button>
    <button id="bCal">Recalibrar giroscópio</button>
    <button id="bSide">Radares em modo lateral</button>
    <button id="bClose">Fechar</button>
  </div>
  <p class="hint">Recalibrar: pousa o capacete parado durante 3 segundos.</p>
  <h3>Diagnóstico</h3>
  <div id="raw"></div>
</div>

<script>
const $=id=>document.getElementById(id);
const cv=$('cv'),ctx=cv.getContext('2d');
const store={get(k,d){try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch(e){return d}},
             set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const opt={vib:store.get('vib',true),flash:store.get('flash',true),fade:store.get('fade',4),range:store.get('range',6),comp:store.get('comp',true)};
let data=null,lastOk=0,cfg=null,pts=[],prevCount=0,lastAlert=0,sweep=0;
const RCOL=['#ff3b3b','#ffd23b','#3bc8ff'];  // cor de cada radar: frente vermelho, trás-esq amarelo, trás-dir azul

function resize(){const r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1;cv.width=r.width*d;cv.height=r.height*d;ctx.setTransform(d,0,0,d,0,0)}
addEventListener('resize',resize);resize();

async function poll(){
  const ac=new AbortController();const to=setTimeout(()=>ac.abort(),1200);
  try{
    const r=await fetch('/data',{signal:ac.signal,cache:'no-store'});
    data=await r.json();lastOk=performance.now();ingest(data);
  }catch(e){}
  clearTimeout(to);setTimeout(poll,110);
}

function ingest(d){
  const now=performance.now();const h=opt.comp?d.h:0;
  for(const t of d.tg){pts.push({wb:t[0]+h,d:t[1],r:t[2],t:now})}
  const keep=Math.max(opt.fade,0.3)*1000;pts=pts.filter(p=>now-p.t<keep);
  const n=d.tg.length;
  if(n>prevCount&&now-lastAlert>1200){
    lastAlert=now;
    if(opt.vib&&navigator.vibrate)navigator.vibrate(120);
    if(opt.flash){$('wrap').classList.add('flash');setTimeout(()=>$('wrap').classList.remove('flash'),300)}
  }
  prevCount=n;
  $('count').textContent=n?(n+(n==1?' alvo':' alvos')):'sem alvos';
  $('count').style.color=n?'var(--tg)':'var(--dim)';
  const rc=$('rc'),w=$('wrap');
  if(d.rc&&d.st){rc.textContent='⚠ MOVIMENTO PRÓXIMO (fora de vista)';rc.className='on';w.classList.add('rcwl')}
  else{rc.textContent=d.rc?'RCWL: ignorado (estás em movimento)':(d.cal?'A calibrar… não mexer':' ');rc.className='';w.classList.remove('rcwl')}
  chips(d);
  if($('panel').classList.contains('open'))$('raw').textContent=JSON.stringify(d,null,0);
}

function chips(d){
  const c=$('radChips');
  if(c.children.length!==d.r.length){c.innerHTML='';d.r.forEach((_,i)=>{const s=document.createElement('span');s.className='chip';s.style.marginRight='6px';c.appendChild(s)})}
  const names=['FRENTE','T-ESQ','T-DIR'];
  d.r.forEach((r,i)=>{const s=c.children[i];s.textContent='● '+(names[i]||('R'+(i+1)));s.className='chip '+(r[0]?'ok':'bad');s.style.color=r[0]?RCOL[i]:''});
  $('cImu').className='chip '+(d.imu?(d.cal?'warn':'ok'):'bad');$('cImu').textContent=d.imu?(d.cal?'CALIB.':'IMU'):'SEM IMU';
  $('cStill').className='chip '+(d.st?'ok':'warn');$('cStill').textContent=d.st?'ESTÁVEL':'EM MOVIMENTO';
}

function draw(){
  const W=cv.clientWidth,H=cv.clientHeight,cx=W/2,cy=H/2,R=Math.min(W,H)/2-14,now=performance.now();
  ctx.clearRect(0,0,W,H);
  const linked=now-lastOk<1500;
  $('cLink').className='chip '+(linked?'ok':'bad');$('cLink').textContent=linked?'LIGADO':'SEM LIGAÇÃO';
  const sc=R/opt.range;
  // cobertura dos radares
  if(cfg){cfg.yaw.slice(0,cfg.n).forEach(y=>{const a0=(y-60-90)*Math.PI/180,a1=(y+60-90)*Math.PI/180;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,Math.min(6,opt.range)*sc,a0,a1);ctx.closePath();ctx.fillStyle='rgba(61,220,101,0.05)';ctx.fill()})}
  // anéis
  ctx.strokeStyle='#1d3b1d';ctx.lineWidth=1;ctx.fillStyle='#4f6b4f';ctx.font='12px system-ui';
  for(let m=1;m<=opt.range;m++){ctx.beginPath();ctx.arc(cx,cy,m*sc,0,Math.PI*2);ctx.stroke();if(m%2==0||opt.range<=4)ctx.fillText(m+'m',cx+4,cy-m*sc+13)}
  for(let a=0;a<360;a+=30){const r=a*Math.PI/180;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.sin(r)*R,cy-Math.cos(r)*R);ctx.stroke()}
  // varrimento
  sweep=(sweep+2.4)%360;const sr=sweep*Math.PI/180;
  const g=ctx.createLinearGradient(cx,cy,cx+Math.sin(sr)*R,cy-Math.cos(sr)*R);
  g.addColorStop(0,'rgba(61,220,101,0)');g.addColorStop(1,'rgba(61,220,101,0.35)');
  ctx.strokeStyle=g;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.sin(sr)*R,cy-Math.cos(sr)*R);ctx.stroke();
  // frente
  ctx.fillStyle='#3ddc65';ctx.beginPath();ctx.moveTo(cx,cy-R-10);ctx.lineTo(cx-7,cy-R+2);ctx.lineTo(cx+7,cy-R+2);ctx.fill();
  // tu
  ctx.fillStyle='#d6f5d6';ctx.beginPath();ctx.arc(cx,cy,5,0,Math.PI*2);ctx.fill();
  // alvos
  const h=(opt.comp&&data)?data.h:0;const fadeMs=Math.max(opt.fade,0.3)*1000;
  for(const p of pts){
    const age=now-p.t;const al=Math.max(0,1-age/fadeMs);if(al<=0)continue;
    const b=(p.wb-h)*Math.PI/180;const dd=Math.min(p.d,opt.range);
    const x=cx+Math.sin(b)*dd*sc,y=cy-Math.cos(b)*dd*sc;const fresh=age<250;
    const col=RCOL[p.r]||'#ff3b3b';
    ctx.globalAlpha=fresh?1:al*0.6;ctx.fillStyle=col;
    ctx.beginPath();ctx.arc(x,y,fresh?9:5,0,Math.PI*2);ctx.fill();
    if(fresh){ctx.globalAlpha=1;ctx.strokeStyle=col;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#fff';ctx.font='bold 13px system-ui';ctx.fillText(p.d.toFixed(1)+'m',x+17,y+4)}
  }
  ctx.globalAlpha=1;
  requestAnimationFrame(draw);
}

async function loadCfg(){
  try{cfg=await (await fetch('/cfg',{cache:'no-store'})).json()}catch(e){setTimeout(loadCfg,2000);return}
  $('dMin').value=cfg.min;$('dInv').checked=!!cfg.inv;
  const names=['Frente','Trás-esquerda','Trás-direita'];let h='';
  for(let i=0;i<cfg.n;i++){h+=`<div class="row"><span>Radar ${i+1} (${names[i]}) direção °</span><input type="number" id="y${i}" value="${cfg.yaw[i]}" step="5"></div>
  <div class="row"><span>Radar ${i+1}: espelhar</span><input type="checkbox" id="f${i}" ${cfg.flip[i]?'checked':''}></div>`}
  $('radCfg').innerHTML=h;
}

function bindOpts(){
  $('oVib').checked=opt.vib;$('oFlash').checked=opt.flash;$('oFade').value=opt.fade;$('oRange').value=opt.range;$('oComp').checked=opt.comp;
  const upd=()=>{opt.vib=$('oVib').checked;opt.flash=$('oFlash').checked;opt.fade=+$('oFade').value;opt.range=+$('oRange').value;opt.comp=$('oComp').checked;
    $('vFade').textContent=opt.fade;$('vRange').textContent=opt.range;for(const k in opt)store.set(k,opt[k])};
  ['oVib','oFlash','oFade','oRange','oComp'].forEach(id=>$(id).addEventListener('input',upd));upd();
}

async function cmd(c){try{await fetch('/cmd?c='+c,{cache:'no-store'})}catch(e){}}
$('bCfg').onclick=()=>{$('panel').classList.add('open');loadCfg()};
$('bClose').onclick=()=>$('panel').classList.remove('open');
$('bZero').onclick=()=>{cmd('zero');pts=[]};
$('bCal').onclick=()=>cmd('cal');
$('bSide').onclick=()=>{if(confirm('Configurar todos os radares para montagem lateral?'))cmd('side')};
$('bSave').onclick=async()=>{
  if(!cfg)return;const q=new URLSearchParams();q.set('min',$('dMin').value);q.set('inv',$('dInv').checked?1:0);
  for(let i=0;i<cfg.n;i++){q.set('y'+i,$('y'+i).value);q.set('f'+i,$('f'+i).checked?1:0)}
  try{await fetch('/set?'+q.toString(),{cache:'no-store'});await loadCfg();$('bSave').textContent='Guardado ✓';setTimeout(()=>$('bSave').textContent='Guardar',1500)}catch(e){}
};
bindOpts();loadCfg();poll();requestAnimationFrame(draw);
</script>
</body>
</html>)HTML";
