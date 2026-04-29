'use strict';

/**
 * scraper.js — tracker.gg Puppeteer scraper (network-interception strategy)
 *
 * How it works:
 *  1. Launch Chromium with puppeteer-extra stealth (bypasses Cloudflare)
 *  2. Navigate to the tracker.gg profile page
 *  3. Intercept the XHR call the page makes to:
 *       https://api.tracker.gg/api/v2/rocket-league/standard/profile/{platform}/{username}
 *     This returns the same JSON structure as the official API — with full segments data.
 *  4. Parse segments and return { '2v2', '3v3', 'rumble' }
 *
 * The browser is reused across polls (singleton). Only a new page is opened per poll.
 */

const puppeteer     = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { executablePath } = require('puppeteer');
puppeteer.use(StealthPlugin());


// ── Parse API response segments ───────────────────────────────────────────────
// Returns ALL ranked playlist modes found — no hardcoded list.
// If Psyonix adds or removes a mode the app adapts automatically.

function parseSegments(segments) {
  const modes = [];

  for (const seg of segments) {
    if (seg.type !== 'playlist') continue;

    const mmr = seg.stats && seg.stats.rating && seg.stats.rating.value != null
      ? seg.stats.rating.value : null;
    if (mmr === null) continue;

    const id       = seg.attributes && seg.attributes.playlistId;
    const name     = (seg.metadata && seg.metadata.name) || `Modo ${id}`;
    const tierName = (seg.stats && seg.stats.tier && seg.stats.tier.metadata && seg.stats.tier.metadata.name) || 'Sin rango';
    const divName  = (seg.stats && seg.stats.division && seg.stats.division.metadata && seg.stats.division.metadata.name) || null;
    const rank     = (divName && tierName !== 'Supersonic Legend') ? `${tierName} - ${divName}` : tierName;
    const iconUrl  = (seg.stats && seg.stats.tier && seg.stats.tier.metadata && seg.stats.tier.metadata.iconUrl) || null;

    modes.push({ id, name, mmr: Math.round(mmr), rank, iconUrl });
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

// ── Random delay ──────────────────────────────────────────────────────────────

function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main scrape ───────────────────────────────────────────────────────────────

async function scrapeProfile(platform, username) {
  const pageUrl = `https://rocketleague.tracker.network/rocket-league/profile/${platform}/${username}/overview`;
  // The page calls this internal API endpoint — we intercept the response
  const apiPattern = /api\.tracker\.gg\/api\/v2\/rocket-league\/standard\/profile\//i;

  const br   = await getBrowser();
  const page = await br.newPage();

  try {
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

    console.log('[INFO] Datos extraidos via intercepcion de red (api.tracker.gg).');
    return parsed;

  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { scrapeProfile, closeBrowser };
