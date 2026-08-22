'use strict';

/**
 * scraper.js — tracker.gg scraper optimized for frequent polling.
 *
 * Performance changes:
 *  - Reuses one browser page instead of navigating to tracker.gg every poll.
 *  - Queries tracker.gg API directly with cache-busting timestamps.
 *  - Removes the 500-1500ms random delay from normal polling.
 *  - Keeps historical seasons completely off the hot polling path.
 *  - Reuses the same page for historical-season requests.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { executablePath } = require('puppeteer');
puppeteer.use(StealthPlugin());

function extractCareerStats(seg) {
  if (!seg || seg.type !== 'overview') return null;
  const stats = seg.stats || {};
  return {
    wins: stats.wins?.value || 0,
    goals: stats.goals?.value || 0,
    mvps: stats.mVPs?.value || 0,
    saves: stats.saves?.value || 0,
    assists: stats.assists?.value || 0,
    shots: stats.shots?.value || 0,
    goalShotRatio: stats.goalShotRatio?.value || 0,
    seasonRewardLevel: stats.seasonRewardLevel?.value || 0,
    seasonRewardIcon: stats.seasonRewardLevel?.metadata?.iconUrl || null,
    seasonRewardName: stats.seasonRewardLevel?.metadata?.rankName || 'Sin rango',
  };
}

function extractModeData(seg) {
  const rawId = seg?.attributes?.playlistId;
  if (rawId == null) return null;
  const id = parseInt(rawId, 10);
  if (Number.isNaN(id)) return null;

  const mmr = seg?.stats?.rating?.value;
  if (mmr == null) return null;

  const name = seg?.metadata?.name || `Modo ${id}`;
  const tierName = seg?.stats?.tier?.metadata?.name || 'Sin rango';
  const divName = seg?.stats?.division?.metadata?.name || null;
  const rank = (divName && tierName !== 'Supersonic Legend')
    ? `${tierName} - ${divName}`
    : tierName;

  return {
    id,
    name,
    mmr: Math.round(mmr),
    rank,
    iconUrl: seg?.stats?.tier?.metadata?.iconUrl || null,
    matchesPlayed: seg?.stats?.matchesPlayed?.value || 0,
    winStreak: seg?.stats?.winStreak?.value || 0,
    winStreakType: seg?.stats?.winStreak?.metadata?.type || 'win',
    peakRating: seg?.stats?.peakRating?.value || null,
    peakRank: seg?.stats?.peakRating?.metadata?.tierName || null,
    peakIconUrl: seg?.stats?.peakRating?.metadata?.iconUrl || null,
  };
}

function parseSegments(segments) {
  const modes = [];
  let careerStats = null;

  for (const seg of segments || []) {
    if (seg?.type === 'overview') {
      careerStats = extractCareerStats(seg);
      continue;
    }
    if (seg?.type !== 'playlist') continue;
    const mode = extractModeData(seg);
    if (mode) modes.push(mode);
  }

  return { modes: modes.length ? modes : null, careerStats };
}

function parseSeasonSegments(segments) {
  const modes = [];
  for (const seg of segments || []) {
    const mode = extractModeData(seg);
    if (mode) modes.push(mode);
  }
  return modes.length ? modes : null;
}

function extractSegmentsFromPayload(json) {
  if (Array.isArray(json?.data?.segments)) return json.data.segments;
  if (Array.isArray(json?.data)) return json.data;
  return null;
}

function detectCurrentSeason(segments) {
  const seasons = (segments || [])
    .map(seg => seg?.attributes?.season ?? seg?.attributes?.seasonId)
    .map(v => parseInt(v, 10))
    .filter(v => !Number.isNaN(v));
  return seasons.length ? Math.max(...seasons) : null;
}

let browser = null;
let apiPage = null;
let pagePromise = null;

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
    browser = null;
    apiPage = null;
    pagePromise = null;
  });

  return browser;
}

async function getApiPage() {
  if (apiPage && !apiPage.isClosed()) return apiPage;
  if (pagePromise) return pagePromise;

  pagePromise = (async () => {
    const br = await getBrowser();
    const page = await br.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 768 });

    // Establish tracker.gg origin once. Subsequent polls use fetch() only.
    await page.goto('https://rocketleague.tracker.network/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch(() => {});

    apiPage = page;
    return page;
  })();

  try {
    return await pagePromise;
  } finally {
    pagePromise = null;
  }
}

async function closeBrowser() {
  apiPage = null;
  pagePromise = null;
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

function apiProfileUrl(platform, username) {
  return `https://api.tracker.gg/api/v2/rocket-league/standard/profile/${platform}/${encodeURIComponent(username)}`;
}

async function fetchTrackerJson(page, url) {
  const result = await page.evaluate(async (targetUrl) => {
    const separator = targetUrl.includes('?') ? '&' : '?';
    const cacheBustedUrl = `${targetUrl}${separator}_=${Date.now()}`;

    const res = await fetch(cacheBustedUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache, no-store, max-age=0',
        'Pragma': 'no-cache',
        'Accept': 'application/json',
      },
    });

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return {
      ok: res.ok,
      status: res.status,
      json,
      text: text.slice(0, 200),
    };
  }, url);

  if (!result.ok) throw new Error(`Tracker API respondio HTTP ${result.status}`);
  if (!result.json) throw new Error('Tracker API no devolvio JSON valido.');
  return result.json;
}

async function scrapeCurrentSeason(platform, username) {
  const page = await getApiPage();
  const apiBase = apiProfileUrl(platform, username);
  const json = await fetchTrackerJson(page, apiBase);
  const segments = extractSegmentsFromPayload(json);

  if (!segments) throw new Error('Tracker API no devolvio segmentos de perfil.');

  const parsed = parseSegments(segments);
  if (!parsed.modes) throw new Error('Tracker API devolvio segmentos sin MMR valido.');

  return { modes: parsed.modes, careerStats: parsed.careerStats };
}

let prevSeasonCache = { prev1: null, prev2: null, fetched: false };

async function scrapePreviousSeasonsDirect(platform, username) {
  const page = await getApiPage();
  const apiBase = apiProfileUrl(platform, username);

  try {
    if (global.sendLogToUI) global.sendLogToUI('Detectando temporada actual de tracker.gg...', 'info');

    const profileJson = await fetchTrackerJson(page, apiBase);
    const currentSegments = extractSegmentsFromPayload(profileJson);
    const currentSeason = detectCurrentSeason(currentSegments);

    if (!currentSeason) {
      if (global.sendLogToUI) global.sendLogToUI('No se pudo detectar la temporada actual en tracker.gg.', 'warn');
      return { prev1: null, prev2: null };
    }

    const targetSeasons = [currentSeason - 1, currentSeason - 2];
    const captured = {};

    if (global.sendLogToUI) {
      global.sendLogToUI(`Temporada actual detectada: ${currentSeason}. Buscando ${targetSeasons.join(' y ')}...`, 'info');
    }

    // Historical data is deliberately sequential and outside the hot polling path.
    for (const seasonKey of targetSeasons) {
      const json = await fetchTrackerJson(page, `${apiBase}/segments/playlist?season=${seasonKey}`);
      const segments = extractSegmentsFromPayload(json);
      const modes = Array.isArray(segments) ? parseSeasonSegments(segments) : null;

      if (modes?.length) {
        captured[String(seasonKey)] = modes;
        const msg = `Temporada ${seasonKey} capturada (${modes.length} modos).`;
        if (global.sendLogToUI) global.sendLogToUI(msg, 'info');
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
  }
}

async function scrapeProfile(platform, username) {
  // Only the current profile is awaited. Historical seasons never block a poll.
  const currentData = await scrapeCurrentSeason(platform, username);

  if (!prevSeasonCache.fetched) {
    prevSeasonCache.fetched = true;
    if (global.sendLogToUI) global.sendLogToUI('Iniciando descarga de temporadas anteriores...', 'info');

    scrapePreviousSeasonsDirect(platform, username)
      .then(seasons => {
        prevSeasonCache = { ...seasons, fetched: true };
        if (global.sendLogToUI) global.sendLogToUI('Datos de temporadas anteriores cargados con exito.', 'success');
        if (typeof process.onUpdateSeasons === 'function') process.onUpdateSeasons(prevSeasonCache);
      })
      .catch(err => {
        console.warn('[WARN] Error cargando temporadas:', err.message);
        prevSeasonCache.fetched = false;
      });
  }

  return {
    modes: currentData.modes,
    careerStats: currentData.careerStats,
    prevSeason1: prevSeasonCache.prev1,
    prevSeason2: prevSeasonCache.prev2,
  };
}

function resetPrevSeasonCache() {
  prevSeasonCache = { prev1: null, prev2: null, fetched: false };
}

module.exports = { scrapeProfile, closeBrowser, resetPrevSeasonCache };
