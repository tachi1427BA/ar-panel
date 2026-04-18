/**
 * ar-continuous-hit-test
 *
 * 8th Wall Engine (XR8) を使って毎フレーム画面中心にヒットテストを行い、
 * target エンティティの位置/向きを更新する。
 * iOS Safari を含むモバイルブラウザで動作する。
 *
 * 発火するイベント（既存コードと互換）:
 *   ar-hit-test-achieved  - 平面が初めて検出されたとき
 *   ar-hit-test-lost      - 平面が失われたとき
 *   ar-hit-test-select    - ユーザーがタップしたとき（かつ平面検出中）
 */
AFRAME.registerComponent('ar-continuous-hit-test', {
  schema: {
    target: { type: 'selector' },
  },

  init() {
    this.hasHit   = false;
    this._onSelect = this._onSelect.bind(this);
    document.addEventListener('touchstart', this._onSelect, { passive: true });
  },

  remove() {
    document.removeEventListener('touchstart', this._onSelect);
    this.hasHit = false;
  },

  tick() {
    if (!window.XR8 || !window.XR8.XrController) return;

    let results;
    try {
      results = XR8.XrController.hitTest(0.5, 0.5, ['FEATURE_POINT', 'PLANE']);
    } catch (_) {
      return;
    }

    const target = this.data.target;

    if (results && results.length > 0) {
      const hit = results[0];
      if (target) {
        target.setAttribute('position', hit.position);
        if (hit.rotation) {
          /* global THREE */
          const euler = new THREE.Euler().setFromQuaternion(
            new THREE.Quaternion(hit.rotation.x, hit.rotation.y, hit.rotation.z, hit.rotation.w)
          );
          const toDeg = THREE.MathUtils.radToDeg;
          target.setAttribute('rotation', {
            x: toDeg(euler.x),
            y: toDeg(euler.y),
            z: toDeg(euler.z),
          });
        }
      }
      if (!this.hasHit) {
        this.hasHit = true;
        this.el.sceneEl.emit('ar-hit-test-achieved');
      }
    } else {
      if (this.hasHit) {
        this.hasHit = false;
        this.el.sceneEl.emit('ar-hit-test-lost');
      }
    }
  },

  _onSelect(e) {
    if (!this.hasHit) return;
    // UI オーバーレイへのタップはキャラクター配置に使わない
    const touch = e.touches && e.touches[0];
    const tappedEl = touch
      ? document.elementFromPoint(touch.clientX, touch.clientY)
      : e.target;
    const mainUI = document.getElementById('main-ui');
    if (mainUI && mainUI.contains(tappedEl)) return;
    this.el.sceneEl.emit('ar-hit-test-select');
  },
});

/**
 * photo-capture system
 *
 * Runs in tock() — AFTER A-Frame's normal scene render — so the XR camera
 * matrices are fully updated for the current frame.
 *
 * We temporarily disable renderer.xr.enabled before our custom render call.
 * This prevents THREE.js from re-invoking the XR ArrayCamera (with its
 * device-pixel-space viewport coordinates) and instead uses sceneEl.camera
 * directly.  sceneEl.camera.matrixWorld already holds the correct XR pose
 * because xr.updateCamera() was called during the normal render that just
 * completed, and preserveDrawingBuffer keeps that state alive.
 *
 * Usage (from main.js):
 *   sceneEl.systems['photo-capture'].request(arCanvas => { ... });
 */
AFRAME.registerSystem('photo-capture', {
  init() {
    this.captureCallback = null;
  },

  tock() {
    if (!this.captureCallback) return;
    const cb = this.captureCallback;
    this.captureCallback = null;

    /* global THREE */
    const sceneEl  = this.el;
    const renderer = sceneEl.renderer;
    const scene    = sceneEl.object3D;
    const camera   = sceneEl.camera;

    // Use the canvas's actual physical-pixel dimensions so the aspect ratio
    // and scale exactly match what the user sees in AR.
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    const target          = new THREE.WebGLRenderTarget(w, h);
    const savedTarget     = renderer.getRenderTarget();
    const savedClearAlpha = renderer.getClearAlpha();

    // Disable XR override so renderer.render() uses our camera as-is,
    // without re-mapping sub-camera viewports to device-pixel coordinates.
    const xrWasEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false;

    renderer.setRenderTarget(target);
    renderer.setClearAlpha(0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(savedTarget);
    renderer.setClearAlpha(savedClearAlpha);
    renderer.xr.enabled = xrWasEnabled;

    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    target.dispose();

    // Build a canvas with Y-axis flipped (WebGL is bottom-up).
    const arCanvas  = document.createElement('canvas');
    arCanvas.width  = w;
    arCanvas.height = h;
    const arCtx   = arCanvas.getContext('2d');
    const imgData = arCtx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      imgData.data.set(
        pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4),
        y * w * 4,
      );
    }
    arCtx.putImageData(imgData, 0, 0);

    cb(arCanvas);
  },

  request(callback) {
    this.captureCallback = callback;
  },
});
