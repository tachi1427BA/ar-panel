// Signal that modules loaded successfully
window.__modulesLoaded = true;

import { state }                from './state.js';
import { dom }                  from './dom.js';
import {
  setCurrentCharacter,
  updateCurrentCharacterDimensions,
  updateInstructions,
  updateReticleVisibility,
  sessionIsActive,
} from './ui.js';
import {
  placeCharacterAt,
  addFallbackCharacter,
  setActiveCharacter,
  removeActiveCharacter,
} from './characters.js';
import {
  enterShootingMode,
  exitShootingMode,
  requestExitToMainMenu,
  finishExitToMainMenu,
  startARSession,
  suppressPlacementTemporarily,
  handleScenePointer,
  getCameraVideo,
} from './modes.js';

// ── Image preview dimensions ──
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
  const key = btn.dataset.charKey || btn.dataset.src;
  setCurrentCharacter(btn.dataset.src, btn.textContent.trim(), key);
});

// Track whether AR was active when the file picker was opened.
let pendingARResume = false;
document.querySelector('label[for="image-upload-input"]').addEventListener('pointerdown', () => {
  pendingARResume = sessionIsActive() && !state.isFallbackMode;
});

dom.imageUploadInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const key   = `upload:${file.name}`;
  const label = file.name.replace(/\.[^/.]+$/, '') || file.name;

  const reader = new FileReader();
  reader.onload = (evt) => {
    const dataUrl = evt.target.result;

    // Add or update the uploaded image button in the preset grid.
    let btn = dom.presetSelector.querySelector(`[data-char-key="${CSS.escape(key)}"]`);
    if (btn) {
      btn.dataset.src = dataUrl;
    } else {
      btn = document.createElement('button');
      btn.className       = 'u-button preset-button';
      btn.dataset.src     = dataUrl;
      btn.dataset.charKey = key;
      btn.textContent     = label;
      dom.presetSelector.insertBefore(btn, dom.presetSelector.firstChild);
    }

    setCurrentCharacter(dataUrl, label, key);

    if (pendingARResume) {
      pendingARResume = false;
      setTimeout(() => startARSession(), 500);
    }
  };
  reader.readAsDataURL(file);
});

// ── Start overlay ──
dom.startOverlay.addEventListener('pointerup', startARSession);

// ── Scene events ──
dom.sceneEl.addEventListener('ar-hit-test-achieved', () => {
  state.isHitTestActive = true;
  updateReticleVisibility();
  updateInstructions();
});

dom.sceneEl.addEventListener('ar-hit-test-lost', () => {
  state.isHitTestActive = false;
  updateReticleVisibility();
  updateInstructions();
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
dom.deleteCharacterButton.addEventListener('click', () => removeActiveCharacter());
dom.addCharacterButton.addEventListener('click', () => addFallbackCharacter());
dom.exitArButton.addEventListener('click',       () => requestExitToMainMenu());

// ── Photo capture ──

let capturedDataUrl = null;

function showPhotoPreview(dataUrl) {
  capturedDataUrl = dataUrl;
  dom.photoPreviewImg.src = dataUrl;
  dom.photoPreview.classList.add('visible');
}

function capturePhoto() {
  /* global THREE */
  const sceneEl  = dom.sceneEl;
  const renderer = sceneEl.renderer;
  const scene    = sceneEl.object3D;
  // Use the XR camera when in AR (has the correct pose), else the A-Frame camera.
  const camera   = renderer.xr.isPresenting ? renderer.xr.getCamera() : sceneEl.camera;

  const w = window.innerWidth;
  const h = window.innerHeight;

  // Render characters to a dedicated WebGLRenderTarget — bypasses the XR
  // compositor framebuffer which is not readable via canvas.toDataURL().
  const target = new THREE.WebGLRenderTarget(w, h);
  const savedTarget     = renderer.getRenderTarget();
  const savedClearAlpha = renderer.getClearAlpha();

  renderer.setRenderTarget(target);
  renderer.setClearAlpha(0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(savedTarget);
  renderer.setClearAlpha(savedClearAlpha);

  // Read pixels (WebGL y-axis is bottom-up, flip vertically).
  const pixels = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
  target.dispose();

  const arCanvas = document.createElement('canvas');
  arCanvas.width  = w;
  arCanvas.height = h;
  const arCtx   = arCanvas.getContext('2d');
  const imgData = arCtx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 4;
    imgData.data.set(pixels.subarray(srcRow, srcRow + w * 4), y * w * 4);
  }
  arCtx.putImageData(imgData, 0, 0);

  // Composite: camera background + AR overlay (transparent where no character).
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width  = w;
  finalCanvas.height = h;
  const ctx = finalCanvas.getContext('2d');

  const video = getCameraVideo();
  if (video && video.readyState >= 2) {
    ctx.drawImage(video, 0, 0, w, h);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(arCanvas, 0, 0);

  showPhotoPreview(finalCanvas.toDataURL('image/png'));
}

// Shutter button is inside #main-ui, so the global pointerup handler ignores it.
dom.shutterButton.addEventListener('pointerup', e => {
  e.stopPropagation();
  // Wait one RAF so the last XR frame has been composited before we render.
  requestAnimationFrame(() => capturePhoto());
});

dom.photoSaveButton.addEventListener('click', async () => {
  if (!capturedDataUrl) return;
  const fileName = `ar_photo_${Date.now()}.png`;

  const res  = await fetch(capturedDataUrl);
  const blob = await res.blob();
  const file = new File([blob], fileName, { type: 'image/png' });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'AR写真' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  // Fallback download
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});

dom.photoCloseButton.addEventListener('click', () => {
  exitShootingMode();
});

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

