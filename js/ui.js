import { state }       from './state.js';
import { dom }         from './dom.js';
import { CHAR_HEIGHT } from './config.js';

export function sessionIsActive() {
  return dom.editControls.style.display !== 'none';
}

export function collapsePanel() { dom.charPanel.classList.remove('expanded'); }
export function expandPanel()   { dom.charPanel.classList.add('expanded'); }

export function updateControlStates() {
  dom.scaleDownButton.disabled = !state.activeCharacter;
  dom.scaleUpButton.disabled   = !state.activeCharacter;
  dom.shootModeButton.disabled = state.placedCharacters.length === 0;
}

export function updateSelectionStatus() {
  dom.selectionStatus.textContent = state.activeCharacter
    ? `選択中: ${state.activeCharacter.dataset.label}`
    : 'キャラクター未選択';
}

export function updateInstructions() {
  if (!sessionIsActive() || state.isShootingMode) {
    dom.instructionsEl.style.display = 'none';
    return;
  }
  if (state.isFallbackMode) {
    dom.instructionsEl.textContent = '「キャラを追加」で配置 / キャラをタップで選択';
  } else {
    dom.instructionsEl.textContent = dom.reticle.getAttribute('visible')
      ? '平面をタップで配置 / キャラをタップで選択'
      : '平面にカメラを向けてください';
  }
  dom.instructionsEl.style.display = 'block';
}

export function updatePresetHighlight(key) {
  document.querySelectorAll('.preset-button').forEach(btn => {
    btn.classList.toggle('active-preset', btn.dataset.src === key);
  });
}

export function setCurrentCharacter(source, label, key) {
  const resolvedKey = key || source;
  state.currentCharacterSrc   = source;
  state.currentCharacterLabel = label;
  state.currentCharacterKey   = resolvedKey;
  dom.imagePreview.src         = source;
  dom.charHandlePreview.src    = source;
  dom.charPanelLabel.textContent = label;
  updatePresetHighlight(resolvedKey);
}

export function updateCurrentCharacterDimensions() {
  const img = dom.imagePreview;
  if (!img.src || !img.complete || !img.naturalHeight) return;
  state.currentCharacterWidth = CHAR_HEIGHT * (img.naturalWidth / img.naturalHeight);
}
