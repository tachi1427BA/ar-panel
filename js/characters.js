import { state }                               from './state.js';
import { buildCharacterEntity }                from './entities.js';
import { updateControlStates, updateSelectionStatus, updateReticleVisibility } from './ui.js';

export function setActiveCharacter(el) {
  if (state.activeCharacter && state.activeCharacter.__outline) {
    state.activeCharacter.__outline.setAttribute('visible', false);
  }
  state.activeCharacter = el || null;
  if (state.activeCharacter && state.activeCharacter.__outline) {
    state.activeCharacter.__outline.setAttribute('visible', true);
  }
  updateSelectionStatus();
  updateControlStates();
}

export function clearPlacedCharacters() {
  state.placedCharacters.forEach(el => el.remove());
  state.placedCharacters = [];
  setActiveCharacter(null);
  updateReticleVisibility();
}

export function findPlacedCharacterByKey(key) {
  return state.placedCharacters.find(el => el.dataset.characterKey === key) || null;
}

export function createCharacterEntity(position, rotation) {
  const el = buildCharacterEntity(position, rotation);
  state.placedCharacters.push(el);
  setActiveCharacter(el);
  updateReticleVisibility();
  return el;
}

export function placeCharacterAt(position, rotation) {
  const existing = findPlacedCharacterByKey(state.currentCharacterKey);
  if (existing) {
    setActiveCharacter(existing);
    return existing;
  }
  return createCharacterEntity(position, rotation);
}

function fallbackPlacementPosition(index) {
  if (index === 0) return { x: 0, y: -0.5, z: -2 };
  const spread = Math.ceil(index / 2);
  const dir    = index % 2 === 1 ? 1 : -1;
  return { x: dir * spread * 0.55, y: -0.5, z: -2 - (spread - 1) * 0.2 };
}

export function addFallbackCharacter() {
  placeCharacterAt(
    fallbackPlacementPosition(state.placedCharacters.length),
    { x: 0, y: 0, z: 0 }
  );
}
