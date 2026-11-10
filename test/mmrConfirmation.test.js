'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNormalMmrConfirmationState, reconcileTrackerMmr } = require('../mmrConfirmation');

function mode(mmr, rank = 'Champion I') {
  return { id: 11, name: 'Ranked Doubles 2v2', mmr, rank, iconUrl: `icon-${mmr}` };
}

test('keeps one normal changed reading pending, then synchronizes the confirmed value', () => {
  const candidates = createNormalMmrConfirmationState();
  const previous = [mode(1102, 'Champion I - Division II')];

  const first = reconcileTrackerMmr([mode(1111, 'Champion I - Division III')], previous, { candidates });
  assert.equal(first.modes[0].mmr, 1102);
  assert.equal(first.modes[0].rank, 'Champion I - Division II');
  assert.equal(first.pending.length, 1);
  assert.equal(first.confirmed.length, 0);

  const second = reconcileTrackerMmr([mode(1111, 'Champion I - Division III')], previous, { candidates });
  assert.equal(second.modes[0].mmr, 1111);
  assert.equal(second.confirmed.length, 1);
  assert.deepEqual(second.confirmed[0], { id: '11', name: 'Ranked Doubles 2v2', from: 1102, to: 1111 });
});

test('does not accept an oscillating normal reading', () => {
  const candidates = createNormalMmrConfirmationState();
  const previous = [mode(1102)];

  reconcileTrackerMmr([mode(1093)], previous, { candidates });
  const recovered = reconcileTrackerMmr([mode(1102)], previous, { candidates });
  const repeated = reconcileTrackerMmr([mode(1093)], previous, { candidates });

  assert.equal(recovered.modes[0].mmr, 1102);
  assert.equal(repeated.modes[0].mmr, 1102);
  assert.equal(repeated.pending.length, 1);
  assert.equal(repeated.confirmed.length, 0);
});

test('accepts post-match polling immediately and clears a pending normal candidate', () => {
  const candidates = createNormalMmrConfirmationState();
  const previous = [mode(1102)];

  reconcileTrackerMmr([mode(1111)], previous, { candidates });
  const fast = reconcileTrackerMmr([mode(1093)], previous, { allowChanges: true, candidates });

  assert.equal(fast.modes[0].mmr, 1093);
  assert.equal(candidates.size, 0);
});
