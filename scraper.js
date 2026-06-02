'use strict';

/**
 * scraper.js — tracker.gg Puppeteer scraper v2.0
 *
 * Changes from v1:
 *  - scrapeProfile() now returns { modes, prevSeason1, prevSeason2 }
 *  - Previous season data is scraped once per session in the background
 *    by reading the current season and calling /segments/playlist?season=<id>.
 */

const puppeteer          = require('puppeteer-extra');
const StealthPlugin      = require('puppeteer-extra-plugin-stealth');
const { executablePath } = require('puppeteer');
puppeteer.use(StealthPlugin());


// ── Mode data extractor ───────────────────────────────────────────────────────

/**
 * Extracts a mode object from a tracker.gg API segment.
 * Works for both current-season ('playlist' type) and historical segments.
 * Returns null if the segment lacks a playlistId or MMR value.
 */
function extractModeData(seg) {
  const rawId = seg.attributes && seg.attributes.playlistId;
  if (rawId == null) return null;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) return null;

  const mmr = seg.stats && seg.stats.rating && seg.stats.rating.value != null
    ? seg.stats.rating.value : null;
  if (mmr === null) return null;

  const name     = (seg.metadata && seg.metadata.name) || `Modo ${id}`;
  const tierName = (seg.stats && seg.stats.tier && seg.stats.tier.metadata && seg.stats.tier.metadata.name) || 'Sin rango';
  const divName  = (seg.stats && seg.stats.division && seg.stats.division.metadata && seg.stats.division.metadata.name) || null;
  const rank     = (divName && tierName !== 'Supersonic Legend') ? `${tierName} - ${divName}` : tierName;
  const iconUrl  = (seg.stats && seg.stats.tier && seg.stats.tier.metadata && seg.stats.tier.metadata.iconUrl) || null;

  return { id, name, mmr: Math.round(mmr), rank, iconUrl };
}

/**
 * Parses current-season segments (only type === 'playlist').
 * Returns array or null.
 */
function parseSegments(segments) {
  const modes = [];
  for (const seg of segments) {
    if (seg.type !== 'playlist') continue;
    const m = extractModeData(seg);
    if (m) modes.push(m);
  }
  return modes.length > 0 ? modes : null;
}

/**
 * Parses any segments that have a playlistId + MMR (used for historical seasons).
 * Returns array or null.
 */
function parseSeasonSegments(segments) {
  const modes = [];
  for (const seg of segments) {
    const m = extractModeData(seg);
    if (m) modes.push(m);
  }
  return modes.length > 0 ? modes : null;
}

// ── Browser singleton ─────────────────────────────────────────────────────────

let browser = null;

async function getBrowser() {
  if (browser && browser.connected) return browser;

  console.log('[INFO] Iniciando navegador Puppeteer (stealth)...');
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: executablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
    ],
  });

  browser.on('disconnected', () => {
    console.warn('[WARN] Navegador cerrado inesperadamente. Se reiniciara en el proximo ciclo.');
    browser = null;
  });

  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiProfileUrl(platform, username) {
  return `https://api.tracker.gg/api/v2/rocket-league/standard/profile/${platform}/${encodeURIComponent(username)}`;
}

function extractSegmentsFromPayload(json) {
  if (Array.isArray(json?.data?.segments)) return json.data.segments;
  if (Array.isArray(json?.data)) return json.data;
  return null;
}

function detectCurrentSeason(segments) {
  const seasons = (segments || [])
    .map(seg => seg?.attributes?.season ?? seg?.attributes?.seasonId)
    .map(season => parseInt(season, 10))
    .filter(season => !isNaN(season));

  return seasons.length > 0 ? Math.max(...seasons) : null;
}

