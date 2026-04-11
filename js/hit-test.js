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
 * Uses the WebXR Raw Camera Access API (camera-access optional feature) to
 * obtain the camera image as a WebGL texture each XR frame.  This sidesteps
 * the Android restriction that prevents getUserMedia from running alongside
 * an active WebXR session.
 *
 * Flow (tock — runs AFTER A-Frame's normal render, inside the XR frame):
 *   1. Obtain XRWebGLBinding and the first XRView's camera texture.
 *   2. Render the camera texture to a full-screen quad (background pass).
 *   3. Render the Three.js scene (characters, transparent background)
 *      on top with renderer.xr.enabled = false to avoid XR viewport override.
 *   4. readRenderTargetPixels → Y-flip → 2-D canvas → callback.
 *
 * Fallback: if camera-access is unavailable (view.camera is null) the
 *   render target will contain only the characters on a transparent background.
 *
 * Usage (from main.js):
 *   sceneEl.systems['photo-capture'].request(canvas => { ... });
 */
AFRAME.registerSystem('photo-capture', {
  init() {
    this.captureCallback = null;
    this.xrBinding       = null;
    this.bgScene         = null;
    this.bgCamera        = null;
    this.bgMesh          = null;

    // Create / tear down XRWebGLBinding with the session lifecycle.
    this.el.addEventListener('enter-vr', () => this._onEnterVR());
    this.el.addEventListener('exit-vr',  () => { this.xrBinding = null; });
  },

  _onEnterVR() {
    const renderer = this.el.renderer;
    const session  = renderer.xr.getSession();
    if (!session) return;
    try {
      this.xrBinding = new XRWebGLBinding(session, renderer.getContext()); // eslint-disable-line
    } catch (e) {
      console.warn('XRWebGLBinding unavailable:', e);
      this.xrBinding = null;
    }
  },

  _ensureBgScene() {
    /* global THREE */
    if (this.bgScene) return;

    this.bgScene  = new THREE.Scene();
    this.bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({
      uniforms:       { camTex: { value: null } },
      vertexShader:   `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}`,
      fragmentShader: `uniform sampler2D camTex;
varying vec2 vUv;
void main(){gl_FragColor=texture2D(camTex,vec2(vUv.x,1.0-vUv.y));}`,
      depthWrite: false,
      depthTest:  false,
    });
    this.bgMesh = new THREE.Mesh(geo, mat);
    this.bgScene.add(this.bgMesh);
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
    const w        = renderer.domElement.width;
    const h        = renderer.domElement.height;

    const target          = new THREE.WebGLRenderTarget(w, h);
    const savedTarget     = renderer.getRenderTarget();
    const savedClearAlpha = renderer.getClearAlpha();
    const savedAutoClear  = renderer.autoClear;
    const xrWasEnabled    = renderer.xr.enabled;

    renderer.autoClear   = false;
    renderer.xr.enabled  = false;
    renderer.setRenderTarget(target);
    renderer.setClearAlpha(0);
    renderer.clear();

    // ── Pass 1: camera background (if camera-access is available) ──
    const frame    = sceneEl.frame;
    const refSpace = renderer.xr.getReferenceSpace ? renderer.xr.getReferenceSpace() : null;
    let cameraTexUsed = false;

    if (this.xrBinding && frame && refSpace) {
      try {
        const pose = frame.getViewerPose(refSpace);
        if (pose && pose.views.length > 0) {
          const view = pose.views[0];
          if (view.camera) {
            const glTex = this.xrBinding.getCameraImage(view.camera);
            if (glTex) {
              this._ensureBgScene();
              // Wrap the raw WebGL texture in a Three.js Texture object.
              const tex = new THREE.Texture();
              renderer.properties.get(tex).__webglTexture = glTex;
              renderer.properties.get(tex).__webglInit    = true;
              this.bgMesh.material.uniforms.camTex.value  = tex;
              renderer.render(this.bgScene, this.bgCamera);
              cameraTexUsed = true;
            }
          }
        }
      } catch (e) {
        console.warn('camera-access render failed:', e);
      }
    }

    if (!cameraTexUsed) {
      // No camera texture — leave background transparent (characters only).
      renderer.clear();
    }

    // ── Pass 2: AR scene (characters) ──
    renderer.render(scene, camera);

    // ── Restore state ──
    renderer.setRenderTarget(savedTarget);
    renderer.setClearAlpha(savedClearAlpha);
    renderer.autoClear  = savedAutoClear;
    renderer.xr.enabled = xrWasEnabled;

    // ── Read pixels & Y-flip ──
    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    target.dispose();

    const out    = document.createElement('canvas');
    out.width    = w;
    out.height   = h;
    const outCtx  = out.getContext('2d');
    const imgData = outCtx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      imgData.data.set(
        pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4),
        y * w * 4,
      );
    }
    outCtx.putImageData(imgData, 0, 0);
    cb(out);
  },

  request(callback) {
    this.captureCallback = callback;
  },
});
