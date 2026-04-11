// Signal that modules loaded successfully
window.__modulesLoaded = true;

import { CHAR_HEIGHT }           from './config.js';
import { state }                from './state.js';
import { dom }                  from './dom.js';
import {
  setCurrentCharacter,
  updateCurrentCharacterDimensions,
  updateInstructions,
} from './ui.js';
import {
  placeCharacterAt,
  addFallbackCharacter,
  setActiveCharacter,
} from './characters.js';
import {
  enterShootingMode,
  exitShootingMode,
  requestExitToMainMenu,
  finishExitToMainMenu,
  startARSession,
  suppressPlacementTemporarily,
  handleScenePointer,
} from './modes.js';

// ── Placement preview RAF loop ──
// Tracks the reticle world position every frame and positions the character
// preview standing upright at that point, facing the camera.
/* global THREE */
(function tickPreview() {
  requestAnimationFrame(tickPreview);
  if (!dom.placementPreview.getAttribute('visible')) return;
  const reticleObj = dom.reticle.object3D;
  const previewObj = dom.placementPreview.object3D;
  if (!reticleObj || !previewObj) return;
  // Sync position: stand character upright at floor hit point
  previewObj.position.set(
    reticleObj.position.x,
    reticleObj.position.y + CHAR_HEIGHT / 2,
    reticleObj.position.z,
  );
  // Face the camera (Y rotation only)
  const cam = dom.sceneEl.camera;
  if (cam) {
    previewObj.rotation.y = Math.atan2(
      cam.position.x - previewObj.position.x,
      cam.position.z - previewObj.position.z,
    );
  }
})();


dom.imagePreview.addEventListener('load', updateCurrentCharacterDimensions);
if (dom.imagePreview.complete) updateCurrentCharacterDimensions();

// ── Panel toggle ──
dom.charPanelHandle.addEventListener('click', () => {
  dom.charPanel.classList.toggle('expanded');
});

// ── Preset / upload events ──
dom.presetSelector.addEventListener('click', e => {
  const btn = e.target.closest('.preset-button');
  if (!btn || !btn.dataset.src) return;
  setCurrentCharacter(btn.dataset.src, btn.textContent.trim(), btn.dataset.src);
});

dom.imageUploadInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  state.createdObjectUrls.add(url);
  const key = `upload:${file.name}:${file.size}:${file.lastModified}`;
  setCurrentCharacter(url, file.name || 'アップロード画像', key);
});

// ── Start overlay ──
dom.startOverlay.addEventListener('pointerup', startARSession);

// ── Scene events ──
dom.sceneEl.addEventListener('ar-hit-test-achieved', () => {
  state.isHitTestActive = true;
  if (!state.isFallbackMode && !state.isShootingMode) {
    dom.placementPreview.setAttribute('visible', true);
    updateInstructions();
  }
});

dom.sceneEl.addEventListener('ar-hit-test-lost', () => {
  state.isHitTestActive = false;
  if (!state.isFallbackMode && !state.isShootingMode) {
    dom.placementPreview.setAttribute('visible', false);
    updateInstructions();
  }
});

dom.sceneEl.addEventListener('ar-hit-test-select', () => {
  if (state.suppressNextPlacement) { state.suppressNextPlacement = false; return; }
  if (state.isShootingMode) {
    exitShootingMode();
    return;
  }
  const pos = dom.reticle.getAttribute('position');
  const rot = dom.reticle.getAttribute('rotation');
  if (!pos) return;
  placeCharacterAt(pos, rot || { x: 0, y: 0, z: 0 });
  updateInstructions();
});

dom.sceneEl.addEventListener('exit-vr', () => { finishExitToMainMenu(); });

// ── Edit controls ──
dom.scaleUpButton.addEventListener('click', () => {
  if (!state.activeCharacter) return;
  const s = state.activeCharacter.getAttribute('scale');
  state.activeCharacter.setAttribute('scale', `${s.x * 1.2} ${s.y * 1.2} ${s.z * 1.2}`);
});

dom.scaleDownButton.addEventListener('click', () => {
  if (!state.activeCharacter) return;
  const s = state.activeCharacter.getAttribute('scale');
  state.activeCharacter.setAttribute('scale', `${s.x * 0.8} ${s.y * 0.8} ${s.z * 0.8}`);
});

dom.shootModeButton.addEventListener('click',   () => enterShootingMode());
dom.addCharacterButton.addEventListener('click', () => addFallbackCharacter());
dom.exitArButton.addEventListener('click',       () => requestExitToMainMenu());

// ── Global pointer (scene tap) ──
// Suppress XR placement when the tap target is inside the UI overlay.
dom.mainUI.addEventListener('pointerdown', suppressPlacementTemporarily, true);

window.addEventListener('pointerup', e => {
  if (dom.editControls.style.display === 'none') return;
  if (dom.mainUI.contains(e.target)) return;
  handleScenePointer(e.clientX, e.clientY);
}, true);

// ── Cleanup ──
window.addEventListener('beforeunload', () => {
  state.createdObjectUrls.forEach(url => URL.revokeObjectURL(url));
});

// ── Panel body drag-scroll (mouse) ──
let drag = { active: false, startY: 0, scrollTop: 0 };
dom.charPanelBody.addEventListener('mousedown', e => {
  drag = { active: true, startY: e.pageY - dom.charPanelBody.offsetTop, scrollTop: dom.charPanelBody.scrollTop };
  dom.charPanelBody.style.cursor = 'grabbing';
});
dom.charPanelBody.addEventListener('mouseleave', () => { drag.active = false; dom.charPanelBody.style.cursor = ''; });
dom.charPanelBody.addEventListener('mouseup',    () => { drag.active = false; dom.charPanelBody.style.cursor = ''; });
dom.charPanelBody.addEventListener('mousemove', e => {
  if (!drag.active) return;
  e.preventDefault();
  dom.charPanelBody.scrollTop = drag.scrollTop - (e.pageY - dom.charPanelBody.offsetTop - drag.startY);
});