async function fetchTrackerJson(page, url) {
  const result = await page.evaluate(async (targetUrl) => {
    const res = await fetch(targetUrl, { cache: 'no-store' });
    const text = await res.text();

    try {
      return { ok: res.ok, status: res.status, json: JSON.parse(text) };
    } catch {
      return { ok: res.ok, status: res.status, json: null, text: text.slice(0, 200) };
    }
  }, url);

  if (!result.ok) throw new Error(`Tracker API respondio HTTP ${result.status}`);
  if (!result.json) throw new Error('Tracker API no devolvio JSON valido.');

  return result.json;
}

// ── Current-season scrape ─────────────────────────────────────────────────────

async function scrapeCurrentSeason(platform, username) {
  const pageUrl    = `https://rocketleague.tracker.network/rocket-league/profile/${platform}/${username}/overview`;
  const apiPattern = /api\.tracker\.gg\/api\/v2\/rocket-league\/standard\/profile\//i;

  const br   = await getBrowser();
  const page = await br.newPage();

  try {
    // Avoid detection
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 768 });

    // Set up response interception BEFORE navigation
    let apiData = null;
    const apiPromise = new Promise((resolve) => {
      page.on('response', async (res) => {
        if (apiData) return; // already captured
        if (!apiPattern.test(res.url())) return;
        // Only the profile endpoint (not sessions/matches)
        if (res.url().includes('/sessions') || res.url().includes('/matches')) return;
        try {
          const json = await res.json();
          if (json && json.data && Array.isArray(json.data.segments)) {
            apiData = json.data.segments;
            resolve(apiData);
          }
        } catch { /* not JSON or wrong shape */ }
      });
    });

    await randomDelay(500, 1500);

    // Navigate — the page will fire the API call automatically
    const navResponse = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const status = navResponse && navResponse.status();
    if (status === 404) throw new Error('Perfil no encontrado (404). Verifica platform y username.');
    if (status === 403) throw new Error('Acceso bloqueado por el sitio (403).');
    if (status && status >= 400) throw new Error(`Sitio respondio HTTP ${status}`);

    // Wait up to 20 seconds for the API response to be intercepted
    const segments = await Promise.race([
      apiPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout esperando respuesta de API (20s)')), 20000)
      ),
    ]);

    const parsed = parseSegments(segments);
    if (!parsed) {
      throw new Error('Segmentos recibidos pero ninguno tiene datos de MMR válidos.');
    }

    console.log('[INFO] Datos de temporada actual extraidos via intercepcion de red.');
    return parsed;

  } finally {
    await page.close().catch(() => {});
  }
}


// ── Previous-seasons scrape (background, one-time per session) ────────────────

let prevSeasonCache = { prev1: null, prev2: null, fetched: false };

