'use strict';

/**
 * index.js — Rocket League MMR Tracker v5.0 (Puppeteer Edition)
 */

const { scrapeProfile, closeBrowser }                 = require('./scraper');
const { updateSession, getSession }                   = require('./sessionTracker');
const { updateCommand, testStreamElementsConnection } = require('./streamElements');

// ── Load & validate config ────────────────────────────────────────────────────
let config;
try {
  config = require('./config.json');
} catch (err) {
  console.error('[ERROR] No se pudo cargar config.json:', err.message);
  process.exit(1);
}

const {
  platform,
  username,
  streamElementsToken,
  channelId,
  commandName,
  pollInterval,
} = config;

const REQUIRED = { platform, username, streamElementsToken, channelId, commandName };
for (const [key, val] of Object.entries(REQUIRED)) {
  if (!val || String(val).startsWith('TU_') || String(val).startsWith('YOUR_')) {
    console.error(`[ERROR] Falta configurar "${key}" en config.json`);
    process.exit(1);
  }
}

const INTERVAL   = pollInterval || 60000; // default 60s (Puppeteer is slower)
const MIN_UPDATE = 15_000;

// ── State ─────────────────────────────────────────────────────────────────────
let previousState  = null;
let lastUpdateTime = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildResponse(data, session) {
  const fmt = (label, mode) => {
    const d = data[mode];
    if (!d) return `${label}: Sin datos`;
    return `${label}: ${d.rank} (${d.mmr})`;
  };

  return [
    '🚀 Rango actual',
    fmt('2v2', '2v2'),
    fmt('3v3', '3v3'),
    fmt('Rumble', 'rumble'),
    `📊 Partidos de hoy: ${session.wins} Ganados - Perdidos ${session.losses}`,
  ].join(' | ');
}

function hasStateChanged(data, session) {
  if (!previousState) return true;

  const mmrChanged =
    previousState['2v2']?.mmr    !== data['2v2']?.mmr    ||
    previousState['3v3']?.mmr    !== data['3v3']?.mmr    ||
    previousState['rumble']?.mmr !== data['rumble']?.mmr;

  const sessionChanged =
    previousState.wins   !== session.wins ||
    previousState.losses !== session.losses;

  return mmrChanged || sessionChanged;
}

// ── Poll cycle ────────────────────────────────────────────────────────────────

async function poll() {
  let data;
  try {
    data = await scrapeProfile(platform, username);
  } catch (err) {
    console.error('[ERROR] Scraper:', err.message);
    return;
  }

  updateSession(data);
  const session = getSession();

  if (!hasStateChanged(data, session)) return;

  const now = Date.now();
  if (now - lastUpdateTime < MIN_UPDATE) return;

  const response = buildResponse(data, session);
  console.log(`[UPDATE] ${response}`);

  try {
    const ok = await updateCommand(channelId, commandName, streamElementsToken, response);
    if (ok) {
      previousState = {
        '2v2':    data['2v2']    ? { ...data['2v2'] }    : null,
        '3v3':    data['3v3']    ? { ...data['3v3'] }    : null,
        'rumble': data['rumble'] ? { ...data['rumble'] } : null,
        wins:     session.wins,
        losses:   session.losses,
      };
      lastUpdateTime = now;
      console.log(`[INFO] Sesión: ${session.wins}W-${session.losses}L`);
    }
  } catch (err) {
    console.error('[ERROR] StreamElements:', err.message);
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('==============================================');
  console.log('  🚀  Rocket League MMR Tracker  v5.0.0');
  console.log('       Puppeteer Edition');
  console.log('==============================================');
  console.log(`[INFO] Plataforma : ${platform}`);
  console.log(`[INFO] Usuario    : ${username}`);
  console.log(`[INFO] Canal ID   : ${channelId}`);
  console.log(`[INFO] Comando    : !${commandName}`);
  console.log(`[INFO] Intervalo  : ${INTERVAL / 1000}s`);
  console.log('');

  const connected = await testStreamElementsConnection(
    channelId,
    commandName,
    streamElementsToken
  );

  if (!connected) {
    console.error('[ERROR] No se pudo conectar con StreamElements.');
    process.exit(1);
  }

  console.log('');
  console.log('[INFO] Iniciando loop con Puppeteer...');
  console.log('[INFO] La primera carga tarda ~10-20 segundos (abriendo navegador).');
  console.log('[INFO] Ctrl+C para detener.\n');

  await poll();
  setInterval(async () => {
    try {
      await poll();
    } catch (err) {
      console.error('[ERROR] Error inesperado en ciclo:', err.message);
    }
  }, INTERVAL);
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[INFO] ${signal} recibido. Cerrando navegador...`);
  await closeBrowser();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('[ERROR] Excepcion no capturada:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] Promesa rechazada:', reason);
});

main().catch((err) => {
  console.error('[ERROR] Error fatal al iniciar:', err.message);
  process.exit(1);
});
