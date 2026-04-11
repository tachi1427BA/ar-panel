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
 * Background rendering uses a raw WebGL program (not Three.js) to avoid
 * internal texture-management issues with external WebGL textures in r152+.
 *
 * Flow (tock — runs AFTER A-Frame's normal render, inside the XR frame):
 *   1. Determine capture size from the XR base-layer viewport.
 *   2. Render the camera texture to the render target with a raw GL quad (Pass 1).
 *   3. resetState() so Three.js re-syncs GL state, then rebind render target.
 *   4. Render the Three.js scene (characters) on top (Pass 2).
 *   5. readRenderTargetPixels → Y-flip → 2-D canvas → callback.
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
    // Raw-GL background program
    this._bgProg   = null;
    this._bgBuf    = null;
    this._bgVAO    = null;   // WebGL2 VAO to avoid corrupting Three.js state
    this._bgPosLoc = -1;
    this._bgTexLoc = null;

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
      console.warn('[photo-capture] XRWebGLBinding unavailable:', e);
      this.xrBinding = null;
    }
  },

  /** Lazily compile the full-screen quad GL program for the camera background. */
  _ensureBgGl() {
    if (this._bgProg) return;
    const gl = this.el.renderer.getContext();

    const vert = `attribute vec2 aPos;varying vec2 vUv;` +
      `void main(){vUv=aPos*.5+.5;gl_Position=vec4(aPos,0.,1.);}`;
    const frag = `precision mediump float;uniform sampler2D uCam;varying vec2 vUv;` +
      `void main(){gl_FragColor=texture2D(uCam,vec2(vUv.x,1.-vUv.y));}`;

    const mkShader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('[photo-capture] shader error:', gl.getShaderInfoLog(s));
      return s;
    };

    const prog = gl.createProgram();
    gl.attachShader(prog, mkShader(gl.VERTEX_SHADER,   vert));
    gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      console.error('[photo-capture] link error:', gl.getProgramInfoLog(prog));

    const posLoc = gl.getAttribLocation(prog,  'aPos');
    const texLoc = gl.getUniformLocation(prog, 'uCam');

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // Use a dedicated VAO (WebGL2) so we never touch Three.js's VAO state.
    let vao = null;
    if (gl.createVertexArray) {
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    this._bgProg   = prog;
    this._bgBuf    = buf;
    this._bgVAO    = vao;
    this._bgPosLoc = posLoc;
    this._bgTexLoc = texLoc;
  },

  tock() {
    if (!this.captureCallback) return;
    const cb = this.captureCallback;
    this.captureCallback = null;

    /* global THREE */
    const sceneEl  = this.el;
    const renderer = sceneEl.renderer;
    const gl       = renderer.getContext();
    const scene    = sceneEl.object3D;
    const camera   = sceneEl.camera;

    // ── Determine capture dimensions ──
    // Prefer the XR base-layer viewport; fall back to the canvas dimensions.
    let w = renderer.domElement.width;
    let h = renderer.domElement.height;

    const frame    = sceneEl.frame;
    const refSpace = renderer.xr.getReferenceSpace ? renderer.xr.getReferenceSpace() : null;
    let glCamTex   = null;

    if (frame && refSpace) {
      try {
        const pose = frame.getViewerPose(refSpace);
        if (pose && pose.views.length > 0) {
          const view    = pose.views[0];
          const session = renderer.xr.getSession();
          const layer   = session && session.renderState.baseLayer;
          if (layer) {
            const vp = layer.getViewport(view);
            if (vp && vp.width > 0 && vp.height > 0) {
              w = vp.width;
              h = vp.height;
            }
          }
          // Try to get the camera texture (camera-access optional feature).
          if (this.xrBinding && view.camera) {
            try {
              glCamTex = this.xrBinding.getCameraImage(view.camera);
            } catch (e) {
              console.warn('[photo-capture] getCameraImage:', e);
            }
          }
        }
      } catch (e) {
        console.warn('[photo-capture] pose error:', e);
      }
    }

    const target      = new THREE.WebGLRenderTarget(w, h,
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const savedTarget    = renderer.getRenderTarget();
    const savedAutoClear = renderer.autoClear;
    const xrWasEnabled   = renderer.xr.enabled;

    renderer.autoClear  = false;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    renderer.clear(true, true, true);

    // ── Pass 1: camera background via raw WebGL (avoids Three.js texture internals) ──
    if (glCamTex) {
      try {
        this._ensureBgGl();

        // Save minimal GL state we're about to change.
        const prevProg  = gl.getParameter(gl.CURRENT_PROGRAM);
        const prevTex   = gl.getParameter(gl.TEXTURE_BINDING_2D);
        const depthTest = gl.isEnabled(gl.DEPTH_TEST);
        const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
        const blend     = gl.isEnabled(gl.BLEND);

        gl.viewport(0, 0, w, h);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.BLEND);

        gl.useProgram(this._bgProg);

        if (this._bgVAO) {
          gl.bindVertexArray(this._bgVAO);
        } else {
          gl.bindBuffer(gl.ARRAY_BUFFER, this._bgBuf);
          gl.enableVertexAttribArray(this._bgPosLoc);
          gl.vertexAttribPointer(this._bgPosLoc, 2, gl.FLOAT, false, 0, 0);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, glCamTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(this._bgTexLoc, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Restore GL state.
        if (this._bgVAO) {
          gl.bindVertexArray(null);
        } else {
          gl.disableVertexAttribArray(this._bgPosLoc);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
        }
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        if (depthTest) gl.enable(gl.DEPTH_TEST);
        gl.depthMask(depthMask);
        if (blend) gl.enable(gl.BLEND);
        gl.useProgram(prevProg);

        // Re-sync Three.js's internal state tracking, then rebind our target.
        if (renderer.resetState) renderer.resetState();
        renderer.autoClear  = false;
        renderer.xr.enabled = false;
        renderer.setRenderTarget(target);
      } catch (e) {
        console.warn('[photo-capture] bg pass error:', e);
      }
    }

    // ── Pass 2: AR scene (characters) on top ──
    renderer.render(scene, camera);

    // ── Restore Three.js state ──
    renderer.setRenderTarget(savedTarget);
    renderer.autoClear  = savedAutoClear;
    renderer.xr.enabled = xrWasEnabled;

    // ── Read pixels & Y-flip (WebGL is bottom-up) ──
    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    target.dispose();

    const out    = document.createElement('canvas');
    out.width    = w;
    out.height   = h;
    const ctx2d   = out.getContext('2d');
    const imgData = ctx2d.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      imgData.data.set(
        pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4),
        y * w * 4,
      );
    }
    ctx2d.putImageData(imgData, 0, 0);
    cb(out);
  },

  request(callback) {
    this.captureCallback = callback;
  },
});
