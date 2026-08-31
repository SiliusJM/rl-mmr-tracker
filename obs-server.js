'use strict';

const http = require('node:http');

let server = null;
let activePort = null;
let revision = 0;
const eventClients = new Set();

let latestData = {
  modes: [],
  careerStats: null,
  prevSeason1: null,
  prevSeason2: null,
  session: { wins: 0, losses: 0 },
  selectedModeIds: [],
  showRecord: true,
  showPrevSeason1: true,
  showPrevSeason2: false,
};

function apiPayload() {
  return JSON.stringify({ ...latestData, _revision: revision, data: latestData });
}

function eventPayload() {
  return JSON.stringify({ revision, data: latestData });
}

function broadcast() {
  const payload = `event: data\ndata: ${eventPayload()}\n\n`;
  for (const client of eventClients) {
    try {
      client.write(payload);
    } catch {
      eventClients.delete(client);
    }
  }
}

function setData(data) {
  if (!data) return;
  const next = { ...latestData, ...data };
  if (JSON.stringify(next) === JSON.stringify(latestData)) return;
  latestData = next;
  revision += 1;
  broadcast();
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(body, css, script) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box}
    :root{--bg:#0b0d19;--panel:#151a30;--line:#4c3f96;--purple:#a78bfa;--green:#34d399;--red:#fb7185;--muted:#7f88aa}
    html,body{margin:0;padding:0;background:transparent;color:#e7e9f6;font-family:Inter,"Segoe UI",Arial,sans-serif;overflow:hidden}
    .empty{padding:18px;color:var(--muted);font-size:13px;font-weight:700}
    ${css}
  </style>
</head>
<body>${body}<script>${script}
// Shared overlay bootstrap: render immediately, then refresh only on tracker changes.
(function(){
  window.esc = window.esc || function(value){return String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
  async function load(){
    const controller = new AbortController();
    const timer = setTimeout(function(){ controller.abort(); }, 2500);
    try {
      const response = await fetch('/api/data', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      if (typeof render === 'function') render(payload.data || payload);
    } catch (_) {
      const root = document.getElementById('overlay');
      if (root && root.querySelector('.empty')) root.querySelector('.empty').textContent = 'Waiting for tracker data...';
    } finally { clearTimeout(timer); }
  }
  load();
  if (window.EventSource) {
    const events = new EventSource('/api/events');
    events.addEventListener('data', function(event){
      try { const payload = JSON.parse(event.data); if (typeof render === 'function') render(payload.data || {}); } catch (_) {}
    });
  }
})();
</script></body>
</html>`;
}

const SESSION_VARIANTS = [
  ['classic', 'Classic', 200, 142],
  ['scoreboard', 'Scoreboard', 275, 129],
  ['compact', 'Compact', 293, 125],
  ['pills', 'Pills', 300, 145],
  ['stacked', 'Stacked', 250, 115],
  ['neon', 'Neon', 375, 125],
  ['minimal', 'Minimal', 325, 150],
  ['wide', 'Wide', 415, 140],
];

const CARD_VARIANTS = [
  ['classic', 'Classic', 475, 420],
  ['broadcast', 'Broadcast', 730, 156],
  ['compact', 'Compact', 650, 110],
  ['rankline', 'Rank line', 835, 172],
  ['neon', 'Neon', 420, 330],
  ['minimal', 'Minimal', 662, 130],
  ['split', 'Split', 795, 180],
  ['tall', 'Tall', 355, 305],
];

const ALL_VARIANTS = [
  ['cards', 'Cards', 375, 375],
  ['compact', 'Compact row', 675, 395],
];

const SEASONS = [
  ['current', 'Current season', 'CURRENT'],
  ['prev1', 'Previous season', 'PREV 1'],
  ['prev2', '2 seasons ago', 'PREV 2'],
];

function previewMarkup(kind, title, subtitle, width, height) {
  if (kind.startsWith('session-')) {
    const label = kind === 'session-compact' || kind === 'session-minimal' ? ['WIN', 'LOSS'] : ['WINS', 'LOSSES'];
    return `<div class="preview preview-session preview-session-${esc(kind)}">
      <div class="preview-chip">Preview</div>
      <div class="preview-title">${esc(title)}</div>
      <div class="preview-session-row">
        <div class="pv-stat win"><b>4</b><span>${label[0]}</span></div>
        <div class="pv-divider"></div>
        <div class="pv-stat loss"><b>2</b><span>${label[1]}</span></div>
      </div>
      <div class="preview-foot">${width} x ${height}</div>
    </div>`;
  }

  if (kind.startsWith('card-')) {
    const large = kind === 'card-broadcast' || kind === 'card-split';
    const mmr = kind === 'card-minimal' ? 'MMR' : '1056';
    const icon = latestData.modes.find(m => m && m.iconUrl) || null;
    const iconMarkup = icon ? `<img class="${large ? 'pv-icon large' : 'pv-icon'}" src="${esc(icon.iconUrl)}" alt="">` : `<div class="${large ? 'pv-icon large' : 'pv-icon'}"></div>`;
    return `<div class="preview preview-card preview-card-${esc(kind)}">
      ${iconMarkup}
      <div class="preview-chip">Preview</div>
      <div class="preview-title">${esc(title)}</div>
      ${subtitle ? `<div class="preview-subtitle">${esc(subtitle)}</div>` : ''}
      <div class="preview-mmr">${mmr}</div>
    </div>`;
  }

  if (kind === 'profile') {
    return `<div class="preview preview-profile">
      <div class="preview-chip">Preview</div>
      <div class="preview-title">${esc(title)}</div>
      <div class="preview-profile-grid">
        <span>GOLES</span><span>DISPAROS</span><span>VICTORIAS</span><span>ASISTENCIAS</span>
      </div>
      <div class="preview-foot">${width} x ${height}</div>
    </div>`;
  }

  return `<div class="preview">
    <div class="preview-chip">Preview</div>
    <div class="preview-title">${esc(title)}</div>
    <div class="preview-bars"><span></span><span></span><span></span></div>
    <div class="preview-foot">${width} x ${height}</div>
  </div>`;
}

function overlayCard(port, path, name, width, height, extraClass = '', previewKind = 'default', subtitle = '') {
  const url = `http://localhost:${port}${path}`;
  return `<article class="linkcard ${extraClass}">
    ${previewMarkup(previewKind, name, subtitle, width, height)}
    <div class="name">${esc(name)}</div>
    <div class="size">Recommended: ${width} x ${height} px</div>
    <a class="url" href="${esc(path)}" target="_blank">${esc(url)}</a>
    <button class="copy" data-url="${esc(url)}" onclick="copy(this.dataset.url,this)">Copy URL</button>
  </article>`;
}

function sessionPageHtml() {
  const css = `
.session{position:relative;display:flex;overflow:hidden;align-items:center;background:linear-gradient(135deg,rgba(20,23,46,.97),var(--bg));border:1px solid var(--line);box-shadow:0 10px 28px rgba(0,0,0,.28)}
/* Compact dimensions keep browser sources practical in OBS. */
.classic{width:585px;height:242px;gap:14px;padding:20px 28px}.classic .row{gap:46px}.classic .number{font-size:57px}.classic .divider{height:44px}.classic .label{font-size:11px}
.scoreboard{width:702px;height:179px;gap:20px;padding:16px 24px}.scoreboard .heading{width:106px}.scoreboard .number{font-size:52px}.scoreboard .divider{height:62px}.scoreboard .label{font-size:11px}
.compact{width:693px;height:239px;padding:18px 24px}.compact .number{font-size:44px}.compact .divider{height:45px}.compact .label{font-size:11px}
.pills{width:693px;height:164px;gap:14px;padding:14px 20px}.pills .stat{height:112px}.pills .number{font-size:42px}.pills .label{font-size:11px}
.stacked{width:621px;height:469px;gap:13px;padding:22px 24px}.stacked .number{font-size:48px}.stacked .divider{height:54px}.stacked .label{font-size:11px}
.neon{width:624px;height:199px;gap:22px;padding:16px 24px}.neon .heading{width:114px}.neon .number{font-size:53px}.neon .divider{height:63px}.neon .label{font-size:11px}
.minimal{width:621px;height:200px;padding:14px 20px}.minimal .number{font-size:37px}.minimal .divider{height:37px}.minimal .label{font-size:10px}
.wide{width:675px;height:140px;gap:10px;padding:8px 14px}.wide .heading{width:140px}.wide .number{font-size:47px}.wide .divider{height:55px}.wide .label{font-size:11px}
/* Keep the enlarged canvas dense: only the space needed by its content. */
.classic{gap:6px;padding:10px 16px}.classic .row{gap:18px}.scoreboard{gap:10px;padding:8px 14px}.scoreboard .heading{width:90px}.compact{padding:8px 12px}.pills{gap:7px;padding:8px 12px}.stacked{gap:7px;padding:10px 12px}.neon{gap:10px;padding:9px 14px}.minimal{padding:8px 12px}.wide{gap:10px;padding:8px 14px}
.heading{color:#c7d2fe;font-size:10px;font-weight:900;letter-spacing:1.1px;text-transform:uppercase;line-height:1.1}
.row{display:flex;align-items:center}
.stat{display:flex;align-items:center;justify-content:center;flex-direction:column}
.number{font-weight:900;line-height:.86;font-variant-numeric:tabular-nums}
.win .number{color:var(--green)}
.loss .number{color:var(--red)}
.label{font-size:9px;color:#cbd5e1;font-weight:900;letter-spacing:.9px;text-transform:uppercase}
.divider{background:rgba(167,139,250,.36);flex:none}
.classic{width:360px;height:124px;flex-direction:column;gap:10px;padding:15px 18px;border-radius:14px}.classic .row{gap:31px}.classic .number{font-size:44px}.classic .divider{height:34px;width:1px}.classic .stat{gap:5px}
.scoreboard{width:450px;height:92px;gap:16px;padding:12px 18px;border-radius:12px}.scoreboard .heading{width:82px}.scoreboard .row{flex:1;justify-content:space-around}.scoreboard .number{font-size:40px}.scoreboard .divider{width:1px;height:48px}.scoreboard .stat{gap:4px}
.compact{width:255px;height:76px;padding:8px 13px;border-radius:10px}.compact .heading{display:none}.compact .row{width:100%;justify-content:space-around}.compact .number{font-size:31px}.compact .divider{height:31px;width:1px}.compact .stat{gap:3px}.compact .label{font-size:8px}
.pills{width:330px;height:78px;gap:10px;padding:9px 13px;border-radius:39px}.pills .heading{display:none}.pills .row{gap:10px;width:100%}.pills .stat{height:56px;flex:1;border-radius:28px;background:rgba(255,255,255,.055)}.pills .number{font-size:30px}.pills .divider{display:none}
.stacked{width:180px;height:136px;flex-direction:column;gap:7px;padding:12px 13px;border-radius:13px}.stacked .row{width:100%;justify-content:space-around}.stacked .number{font-size:33px}.stacked .divider{height:38px;width:1px}.stacked .stat{gap:4px}.stacked .label{font-size:8px}
.neon{width:390px;height:102px;gap:17px;padding:12px 18px;border-radius:13px;border-color:#c4b5fd;box-shadow:0 0 24px rgba(139,92,246,.4),inset 0 0 22px rgba(139,92,246,.08)}.neon .heading{width:88px}.neon .row{justify-content:space-around;flex:1}.neon .number{font-size:41px}.neon .divider{height:48px;width:1px}.neon .stat{gap:4px}
.minimal{width:210px;height:58px;padding:6px 10px;border-radius:9px}.minimal .heading{display:none}.minimal .row{width:100%;justify-content:space-around}.minimal .number{font-size:25px}.minimal .label{font-size:7px}.minimal .divider{height:24px;width:1px}
.wide{width:540px;height:78px;gap:24px;padding:9px 22px;border-radius:10px}.wide .heading{width:132px}.wide .row{justify-content:space-around;flex:1}.wide .number{font-size:36px}.wide .divider{height:42px;width:1px}.wide .stat{gap:3px}
/* Final enlarged, dense sizing (declared after the base variant rules). */
.session.classic{width:200px;height:142px;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:10px 16px}.session.classic .row{gap:12px}.session.classic .number{font-size:54px}.session.classic .label{font-size:11px}.session.classic .heading{font-size:12px}
.classic{width:585px;height:242px;gap:6px;padding:10px 16px}.classic .row{gap:18px}.classic .number{font-size:57px}.classic .divider{height:44px}.classic .label{font-size:11px}
.scoreboard{width:675px;height:179px;gap:10px;padding:8px 14px}.scoreboard .heading{width:90px}.scoreboard .number{font-size:52px}.scoreboard .divider{height:62px}.scoreboard .label{font-size:11px}
.compact{width:693px;height:239px;gap:6px;padding:8px 12px}.compact .number{font-size:44px}.compact .divider{height:45px}.compact .label{font-size:11px}
.pills{width:693px;height:164px;gap:7px;padding:8px 12px}.pills .stat{height:112px}.pills .number{font-size:42px}.pills .label{font-size:11px}
.stacked{width:621px;height:469px;gap:7px;padding:10px 12px}.stacked .number{font-size:48px}.stacked .divider{height:54px}.stacked .label{font-size:11px}
.neon{width:624px;height:199px;gap:10px;padding:9px 14px}.neon .heading{width:114px}.neon .number{font-size:53px}.neon .divider{height:63px}.neon .label{font-size:11px}
.minimal{width:621px;height:200px;gap:5px;padding:8px 12px}.minimal .number{font-size:37px}.minimal .divider{height:37px}.minimal .label{font-size:10px}
.wide{width:675px;height:140px;gap:10px;padding:8px 14px}.wide .heading{width:140px}.wide .number{font-size:47px}.wide .divider{height:55px}.wide .label{font-size:11px}
/* Larger session typography while preserving the requested canvas widths. */
.classic .heading{font-size:14px}.classic .number{font-size:70px}.classic .label{font-size:14px}
.scoreboard .heading{font-size:14px}.scoreboard .number{font-size:64px}.scoreboard .label{font-size:14px}
.compact .number{font-size:56px}.compact .label{font-size:13px}
.pills .number{font-size:55px}.pills .label{font-size:13px}
.neon .heading{font-size:14px}.neon .number{font-size:65px}.neon .label{font-size:13px}
.minimal .number{font-size:52px}.minimal .label{font-size:13px}
.wide .heading{font-size:14px}.wide .number{font-size:58px}.wide .label{font-size:13px}
.stacked{height:300px}.stacked .number{font-size:55px}.stacked .label{font-size:13px}
.session.classic .number{font-size:72px}.session.classic .label{font-size:18px}.session.scoreboard{width:275px;height:129px;gap:10px;padding:8px 14px}.session.compact{width:293px;height:125px;gap:6px;padding:8px 12px}.session.compact .label{font-size:40px}.session.pills{width:300px;height:145px;gap:7px;padding:8px 12px}.session.pills .number{font-size:55px}.session.pills .label{font-size:22px}.session.stacked{width:250px;height:115px;gap:7px;padding:10px 12px}.session.stacked .number{font-size:55px}.session.stacked .heading{font-size:15px}.session.neon{width:375px;height:125px;gap:10px;padding:9px 14px}.session.neon .heading{font-size:20px}.session.neon .label{font-size:19px}.session.minimal{width:325px;height:150px;gap:5px;padding:8px 12px}.session.minimal .number{font-size:72px}.session.minimal .label{font-size:43px}.session.wide{width:415px;height:140px;gap:10px;padding:8px 14px}
`.trim();

  const script = `
const q = new URLSearchParams(location.search);
const variant = ${JSON.stringify(SESSION_VARIANTS.map(v => v[0]))}.includes(q.get('variant')) ? q.get('variant') : 'classic';
function labels(){ return ['compact','pills','minimal'].includes(variant) ? ['WIN','LOSS'] : ['WINS','LOSSES']; }
function render(d){
  const s = d.session || { wins: 0, losses: 0 };
  const l = labels();
  document.getElementById('overlay').innerHTML =
    '<article class="session ' + variant + '">' +
    '<div class="heading">Match record</div>' +
    '<div class="row">' +
      '<div class="stat win"><div class="number">' + esc(s.wins) + '</div><div class="label">' + l[0] + '</div></div>' +
      '<div class="divider"></div>' +
      '<div class="stat loss"><div class="number">' + esc(s.losses) + '</div><div class="label">' + l[1] + '</div></div>' +
    '</div>' +
    '</article>';
}`;
  return page('<div id="overlay"><div class="empty">Loading overlay...</div></div>', css, script);
}

function cardPageHtml() {
  const css = `
.card{display:flex;position:relative;overflow:hidden;background:linear-gradient(135deg,rgba(20,23,46,.97),var(--bg));border:1px solid var(--line);box-shadow:0 10px 28px rgba(0,0,0,.28)}
.mode{color:var(--muted);font-weight:900;font-size:10px;letter-spacing:1.1px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rank{font-weight:850;line-height:1.12;text-wrap:balance}
.mmr{color:var(--purple);font-weight:950;line-height:.9;font-variant-numeric:tabular-nums}
.label{font-size:9px;color:var(--muted);font-weight:900;letter-spacing:.8px;text-transform:uppercase}
.delta{font-size:11px;font-weight:900;letter-spacing:.4px;white-space:nowrap}
.delta.up{color:var(--green)}.delta.down{color:var(--red)}.delta.flat{color:#cbd5e1}
.icon{object-fit:contain;flex:none;filter:drop-shadow(0 0 10px rgba(167,139,250,.45))}
.season{display:inline-flex;align-self:center;color:#fcd34d;font-size:9px;font-weight:900;letter-spacing:.7px;text-transform:uppercase}
.bar{position:absolute;inset:0 auto 0 0;width:5px;background:linear-gradient(#f0abfc,#7c3aed)}
.classic{width:340px;height:330px;align-items:center;flex-direction:column;gap:8px;padding:20px 22px;text-align:center;border-radius:16px}.classic .icon{width:110px;height:110px;margin:2px 0}.classic .rank{font-size:17px}.classic .mmr{font-size:51px}.classic .delta{margin-top:-2px}
.broadcast{width:540px;height:130px;align-items:center;gap:0;padding:0 18px 0 0;border-radius:12px;background:linear-gradient(90deg,rgba(167,36,148,.86) 0,rgba(167,36,148,.86) 126px,rgba(9,12,20,.92) 126px,rgba(9,12,20,.88) 100%)}.broadcast .iconwrap{align-self:stretch;display:flex;align-items:center;justify-content:center;width:126px;flex:none;padding:8px}.broadcast .icon{width:82px;height:82px;max-width:100%;max-height:100%}.broadcast .info{display:flex;min-width:0;flex:1;flex-direction:column;gap:5px;padding:0 0 0 16px}.broadcast .rank{font-size:18px}.broadcast .mmrbox{margin-left:auto;text-align:right;padding-left:12px}.broadcast .mmr{font-size:47px}
.compact{width:285px;height:108px;align-items:center;gap:10px;padding:10px 14px;border-radius:12px}.compact .icon{width:69px;height:69px}.compact .info{display:flex;min-width:0;flex:1;flex-direction:column;gap:3px}.compact .rank{font-size:13px}.compact .mmr{font-size:31px}.compact .label{display:none}
.rankline{width:455px;height:112px;align-items:center;gap:13px;padding:11px 18px;border-radius:12px}.rankline .icon{width:78px;height:78px}.rankline .info{display:flex;min-width:0;flex:1;flex-direction:column;gap:5px}.rankline .rank{font-size:16px}.rankline .mmrbox{display:flex;align-items:baseline;gap:8px}.rankline .mmr{font-size:41px}
.neon{width:355px;height:218px;align-items:center;flex-direction:column;gap:6px;padding:15px 20px;border-radius:14px;border-color:#c4b5fd;box-shadow:0 0 24px rgba(139,92,246,.38),inset 0 0 22px rgba(139,92,246,.08)}.neon .icon{width:100px;height:100px}.neon .rank{font-size:15px}.neon .mmr{color:#e9d5ff;font-size:44px}
.minimal{width:245px;height:84px;align-items:center;gap:8px;padding:8px 11px;border-radius:10px}.minimal .icon{width:57px;height:57px}.minimal .info{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}.minimal .mode{font-size:8px}.minimal .rank{font-size:11px}.minimal .mmrbox{margin-left:auto;text-align:right}.minimal .mmr{font-size:26px}.minimal .label{display:none}.minimal .delta{font-size:9px}
.compact .mode,.minimal .mode,.split .mode{white-space:normal;line-height:1.1;overflow-wrap:anywhere}
.card .mode,.card .rank{white-space:normal;overflow-wrap:anywhere}
.split{width:405px;height:158px;align-items:center;border-radius:14px}.split .iconwrap{align-self:stretch;display:flex;align-items:center;justify-content:center;width:138px;background:linear-gradient(135deg,rgba(124,58,237,.68),rgba(30,41,59,.2));border-right:1px solid var(--line)}.split .icon{width:100px;height:100px}.split .info{display:flex;min-width:0;flex:1;flex-direction:column;gap:6px;padding:17px}.split .rank{font-size:16px}.split .mmr{font-size:45px}
.tall{width:270px;height:285px;align-items:center;flex-direction:column;gap:7px;padding:17px 19px;text-align:center;border-radius:16px}.tall .icon{width:106px;height:106px;margin-top:2px}.tall .rank{font-size:15px}.tall .mmr{font-size:47px}
.classic{width:510px;height:495px;gap:12px;padding:28px 30px}.classic .icon{width:165px;height:165px}.classic .mode{font-size:13px}.classic .rank{font-size:25px}.classic .mmr{font-size:76px}.classic .label{font-size:12px}
.broadcast{width:648px;height:156px}.broadcast .iconwrap{width:151px;padding:10px}.broadcast .icon{width:99px;height:99px}.broadcast .info{padding-left:20px}.broadcast .mode{font-size:12px}.broadcast .rank{font-size:22px}.broadcast .mmr{font-size:56px}
.compact{width:556px;height:211px;padding:14px 20px}.compact .icon{width:90px;height:90px}.compact .rank{font-size:17px}.compact .mmr{font-size:40px}
.rankline{width:675px;height:168px;padding:10px 16px;gap:10px}.rankline .icon{width:117px;height:117px}.rankline .rank{font-size:20px}.rankline .mmr{font-size:53px}
.neon{width:533px;height:327px;gap:9px;padding:22px 28px}.neon .icon{width:130px;height:130px}.neon .rank{font-size:19px}.neon .mmr{font-size:57px}
.minimal{width:662px;height:227px;padding:14px 20px;gap:12px}.minimal .icon{width:103px;height:103px}.minimal .mode{font-size:11px}.minimal .rank{font-size:15px}.minimal .mmr{font-size:34px}
.split{width:608px;height:237px}.split .iconwrap{width:207px}.split .icon{width:150px;height:150px}.split .info{gap:9px;padding:25px}.split .rank{font-size:20px}.split .mmr{font-size:59px}
.tall{width:608px;height:642px;gap:10px;padding:25px 28px}.tall .icon{width:159px;height:159px}.tall .rank{font-size:19px}.tall .mmr{font-size:59px}
/* Per-variant refinements requested for readability and compact proportions. */
.compact .icon{width:110px;height:110px}.compact .mode{font-size:16px}.compact .rank{font-size:24px}.compact .label{font-size:12px}
.rankline .mode{font-size:15px}.rankline .rank{font-size:25px}.rankline .label{font-size:12px}
.minimal .icon{width:132px;height:132px}.minimal .mode{font-size:14px}.minimal .rank{font-size:23px}.minimal .label{font-size:11px}
.split .info{gap:12px}.split .mode{font-size:16px}.split .rank{font-size:27px}.split .label{font-size:12px}
.tall{height:420px;gap:7px;padding:16px 22px}.tall .icon{width:125px;height:125px}.tall .rank{font-size:19px}
.card .label{font-size:20px}.compact .delta{font-size:17px;font-weight:900;letter-spacing:.4px;white-space:nowrap}.rankline .delta,.broadcast .delta{font-size:21px;font-weight:900;letter-spacing:.4px;white-space:nowrap}.classic .delta{font-size:30px;font-weight:900;letter-spacing:.4px;white-space:nowrap}
.card .rank{overflow-wrap:anywhere;white-space:normal}
.card.classic{width:475px;height:420px;gap:12px;padding:28px 30px}.card.classic .mode{font-size:20px}.neon{width:420px;height:330px;gap:9px;padding:22px 28px}.card.rankline{width:835px;height:172px;padding:10px 16px;gap:10px}.rankline .mode{font-size:20px}.compact{width:650px;height:110px;padding:14px 20px}.card.minimal{width:662px;height:130px;padding:14px 20px;gap:12px}.minimal .icon{width:140px;height:140px}.minimal .mode{font-size:20px}.minimal .delta{font-size:15px}.minimal .mmr{font-size:34px}.minimal .rank{font-size:22px}.broadcast{width:730px;height:156px}.broadcast .mode{font-size:22px}.broadcast .rank{font-size:25px}.neon .mode{font-size:20px}.neon .rank{font-size:22px}.card.split{width:795px;height:180px}.neon .delta,.split .delta{font-size:21px;font-weight:900;letter-spacing:.4px;white-space:nowrap}.card.tall{width:355px;height:305px}.card.tall .delta{font-size:22px;font-weight:900;letter-spacing:.4px;white-space:nowrap}.card.tall .mode{font-size:15px}
`.trim();

  const script = `
const q = new URLSearchParams(location.search);
const variant = ${JSON.stringify(CARD_VARIANTS.map(v => v[0]))}.includes(q.get('variant')) ? q.get('variant') : 'classic';
const modeId = q.get('mode');
const season = q.get('season') || 'current';
const seasonName = { prev1: 'PREVIOUS SEASON', prev2: '2 SEASONS AGO' };
function rankHtml(value){ return String(value || 'Unranked').split(/\s+-\s+/).map(esc).join('<br>'); }
function delta(m){
  if (m.mmrDelta == null || !Number.isFinite(Number(m.mmrDelta))) return '<div class="label">MMR</div>';
  const n = Number(m.mmrDelta);
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  const sign = n > 0 ? '+' : '';
  return '<div class="delta ' + cls + '">' + sign + n + ' MMR</div>';
}
function render(d){
  if ((season === 'prev1' && d.showPrevSeason1 === false) || (season === 'prev2' && d.showPrevSeason2 !== true)) {
    document.getElementById('overlay').innerHTML = '<div class="empty">Season disabled in tracker settings.</div>';
    return;
  }
  const list = season === 'prev1' ? d.prevSeason1 : season === 'prev2' ? d.prevSeason2 : d.modes;
  const m = Array.isArray(list) && list.find(x => String(x.id) === String(modeId));
  const root = document.getElementById('overlay');
  if (!m) {
    root.innerHTML = '<div class="empty">Waiting for mode data...</div>';
    return;
  }
  const icon = m.iconUrl ? '<div class="iconwrap"><img class="icon" src="' + esc(m.iconUrl) + '" alt=""></div>' : '';
  const tag = seasonName[season] ? '<div class="season">' + seasonName[season] + '</div>' : '';
  const info = '<div class="info"><div class="mode">' + esc(m.name) + '</div>' + tag + '<div class="rank">' + rankHtml(m.rank) + '</div></div>';
  const mmr = '<div class="mmrbox"><div class="mmr">' + esc(m.mmr) + '</div>' + delta(m) + '</div>';
  if (variant === 'broadcast') {
    root.innerHTML = '<article class="card broadcast"><span class="bar"></span>' + icon + info + mmr + '</article>';
    return;
  }
  if (variant === 'split') {
    root.innerHTML = '<article class="card split"><span class="bar"></span><div class="iconwrap">' + (m.iconUrl ? '<img class="icon" src="' + esc(m.iconUrl) + '" alt="">' : '') + '</div>' + info + mmr + '</article>';
    return;
  }
  if (['classic','neon','tall'].includes(variant)) {
    root.innerHTML = '<article class="card ' + variant + '"><span class="bar"></span><div class="mode">' + esc(m.name) + '</div>' + tag + (m.iconUrl ? '<img class="icon" src="' + esc(m.iconUrl) + '" alt="">' : '') + '<div class="rank">' + rankHtml(m.rank) + '</div>' + mmr + '</article>';
    return;
  }
  root.innerHTML = '<article class="card ' + variant + '"><span class="bar"></span>' + (m.iconUrl ? '<img class="icon" src="' + esc(m.iconUrl) + '" alt="">' : '') + info + mmr + '</article>';
}`;
  return page('<div id="overlay"><div class="empty">Loading overlay...</div></div>', css, script);
}

function allPageHtml() {
  const css = `
.all{display:flex;align-items:stretch;gap:12px}
.all.compact{gap:8px}
.card{width:250px;min-height:250px;display:flex;align-items:center;flex-direction:column;text-align:center;gap:6px;padding:16px;background:linear-gradient(135deg,rgba(20,23,46,.97),var(--bg));border:1px solid var(--line);border-radius:14px}
.all.compact .card{width:180px;min-height:105px;flex-direction:row;padding:10px;text-align:left}
.icon{width:88px;height:88px;object-fit:contain;filter:drop-shadow(0 0 10px rgba(167,139,250,.45))}
.all.compact .icon{width:60px;height:60px}.all:not(.compact) .card{width:375px;min-height:375px;justify-content:center;gap:4px;padding:12px}.all.compact .card{width:675px;min-height:395px;gap:6px;padding:12px}.all.compact .icon{width:120px;height:120px}.all.compact .mode{font-size:16px}.all.compact .rank{font-size:18px}.all.compact .mmr{font-size:41px}.all:not(.compact) .icon{width:132px;height:132px}.all:not(.compact) .mode{font-size:15px}.all:not(.compact) .rank{font-size:22px}.all:not(.compact) .mmr{font-size:60px}
.mode{color:var(--muted);font-size:10px;font-weight:900;letter-spacing:1px;text-transform:uppercase}
.rank{font-size:15px;font-weight:850;line-height:1.15}
.mmr{color:var(--purple);font-size:40px;font-weight:950;line-height:1;font-variant-numeric:tabular-nums}
.all.compact .rank{font-size:12px}.all.compact .mmr{font-size:27px}
.all.compact .card{width:675px;min-height:395px;gap:6px;padding:12px}.all.compact .icon{width:160px;height:160px}.all.compact .mode{font-size:22px}.all.compact .rank{font-size:24px}.all.compact .mmr{font-size:58px}.all.compact .label{font-size:13px}
.all .label{font-size:20px}
.info{display:flex;flex-direction:column;gap:4px}.label{font-size:9px;color:var(--muted);font-weight:900;letter-spacing:.8px}.empty{margin:0}
.preview{position:relative;height:128px;overflow:hidden;border-radius:7px;background:linear-gradient(135deg,#0f1326,#080a14);border:1px solid rgba(167,139,250,.24);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;padding:10px;text-align:center}
.preview-title{font-weight:850;color:#f6f3ff;font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.preview-subtitle{font-size:10px;color:#a5acc9;font-weight:700;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.preview-chip{font-size:10px;font-weight:900;letter-spacing:.9px;color:#c4b5fd;text-transform:uppercase}
.preview-foot{font-size:10px;color:#a5acc9;letter-spacing:.4px}
.preview-bars,.preview-profile-grid,.preview-session-row{display:flex;gap:6px;width:min(92%,160px)}
.preview-bars span,.pv-divider{height:10px;border-radius:999px;background:linear-gradient(90deg,#34d399,#a78bfa);flex:1;opacity:.9}
.preview-bars span:nth-child(2){flex:.7}.preview-bars span:nth-child(3){flex:.45}
.preview-session{justify-content:center}.preview-session .preview-session-row{align-items:center;justify-content:space-between;width:min(92%,180px)}.pv-stat{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0}.pv-stat b{font-size:18px;line-height:1}.pv-stat span{font-size:9px;font-weight:900;letter-spacing:.8px}.pv-stat.win b,.pv-stat.win span{color:#34d399}.pv-stat.loss b,.pv-stat.loss span{color:#fb7185}.preview-session-classic{padding-top:12px}.preview-session-scoreboard{flex-direction:row;justify-content:space-between;padding:12px 14px;text-align:left}.preview-session-scoreboard .preview-title{font-size:10px;max-width:72px;white-space:normal;line-height:1.1}.preview-session-scoreboard .preview-session-row{width:120px}.preview-session-compact{flex-direction:row;justify-content:space-between;padding:10px 12px}.preview-session-compact .preview-title,.preview-session-minimal .preview-title{display:none}.preview-session-compact .preview-session-row,.preview-session-minimal .preview-session-row{width:120px}.preview-session-pills .pv-stat{flex:1;border-radius:999px;background:rgba(255,255,255,.05);padding:5px 0}.preview-session-pills .preview-session-row{width:min(92%,176px)}.preview-session-stacked{justify-content:space-between;padding:12px}.preview-session-stacked .preview-session-row{width:100%;flex-direction:column;gap:4px}.preview-session-stacked .pv-divider{display:none}.preview-session-stacked .pv-stat{width:100%;padding:4px 0;background:rgba(255,255,255,.05);border-radius:10px}.preview-session-neon,.preview-card-neon{box-shadow:0 0 18px rgba(167,139,250,.28),inset 0 0 16px rgba(167,139,250,.08)}.preview-session-minimal{padding:8px 10px;align-items:flex-start}.preview-session-minimal .preview-session-row{width:100%}.preview-session-wide{flex-direction:row;justify-content:space-between;padding:10px 14px}.preview-session-wide .preview-title{align-self:center;max-width:90px;white-space:normal}
.preview-card{justify-content:space-between;align-items:flex-start;text-align:left}.preview-card .pv-icon{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#60a5fa,#a78bfa);box-shadow:0 0 0 2px rgba(255,255,255,.08),0 0 14px rgba(96,165,250,.3)}.preview-card .pv-icon.large{width:42px;height:42px}.preview-card .preview-mmr{margin-top:auto;font-size:16px;font-weight:950;color:#c4b5fd;line-height:1}.preview-card .preview-title{font-size:11px;white-space:normal;line-height:1.1}.preview-card .preview-subtitle{max-width:100%;line-height:1.15}.preview-card-broadcast{flex-direction:row;align-items:center;gap:10px;padding:10px 12px;text-align:left;background:linear-gradient(90deg,rgba(167,36,148,.22) 0,rgba(9,12,20,.88) 28%)}.preview-card-broadcast .preview-title{font-size:10px}.preview-card-broadcast .preview-mmr{font-size:20px}.preview-card-broadcast .pv-icon{width:34px;height:34px}.preview-card-compact{gap:4px}.preview-card-compact .preview-mmr{font-size:14px}.preview-card-rankline{padding:10px 12px;flex-direction:row;align-items:center}.preview-card-rankline .pv-icon{width:30px;height:30px}.preview-card-rankline .preview-mmr{font-size:17px;margin-left:auto}.preview-card-minimal{flex-direction:row;align-items:center;gap:8px;padding:8px 10px}.preview-card-minimal .preview-title,.preview-card-minimal .preview-subtitle{display:none}.preview-card-minimal .preview-mmr{margin-left:auto;font-size:15px}.preview-card-split{flex-direction:row;align-items:center;padding:0;text-align:left}.preview-card-split .pv-icon{width:100%;height:100%;border-radius:0;max-width:84px;background:linear-gradient(135deg,#7c3aed,#2563eb)}.preview-card-split .preview-title,.preview-card-split .preview-subtitle,.preview-card-split .preview-mmr{padding-right:10px}.preview-card-split .preview-mmr{margin-left:auto}.preview-card-tall{justify-content:space-between;padding:14px 12px}.preview-card-tall .preview-title{white-space:normal}.preview-profile{justify-content:space-between;align-items:flex-start;text-align:left;padding:12px 14px}.preview-profile-grid{flex-wrap:wrap;width:100%;gap:6px}.preview-profile-grid span{flex:1 1 calc(50% - 6px);min-width:0;border-radius:8px;background:rgba(255,255,255,.05);padding:5px 6px;font-size:9px;color:#c4b5fd;font-weight:900;letter-spacing:.7px;text-transform:uppercase}
`.trim();

  const script = `
const q = new URLSearchParams(location.search);
const season = q.get('season') || 'current';
const variant = q.get('variant') === 'compact' ? 'compact' : 'cards';
const explicit = q.get('modes') ? q.get('modes').split(',') : null;
function rankHtml(value){ return String(value || 'Unranked').split(/\s+-\s+/).map(esc).join('<br>'); }
function render(d){
  if ((season === 'prev1' && d.showPrevSeason1 === false) || (season === 'prev2' && d.showPrevSeason2 !== true)) {
    document.getElementById('overlay').innerHTML = '<div class="empty">Season disabled in tracker settings.</div>';
    return;
  }
  const source = season === 'prev1' ? d.prevSeason1 : season === 'prev2' ? d.prevSeason2 : d.modes;
  const selected = explicit || (d.selectedModeIds || []).map(String);
  const modes = Array.isArray(source) ? source.filter(m => selected.includes(String(m.id))) : [];
  const root = document.getElementById('overlay');
  if (!modes.length) {
    root.innerHTML = '<div class="empty">Waiting for selected modes...</div>';
    return;
  }
  root.innerHTML = '<section class="all ' + variant + '">' + modes.map(m =>
    '<article class="card">' +
      (m.iconUrl ? '<img class="icon" src="' + esc(m.iconUrl) + '" alt="">' : '') +
      '<div class="info"><div class="mode">' + esc(m.name) + '</div><div class="rank">' + rankHtml(m.rank) + '</div><div class="mmr">' + esc(m.mmr) + '</div><div class="label">MMR</div></div>' +
    '</article>'
  ).join('') + '</section>';
}`;
  return page('<div id="overlay"><div class="empty">Loading overlay...</div></div>', css, script);
}

function profilePageHtml() {
  const css = `
body{width:1200px;min-height:760px;padding:24px 28px;background:#0a0b16;color:#e2e8f0;overflow:auto}
.section{background:rgba(20,23,46,.92);border:1px solid rgba(139,92,246,.38);border-radius:14px;padding:20px;margin-bottom:16px}
.title{color:var(--purple);font-size:16px;font-weight:900;letter-spacing:.8px;text-transform:uppercase;margin-bottom:15px}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
.stat{padding:13px;background:rgba(255,255,255,.04);border-radius:10px;text-align:center}.stat b{display:block;font-size:25px}.stat span{color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.7px;text-transform:uppercase}
.highlights{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px;margin-bottom:8px}.highlight{display:flex;align-items:center;justify-content:center;gap:8px;padding:9px;background:rgba(255,255,255,.04);border-radius:8px;text-align:center;min-height:72px}.highlight span{display:block;color:var(--muted);font-size:9px;font-weight:800;text-transform:uppercase}.highlight b{font-size:18px;color:var(--purple)}.highlight img{width:48px;height:48px;object-fit:contain;filter:drop-shadow(0 0 8px rgba(167,139,250,.5))}
.modes{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.modecard{display:flex;align-items:center;gap:13px;background:rgba(255,255,255,.04);border-radius:12px;padding:14px}.modecard img{width:72px;height:72px;object-fit:contain}.modecard b{display:block;font-size:23px;color:var(--purple)}.modecard span{display:block;color:var(--muted);font-size:11px;font-weight:800;text-transform:uppercase;margin-bottom:4px}.empty{background:transparent;border:0;color:var(--muted)}
`.trim();

  const script = `
function stat(label,value){return '<div class="stat"><b>'+esc(value||0)+'</b><span>'+label+'</span></div>';}
function render(d){
  const root = document.getElementById('overlay');
  const c = d.careerStats || {};
  const modes = (d.modes || []).filter(m => (d.selectedModeIds || []).some(id => String(id) === String(m.id)));
  const ranked = modes.filter(m => m.peakRank || m.peakRating);
  const highest = ranked.slice().sort((a,b)=>(Number(b.peakRating)||0)-(Number(a.peakRating)||0))[0] || modes[0] || {};
  root.innerHTML = '<section class="section"><div class="title">📈 Estadísticas de carrera</div><div class="stats">' +
    stat('Tiros', c.shots) + stat('Goles', c.goals) + stat('Salvadas', c.saves) + stat('Asistencias', c.assists) + stat('MVPs', c.mvps) + stat('Victorias', c.wins) +
    '</div><div class="highlights"><div class="highlight">' + ((highest.peakIconUrl || highest.iconUrl) ? '<img src="' + esc(highest.peakIconUrl || highest.iconUrl) + '" alt="">' : '') + '<span>Rango mayor alcanzado<br><b>' + esc(highest.peakRank || highest.rank || 'Sin datos') + '</b></span></div><div class="highlight"><span>Partidos<br><b>' + esc(highest.matchesPlayed || 0) + '</b></span></div><div class="highlight"><span>MMR Mayor Alcanzado<br><b>' + esc(highest.peakRating || highest.mmr || 0) + '</b></span></div></div></section><section class="section"><div class="title">🎮 Temporada actual</div><div class="modes">' +
    (modes.length ? modes.map(m => '<article class="modecard">' + (m.iconUrl ? '<img src="' + esc(m.iconUrl) + '" alt="">' : '') + '<div><span>' + esc(m.name) + '</span><strong>' + esc(m.rank) + '</strong><b>' + esc(m.mmr) + ' <small>MMR</small></b></div></article>').join('') : '<div class="empty">Waiting for tracker data...</div>') +
    '</div></section>';
}`;
  return page('<div id="overlay"><div class="empty">Loading profile...</div></div>', css, script);
}

function previewScale(width, height) {
  return Math.min(1, 226 / width, 118 / height);
}

function indexPageHtml(port) {
  const profile = overlayCard(port, '/obs/profile', 'Full player profile', 1200, 760, 'profile-card', 'profile');
  const sessionCards = SESSION_VARIANTS.map(v =>
    overlayCard(port, `/obs/session?variant=${v[0]}`, v[1], v[2], v[3], '', `session-${v[0]}`)
  ).join('');
  const visibleSeasons = SEASONS.filter(seasonInfo => seasonInfo[0] === 'current' ||
    (seasonInfo[0] === 'prev1' ? latestData.showPrevSeason1 !== false : latestData.showPrevSeason2 === true));
  const selectedCards = visibleSeasons.flatMap(seasonInfo =>
    ALL_VARIANTS.map(v =>
      overlayCard(port, `/obs/all?season=${seasonInfo[0]}&variant=${v[0]}`, `${seasonInfo[1]} - ${v[1]}`, v[2], v[3], '', `card-${v[0]}`, seasonInfo[2])
    )
  ).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>RL MMR Tracker - OBS</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;background:#0b0d19;color:#e7e9f6;font:14px Inter,Segoe UI,Arial,sans-serif;padding:18px;max-width:1360px}
    .hero{margin-bottom:18px}.hero h1{margin:0 0 7px;color:#c4b5fd;font-size:27px}.hero p{margin:0;color:#a5acc9;line-height:1.5}
    .notice{padding:11px 13px;border-left:3px solid #a78bfa;background:#151a30;color:#bbc2dd;font-size:12px;line-height:1.45;border-radius:0 8px 8px 0}
    .section{margin:22px 0}.section h2{font-size:15px;letter-spacing:.5px;margin:0 0 5px;color:#d8d4ff}.section>p{margin:0 0 12px;color:#8e96b7;font-size:12px;line-height:1.45}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
    .linkcard{display:flex;min-height:268px;flex-direction:column;gap:8px;padding:12px;background:#151a30;border:1px solid #2d355e;border-radius:8px}
    .linkcard:hover{border-color:#a78bfa}
    .profile-card .preview{height:122px}
    .preview{position:relative;height:128px;overflow:hidden;border-radius:7px;background:linear-gradient(135deg,#0f1326,#080a14);border:1px solid rgba(167,139,250,.24);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;padding:10px;text-align:center}
    .preview-title{font-weight:850;color:#f6f3ff;font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .preview-subtitle{font-size:10px;color:#a5acc9;font-weight:700;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .preview-chip{font-size:10px;font-weight:900;letter-spacing:.9px;color:#c4b5fd;text-transform:uppercase}
    .preview-foot{font-size:10px;color:#a5acc9;letter-spacing:.4px}
    .preview-bars,.preview-profile-grid,.preview-session-row{display:flex;gap:6px;width:min(92%,160px)}
    .preview-bars span,.pv-divider{height:10px;border-radius:999px;background:linear-gradient(90deg,#34d399,#a78bfa);flex:1;opacity:.9}
    .preview-bars span:nth-child(2){flex:.7}.preview-bars span:nth-child(3){flex:.45}
    .preview-session{justify-content:center}.preview-session .preview-session-row{align-items:center;justify-content:space-between;width:min(92%,180px)}
    .pv-stat{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0}.pv-stat b{font-size:18px;line-height:1}.pv-stat span{font-size:9px;font-weight:900;letter-spacing:.8px}.pv-stat.win b,.pv-stat.win span{color:#34d399}.pv-stat.loss b,.pv-stat.loss span{color:#fb7185}
    .preview-session-classic{padding-top:12px}
    .preview-session-scoreboard{flex-direction:row;justify-content:space-between;padding:12px 14px;text-align:left}
    .preview-session-scoreboard .preview-title{font-size:10px;max-width:72px;white-space:normal;line-height:1.1}.preview-session-scoreboard .preview-session-row{width:120px}
    .preview-session-compact{flex-direction:row;justify-content:space-between;padding:10px 12px}.preview-session-compact .preview-title,.preview-session-minimal .preview-title{display:none}.preview-session-compact .preview-session-row,.preview-session-minimal .preview-session-row{width:120px}
    .preview-session-pills .pv-stat{flex:1;border-radius:999px;background:rgba(255,255,255,.05);padding:5px 0}.preview-session-pills .preview-session-row{width:min(92%,176px)}
    .preview-session-stacked{justify-content:space-between;padding:12px}.preview-session-stacked .preview-session-row{width:100%;flex-direction:column;gap:4px}.preview-session-stacked .pv-divider{display:none}.preview-session-stacked .pv-stat{width:100%;padding:4px 0;background:rgba(255,255,255,.05);border-radius:10px}
    .preview-session-neon,.preview-card-neon{box-shadow:0 0 18px rgba(167,139,250,.28),inset 0 0 16px rgba(167,139,250,.08)}
    .preview-session-minimal{padding:8px 10px;align-items:flex-start}.preview-session-minimal .preview-session-row{width:100%}
    .preview-session-wide{flex-direction:row;justify-content:space-between;padding:10px 14px}.preview-session-wide .preview-title{align-self:center;max-width:90px;white-space:normal}
.preview-card{justify-content:space-between;align-items:flex-start;text-align:left;gap:4px;padding:8px}
    .preview-card .pv-icon{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#60a5fa,#a78bfa);box-shadow:0 0 0 2px rgba(255,255,255,.08),0 0 14px rgba(96,165,250,.3)}
    .preview-card .pv-icon.large{width:42px;height:42px}
    .preview-card .preview-mmr{margin-top:auto;font-size:16px;font-weight:950;color:#c4b5fd;line-height:1}
    .preview-card .preview-title{font-size:11px;white-space:normal;line-height:1.1}
    .preview-card .preview-subtitle{max-width:100%;line-height:1.15}
.preview-card .pv-icon{width:34px;height:34px;border-radius:50%;clip-path:polygon(50% 0,88% 25%,100% 68%,50% 100%,0 68%,12% 25%)}.preview-card .pv-icon.large{width:38px;height:38px}.preview-card .preview-title{font-size:10px;line-height:1.1;max-height:24px}.preview-card .preview-subtitle{font-size:9px;line-height:1.1;max-height:20px}.preview-card .preview-foot{font-size:9px}
    .preview-card .pv-icon{width:34px;height:34px;border-radius:50%;clip-path:polygon(50% 0,88% 25%,100% 68%,50% 100%,0 68%,12% 25%)}.preview-card .pv-icon.large{width:38px;height:38px}.preview-card .preview-title{font-size:10px;line-height:1.1;max-height:24px}.preview-card .preview-subtitle{font-size:9px;line-height:1.1;max-height:20px}.preview-card .preview-foot{font-size:9px}
    .preview-card-broadcast{flex-direction:row;align-items:center;gap:10px;padding:10px 12px;text-align:left;background:linear-gradient(90deg,rgba(167,36,148,.22) 0,rgba(9,12,20,.88) 28%)}
    .preview-card-broadcast .preview-title{font-size:10px}.preview-card-broadcast .preview-mmr{font-size:20px}.preview-card-broadcast .pv-icon{width:34px;height:34px}
    .preview-card-compact{gap:4px}.preview-card-compact .preview-mmr{font-size:14px}
    .preview-card-rankline{padding:10px 12px;flex-direction:row;align-items:center}.preview-card-rankline .pv-icon{width:30px;height:30px}.preview-card-rankline .preview-mmr{font-size:17px;margin-left:auto}
    .preview-card-minimal{flex-direction:row;align-items:center;gap:8px;padding:8px 10px}.preview-card-minimal .preview-title,.preview-card-minimal .preview-subtitle{display:none}.preview-card-minimal .preview-mmr{margin-left:auto;font-size:15px}
    .preview-card-split{flex-direction:row;align-items:center;padding:0;text-align:left}.preview-card-split .pv-icon{width:100%;height:100%;border-radius:0;max-width:84px;background:linear-gradient(135deg,#7c3aed,#2563eb)}.preview-card-split .preview-title,.preview-card-split .preview-subtitle,.preview-card-split .preview-mmr{padding-right:10px}.preview-card-split .preview-mmr{margin-left:auto}
    .preview-card-tall{justify-content:space-between;padding:14px 12px}.preview-card-tall .preview-title{white-space:normal}
    .preview-profile{justify-content:space-between;align-items:flex-start;text-align:left;padding:12px 14px}
    .preview-profile-grid{flex-wrap:wrap;width:100%;gap:6px}.preview-profile-grid span{flex:1 1 calc(50% - 6px);min-width:0;border-radius:8px;background:rgba(255,255,255,.05);padding:5px 6px;font-size:9px;color:#c4b5fd;font-weight:900;letter-spacing:.7px;text-transform:uppercase}
    .name{font-weight:850;color:#f6f3ff}.size{font-size:11px;color:#a5acc9}.url{color:#5eead4;font:11px Consolas,monospace;word-break:break-all;line-height:1.35}.copy{align-self:flex-start;margin-top:auto;padding:6px 9px;border:1px solid #3e4777;border-radius:6px;background:#202746;color:#eef;cursor:pointer;font-size:11px}.copy:hover{border-color:#a78bfa}
    .live-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-bottom:14px}.live-card{display:flex;flex-direction:column;gap:4px;min-height:126px;padding:12px;background:#151a30;border:1px solid #4c3f96;border-radius:10px;text-decoration:none;color:inherit}.live-card:hover{border-color:#c4b5fd;transform:translateY(-1px)}.live-card .mode{font-size:10px;color:#9da5c4}.live-card .rank{font-size:12px;color:#f6f3ff;line-height:1.15}.live-card .mmr{margin-top:auto;color:#b79cff;font-size:26px;font-weight:950;line-height:1}.live-card .mmr small{font-size:9px;color:#8e96b7;letter-spacing:.8px}.live-card .season{font-size:9px;color:#fcd34d;font-weight:900;text-transform:uppercase}.live-session{display:flex;align-items:center;gap:18px;padding:12px 16px;margin-bottom:14px;background:#151a30;border:1px solid #2d355e;border-radius:10px}.live-session b{font-size:25px}.live-session .win{color:#34d399}.live-session .loss{color:#fb7185}.live-session span{font-size:10px;color:#a5acc9;font-weight:900;text-transform:uppercase}.mode-block details{margin-bottom:9px;background:#11162a;border:1px solid #2d355e;border-radius:9px;overflow:hidden}.mode-block summary{cursor:pointer;padding:11px 13px;color:#f6f3ff;font-weight:850;list-style:none}.mode-block summary::-webkit-details-marker{display:none}.mode-block summary:before{content:'+';display:inline-block;width:18px;color:#a78bfa;font-size:17px}.mode-block details[open] summary:before{content:'−'}.mode-block .season-title{margin:0;padding:8px 13px 4px}.mode-block .grid{padding:0 10px 10px}
    .live-card .rank-icon{width:42px;height:42px;object-fit:contain;align-self:center;filter:drop-shadow(0 0 8px rgba(167,139,250,.45))}.live-card,.live-session{text-decoration:none}.collapsible{padding:0;overflow:hidden}.collapsible>summary{cursor:pointer;padding:0 0 10px;color:#d8d4ff;font-size:15px;font-weight:850;list-style:none}.collapsible>summary::-webkit-details-marker{display:none}.collapsible>summary:before{content:'+';display:inline-block;width:20px;color:#a78bfa;font-size:20px;vertical-align:-1px}.collapsible[open]>summary:before{content:'−'}.collapsible>p,.collapsible>.grid,.collapsible>#modes,.collapsible>div{margin-left:0;margin-right:0}.collapsible>p{margin-top:0}.collapsible>.grid{margin-bottom:18px}.live-session{max-width:430px;gap:12px;flex-wrap:wrap}.live-session span:first-child{width:100%}.season-summary{margin-top:10px}.season-summary .season-title{margin-top:0}
    .section>h2{padding-left:20px}.live-session{margin-left:0;margin-right:0}.preview-card img.pv-icon{object-fit:contain;clip-path:none;background:transparent;box-shadow:none}
    .mode-block{margin:16px 0 22px}.mode-block h3{margin:0 0 9px;font-size:15px;color:#fff}.season-title{display:flex;align-items:center;gap:8px;margin:13px 0 8px;color:#c7d2fe;font-size:12px;font-weight:850;text-transform:uppercase;letter-spacing:.8px}.tag{padding:3px 6px;border-radius:5px;background:#36295b;color:#e9d5ff;font-size:10px}.empty-state{padding:15px;background:#151a30;border:1px solid #2d355e;border-radius:8px;color:#a5acc9}
  </style>
</head>
<body>
  <header class="hero">
    <h1>RL MMR Tracker - Overlays para OBS</h1>
    <p>Agrega estas URLs como Browser Source en OBS Studio. Activa fondo transparente cuando uses overlays pequenos.</p>
  </header>
  <div class="notice">Cada diseno tiene su propia URL. Los nombres de los modos y rangos se mantienen en ingles como aparecen en Rocket League; en overlays pequenos se usa WIN/LOSS para que el texto no se salga.</div>

  <section class="section legacy-summary" hidden>
    <h2>Resumen legacy</h2>
    <p>Consulta tus modos activos, MMR y partidas de hoy sin abrir cada overlay. Haz clic en una tarjeta para ir a su diseño.</p>
    <div id="legacy-dashboard"><div class="empty-state">Cargando datos del tracker...</div></div>
  </section>

  <section class="section">
    <h2>👤 Perfil completo de jugador</h2>
    <p>Vista grande con estadisticas generales y modos seleccionados.</p>
    <div class="grid">${profile}</div>
  </section>

  <section class="section">
    <h2>📌 Resumen actual</h2>
    <p>Consulta tus modos activos, MMR y partidas de hoy sin abrir cada overlay. Haz clic en una tarjeta para ir a su diseño.</p>
    <div id="live-dashboard"><div class="empty-state">Cargando datos del tracker...</div></div>
  </section>

  <details id="session-overlays" class="section collapsible">
    <summary>🎮 Partidas de hoy - Overlays</summary>
    <p>Ocho tamanos distintos para acomodarlo en espacios altos, bajos, anchos o reducidos.</p>
    <div class="grid">${sessionCards}</div>
  </details>

  <section class="section">
    <h2>🎯 Modos individuales</h2>
    <p>Cada modo activo tiene sus diseños y URLs separados. Abre un bloque para ver las variantes disponibles.</p>
    <div id="modes" class="mode-list"><div class="empty-state">Inicia el tracker para cargar tus modos activos.</div></div>
  </section>

  <details id="all-overlays" class="section collapsible" open>
    <summary>📦 Todos los modos seleccionados (horizontal)</summary>
    <p>Estas URLs se adaptan solas cuando seleccionas modos y respetan las temporadas habilitadas.</p>
    <div class="grid">${selectedCards}</div>
  </details>

  <details id="previous-season" class="section collapsible" open>
    <summary>🕘 Previous season <span class="tag">PREV 1</span></summary>
    <div id="season-prev1"><div class="empty-state">Temporada no habilitada.</div></div>
  </details>

  <details id="previous-season-2" class="section collapsible" open>
    <summary>⏪ 2 seasons ago <span class="tag">PREV 2</span></summary>
    <div id="season-prev2"><div class="empty-state">Temporada no habilitada.</div></div>
  </details>

  <script>
    const port = ${port};
    const cardVariants = ${JSON.stringify(CARD_VARIANTS)};
    const seasons = ${JSON.stringify(SEASONS)};
    const rankIcons = ${JSON.stringify([...new Set((latestData.modes || []).map(m=>m && m.iconUrl).filter(Boolean))])};
    const sessionSection=document.getElementById('session-overlays'); if(sessionSection){sessionSection.removeAttribute('open');sessionSection.open=false;}
    function clean(s){return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
    function copy(url,b){navigator.clipboard?.writeText(url).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy URL',1100)}).catch(()=>prompt('Copy this URL:',url));}
    function previewMarkup(kind,title,subtitle,w,h){
      if(kind.startsWith('session-')) return '<div class="preview preview-session preview-session-'+clean(kind)+'"><div class="preview-chip">Preview</div><div class="preview-title">'+clean(title)+'</div><div class="preview-session-row"><div class="pv-stat win"><b>4</b><span>'+(kind==='session-compact'||kind==='session-minimal'?'WIN':'WINS')+'</span></div><div class="pv-divider"></div><div class="pv-stat loss"><b>2</b><span>'+(kind==='session-compact'||kind==='session-minimal'?'LOSS':'LOSSES')+'</span></div></div><div class="preview-foot">'+w+' x '+h+'</div></div>';
      if(kind.startsWith('card-')){
        const iconClass=(kind==='card-broadcast'||kind==='card-split')?'pv-icon large':'pv-icon';
        const sub=subtitle?'<div class="preview-subtitle">'+clean(subtitle)+'</div>':'';
        const mmr=kind==='card-minimal'?'MMR':'1056';
        const icon=rankIcons.length?'<img class="'+iconClass+'" src="'+clean(rankIcons[Math.floor(Math.random()*rankIcons.length)])+'" alt="">':'<div class="'+iconClass+'"></div>';
        return '<div class="preview preview-card preview-card-'+clean(kind)+'">'+icon+'<div class="preview-chip">Preview</div><div class="preview-title">'+clean(title)+'</div>'+sub+'<div class="preview-mmr">'+mmr+'</div></div>';
      }
      if(kind==='profile') return '<div class="preview preview-profile"><div class="preview-chip">Preview</div><div class="preview-title">'+clean(title)+'</div><div class="preview-profile-grid"><span>GOLES</span><span>DISPAROS</span><span>VICTORIAS</span><span>ASISTENCIAS</span></div><div class="preview-foot">'+w+' x '+h+'</div></div>';
      return '<div class="preview"><div class="preview-chip">Preview</div><div class="preview-title">'+clean(title)+'</div><div class="preview-bars"><span></span><span></span><span></span></div><div class="preview-foot">'+w+' x '+h+'</div></div>';
    }
    function card(path,name,w,h,kind,subtitle){const url='http://localhost:'+port+path;return '<article class="linkcard">'+previewMarkup(kind||'default',name,subtitle,w,h)+'<div class="name">'+clean(name)+'</div><div class="size">Recommended: '+w+' x '+h+' px</div><a class="url" href="'+clean(path)+'" target="_blank">'+clean(url)+'</a><button class="copy" data-url="'+clean(url)+'" onclick="copy(this.dataset.url,this)">Copy URL</button></article>';}
    function show(d){
      const ids=(d.selectedModeIds||[]).map(String), current=Array.isArray(d.modes)?d.modes:[], selected=current.filter(m=>ids.includes(String(m.id))), modes=selected.length?selected:current;
      const live=document.getElementById('live-dashboard'), root=document.getElementById('modes');
      const session=d.session||{wins:0,losses:0};
      if(!modes.length){live.innerHTML='<div class="empty-state">Esperando datos del tracker...</div>';root.innerHTML='<div class="empty-state">Esperando modos seleccionados...</div>';return;}
      const enabled=seasons.filter(s=>s[0]==='current'||(s[0]==='prev1'?d.showPrevSeason1!==false:d.showPrevSeason2===true));
      const prevSection=document.getElementById('previous-season'), prev2Section=document.getElementById('previous-season-2');
      if(prevSection) prevSection.hidden=d.showPrevSeason1===false;
      if(prev2Section) prev2Section.hidden=d.showPrevSeason2!==true;
      const activeIds=selected.length?ids:current.map(m=>String(m.id));
      const modeCard=m=>'<a class="live-card" href="#mode-'+clean(m.id)+'">'+(m.iconUrl?'<img class="rank-icon" src="'+clean(m.iconUrl)+'" alt="">':'')+'<div class="mode">'+clean(m.name)+'</div><div class="rank">'+clean(m.rank||'Unranked')+'</div><div class="mmr">'+clean(m.mmr||0)+' <small>MMR</small></div></a>';
      enabled.filter(s=>s[0]!=='current').forEach(s=>{const source=s[0]==='prev1'?d.prevSeason1:d.prevSeason2;const rows=Array.isArray(source)?source.filter(m=>activeIds.includes(String(m.id))):[];const target=document.getElementById('season-'+s[0]);if(target) target.innerHTML=rows.length?'<div class="live-grid">'+rows.map(modeCard).join('')+'</div>':'<div class="empty-state">No hay datos disponibles para esta temporada.</div>';});
      live.innerHTML='<div class="live-grid">'+modes.map(modeCard).join('')+'</div><a class="live-session" href="#session-overlays"><span>Partidas de hoy</span><b class="win">'+clean(session.wins||0)+'</b><span>Ganadas</span><b class="loss">'+clean(session.losses||0)+'</b><span>Perdidas</span></a>';
      root.innerHTML=modes.map(m=>'<div class="mode-block" id="mode-'+clean(m.id)+'"><details><summary>'+clean(m.name)+' · '+clean(m.rank||'Unranked')+' · '+clean(m.mmr||0)+' MMR</summary>'+enabled.map(s=>'<div class="season-title"><span>'+clean(s[1])+'</span><span class="tag">'+clean(s[2])+'</span></div><div class="grid">'+cardVariants.map(v=>card('/obs/card?mode='+encodeURIComponent(m.id)+'&season='+s[0]+'&variant='+v[0],v[1],v[2],v[3],'card-'+v[0],m.rank)).join('')+'</div>').join('')+'</details></div>').join('');
    }
    async function load(){try{const r=await fetch('/api/data',{cache:'no-store'});show((await r.json()).data||{});}catch(_){}}
    load();
    if(window.EventSource){const events=new EventSource('/api/events');events.addEventListener('data',e=>{try{show(JSON.parse(e.data).data||{});}catch(_){}});}
    function openHash(){const target=document.getElementById(location.hash.slice(1));if(!target)return;const details=target.matches('details')?target:target.querySelector('details');if(details)details.open=true;setTimeout(()=>target.scrollIntoView({behavior:'smooth',block:'start'}),30);}
    window.addEventListener('hashchange',openHash);
    setTimeout(openHash,120);
  </script>
</body>
</html>`;
}

function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://localhost:${activePort}`);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  if (url.pathname === '/api/data') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(apiPayload());
    return;
  }

  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`event: data\ndata: ${eventPayload()}\n\n`);
    eventClients.add(res);
    req.on('close', () => eventClients.delete(res));
    return;
  }

  const routes = {
    '/obs/card': cardPageHtml,
    '/obs/session': sessionPageHtml,
    '/obs/all': allPageHtml,
    '/obs/profile': profilePageHtml,
  };

  if (routes[url.pathname]) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(routes[url.pathname]());
    return;
  }

  if (url.pathname === '/' || url.pathname === '/obs' || url.pathname === '/obs/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(indexPageHtml(activePort));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function start(port) {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(activePort);
      return;
    }
    activePort = port || 3030;
    server = http.createServer(handleRequest);
    server.once('error', err => {
      server = null;
      activePort = null;
      reject(err);
    });
    server.listen(activePort, '127.0.0.1', () => resolve(activePort));
  });
}

function stop() {
  return new Promise(resolve => {
    for (const client of eventClients) client.end();
    eventClients.clear();
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      server = null;
      activePort = null;
      resolve();
    });
  });
}

function isRunning() {
  return !!server;
}

function getPort() {
  return activePort;
}

module.exports = { start, stop, setData, isRunning, getPort };
