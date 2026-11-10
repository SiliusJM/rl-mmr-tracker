'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMatchLifecycleState, observeMatch, consumePostMatch, destroyMatch } = require('../matchLifecycle');

test('MatchDestroyed starts the post-match sync when MatchEnded was missed', () => {
  const state = createMatchLifecycleState();
  observeMatch(state, { MatchGuid: 'match-1' });

  assert.equal(destroyMatch(state, { MatchGuid: 'match-1' }), true);
  assert.equal(state.activeMatchSeen, false);
  assert.equal(state.activeMatchGuid, null);
});

test('MatchDestroyed does not duplicate a MatchEnded sync for the same match', () => {
  const state = createMatchLifecycleState();
  observeMatch(state, { MatchGuid: 'match-2' });

  assert.equal(consumePostMatch(state, { MatchGuid: 'match-2' }), true);
  assert.equal(destroyMatch(state, { MatchGuid: 'match-2' }), false);
});

test('anonymous lifecycle events are deduplicated after a match closes', () => {
  const state = createMatchLifecycleState();
  observeMatch(state, {});

  assert.equal(consumePostMatch(state, {}, 1_000), true);
  assert.equal(destroyMatch(state, {}, 2_000), false);
});
