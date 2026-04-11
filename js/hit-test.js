/**
 * ar-continuous-hit-test
 *
 * A-Frame の組み込み ar-hit-test (type: hittest) はタップ時のみ更新される
 * トランジェント入力を使う。このコンポーネントは WebXR の
 * requestHitTestSource (viewer 空間) を使って毎フレーム画面中心に
 * ヒットテストを行い、target エンティティの位置/向きを更新する。
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
    this.hitTestSource = null;
    this.hasHit        = false;

    this._onEnterVR = this._onEnterVR.bind(this);
    this._onExitVR  = this._onExitVR.bind(this);
    this._onSelect  = this._onSelect.bind(this);

    this.el.sceneEl.addEventListener('enter-vr', this._onEnterVR);
    this.el.sceneEl.addEventListener('exit-vr',  this._onExitVR);
  },

  remove() {
    this.el.sceneEl.removeEventListener('enter-vr', this._onEnterVR);
    this.el.sceneEl.removeEventListener('exit-vr',  this._onExitVR);
    this._onExitVR();
  },

  _onEnterVR() {
    const session = this.el.sceneEl.renderer.xr.getSession();
    if (!session) return;

    session.requestReferenceSpace('viewer')
      .then(viewerSpace => session.requestHitTestSource({ space: viewerSpace }))
      .then(source => {
        this.hitTestSource = source;
        session.addEventListener('select', this._onSelect);
      })
      .catch(err => console.error('[ar-continuous-hit-test]', err));
  },

  _onExitVR() {
    if (this.hitTestSource) {
      this.hitTestSource.cancel();
      this.hitTestSource = null;
    }
    this.hasHit = false;
  },

  tick() {
    if (!this.hitTestSource) return;

    const frame = this.el.sceneEl.frame;
    if (!frame) return;

    const results  = frame.getHitTestResults(this.hitTestSource);
    const target   = this.data.target;
    const refSpace = this.el.sceneEl.renderer.xr.getReferenceSpace();

    if (results.length > 0) {
      const pose = results[0].getPose(refSpace);
      if (pose && target) {
        const p = pose.transform.position;
        const q = pose.transform.orientation;

        // Use setAttribute so getAttribute() reflects the hit-test position.
        target.setAttribute('position', { x: p.x, y: p.y, z: p.z });

        // Convert quaternion → Euler (degrees) for A-Frame rotation attribute.
        /* global THREE */
        const euler = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion(q.x, q.y, q.z, q.w)
        );
        const toDeg = THREE.MathUtils.radToDeg;
        target.setAttribute('rotation', {
          x: toDeg(euler.x),
          y: toDeg(euler.y),
          z: toDeg(euler.z),
        });
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

  _onSelect() {
    if (this.hasHit) {
      this.el.sceneEl.emit('ar-hit-test-select');
    }
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