async function scrapePreviousSeasonsDirect(platform, username) {
  const overviewUrl = `https://rocketleague.tracker.network/rocket-league/profile/${platform}/${encodeURIComponent(username)}/overview`;
  const apiBase = apiProfileUrl(platform, username);

  const br   = await getBrowser();
  const page = await br.newPage();

  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 768 });

    await randomDelay(500, 1000);
    if (global.sendLogToUI) global.sendLogToUI('Detectando temporada actual de tracker.gg...', 'info');

    const navResponse = await page.goto(overviewUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = navResponse && navResponse.status();
    if (status === 404) throw new Error('Perfil no encontrado (404). Verifica platform y username.');
    if (status === 403) throw new Error('Acceso bloqueado por el sitio (403).');
    if (status && status >= 400) throw new Error(`Sitio respondio HTTP ${status}`);

    const profileJson = await fetchTrackerJson(page, `${apiBase}?`);
    const currentSegments = extractSegmentsFromPayload(profileJson);
    const currentSeason = detectCurrentSeason(currentSegments);

    if (!currentSeason) {
      console.log('[INFO] No se pudo detectar la temporada actual.');
      if (global.sendLogToUI) global.sendLogToUI('No se pudo detectar la temporada actual en tracker.gg.', 'warn');
      return { prev1: null, prev2: null };
    }

    const targetSeasons = [currentSeason - 1, currentSeason - 2];
    const captured = {};

    if (global.sendLogToUI) {
      global.sendLogToUI(`Temporada actual detectada: ${currentSeason}. Buscando ${targetSeasons.join(' y ')}...`, 'info');
    }

    for (const seasonKey of targetSeasons) {
      await randomDelay(400, 900);
      const json = await fetchTrackerJson(page, `${apiBase}/segments/playlist?season=${seasonKey}`);
      const segments = extractSegmentsFromPayload(json);
      const modes = Array.isArray(segments) ? parseSeasonSegments(segments) : null;

      if (modes && modes.length > 0) {
        captured[String(seasonKey)] = modes;
        const msg = `Temporada ${seasonKey} capturada (${modes.length} modos).`;
        if (global.sendLogToUI) global.sendLogToUI(msg, 'info');
        console.log(`[INFO] ${msg}`);
      } else {
        const msg = `Temporada ${seasonKey} no devolvio modos con MMR.`;
        if (global.sendLogToUI) global.sendLogToUI(msg, 'warn');
        console.log(`[INFO] ${msg}`);
      }
    }

    return {
      prev1: captured[String(targetSeasons[0])] || null,
      prev2: captured[String(targetSeasons[1])] || null,
    };

  } catch (err) {
    console.warn('[WARN] scrapePreviousSeasons fallo:', err.message);
    return { prev1: null, prev2: null };
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapePreviousSeasons(platform, username) {
  // tracker.gg seasons page — the React router loads this as a tab,
  // and the page fires API calls with ?season=<id> query params.
  const seasonsUrl = `https://rocketleague.tracker.network/rocket-league/profile/${platform}/${username}/seasons`;
  const apiPattern = /api\.tracker\.gg\/api\/v2\/rocket-league\/standard\/profile\//i;

  const br   = await getBrowser();
  const page = await br.newPage();

  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 768 });

    const captured = {}; // { [seasonKey]: modes[] }

    page.on('response', async (res) => {
      const url = res.url();
      if (!apiPattern.test(url)) return;
      if (url.includes('/sessions') || url.includes('/matches')) return;
      try {
        const json = await res.json();
        // tracker.gg standard profile data is usually in json.data
        // For segments, it's optionally under data.segments or just data
        const segments = json?.data?.segments || (Array.isArray(json?.data) ? json.data : null);

        if (Array.isArray(segments)) {
          let seasonKey = null;

          // 1. Try URL search params
          try {
            const u = new URL(url);
            seasonKey = u.searchParams.get('season') || u.searchParams.get('seasonId');
          } catch {}

          // 2. Try to extract from metadata/attributes in the JSON
          // Some responses have it in metadata.season (current) or attributes.seasonId (historical)
          if (!seasonKey) {
            const metaSeason = json?.data?.metadata?.season; 
            if (metaSeason != null) seasonKey = String(metaSeason);
          }

          if (!seasonKey) {
            const segWithSeason = segments.find(s => s.attributes && s.attributes.seasonId);
            if (segWithSeason) seasonKey = String(segWithSeason.attributes.seasonId);
          }

          if (seasonKey) {
            const modes = parseSeasonSegments(segments);
            if (modes && modes.length > 0) {
              // Only overwrite if we haven't captured this season or if we get more data
              if (!captured[seasonKey] || modes.length >= captured[seasonKey].length) {
                captured[seasonKey] = modes;
                const msg = `Temporada ${seasonKey} capturada (${modes.length} modos).`;
                if (global.sendLogToUI) global.sendLogToUI(msg, 'info');
                console.log(`[INFO] ${msg}`);
              }
            }
          }
        }
      } catch (e) {}
    });

    await randomDelay(500, 1000);
    if (global.sendLogToUI) global.sendLogToUI('Navegando a la sección de temporadas...', 'info');
    
    const navResponse = await page.goto(seasonsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Check if we were redirected back to overview (common if seasons tab fails)
    const currentUrl = page.url();
    if (currentUrl.includes('/overview') && !seasonsUrl.includes('/overview')) {
      if (global.sendLogToUI) global.sendLogToUI('Redirigido a Overview, reintentando acceso a temporadas...', 'warn');
      await page.goto(seasonsUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    }

    // High-latency waits and explicit clicks if needed
    await new Promise(r => setTimeout(r, 5000));
    
    // Scroll multiple times to trigger all historical API calls
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await new Promise(r => setTimeout(r, 2000));
    }
    await page.evaluate(() => window.scrollTo(0, 0));

    // Wait for the page's async API calls to finish processing
    await new Promise(r => setTimeout(r, 10000));

    // Sort season keys — numeric descending
    const keys = Object.keys(captured)
      .map(k => parseInt(k, 10))
      .filter(k => !isNaN(k))
      .sort((a, b) => b - a);

    if (keys.length > 0) {
      console.log(`[INFO] Temporadas encontradas: ${keys.join(', ')}`);
      if (global.sendLogToUI) {
        global.sendLogToUI(`Historial: Se detectaron las temporadas ${keys.join(', ')}.`, 'info');
        if (keys.length > 1) {
          global.sendLogToUI(`Asignando Temporada ${keys[1]} a "Anterior" y ${keys[2] || '?' } a "Hace 2 temporadas".`, 'success');
        }
      }
    } else {
      console.log('[INFO] No se encontraron datos de temporadas anteriores.');
      if (global.sendLogToUI) global.sendLogToUI('No se detectaron temporadas en el historial de tracker.gg.', 'warn');
    }

    // Assining prev1 (last season) and prev2 (two seasons ago)
    return {
      prev1: (keys[1] != null) ? captured[String(keys[1])] : null,
      prev2: (keys[2] != null) ? captured[String(keys[2])] : null,
    };

  } catch (err) {
    console.warn('[WARN] scrapePreviousSeasons fallo:', err.message);
    return { prev1: null, prev2: null };
  } finally {
    await page.close().catch(() => {});
  }
}


