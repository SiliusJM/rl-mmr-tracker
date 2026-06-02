'use strict';

/**
 * main.js — Electron main process
 *
 * Scraping strategy: Electron's own built-in Chromium via BrowserWindow + CDP
 * (Chrome DevTools Protocol). No external Chromium download required.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path   = require('path');
const fs     = require('fs');

// ── Single-instance lock ─────────────────────────────────────────────────────
// Prevents multiple Electron windows from running at the same time.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
const { updateCommand, testStreamElementsConnection } = require('./streamElements');
const { updateSession }                               = require('./sessionTracker');
const { scrapeProfile, closeBrowser, resetPrevSeasonCache } = require('./scraper');
const obsServer                                       = require('./obs-server');

// Bridge to update renderer when background seasons are ready
process.onUpdateSeasons = (seasons) => {
  if (lastData) {
    lastData.prevSeason1 = seasons.prev1;
    lastData.prevSeason2 = seasons.prev2;
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('data-update', lastData);
    }
    obsServer.setData(lastData);
  }
};

// ── Modes cache ───────────────────────────────────────────────────────────────
// Persists the list of modes to disk so Settings can show checkboxes even before
// the tracker is started.

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

// ── Response builder ──────────────────────────────────────────────────────────

function buildResponse(modes, selectedIds, showRecord, session) {
  const selected = modes.filter(m => selectedIds.includes(m.id));
  const parts    = selected.map(m => `${m.name}: ${m.rank} (${m.mmr})`);
  const record   = showRecord
    ? `📊 Hoy: ${session.wins} Ganados - ${session.losses} Perdidos`
    : null;
  return ['🚀', ...parts, ...(record ? [record] : [])].join(' | ');
}

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_CFG = {
  platform: 'epic', username: '',
  streamElementsToken: '', channelId: '',
  commandName: 'rango', pollInterval: 60000,
  selectedModeIds: [10, 11, 13, 28],
  showRecord: true,
  obsPort: 3030,
  obsEnabled: true,
  showPrevSeason1: true,
  showPrevSeason2: false,
};

function configPath() {
  return path.join(__dirname, 'config.json');
}

function loadConfig() {
  try {
    const p = configPath();
    if (fs.existsSync(p)) return { ...DEFAULT_CFG, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {}
  return { ...DEFAULT_CFG };
}

function saveConfig(cfg) {
  // Write ALL fields (including selectedModeIds and showRecord) to a single config.json.
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

async function applyLiveConfig(cfg) {
  if (!lastData) return { applied: false };

  const selectedIds = cfg.selectedModeIds || [10, 11, 13, 28];
  const showRecord  = cfg.showRecord !== false;

  lastData = {
    ...lastData,
    selectedModeIds: selectedIds,
    showRecord,
    showPrevSeason1: cfg.showPrevSeason1 !== false,
    showPrevSeason2: cfg.showPrevSeason2 === true,
  };

  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('data-update', lastData);
  }
  obsServer.setData(lastData);

  if (isTracking && cfg.channelId && cfg.streamElementsToken && lastData.modes) {
    const response = buildResponse(lastData.modes, selectedIds, showRecord, lastData.session || { wins: 0, losses: 0 });
    const ok = await updateCommand(cfg.channelId, cfg.commandName, cfg.streamElementsToken, response);
    sendLog(ok ? 'Cambios aplicados al instante.' : 'Cambios aplicados localmente; no se pudo actualizar StreamElements.', ok ? 'success' : 'warn');
  }

  return { applied: true };
}

// ── Scraping delegado a scraper.js (puppeteer-extra + stealth) ───────────────
// scrapeProfile(platform, username) y closeBrowser() importados arriba.


// ── Main window ───────────────────────────────────────────────────────────────

let mainWin;
let isTracking = false;
let pollTimer  = null;
let lastData   = null;   // last successful poll result, for fresh renderer loads

// Pre-populate lastData from cache so Settings checkboxes are available immediately
(function initLastDataFromCache() {
  const cached = loadModesCache();
  if (cached && cached.length > 0) {
    const cfg = loadConfig();
    lastData = {
      modes:           cached,
      prevSeason1:     null,
      prevSeason2:     null,
      session:         { wins: 0, losses: 0 },
      selectedModeIds: cfg.selectedModeIds || [10, 11, 13, 28],
      showRecord:      cfg.showRecord !== false,
      showPrevSeason1: cfg.showPrevSeason1 !== false,
      showPrevSeason2: cfg.showPrevSeason2 === true,
    };
  }
}());

function createWindow() {
  mainWin = new BrowserWindow({
    width: 920, height: 680,
    minWidth: 700, minHeight: 540,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: '🚀 RL MMR Tracker',
    backgroundColor: '#0d0d1a',
    show: false,
  });

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.setMenuBarVisibility(false);
  mainWin.once('ready-to-show', () => mainWin.show());
  // Resend last data to renderer if tracker was already running when window loads
  mainWin.webContents.on('did-finish-load', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('tracker-state', { running: isTracking });
      if (isTracking && lastData) mainWin.webContents.send('data-update', lastData);
    }
  });

  mainWin.on('closed', () => {
    isTracking = false;
    if (pollTimer) clearTimeout(pollTimer);
    closeBrowser().catch(() => {});
    mainWin = null;
  });
}

app.whenReady().then(async () => {
  // Start OBS overlay server
  const cfg = loadConfig();
  if (cfg.obsEnabled !== false) {
    await obsServer.start(cfg.obsPort || 3030).catch(err =>
      console.warn('[WARN] No se pudo iniciar el servidor OBS:', err.message)
    );
    if (lastData) obsServer.setData(lastData);
  }
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── IPC helpers ───────────────────────────────────────────────────────────────

function sendLog(msg, type = 'info') {
  if (mainWin && !mainWin.isDestroyed())
    mainWin.webContents.send('log', { msg, type, time: new Date().toLocaleTimeString() });
  console.log(`[${type.toUpperCase()}] ${msg}`);
}

// Global reference for the scraper to send logs to the UI
global.sendLogToUI = sendLog;

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('load-config', () => loadConfig());

ipcMain.handle('save-config', async (_e, cfg) => {
  const oldCfg = loadConfig();
  saveConfig(cfg);

  // Restart OBS server if port changed or toggled on
  const newPort = cfg.obsPort || 3030;
  const oldPort = oldCfg.obsPort || 3030;
  if (cfg.obsEnabled !== false) {
    if (newPort !== oldPort || !obsServer.isRunning()) {
      await obsServer.stop();
      await obsServer.start(newPort).catch(err =>
        console.warn('[WARN] No se pudo reiniciar el servidor OBS:', err.message)
      );
      if (lastData) obsServer.setData(lastData);
    }
  } else if (cfg.obsEnabled === false && obsServer.isRunning()) {
    await obsServer.stop();
  }

  await applyLiveConfig(cfg);

  return true;
});

ipcMain.handle('test-connection', async (_e, { channelId, streamElementsToken, commandName }) => {
  return testStreamElementsConnection(channelId, commandName, streamElementsToken);
});

ipcMain.handle('start-tracker', async () => {
  if (isTracking) return true;
  isTracking = true; // set immediately to prevent race condition on concurrent calls
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
  resetPrevSeasonCache(); // fresh start — re-scrape previous seasons
  poll(cfg);
  return true;
});

ipcMain.handle('get-status',       () => ({ running: isTracking, data: lastData }));
ipcMain.handle('get-modes-cache',  () => loadModesCache());
ipcMain.handle('get-obs-info',     () => ({
  port:    obsServer.getPort() || (loadConfig().obsPort || 3030),
  running: obsServer.isRunning(),
}));

ipcMain.handle('force-poll', () => {
  if (!isTracking) return false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  setImmediate(() => poll(loadConfig()));
  return true;
});

ipcMain.handle('stop-tracker', () => {
  isTracking = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  closeBrowser().catch(() => {});
  sendLog('Tracker detenido.', 'info');
  if (mainWin) mainWin.webContents.send('tracker-state', { running: false });
  return true;
});

// ── Poll loop ─────────────────────────────────────────────────────────────────

async function poll(cfg) {
  if (!isTracking) return;
  try {
    sendLog('Consultando tracker.gg...', 'info');
    const scraped      = await scrapeProfile(cfg.platform, cfg.username);
    const modes        = scraped.modes;
    const sessionData  = updateSession(modes);

    // Log detected events (wins/losses)
    if (sessionData.events && sessionData.events.length > 0) {
      for (const ev of sessionData.events) sendLog(ev.msg, ev.type);
    }

    const selectedIds  = cfg.selectedModeIds || [10, 11, 13, 28];
    const showRecord   = cfg.showRecord !== false;
    const response     = buildResponse(modes, selectedIds, showRecord, sessionData);

    sendLog(response, 'update');
    saveModesCache(modes);
    lastData = {
      modes,
      prevSeason1:     scraped.prevSeason1,
      prevSeason2:     scraped.prevSeason2,
      session:         sessionData,
      selectedModeIds: selectedIds,
      showRecord,
      showPrevSeason1: cfg.showPrevSeason1 !== false,
      showPrevSeason2: cfg.showPrevSeason2 === true,
    };
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('data-update', lastData);
    }
    obsServer.setData(lastData);

    const seOk = await updateCommand(cfg.channelId, cfg.commandName, cfg.streamElementsToken, response);
    sendLog(seOk ? 'Comando actualizado en StreamElements.' : 'No se pudo actualizar StreamElements.', seOk ? 'success' : 'warn');

  } catch (err) {
    sendLog(err.message, 'error');
  }

  if (isTracking) {
    const interval = Math.max((loadConfig().pollInterval || 60000), 30000);
    sendLog(`Próxima actualización en ${interval / 1000}s.`, 'info');
    pollTimer = setTimeout(() => poll(loadConfig()), interval);
  }
}
