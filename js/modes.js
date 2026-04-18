import { CHAR_HEIGHT }                         from './config.js';
import { state }                               from './state.js';
import { dom }                                 from './dom.js';
import { updateInstructions, updateControlStates, updateReticleVisibility, collapsePanel, expandPanel } from './ui.js';
import { clearPlacedCharacters, addFallbackCharacter, setActiveCharacter } from './characters.js';

export function suppressPlacementTemporarily() {
  state.suppressNextPlacement = true;
  setTimeout(() => { state.suppressNextPlacement = false; }, 250);
}

export function clearExitTimeout() {
  if (state.exitSessionTimeoutId !== null) {
    clearTimeout(state.exitSessionTimeoutId);
    state.exitSessionTimeoutId = null;
  }
}

export function getActiveXrSession() {
  // XR8 セッション中は WebXR セッションなし
  if (dom.sceneEl.components && dom.sceneEl.components['xrweb']) return null;
  try { return dom.sceneEl.renderer.xr.getSession(); } catch (_) { return null; }
}

// ── Shooting mode ──

export function enterShootingMode() {
  if (!state.placedCharacters.length) return;
  state.isShootingMode = true;
  dom.mainUI.classList.add('shooting-mode');
  updateReticleVisibility();
  state.placedCharacters.forEach(c => {
    if (c.__outline) c.__outline.setAttribute('visible', false);
  });
  updateInstructions();
}

export function exitShootingMode() {
  if (!state.isShootingMode) return;
  state.isShootingMode = false;
  dom.mainUI.classList.remove('shooting-mode');
  updateReticleVisibility();
  if (state.activeCharacter && state.activeCharacter.__outline) {
    state.activeCharacter.__outline.setAttribute('visible', true);
  }
  updateInstructions();
}

// ── Session mode ──

export function enterFallbackMode(message) {
  alert(message);
  state.isFallbackMode = true;
  dom.startOverlay.style.display = 'none';
  dom.exitArButton.classList.remove('hidden');
  dom.editControls.style.display = 'flex';
  dom.addCharacterButton.classList.remove('hidden');
  updateReticleVisibility();
  collapsePanel();
  if (!state.placedCharacters.length) addFallbackCharacter();
  updateInstructions();
  updateControlStates();
}

export function resetToMainMenu() {
  clearExitTimeout();
  state.isExitingSession      = false;
  dom.exitArButton.disabled   = false;
  exitShootingMode();
  state.isFallbackMode        = false;
  state.suppressNextPlacement = false;
  dom.exitArButton.classList.add('hidden');
  dom.startOverlay.style.display       = '';
  dom.instructionsEl.style.display     = 'none';
  dom.editControls.style.display       = 'none';
  dom.addCharacterButton.classList.add('hidden');
  updateReticleVisibility();
  clearPlacedCharacters();
  expandPanel();
}

export function finishExitToMainMenu() {
  const editControls = dom.editControls;
  if (!state.isExitingSession && editControls.style.display === 'none') return;
  resetToMainMenu();
}

export function requestExitToMainMenu() {
  if (dom.sceneEl.components && dom.sceneEl.components['xrweb']) {
    // XR8 セッション中: WebXR セッションがないので UI リセットのみ
    finishExitToMainMenu();
    return;
  }

  const xrSession = getActiveXrSession();
  if (!xrSession) { finishExitToMainMenu(); return; }
  if (state.isExitingSession) return;

  state.isExitingSession      = true;
  dom.exitArButton.disabled   = true;

  Promise.resolve(xrSession.end()).catch(err => {
    console.error(err);
    finishExitToMainMenu();
  });

  clearExitTimeout();
  state.exitSessionTimeoutId = setTimeout(() => {
    if (state.isExitingSession) finishExitToMainMenu();
  }, 1000);
}

// WebXR immersive-ar サポートをページ読み込み時に先行チェックしてキャッシュする。
// startARSession() がタップ（user gesture）から同期的に呼ばれるとき、
// await を挟まず結果を使えるので iOS のジェスチャーコンテキストが維持される。
let _webXRArSupported = false;
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-ar')
    .then(s => { _webXRArSupported = s; })
    .catch(() => {});
}

export function startARSession() {
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ── Android Chrome (ARCore): WebXR immersive-ar 対応 ──
  // _webXRArSupported はページロード時に同期的にセット済み
  if (_webXRArSupported) {
    _showARUI();
    dom.sceneEl.enterAR();
    return;
  }

  // ── iOS Safari: navigator.xr 未定義 → XR8 (同期パスでジェスチャーコンテキスト維持) ──
  // ── Android で WebXR なし (稀): XR8 フォールバック ──
  if (window.XR8 && isMobile) {
    _startXR8ARSession();
    return;
  }

  // ── デスクトップ等: 3D フォールバック ──
  enterFallbackMode('お使いのブラウザはARに対応していません。3Dビューで表示します。');
}