// ── Public API ────────────────────────────────────────────────────────────────

/**
 * scrapeProfile — scrapes current season data and returns previous season data
 * from the in-memory cache (populated asynchronously in the background).
 *
 * Returns: { modes: [...], prevSeason1: [...] | null, prevSeason2: [...] | null }
 */
async function scrapeProfile(platform, username) {
  const modes = await scrapeCurrentSeason(platform, username);

  // Kick off the previous-seasons scrape once per session (non-blocking)
  if (!prevSeasonCache.fetched) {
    prevSeasonCache.fetched = true; // prevent duplicate concurrent calls
    if (global.sendLogToUI) global.sendLogToUI('Iniciando descarga de temporadas anteriores...', 'info');
    scrapePreviousSeasonsDirect(platform, username)
      .then(seasons => {
        prevSeasonCache = { ...seasons, fetched: true };
        if (global.sendLogToUI) global.sendLogToUI('Datos de temporadas anteriores cargados con éxito.', 'success');
        // Notify main process to update UI/OBS
        if (typeof process.onUpdateSeasons === 'function') {
          process.onUpdateSeasons(prevSeasonCache);
        }
      })
      .catch((err) => {
        if (global.sendLogToUI) global.sendLogToUI(`No se pudieron cargar las temporadas anteriores: ${err.message}`, 'error');
        prevSeasonCache.fetched = false; // allow retry
      });
  }

  return {
    modes,
    prevSeason1: prevSeasonCache.prev1,
    prevSeason2: prevSeasonCache.prev2,
  };
}

/** Resets the previous-season cache (e.g. on tracker restart). */
function resetPrevSeasonCache() {
  prevSeasonCache = { prev1: null, prev2: null, fetched: false };
}

module.exports = { scrapeProfile, closeBrowser, resetPrevSeasonCache };
