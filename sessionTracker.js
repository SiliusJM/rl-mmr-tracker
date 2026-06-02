'use strict';

/**
 * sessionTracker.js — Session win/loss tracker (MMR-delta based)
 *
 * Logic:
 *   - First poll: record baseline MMR, don't count anything.
 *   - Subsequent polls: compare each playlist's MMR to previous value.
 *     - Increased → win
 *     - Decreased → loss
 *   - Resets automatically on script restart (in-memory only).
 */

let wins    = 0;
let losses  = 0;
let prevMMR = null; // { [playlistId]: mmr } — dynamic, adapts to any modes
let currentDay = new Date().toDateString();

/**
 * Compares current mode array against previous snapshot.
 * Each element: { id: number, mmr: number, ... }
 *
 * @param {Array<{id:number, mmr:number}>} modesArray
 * @returns {{ wins: number, losses: number, changed: boolean }}
 */
function updateSession(modesArray) {
  const today = new Date().toDateString();
  const events = [];
  if (today !== currentDay) {
    wins = 0; losses = 0; prevMMR = null;
    currentDay = today;
    events.push({ msg: 'Nuevo día detectado — contadores de sesión reseteados.', type: 'info' });
  }

  // Build current MMR map: String(playlistId) → mmr
  const currentMMR = {};
  for (const mode of (modesArray || [])) {
    if (mode.id != null && mode.mmr != null) currentMMR[String(mode.id)] = mode.mmr;
  }

  if (!prevMMR) {
    prevMMR = { ...currentMMR };
    return { wins, losses, changed: false, events };
  }

  let changed = false;
  for (const [id, curr] of Object.entries(currentMMR)) {
    const prev = prevMMR[id];
    if (prev == null || curr === prev) continue;
    if (curr > prev) {
      wins++;
      events.push({ msg: `¡Victoria detectada! (+${curr - prev} MMR)`, type: 'success' });
    } else {
      losses++;
      events.push({ msg: `Derrota detectada (${curr - prev} MMR)`, type: 'warn' });
    }
    changed = true;
  }

  prevMMR = { ...currentMMR };
  return { wins, losses, changed, events };
}

/**
 * Returns current counters without modifying state.
 * @returns {{ wins: number, losses: number }}
 */
function getSession() {
  return { wins, losses };
}

/**
 * Resets all counters and baseline (useful for testing).
 */
function resetSession() {
  wins    = 0;
  losses  = 0;
  prevMMR = null;
}

module.exports = { updateSession, getSession, resetSession };

