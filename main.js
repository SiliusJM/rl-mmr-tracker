'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });

const { updateCommand, testStreamElementsConnection } = require('./streamElements');
const { updateSession } = require('./sessionTracker');
const { scrapeProfile, closeBrowser, resetPrevSeasonCache } = require('./scraper');
const rlStatsApi = require('./rlStatsApi');
const obsServer = require('./obs-server');

process.onUpdateSeasons = (seasons) => {
  if (lastData) {
    lastData.prevSeason1 = seasons.prev1;
    lastData.prevSeason2 = seasons.prev2;
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('data-update', lastData);
    obsServer.setData(lastData);
  }
};

const MODES_CACHE_PATH = path.join(__dirname, 'modes-cache.json');
function loadModesCache() {
  try {
    if (fs.existsSync(MODES_CACHE_PATH)) return JSON.parse(fs.readFileSync(MODES_CACHE_PATH, 'utf8'));
  } catch {}
  return null;
}
function saveModesCache(modes) {
  try { fs.writeFileSync(MODES_CACHE_PATH, JSON.stringify(modes, null, 2), 'utf8'); } catch {}
}

function buildResponse(modes, selectedIds, showRecord, session, careerStats, cfg) {
  const selected = modes.filter(m => selectedIds.includes(m.id));
  const format = cfg.twitchCommandFormat || 'modes';
  const showStats = cfg.twitchShowStats || false;
  const statsToShow = cfg.twitchStatsToShow || [];
  const parts = ['🚀'];

  if (format === 'modes' || format === 'both') parts.push(...selected.map(m => `${m.name}: ${m.rank} (${m.mmr})`));

  if ((format === 'stats' || format === 'both') && careerStats && showStats && statsToShow.length > 0) {
    const statsMap = {
      goals: `⚽ ${careerStats.goals} Goles`, shots: `🎯 ${careerStats.shots} Tiros`,
      saves: `🛡️ ${careerStats.saves} Salvadas`, assists: `🤝 ${careerStats.assists} Asistencias`,
      mvps: `⭐ ${careerStats.mvps} MVPs`, wins: `🏆 ${careerStats.wins} Ganados`,
    };
    parts.push(...statsToShow.filter(k => statsMap[k]).map(k => statsMap[k]));
  }

  if (showRecord) parts.push(`📊 Hoy: ${session.wins} Ganados - ${session.losses} Perdidos`);
  return parts.join(' | ');
}

const DEFAULT_CFG = {
  platform: 'epic', username: '', streamElementsToken: '', channelId: '', commandName: 'rango',
  pollInterval: 10000, selectedModeIds: [10, 11, 13, 28], showRecord: true,
  obsPort: 3030, obsEnabled: true, showPrevSeason1: true, showPrevSeason2: false,
  twitchCommandFormat: 'modes', twitchShowStats: false, twitchStatsToShow: [],
  fastPollEnabled: true,
  // Post-match watch: seconds after match end. It keeps watching until 5 minutes.
  fastPollDelays: [2000, 4000, 7000, 12000, 20000, 30000, 45000, 60000, 90000, 120000, 180000, 240000, 300000],
  rlStatsApiHost: '127.0.0.1', rlStatsApiPort: 49123,
};