// iOS/Android 向け XR8 ARセッション開始。
// user gesture（touchend/click）内から呼ばれることが前提。
// iOS 13+ の DeviceOrientationEvent.requestPermission() と getUserMedia() を
// ジェスチャーコンテキスト内で同期的に開始してから xrweb を起動する。
function _startXR8ARSession() {
  if (dom.sceneEl.components['xrweb']) {
    // 再入時（exit 後の再開）: 既に XR8 起動済みなので UI だけ表示
    _showARUI();
    return;
  }

  // 両 Promise を同期的に開始（iOS はジェスチャーコンテキスト内と認識する）
  const orientationP =
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
      ? DeviceOrientationEvent.requestPermission()
      : Promise.resolve('granted');

  const cameraP = navigator.mediaDevices
    ? navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    : Promise.reject(Object.assign(new Error(), { name: 'SecurityError' }));

  Promise.all([orientationP, cameraP])
    .then(([orientState, stream]) => {
      if (orientState !== 'granted') {
        throw Object.assign(new Error(), { name: 'OrientationDeniedError' });
      }
      // ストリームを即座に解放; XR8 が改めてカメラを開く
      stream.getTracks().forEach(t => t.stop());
      // 権限取得済みなので xrweb が非同期で XR8.run() を呼んでも iOS が許可する
      dom.sceneEl.setAttribute('xrweb', 'allowedDevices: any');
      _showARUI();
    })
    .catch(err => {
      console.error('AR start error:', err);
      enterFallbackMode(_getPermissionErrorMessage(err));
    });
}

function _showARUI() {
  state.isFallbackMode = false;
  dom.startOverlay.style.display = 'none';
  dom.exitArButton.classList.remove('hidden');
  dom.editControls.style.display = 'flex';
  dom.addCharacterButton.classList.add('hidden');
  collapsePanel();
  updateInstructions();
  updateControlStates();
}

function _getPermissionErrorMessage(err) {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' ||
      err.name === 'OrientationDeniedError') {
    return isIOS
      ? 'カメラまたはモーションセンサーへのアクセスが拒否されました。\n' +
        '設定 > Safari > カメラ でこのサイトを「許可」に設定し、ページを再読み込みしてください。'
      : 'カメラへのアクセスが拒否されました。ブラウザの権限設定を確認してください。';
  }
  if (err.name === 'SecurityError' || !navigator.mediaDevices) {
    return 'カメラへのアクセスにはHTTPS接続が必要です。\nngrok等のHTTPS URLでアクセスしてください。';
  }
  return `ARを起動できませんでした（${err.name || err.message || '不明なエラー'}）。3Dビューで表示します。`;
}

// ── Screen projection / tap detection ──

export function projectCharacterToScreen(el) {
  if (!dom.sceneEl.camera) return null;
  const cam     = dom.sceneEl.camera;
  /* global THREE */
  const centerW = el.object3D.localToWorld(new THREE.Vector3(0, CHAR_HEIGHT / 2, 0));
  const topW    = el.object3D.localToWorld(new THREE.Vector3(0, CHAR_HEIGHT, 0));
  const botW    = el.object3D.localToWorld(new THREE.Vector3(0, 0, 0));
  const cProj   = centerW.clone().project(cam);
  const tProj   = topW.clone().project(cam);
  const bProj   = botW.clone().project(cam);

  if (cProj.z < -1 || cProj.z > 1) return null;

  return {
    x:      (cProj.x  * 0.5 + 0.5) * window.innerWidth,
    y:      (-cProj.y * 0.5 + 0.5) * window.innerHeight,
    height: Math.abs(
      (-tProj.y * 0.5 + 0.5) * window.innerHeight -
      (-bProj.y * 0.5 + 0.5) * window.innerHeight
    ),
  };
}

export function findTappedCharacter(clientX, clientY) {
  if (!dom.sceneEl.camera || !state.placedCharacters.length) return null;
  dom.sceneEl.object3D.updateMatrixWorld(true);
  let closest = null, minDist = Infinity;
  state.placedCharacters.forEach(el => {
    const proj = projectCharacterToScreen(el);
    if (!proj) return;
    const r    = Math.max(48, proj.height * 0.35);
    const dist = Math.hypot(proj.x - clientX, proj.y - clientY);
    if (dist <= r && dist < minDist) { minDist = dist; closest = el; }
  });
  return closest;
}

export function handleScenePointer(clientX, clientY) {
  if (dom.editControls.style.display === 'none') return;
  if (state.isShootingMode) {
    exitShootingMode();
    suppressPlacementTemporarily();
    return;
  }
  const hit = findTappedCharacter(clientX, clientY);
  if (hit) {
    setActiveCharacter(hit);
    suppressPlacementTemporarily();
  }
}
