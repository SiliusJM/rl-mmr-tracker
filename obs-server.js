'use strict';

/**
 * obs-server.js — Local HTTP server for OBS browser source overlays
 *
 * Routes:
 *   GET /                        → index page listing all available overlay URLs
 *   GET /api/data                → JSON data (current state)
 *   GET /obs/card?mode={id}&season={current|prev1|prev2}  → single mode card
 *   GET /obs/session             → wins / losses card
 *   GET /obs/all?season={...}&modes={id,id,...}           → all selected modes
 */

const http = require('node:http');

let server     = null;
let activePort = null;

let latestData = {
  modes:           [],
  prevSeason1:     null,
  prevSeason2:     null,
  session:         { wins: 0, losses: 0 },
  selectedModeIds: [],
};

function setData(data) {
  if (data) latestData = { ...latestData, ...data };
}

// ── Shared CSS injected into every overlay page ───────────────────────────────

const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;-webkit-app-region:no-drag;
  font-family:'Segoe UI',Arial,sans-serif;overflow:hidden}
`.trim();

// ── /obs/card ─────────────────────────────────────────────────────────────────

function cardPageHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
${BASE_CSS}
.card{display:inline-flex;flex-direction:column;align-items:center;
  background:rgba(13,13,26,.88);border:1.5px solid rgba(108,99,255,.65);
  border-radius:14px;padding:22px 28px;min-width:270px;max-width:330px;
  text-align:center;gap:8px;backdrop-filter:blur(4px)}
.mode{font-size:14px;color:#8888aa;text-transform:uppercase;
  letter-spacing:1.5px;font-weight:700}
.badge{font-size:12px;color:#fbbf24;background:rgba(251,191,36,.18);
  border-radius:4px;padding:3px 10px;font-weight:700;letter-spacing:.5px}
.rimg{width:122px;height:122px;object-fit:contain;margin:4px 0}
.rank{font-size:18px;font-weight:700;color:#e2e2f0;line-height:1.25;max-width:280px}
.mmr{font-size:54px;font-weight:800;color:#a78bfa;line-height:1;margin-top:2px}
.mmrlbl{font-size:14px;color:#666688;font-weight:600;letter-spacing:.5px;margin-top:-2px}
.nodata{font-size:16px;color:#666688;padding:28px 20px;font-style:italic}
</style></head><body>
<div id="c"><div class="nodata">Esperando datos...</div></div>
<script>
const P=new URLSearchParams(location.search);
const mid=parseInt(P.get('mode')||'0',10);
const seas=P.get('season')||'current';
const B={prev1:'\u25C4 TEMP. ANTERIOR',prev2:'\u25C4\u25C4 HACE 2 TEMP.'};
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
async function upd(){
  try{
    const r=await fetch('/api/data', { cache: 'no-store' });
    if(!r.ok)return;
    const d=await r.json();
    const arr=(seas==='prev1')?d.prevSeason1:(seas==='prev2')?d.prevSeason2:d.modes;
    const el=document.getElementById('c');
    
    // Flexible ID comparison (handle string vs number)
    let m = null;
    if (Array.isArray(arr)) {
      m = arr.find(x => String(x.id) === String(mid));
    }

    if(!m){
      const msg = !Array.isArray(arr) ? ('Sin datos de temporada ('+seas+')') : ('Modo '+mid+' no encontrado');
      el.innerHTML='<div class="nodata">'+msg+'</div>';
      return;
    }
    const bg=B[seas]?'<div class="badge">'+B[seas]+'</div>':'';
    const im=m.iconUrl?'<img class="rimg" src="'+esc(m.iconUrl)+'" alt="">':'';
    el.innerHTML='<div class="card">'+
      '<div class="mode">'+esc(m.name)+'</div>'+bg+im+
      '<div class="rank">'+esc(m.rank)+'</div>'+
      '<div class="mmr">'+m.mmr+'</div>'+
      '<div class="mmrlbl">MMR</div></div>';
  }catch(e){ console.error(e); }
}
upd();setInterval(upd,5000);
</script></body></html>`;
}

// ── /obs/session ──────────────────────────────────────────────────────────────

function sessionPageHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
${BASE_CSS}
.card{display:inline-flex;flex-direction:column;align-items:center;
  background:rgba(13,13,26,.88);border:1.5px solid rgba(108,99,255,.65);
  border-radius:14px;padding:22px 42px;text-align:center;gap:10px;backdrop-filter:blur(4px)}
.title{font-size:14px;color:#8888aa;text-transform:uppercase;letter-spacing:1px;font-weight:700}
.row{display:flex;align-items:center;gap:36px;margin-top:6px}
.stat{display:flex;flex-direction:column;align-items:center;gap:4px}
.nw{font-size:58px;font-weight:800;color:#34d399;line-height:1}
.nl{font-size:58px;font-weight:800;color:#f87171;line-height:1}
.lbl{font-size:14px;color:#666688;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.sep{font-size:42px;color:#2c2c52;align-self:center;margin-top:-6px}
.nodata{padding:28px;color:#666688;font-size:16px;font-style:italic}
</style></head><body>
<div id="c"><div class="nodata">Esperando datos...</div></div>
<script>
async function upd(){
  try{
    const r=await fetch('/api/data');if(!r.ok)return;
    const d=await r.json();const s=d.session||{wins:0,losses:0};
    document.getElementById('c').innerHTML=
      '<div class="card">'+
      '<div class="title">\uD83D\uDCCA Partidos de hoy</div>'+
      '<div class="row">'+
        '<div class="stat"><div class="nw">'+s.wins+'</div><div class="lbl">Ganados</div></div>'+
        '<div class="sep">&mdash;</div>'+
        '<div class="stat"><div class="nl">'+s.losses+'</div><div class="lbl">Perdidos</div></div>'+
      '</div></div>';
  }catch(e){}
}
upd();setInterval(upd,5000);
</script></body></html>`;
}

// ── /obs/all ──────────────────────────────────────────────────────────────────

function allPageHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
${BASE_CSS}
body{display:inline-flex;align-items:flex-start;gap:16px}
.card{display:inline-flex;flex-direction:column;align-items:center;
  background:rgba(13,13,26,.88);border:1.5px solid rgba(108,99,255,.65);
  border-radius:14px;padding:20px 24px;min-width:260px;max-width:320px;
  text-align:center;gap:7px;backdrop-filter:blur(4px)}
.mode{font-size:13px;color:#8888aa;text-transform:uppercase;letter-spacing:1.5px;font-weight:700}
.badge{font-size:11px;color:#fbbf24;background:rgba(251,191,36,.18);
  border-radius:4px;padding:3px 9px;font-weight:700}
.rimg{width:112px;height:112px;object-fit:contain;margin:3px 0}
.rank{font-size:17px;font-weight:700;color:#e2e2f0;line-height:1.25;max-width:270px}
.mmr{font-size:48px;font-weight:800;color:#a78bfa;line-height:1;margin-top:1px}
.mmrlbl{font-size:13px;color:#666688;font-weight:600;letter-spacing:.5px;margin-top:-2px}
.nodata{padding:28px;color:#666688;font-size:16px;font-style:italic}
</style></head><body id="c"><div class="nodata">Esperando datos...</div></body>
<script>
const P=new URLSearchParams(location.search);
const seas=P.get('season')||'current';
const fids=P.get('modes')?P.get('modes').split(',').map(Number):null;
const B={prev1:'\u25C4 TEMP. ANTERIOR',prev2:'\u25C4\u25C4 HACE 2 TEMP.'};
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
async function upd(){
  try{
    const r=await fetch('/api/data', { cache: 'no-store' });
    if(!r.ok)return;
    const d=await r.json();
    const arr=seas==='prev1'?d.prevSeason1:seas==='prev2'?d.prevSeason2:d.modes;
    const el=document.getElementById('c');
    if(!Array.isArray(arr) || arr.length === 0){
      el.innerHTML='<div class="nodata">Sin datos de esta temporada ('+seas+')</div>';
      return;
    }
    const sel=fids || d.selectedModeIds || [];
    const modes=arr.filter(m => sel.some(sid => String(sid) === String(m.id)));
    if(!modes.length){
      el.innerHTML='<div class="nodata">Sin modos para mostrar</div>';
      return;
    }
    const bg=B[seas]?'<div class="badge">'+B[seas]+'</div>':'';
    el.innerHTML=modes.map(m=>{
      const im=m.iconUrl?'<img class="rimg" src="'+esc(m.iconUrl)+'" alt="">':'';
      return '<div class="card">'+
        '<div class="mode">'+esc(m.name)+'</div>'+bg+im+
        '<div class="rank">'+esc(m.rank)+'</div>'+
        '<div class="mmr">'+m.mmr+'</div>'+
        '<div class="mmrlbl">MMR</div></div>';
    }).join('');
  }catch(e){ console.error(e); }
}
upd();setInterval(upd,5000);
</script></html>`;
}

// ── / index page ──────────────────────────────────────────────────────────────

function indexPageHtml(port) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>RL MMR Tracker \u2014 OBS</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d0d1a;color:#e2e2f0;font-family:'Segoe UI',Arial,sans-serif;
  font-size:14px;padding:30px 36px;max-width:860px}
h1{font-size:22px;font-weight:800;color:#a78bfa;margin-bottom:4px}
.sub{color:#8888aa;font-size:13px;margin-bottom:30px}
h2{font-size:12px;font-weight:700;color:#6c63ff;margin:22px 0 8px;
  border-bottom:1px solid #2c2c52;padding-bottom:5px;
  text-transform:uppercase;letter-spacing:.6px}
.grid{display:flex;flex-direction:column;gap:5px}
.row{display:flex;align-items:center;gap:12px;
  background:#15152b;border:1px solid #2c2c52;border-radius:8px;
  padding:9px 14px;transition:border-color .15s}
.row:hover{border-color:#6c63ff}
.lbl{font-size:11px;color:#8888aa;min-width:210px;font-weight:600;flex-shrink:0}
a.link{font-family:monospace;font-size:12px;color:#34d399;text-decoration:none;
  word-break:break-all;flex:1}
a.link:hover{color:#a78bfa;text-decoration:underline}
.hint{font-size:11px;color:#555577;padding:4px 0 0 14px}
.tag{display:inline-block;font-size:9px;padding:2px 6px;border-radius:4px;
  font-weight:700;margin-left:5px;vertical-align:middle}
.tc{background:rgba(108,99,255,.2);color:#a78bfa}
.tp1{background:rgba(251,191,36,.15);color:#fbbf24}
.tp2{background:rgba(248,113,113,.15);color:#f87171}
.nodata{font-size:12px;color:#555577;padding:4px 14px;font-style:italic}
.section{margin-top:4px}
</style></head>
<body>
<h1>\uD83D\uDE80 RL MMR Tracker \u2014 OBS Overlays</h1>
<p class="sub">Agrega estas URLs como <strong>Fuente de navegador</strong> en OBS Studio
  &nbsp;&mdash;&nbsp; activa <em>Fondo transparente (sin color de pantalla)</em> en la fuente.</p>

<h2>\uD83D\uDCCA Sesi\u00F3n &mdash; Ganados / Perdidos</h2>
<div class="grid">
  <div class="row">
    <span class="lbl">Ganados / Perdidos</span>
    <a class="link" href="/obs/session" target="_blank">http://localhost:${port}/obs/session</a>
  </div>
  <p class="hint">Tama\u00F1o recomendado: <strong>420 \u00D7 180</strong>&nbsp;px</p>
</div>

<h2>\uD83C\uDFAE Modos individuales</h2>
<div class="grid" id="ind-grid"><p class="nodata">Inicia el tracker para ver los modos disponibles\u2026</p></div>

<h2>\uD83D\uDCE6 Todos los modos seleccionados (horizontal)</h2>
<div class="grid">
  <div class="row">
    <span class="lbl">Temp. actual <span class="tag tc">ACTUAL</span></span>
    <a class="link" href="/obs/all?season=current" target="_blank">http://localhost:${port}/obs/all?season=current</a>
  </div>
  <div class="row">
    <span class="lbl">Temp. anterior <span class="tag tp1">PREV 1</span></span>
    <a class="link" href="/obs/all?season=prev1" target="_blank">http://localhost:${port}/obs/all?season=prev1</a>
  </div>
  <div class="row">
    <span class="lbl">Hace 2 temp. <span class="tag tp2">PREV 2</span></span>
    <a class="link" href="/obs/all?season=prev2" target="_blank">http://localhost:${port}/obs/all?season=prev2</a>
  </div>
  <p class="hint">Tama\u00F1o: <strong>340 px &times; n\u00FAmero de modos</strong> de ancho &times; <strong>360</strong>&nbsp;px de alto</p>
</div>

<script>
const port=${port};
const seasons=[
  {k:'current',lbl:'Temp. actual',tc:'tc',tag:'ACTUAL'},
  {k:'prev1',  lbl:'Temp. anterior',tc:'tp1',tag:'PREV 1'},
  {k:'prev2',  lbl:'Hace 2 temp.',  tc:'tp2',tag:'PREV 2'},
];
async function load(){
  try{
    const r=await fetch('/api/data');if(!r.ok)return;
    const d=await r.json();
    const allModes=d.modes||[];
    const sel=d.selectedModeIds||allModes.map(m=>m.id);
    const visible=allModes.filter(m=>sel.includes(m.id));
    if(!visible.length)return;
    const rows=[];
    seasons.forEach(s=>{
      const src=s.k==='current'?d.modes:s.k==='prev1'?d.prevSeason1:d.prevSeason2;
      const avail=src&&src.length>0;
      visible.forEach(m=>{
        const url='http://localhost:'+port+'/obs/card?mode='+m.id+'&season='+s.k;
        const na=avail?'':'<span style="font-size:10px;color:#555577"> (sin datos)</span>';
        rows.push(
          '<div class="row">'+
          '<span class="lbl">'+m.name+' <span class="tag '+s.tc+'">'+s.tag+'</span></span>'+
          '<a class="link" href="'+url+'" target="_blank">'+url+'</a>'+na+
          '</div>'
        );
      });
    });
    rows.push('<p class="hint">Tama\u00F1o recomendado: <strong>340 \u00D7 360</strong>&nbsp;px por tarjeta</p>');
    document.getElementById('ind-grid').innerHTML=rows.join('');
  }catch(e){}
}
load();setInterval(load,10000);
</script></body></html>`;
}

// ── HTTP request handler ──────────────────────────────────────────────────────

function handleRequest(req, res) {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://localhost:${activePort}`);
  } catch {
    res.writeHead(400); res.end('Bad Request'); return;
  }

  const path = parsedUrl.pathname;

  // /api/data — JSON data endpoint (CORS for null origin = local files)
  if (path === '/api/data') {
    res.writeHead(200, {
      'Content-Type':                'application/json',
      'Cache-Control':               'no-store',
      // CORS: safe — server only binds to 127.0.0.1 (localhost)
      'Access-Control-Allow-Origin': '*', // needed for OBS browser source (null origin)
    });
    res.end(JSON.stringify(latestData));
    return;
  }

  // /obs/* — Overlay HTML pages
  const htmlRoutes = {
    '/obs/card':    cardPageHtml,
    '/obs/session': sessionPageHtml,
    '/obs/all':     allPageHtml,
  };
  if (htmlRoutes[path]) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(htmlRoutes[path]());
    return;
  }

  // / or /obs — index page
  if (path === '/' || path === '/obs' || path === '/obs/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(indexPageHtml(activePort));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function start(port) {
  return new Promise((resolve, reject) => {
    if (server) { resolve(activePort); return; }
    activePort = port || 3030;
    server     = http.createServer(handleRequest);
    server.on('error', (err) => {
      server = null; activePort = null;
      reject(err);
    });
    server.listen(activePort, '127.0.0.1', () => {
      console.log(`[OBS] Servidor corriendo en http://localhost:${activePort}`);
      resolve(activePort);
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!server) { resolve(); return; }
    server.close(() => { server = null; activePort = null; resolve(); });
  });
}

function isRunning() { return !!server; }
function getPort()   { return activePort; }

module.exports = { start, stop, setData, isRunning, getPort };