function configPath() { return path.join(__dirname, 'config.json'); }
function loadConfig() {
  try {
    const p = configPath();
    if (fs.existsSync(p)) return { ...DEFAULT_CFG, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {}
  return { ...DEFAULT_CFG };
}
function saveConfig(cfg) { fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8'); }

function normalizeFastPollDelays(cfg) {
  const defaults = DEFAULT_CFG.fastPollDelays;
  const raw = Array.isArray(cfg.fastPollDelays) ? cfg.fastPollDelays : defaults;
  const delays = raw.map(Number).filter(n => Number.isFinite(n) && n >= 0);
  if (!delays.length) return defaults;
  // Convert legacy configurations containing the old 2/4/7/12/20s schedule
  // to the extended post-match watch automatically.
  if (delays.length <= 5 && delays.join(',') === '2000,4000,7000,12000,20000') return defaults;
  return delays;
}

function mergeConfig(cfg) {
  return { ...DEFAULT_CFG, ...cfg, fastPollDelays: normalizeFastPollDelays(cfg) };
}

function getFastPollDelays() {
  return normalizeFastPollDelays(loadConfig());
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(mergeConfig(cfg), null, 2), 'utf8');
}

async function applyLiveConfig(cfg) {
  cfg = mergeConfig(cfg);
  if (!lastData) return { applied: false };
  const selectedIds = cfg.selectedModeIds || [10, 11, 13, 28];
  const showRecord = cfg.showRecord !== false;
  lastData = { ...lastData, selectedModeIds: selectedIds, showRecord,
    showPrevSeason1: cfg.showPrevSeason1 !== false, showPrevSeason2: cfg.showPrevSeason2 === true };
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('data-update', lastData);
  obsServer.setData(lastData);

  if (isTracking && cfg.channelId && cfg.streamElementsToken && lastData.modes) {
    const response = buildResponse(lastData.modes, selectedIds, showRecord, lastData.session || { wins: 0, losses: 0 }, lastData.careerStats, cfg);
    const ok = await updateCommand(cfg.channelId, cfg.commandName, cfg.streamElementsToken, response);
    sendLog(ok ? 'Cambios aplicados al instante.' : 'Cambios aplicados localmente; no se pudo actualizar StreamElements.', ok ? 'success' : 'warn');
    lastPublishedResponse = response;
  }
  return { applied: true };
}

let mainWin;
let isTracking = false;
let pollTimer = null;
let fastPollTimer = null;
let fastPollGeneration = 0;
let fastPollAttempt = 0;
let lastData = null;
let lastPublishedResponse = null;
let lastMatchEndAt = 0;
let fastPollInProgress = false;

(function initLastDataFromCache() {
  const cached = loadModesCache();
  if (cached && cached.length > 0) {
    const cfg = mergeConfig(loadConfig());
    lastData = { modes: cached, prevSeason1: null, prevSeason2: null, session: { wins: 0, losses: 0 },
      selectedModeIds: cfg.selectedModeIds || [10, 11, 13, 28], showRecord: cfg.showRecord !== false,
      showPrevSeason1: cfg.showPrevSeason1 !== false, showPrevSeason2: cfg.showPrevSeason2 === true };
  }
}());

function createWindow() {
  mainWin = new BrowserWindow({
    width: 920, height: 680, minWidth: 700, minHeight: 540,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true },
    title: '🚀 RL MMR Tracker', backgroundColor: '#0d0d1a', show: false,
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.setMenuBarVisibility(false);
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.webContents.on('did-finish-load', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('tracker-state', { running: isTracking });
      if (isTracking && lastData) mainWin.webContents.send('data-update', lastData);
    }
  });
  mainWin.on('closed', () => {
    isTracking = false;
    cancelFastPoll();
    if (pollTimer) clearTimeout(pollTimer);
    rlStatsApi.stop();
    closeBrowser().catch(() => {});
    mainWin = null;
  });
}

app.whenReady().then(async () => {
  const cfg = mergeConfig(loadConfig());
  if (cfg.obsEnabled !== false) {
    await obsServer.start(cfg.obsPort || 3030).catch(err => console.warn('[WARN] No se pudo iniciar el servidor OBS:', err.message));
    if (lastData) obsServer.setData(lastData);
  }
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function sendLog(msg, type = 'info') {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('log', { msg, type, time: new Date().toLocaleTimeString() });
  console.log(`[${type.toUpperCase()}] ${msg}`);
}
global.sendLogToUI = sendLog;

function cancelFastPoll() {
  fastPollGeneration++;
  fastPollAttempt = 0;
  if (fastPollTimer) { clearTimeout(fastPollTimer); fastPollTimer = null; }
  fastPollInProgress = false;
}

function scheduleFastPoll(delayMs, generation, attempt) {
  if (!isTracking || generation !== fastPollGeneration) return;
  if (fastPollTimer) clearTimeout(fastPollTimer);
  fastPollTimer = setTimeout(async () => {
    fastPollTimer = null;
    if (!isTracking || generation !== fastPollGeneration) return;
    await poll(loadConfig(), { reason: 'match-end-fast', generation, attempt });
  }, delayMs);
}

function startFastPoll() {
  if (!isTracking) return;
  const cfg = mergeConfig(loadConfig());
  if (cfg.fastPollEnabled === false) return;

  const now = Date.now();
  if (now - lastMatchEndAt < 15000) return;
  lastMatchEndAt = now;

  cancelFastPoll();
  fastPollInProgress = true;
  const generation = fastPollGeneration;
  fastPollAttempt = 0;
  const delays = getFastPollDelays();

  sendLog(`🏁 Fin de partida detectado. Vigilancia post-partida: ${delays.map(d => d / 1000).join(' / ')}s (máx. 5 min).`, 'success');
  scheduleFastPoll(delays[0], generation, 0);
}

function onStatsApiEvent({ event }) {
  const normalized = String(event || '').toLowerCase().replace(/[\s-]+/g, '_');
  const isMatchEnd = (
    /(?:match|game|playlist).*?(?:ended|end|finished|finish|complete|completed)/i.test(normalized) ||
    /(?:ended|end|finished|finish|complete|completed).*?(?:match|game|playlist)/i.test(normalized)
  );
  if (isMatchEnd) startFastPoll();
}

ipcMain.handle('load-config', () => mergeConfig(loadConfig()));
ipcMain.handle('save-config', async (_e, cfg) => {
  const oldCfg = mergeConfig(loadConfig());
  cfg = mergeConfig(cfg);
  saveConfig(cfg);
  const newPort = cfg.obsPort || 3030;
  const oldPort = oldCfg.obsPort || 3030;
  if (cfg.obsEnabled !== false) {
    if (newPort !== oldPort || !obsServer.isRunning()) {
      await obsServer.stop();
      await obsServer.start(newPort).catch(err => console.warn('[WARN] No se pudo reiniciar el servidor OBS:', err.message));
      if (lastData) obsServer.setData(lastData);
    }
  } else if (obsServer.isRunning()) await obsServer.stop();
  await applyLiveConfig(cfg);
  return true;
});

ipcMain.handle('test-connection', async (_e, { channelId, streamElementsToken, commandName }) =>
  testStreamElementsConnection(channelId, commandName, streamElementsToken)
);

ipcMain.handle('start-tracker', async () => {
  if (isTracking) return true;
  isTracking = true;
  const cfg = mergeConfig(loadConfig());
  if (!cfg.username || !cfg.streamElementsToken || !cfg.channelId) {
    isTracking = false;
    sendLog('Completa la configuración antes de iniciar.', 'error');
    if (mainWin) mainWin.webContents.send('tracker-state', { running: false });
    return false;
  }
  sendLog('Probando conexión con StreamElements...', 'info');
  const ok = await testStreamElementsConnection(cfg.channelId, cfg.commandName, cfg.streamElementsToken);
  if (!ok) {
    isTracking = false;
    sendLog('No se pudo conectar con StreamElements. Verifica el token y el Channel ID.', 'error');
    if (mainWin) mainWin.webContents.send('tracker-state', { running: false });
    return false;
  }
  sendLog('Conexión con StreamElements verificada.', 'success');
  if (mainWin) mainWin.webContents.send('tracker-state', { running: true });
  resetPrevSeasonCache();
  lastPublishedResponse = null;
  cancelFastPoll();
  if (cfg.fastPollEnabled !== false) {
    rlStatsApi.start({ host: cfg.rlStatsApiHost || '127.0.0.1', port: cfg.rlStatsApiPort || 49123 });
    sendLog('Detector de fin de partida iniciado.', 'info');
  }
  poll(cfg);
  return true;
});

ipcMain.handle('get-status', () => ({ running: isTracking, data: lastData, fastPoll: fastPollInProgress, statsApiConnected: rlStatsApi.isConnected() }));
ipcMain.handle('get-modes-cache', () => loadModesCache());
ipcMain.handle('get-obs-info', () => ({ port: obsServer.getPort() || (loadConfig().obsPort || 3030), running: obsServer.isRunning() }));

ipcMain.handle('force-poll', () => {
  if (!isTracking) return false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  setImmediate(() => poll(loadConfig(), { reason: 'manual' }));
  return true;
});

ipcMain.handle('stop-tracker', () => {
  isTracking = false;
  cancelFastPoll();
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  rlStatsApi.stop();
  closeBrowser().catch(() => {});
  sendLog('Tracker detenido.', 'info');
  if (mainWin) mainWin.webContents.send('tracker-state', { running: false });
  return true;
});

async function poll(cfg, meta = {}) {
  if (!isTracking) return null;
  const isFast = meta.reason === 'match-end-fast';
  // Never run the normal scheduler while a post-match watch is active.
  if (!isFast && fastPollInProgress) return null;

  try {
    sendLog(isFast ? '⚡ Consulta rápida de Tracker.gg...' : 'Consultando tracker.gg...', 'info');
    const scraped = await scrapeProfile(cfg.platform, cfg.username);
    const modes = scraped.modes;
    const careerStats = scraped.careerStats;
    const sessionData = updateSession(modes);

    if (sessionData.events?.length) for (const ev of sessionData.events) sendLog(ev.msg, ev.type);

    const selectedIds = cfg.selectedModeIds || [10, 11, 13, 28];
    const showRecord = cfg.showRecord !== false;
    const response = buildResponse(modes, selectedIds, showRecord, sessionData, careerStats, cfg);

    saveModesCache(modes);
    lastData = { modes, careerStats, prevSeason1: scraped.prevSeason1, prevSeason2: scraped.prevSeason2,
      session: sessionData, selectedModeIds: selectedIds, showRecord,
      showPrevSeason1: cfg.showPrevSeason1 !== false, showPrevSeason2: cfg.showPrevSeason2 === true };
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('data-update', lastData);
    obsServer.setData(lastData);

    const changed = response !== lastPublishedResponse;
    if (changed) {
      sendLog(response, 'update');
      const seOk = await updateCommand(cfg.channelId, cfg.commandName, cfg.streamElementsToken, response);
      sendLog(seOk ? 'Comando actualizado en StreamElements.' : 'No se pudo actualizar StreamElements.', seOk ? 'success' : 'warn');
      if (seOk) lastPublishedResponse = response;

      if (isFast) {
        fastPollInProgress = false;
        if (fastPollTimer) { clearTimeout(fastPollTimer); fastPollTimer = null; }
        sendLog('⚡ MMR nuevo detectado. Vigilancia post-partida completada.', 'success');
      }
    } else if (isFast) {
      const delays = getFastPollDelays();
      const nextAttempt = Number(meta.attempt || 0) + 1;
      if (delays[nextAttempt] != null && meta.generation === fastPollGeneration) {
        fastPollAttempt = nextAttempt;
        sendLog(`⏳ Tracker.gg aún no refleja el resultado. Reintentando en ${delays[nextAttempt] / 1000}s...`, 'info');
        scheduleFastPoll(delays[nextAttempt], meta.generation, nextAttempt);
      } else {
        fastPollInProgress = false;
        sendLog('Fin de vigilancia post-partida: Tracker.gg todavía no publicó un MMR nuevo después de 5 minutos.', 'warn');
      }
    } else {
      sendLog('Sin cambios en MMR/estadísticas.', 'info');
    }
  } catch (err) {
    sendLog(err.message, 'error');
    if (isFast) {
      const delays = getFastPollDelays();
      const nextAttempt = Number(meta.attempt || 0) + 1;
      if (delays[nextAttempt] != null && meta.generation === fastPollGeneration) {
        fastPollAttempt = nextAttempt;
        sendLog(`⚠️ Error durante vigilancia post-partida. Reintentando en ${delays[nextAttempt] / 1000}s...`, 'warn');
        scheduleFastPoll(delays[nextAttempt], meta.generation, nextAttempt);
      } else {
        fastPollInProgress = false;
      }
    }
  }

  if (isTracking && !isFast && !fastPollInProgress) {
    const interval = Math.min(Math.max(Number(mergeConfig(loadConfig()).pollInterval) || 10000, 5000), 30000);
    sendLog(`Próxima actualización en ${interval / 1000}s.`, 'info');
    pollTimer = setTimeout(() => poll(loadConfig(), { reason: 'normal' }), interval);
  }
}

rlStatsApi.on('connected', () => sendLog('Rocket League Stats API conectada. Detección de fin de partida activa.', 'success'));
rlStatsApi.on('error', err => {
  if (err.code !== 'ECONNREFUSED') sendLog(`Stats API: ${err.message}`, 'warn');
});
rlStatsApi.on('*', onStatsApiEvent);
