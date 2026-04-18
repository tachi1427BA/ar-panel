import { CHAR_HEIGHT } from './config.js';
import { state }       from './state.js';
import { dom }         from './dom.js';

function cloneVector(v) { return { x: v.x, y: v.y, z: v.z }; }

export function buildBodyElement() {
  // Use a raw a-entity instead of a-plane so we can apply the texture via
  // THREE.TextureLoader directly (same pattern as the shadow mesh).
  // This bypasses A-Frame's material component, which can fail on data/blob URLs.
  const el = document.createElement('a-entity');
  el.setAttribute('position', `0 ${CHAR_HEIGHT / 2} 0`);

  const src   = state.currentCharacterSrc;
  const width = state.currentCharacterWidth;

  el.addEventListener('loaded', () => {
    /* global THREE */
    new THREE.TextureLoader().load(src, (tex) => {
      if (!el.parentNode) return;
      tex.colorSpace = THREE.SRGBColorSpace;
      const geometry = new THREE.PlaneGeometry(width, CHAR_HEIGHT);
      const material = new THREE.MeshBasicMaterial({
        map:         tex,
        transparent: true,
        alphaTest:   0.5,
        side:        THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1;
      el.object3D.add(mesh);
    });
  });

  return el;
}

export function buildOutlineElement() {
  const outer = document.createElement('a-entity');
  outer.setAttribute('position', `0 ${CHAR_HEIGHT / 2} -0.001`);
  outer.setAttribute('visible', false);
  const w = state.currentCharacterWidth + 0.06;
  const h = CHAR_HEIGHT + 0.06;
  const t = 0.025;
  const mat = 'color: #ffffff; shader: flat';
  [
    [w, t,  0,               h / 2 - t / 2],
    [w, t,  0,             -(h / 2 - t / 2)],
    [t, h, -(w / 2 - t / 2), 0],
    [t, h,  (w / 2 - t / 2), 0],
  ].forEach(([bw, bh, bx, by]) => {
    const bar = document.createElement('a-plane');
    bar.setAttribute('width', bw);
    bar.setAttribute('height', bh);
    bar.setAttribute('position', `${bx} ${by} 0`);
    bar.setAttribute('material', mat);
    outer.appendChild(bar);
  });
  return outer;
}

// Returns a new character <a-entity> appended to the scene container.
// Caller is responsible for calling setActiveCharacter(el) afterwards.
export function buildCharacterEntity(position, rotation) {
  const el = document.createElement('a-entity');
  el.dataset.characterId  = String(++state.characterCounter);
  el.dataset.label        = state.currentCharacterLabel || `キャラクター${state.characterCounter}`;
  el.dataset.characterKey = state.currentCharacterKey;
  el.setAttribute('position', cloneVector(position));
  el.setAttribute('scale', '1 1 1');

  const body    = buildBodyElement();
  const outline = buildOutlineElement();

  el.appendChild(outline);
  el.appendChild(body);
  el.__outline = outline;

  // Ensure outline always renders AFTER the shadow (renderOrder 0).
  // Body mesh renderOrder is set inside buildBodyElement.
  outline.addEventListener('loaded', () => {
    outline.object3D.traverse(obj => { if (obj.isMesh) obj.renderOrder = 1; });
  });

  dom.charactersContainer.appendChild(el);

  // Always face the user: set Y rotation AFTER DOM connection so
  // object3D is fully initialised.  We set THREE.js radians directly
  // to avoid A-Frame component timing issues.
  // atan2(dx, dz) produces the angle that rotates the entity's local +Z
  // (plane front face) toward the camera position.
  /* global THREE */
  const camPos = dom.sceneEl.camera.getWorldPosition(new THREE.Vector3());
  const dx = camPos.x - position.x;
  const dz = camPos.z - position.z;
  el.object3D.rotation.set(0, Math.atan2(dx, dz), 0);

  // Add shadow mesh directly to Three.js object — bypasses A-Frame component pipeline
  const charSrc   = state.currentCharacterSrc;
  const charWidth = state.currentCharacterWidth;
  /* global THREE */
  new THREE.TextureLoader().load(charSrc, (tex) => {
    if (!el.parentNode) return;
    tex.colorSpace = THREE.SRGBColorSpace;
    const geometry = new THREE.PlaneGeometry(charWidth, CHAR_HEIGHT);
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      alphaTest: 0.1,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 0;
    // Lay flat on the ground: rotate -90° around X, pivot from feet forward
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.005, -CHAR_HEIGHT / 2);
    el.object3D.add(mesh);
  });

  return el;
}
