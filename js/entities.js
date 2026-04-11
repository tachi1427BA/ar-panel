import { CHAR_HEIGHT } from './config.js';
import { state }       from './state.js';
import { dom }         from './dom.js';

function cloneVector(v) { return { x: v.x, y: v.y, z: v.z }; }

export function buildBodyElement() {
  const el = document.createElement('a-plane');
  el.setAttribute('height', CHAR_HEIGHT);
  el.setAttribute('width', state.currentCharacterWidth);
  el.setAttribute('position', `0 ${CHAR_HEIGHT / 2} 0`);
  el.setAttribute('material', {
    src: state.currentCharacterSrc,
    shader: 'flat',
    transparent: true,
    alphaTest: 0.5,
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
  // Use only Y rotation — reticle sends X=-90 (flat on floor) which would
  // lay the character plane down and show the image at ground level.
  el.setAttribute('rotation', { x: 0, y: (rotation && rotation.y) || 0, z: 0 });
  el.setAttribute('scale', '1 1 1');

  const body    = buildBodyElement();
  const outline = buildOutlineElement();

  el.appendChild(outline);
  el.appendChild(body);
  el.__outline = outline;

  dom.charactersContainer.appendChild(el);

  // Add shadow mesh directly to Three.js object — bypasses A-Frame component pipeline
  const charSrc   = state.currentCharacterSrc;
  const charWidth = state.currentCharacterWidth;
  /* global THREE */
  new THREE.TextureLoader().load(charSrc, (tex) => {
    if (!el.parentNode) return;
    tex.colorSpace = THREE.SRGBColorSpace;
    const geometry = new THREE.PlaneGeometry(charWidth, CHAR_HEIGHT);
    // In non-WebXR environments show shadow as red to verify positioning
    const shadowColor = navigator.xr ? 0x000000 : 0xff0000;
    const shadowOpacity = navigator.xr ? 0.45 : 0.7;
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      color: shadowColor,
      transparent: true,
      opacity: shadowOpacity,
      alphaTest: 0.1,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1;
    // Lay flat on the ground: rotate -90° around X, pivot from feet forward
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.005, -CHAR_HEIGHT / 2);
    el.object3D.add(mesh);
  });

  return el;
}
