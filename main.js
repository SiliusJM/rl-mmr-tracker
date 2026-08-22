'use strict';

/**
 * main.js — Electron main process
 *
 * Polling is intentionally lightweight: scraper.js keeps a warm page and
 * calls tracker.gg directly instead of navigating the web page every cycle.
 *
 * Fast mode: rlStatsApi.js listens to Rocket League's local Stats API. When a
 * match-end event is received, the tracker performs short-interval retries
 * (2s, 4s, 7s, 12s, 20s) until the published MMR changes.
 */

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

  if (format === 'modes' || format === 'both') {
    parts.push(...selected.map(m => `${m.name}: ${m.rank} (${m.mmr})`));
  }

  if ((format === 'stats' || format === 'both') && careerStats && showStats && statsToShow.length > 0) {
    const statsMap = {
      goals: `⚽ ${careerStats.goals} Goles`,
      shots: `🎯 ${careerStats.shots} Tiros`,
      saves: `🛡️ ${careerStats.saves} Salvadas`,
      assists: `🤝 ${careerStats.assists} Asistencias`,
      mvps: `⭐ ${careerStats.mvps} MVPs`,
      wins: `🏆 ${careerStats.wins} Ganados`,
    };
    parts.push(...statsToShow.filter(k => statsMap[k]).map(k => statsMap[k]));
  }

  if (showRecord) parts.push(`📊 Hoy: ${session.wins} Ganados - ${session.losses} Perdidos`);
  return parts.join(' | ');
}

