'use strict';

/**
 * sessionTracker.js — Session win/loss tracker.
 *
 * Normal mode counts results from MMR deltas. When Rocket League's Stats API
 * gives us the result first, recordMatchResult() updates the session instantly
 * and the following MMR delta is consumed so it is not counted twice.
 */

let wins = 0;
let losses = 0;
let prevMMR = null;
let currentDay = new Date().toDateString();
let pendingExternalResults = [];

function resetIfNewDay(events) {
  const today = new Date().toDateString();
  if (today !== currentDay) {
    wins = 0;
    losses = 0;
    prevMMR = null;
    pendingExternalResults = [];
    currentDay = today;
    events.push({ msg: 'Nuevo día detectado — contadores de sesión reseteados.', type: 'info' });
  }
}

/**
 * Record the match result from Rocket League immediately.
 * The result is kept as pending so a later Tracker.gg MMR delta won't double-count it.
 */
function recordMatchResult(result) {
  const events = [];
  resetIfNewDay(events);
  if (result !== 'win' && result !== 'loss') return { wins, losses, changed: false, events };

  if (result === 'win') {
    wins++;
    events.push({ msg: '🏆 Victoria detectada desde Rocket League. Resultado actualizado inmediatamente.', type: 'success' });
  } else {
    losses++;
    events.push({ msg: '❌ Derrota detectada desde Rocket League. Resultado actualizado inmediatamente.', type: 'warn' });
  }

  pendingExternalResults.push({ result, expiresAt: Date.now() + 5 * 60 * 1000 });
  return { wins, losses, changed: true, events };
}

function consumeExternalResultForDelta(delta) {
  const now = Date.now();
  pendingExternalResults = pendingExternalResults.filter(p => p.expiresAt > now);
  if (!pendingExternalResults.length) return false;

  const result = delta > 0 ? 'win' : delta < 0 ? 'loss' : null;
  if (!result) return false;

  const index = pendingExternalResults.findIndex(p => p.result === result);
  if (index === -1) return false;
  pendingExternalResults.splice(index, 1);
  return true;
}

function updateSession(modesArray) {
  const today = new Date().toDateString();
  const events = [];
  if (today !== currentDay) {
    wins = 0;
    losses = 0;
    prevMMR = null;
    pendingExternalResults = [];
    currentDay = today;
    events.push({ msg: 'Nuevo día detectado — contadores de sesión reseteados.', type: 'info' });
  }

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

    const delta = curr - prev;
    if (consumeExternalResultForDelta(delta)) {
      // Rocket League already counted this result immediately.
      events.push({ msg: `📈 MMR confirmado por Tracker.gg (${delta > 0 ? '+' : ''}${delta}).`, type: 'info' });
    } else if (delta > 0) {
      wins++;
      events.push({ msg: `¡Victoria detectada! (+${delta} MMR)`, type: 'success' });
    } else {
      losses++;
      events.push({ msg: `Derrota detectada (${delta} MMR)`, type: 'warn' });
    }
    changed = true;
  }

  prevMMR = { ...currentMMR };
  return { wins, losses, changed, events };
}

function getSession() { return { wins, losses }; }

function resetSession() {
  wins = 0;
  losses = 0;
  prevMMR = null;
  pendingExternalResults = [];
}

module.exports = { updateSession, recordMatchResult, getSession, resetSession };
