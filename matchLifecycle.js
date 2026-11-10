'use strict';

const ANONYMOUS_MATCH_DEDUPE_MS = 5 * 60 * 1000;

function createMatchLifecycleState() {
  return { activeMatchGuid: null, activeMatchSeen: false, lastHandledMatchGuid: null, lastAnonymousPostMatchAt: 0 };
}

function matchGuidFrom(data) {
  const value = String(data?.MatchGuid || '').trim();
  return value || null;
}

function observeMatch(state, data) {
  state.activeMatchSeen = true;
  const matchGuid = matchGuidFrom(data);
  if (matchGuid) state.activeMatchGuid = matchGuid;
}

function consumePostMatch(state, data, now = Date.now()) {
  const matchGuid = matchGuidFrom(data) || state.activeMatchGuid;
  if (matchGuid) {
    if (matchGuid === state.lastHandledMatchGuid) return false;
    state.lastHandledMatchGuid = matchGuid;
    return true;
  }

  if (!state.activeMatchSeen || (state.lastAnonymousPostMatchAt && now - state.lastAnonymousPostMatchAt < ANONYMOUS_MATCH_DEDUPE_MS)) return false;
  state.lastAnonymousPostMatchAt = now;
  return true;
}

function destroyMatch(state, data, now = Date.now()) {
  const shouldPoll = consumePostMatch(state, data, now);
  state.activeMatchGuid = null;
  state.activeMatchSeen = false;
  return shouldPoll;
}

module.exports = { createMatchLifecycleState, observeMatch, consumePostMatch, destroyMatch };