const DEFAULT_CFG = {
  platform: 'epic', username: '',
  streamElementsToken: '', channelId: '',
  commandName: 'rango',
  pollInterval: 10000,
  selectedModeIds: [10, 11, 13, 28],
  showRecord: true,
  obsPort: 3030,
  obsEnabled: true,
  showPrevSeason1: true,
  showPrevSeason2: false,
  twitchCommandFormat: 'modes',
  twitchShowStats: false,
  twitchStatsToShow: [],
  fastPollEnabled: true,
  fastPollDelays: [2000, 4000, 7000, 12000, 20000],
  rlStatsApiHost: '127.0.0.1',
  rlStatsApiPort: 49123,
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

async function applyLiveConfig(cfg) {
  if (!lastData) return { applied: false };
  const selectedIds = cfg.selectedModeIds || [10, 11, 13, 28];
  const showRecord = cfg.showRecord !== false;

  lastData = {
    ...lastData,
    selectedModeIds: selectedIds,
    showRecord,
    showPrevSeason1: cfg.showPrevSeason1 !== false,
    showPrevSeason2: cfg.showPrevSeason2 === true,
  };

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
let lastData = null;
let lastPublishedResponse = null;
let lastMatchEndAt = 0;
let fastPollInProgress = false;

(function initLastDataFromCache() {
  const cached = loadModesCache();
  if (cached && cached.length > 0) {
    const cfg = loadConfig();
    lastData = {
      modes: cached,
      prevSeason1: null,
      prevSeason2: null,
      session: { wins: 0, losses: 0 },
      selectedModeIds: cfg.selectedModeIds || [10, 11, 13, 28],
      showRecord: cfg.showRecord !== false,
      showPrevSeason1: cfg.showPrevSeason1 !== false,
      showPrevSeason2: cfg.showPrevSeason2 === true,
    };
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
  const cfg = loadConfig();
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
  if (fastPollTimer) {
    clearTimeout(fastPollTimer);
    fastPollTimer = null;
  }
  fastPollInProgress = false;
}

function scheduleFastPoll(delayMs, generation) {
  if (!isTracking || generation !== fastPollGeneration) return;
  if (fastPollTimer) clearTimeout(fastPollTimer);

  fastPollTimer = setTimeout(async () => {
    fastPollTimer = null;
    if (!isTracking || generation !== fastPollGeneration) return;
    await poll(loadConfig(), { reason: 'match-end-fast', generation });
  }, delayMs);
}

function startFastPoll(reason = 'match-end') {
  if (!isTracking) return;
  const cfg = loadConfig();
  if (cfg.fastPollEnabled === false) return;

  const now = Date.now();
  // Prevent duplicate bursts from multiple Stats API lifecycle events.
  if (now - lastMatchEndAt < 15000) return;
  lastMatchEndAt = now;

  cancelFastPoll();
  fastPollInProgress = true;
  const generation = fastPollGeneration;
  const delays = Array.isArray(cfg.fastPollDelays) && cfg.fastPollDelays.length
    ? cfg.fastPollDelays.map(Number).filter(n => Number.isFinite(n) && n >= 0)
    : [2000, 4000, 7000, 12000, 20000];

  sendLog(`🏁 Fin de partida detectado. Activando actualización rápida (${delays.map(d => d / 1000).join('/')}s)...`, 'success');
  scheduleFastPoll(delays[0] || 0, generation);
}

function onStatsApiEvent({ event, data }) {
  const normalized = String(event || '').toLowerCase().replace(/[\s-]+/g, '_');

  // Match lifecycle names used by Stats API/client builds. We intentionally
  // require both a match/game keyword and an end/finish keyword to avoid
  // triggering on kickoff, goals, joins, or other normal events.
  const isMatchEnd = (
    /(?:match|game|playlist).*?(?:ended|end|finished|finish|complete|completed)/i.test(normalized) ||
    /(?:ended|end|finished|finish|complete|completed).*?(?:match|game|playlist)/i.test(normalized)
  );

  if (!isMatchEnd) return;
  startFastPoll('stats-api');
}

ipcMain.handle('load-config', () => loadConfig());

ipcMain.handle('save-config', async (_e, cfg) => {
  const oldCfg = loadConfig();
  saveConfig(cfg);

  const newPort = cfg.obsPort || 3030;
  const oldPort = oldCfg.obsPort || 3030;
  if (cfg.obsEnabled !== false) {
    if (newPort !== oldPort || !obsServer.isRunning()) {
      await obsServer.stop();
      await obsServer.start(newPort).catch(err => console.warn('[WARN] No se pudo reiniciar el servidor OBS:', err.message));
      if (lastData) obsServer.setData(lastData);
    }
  } else if (obsServer.isRunning()) {
    await obsServer.stop();
  }

  await applyLiveConfig(cfg);
  return true;
});

ipcMain.handle('test-connection', async (_e, { channelId, streamElementsToken, commandName }) =>
  testStreamElementsConnection(channelId, commandName, streamElementsToken)
);

ipcMain.handle('start-tracker', async () => {
  if (isTracking) return true;
  isTracking = true;
  const cfg = loadConfig();

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

  // Stats API is optional. If Rocket League is closed or the API is disabled,
  // the normal 10s polling continues without breaking the tracker.
  if (cfg.fastPollEnabled !== false) {
    rlStatsApi.start({
      host: cfg.rlStatsApiHost || '127.0.0.1',
      port: cfg.rlStatsApiPort || 49123,
    });
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
  try {
    if (meta.reason === 'match-end-fast') {
      sendLog(`⚡ Consulta rápida de Tracker.gg (${meta.generation === fastPollGeneration ? 'post-partida' : 'normal'})...`, 'info');
    } else {
      sendLog('Consultando tracker.gg...', 'info');
    }

    const scraped = await scrapeProfile(cfg.platform, cfg.username);
    const modes = scraped.modes;
    const careerStats = scraped.careerStats;
    const sessionData = updateSession(modes);

    if (sessionData.events?.length) {
      for (const ev of sessionData.events) sendLog(ev.msg, ev.type);
    }

    const selectedIds = cfg.selectedModeIds || [10, 11, 13, 28];
    const showRecord = cfg.showRecord !== false;
    const response = buildResponse(modes, selectedIds, showRecord, sessionData, careerStats, cfg);

    saveModesCache(modes);
    lastData = {
      modes, careerStats,
      prevSeason1: scraped.prevSeason1,
      prevSeason2: scraped.prevSeason2,
      session: sessionData,
      selectedModeIds: selectedIds,
      showRecord,
      showPrevSeason1: cfg.showPrevSeason1 !== false,
      showPrevSeason2: cfg.showPrevSeason2 === true,
    };

    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('data-update', lastData);
    obsServer.setData(lastData);

    const changed = response !== lastPublishedResponse;
    if (changed) {
      sendLog(response, 'update');
      const seOk = await updateCommand(cfg.channelId, cfg.commandName, cfg.streamElementsToken, response);
      sendLog(seOk ? 'Comando actualizado en StreamElements.' : 'No se pudo actualizar StreamElements.', seOk ? 'success' : 'warn');
      if (seOk) lastPublishedResponse = response;

      // A changed MMR/session result means the post-match burst succeeded.
      if (meta.reason === 'match-end-fast') {
        fastPollInProgress = false;
        if (fastPollTimer) { clearTimeout(fastPollTimer); fastPollTimer = null; }
        sendLog('⚡ MMR nuevo detectado. Actualización rápida completada.', 'success');
      }
    } else if (meta.reason === 'match-end-fast') {
      const delays = Array.isArray(cfg.fastPollDelays) && cfg.fastPollDelays.length
        ? cfg.fastPollDelays.map(Number).filter(n => Number.isFinite(n) && n >= 0)
        : [2000, 4000, 7000, 12000, 20000];
      const currentIndex = delays.findIndex(d => d >= 0 && d >= (meta.elapsedMs || 0));
      const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 1;
      const nextDelay = delays[nextIndex];

      if (nextDelay != null && meta.generation === fastPollGeneration) {
        sendLog(`⏳ Tracker.gg aún no refleja el resultado. Reintentando en ${nextDelay / 1000}s...`, 'info');
        // Preserve generation and track elapsed time from this burst.
        const elapsed = Number(meta.elapsedMs) || 0;
        scheduleFastPoll(nextDelay, meta.generation);
        fastPollTimer._rlElapsedMs = elapsed + nextDelay;
      } else {
        fastPollInProgress = false;
        sendLog('Fin de actualización rápida: Tracker.gg todavía no publicó un MMR nuevo.', 'warn');
      }
    } else {
      sendLog('Sin cambios en MMR/estadísticas.', 'info');
    }
  } catch (err) {
    sendLog(err.message, 'error');
    if (meta.reason === 'match-end-fast') {
      fastPollInProgress = false;
    }
  }

  if (isTracking && meta.reason !== 'match-end-fast') {
    const interval = Math.min(Math.max(Number(loadConfig().pollInterval) || 10000, 5000), 30000);
    sendLog(`Próxima actualización en ${interval / 1000}s.`, 'info');
    pollTimer = setTimeout(() => poll(loadConfig(), { reason: 'normal' }), interval);
  }
}

// Wire the listener once at module initialization.
rlStatsApi.on('connected', () => sendLog('Rocket League Stats API conectada. Detección de fin de partida activa.', 'success'));
rlStatsApi.on('error', err => {
  if (err.code !== 'ECONNREFUSED') sendLog(`Stats API: ${err.message}`, 'warn');
});
rlStatsApi.on('*', onStatsApiEvent);
