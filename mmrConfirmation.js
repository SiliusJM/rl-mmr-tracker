'use strict';

const NORMAL_MMR_CONFIRMATIONS_REQUIRED = 2;

function createNormalMmrConfirmationState() {
  return new Map();
}

function reconcileTrackerMmr(modes, previousModes, {
  allowChanges = false,
  candidates = createNormalMmrConfirmationState(),
  confirmationsRequired = NORMAL_MMR_CONFIRMATIONS_REQUIRED,
} = {}) {
  const incomingModes = Array.isArray(modes) ? modes : [];
  const required = Math.max(1, Number(confirmationsRequired) || NORMAL_MMR_CONFIRMATIONS_REQUIRED);

  if (allowChanges || !Array.isArray(previousModes)) {
    candidates.clear();
    return { modes: incomingModes, pending: [], confirmed: [] };
  }

  const previousById = new Map(previousModes.map(mode => [String(mode.id), mode]));
  const pending = [];
  const confirmed = [];
  const stableModes = incomingModes.map(mode => {
    const id = String(mode?.id ?? '');
    const previous = previousById.get(id);
    const currentMmr = Number(mode?.mmr);
    const previousMmr = Number(previous?.mmr);

    if (!id || !previous || !Number.isFinite(currentMmr) || !Number.isFinite(previousMmr) || currentMmr === previousMmr) {
      if (id) candidates.delete(id);
      return mode;
    }

    const existing = candidates.get(id);
    const seen = existing?.mmr === currentMmr ? existing.seen + 1 : 1;
    if (seen >= required) {
      candidates.delete(id);
      confirmed.push({ id, name: mode.name || previous.name || id, from: previousMmr, to: currentMmr });
      return mode;
    }

    candidates.set(id, { mmr: currentMmr, seen });
    pending.push({ id, name: mode.name || previous.name || id, from: previousMmr, to: currentMmr });
    return { ...mode, mmr: previous.mmr, rank: previous.rank, iconUrl: previous.iconUrl };
  });

  return { modes: stableModes, pending, confirmed };
}

module.exports = { NORMAL_MMR_CONFIRMATIONS_REQUIRED, createNormalMmrConfirmationState, reconcileTrackerMmr };
