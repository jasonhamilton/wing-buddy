/**
 * The wing in 3D.
 *
 * Imperative Three.js rather than a declarative wrapper: the scene is rebuilt
 * wholesale from each GeometryResult, so there is no component tree to diff and
 * nothing a reconciler could help with. The previous scene stays on screen
 * while a new result is computed — the viewport never blanks.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GeometryResult, Path } from "../../geometry/types";
import { formatLength } from "../../domain/units";
import { useStore } from "../../state/store";
import { ghostedPanels, ghostOpacity } from "./ghosts";
import { read, viewTheme } from "./theme";

export type ViewOptions = {
  ribs: boolean;
  spars: boolean;
  webbing: boolean;
  sheeting: boolean;
  combs: boolean;
  leadingEdge: boolean;
  trailingEdge: boolean;
  axes: boolean;
  dihedral: boolean;
  bothHalves: boolean;
  transparency: number;
  /** draw the panels other than the selected one faint */
  ghostPanels: boolean;
  /** ghosts in neutral grey instead of the colour of their parts */
  grayGhosts: boolean;
  /** how transparent a ghost is, 0 solid to 1 almost gone */
  ghostTransparency: number;
  /** a feature is open: its panel's other parts are faded (still in colour) and this one is drawn as set */
  focus?: { panelId: string; ids: string[] } | null;
  /** how transparent the open feature is, 0 solid */
  featureTransparency?: number;
  /** how transparent the rest of that panel is */
  panelTransparency?: number;
  /** solids to draw 95 % transparent: the ids of hidden features */
  hiddenIds?: string[];
  /** edge stock whose carved-away copy is not drawn: the ids of the stock's solids */
  noCutStockIds?: string[];
};

export const DEFAULT_VIEW: ViewOptions = {
  ribs: true,
  spars: true,
  webbing: true,
  sheeting: true,
  combs: true,
  leadingEdge: true,
  trailingEdge: true,
  axes: false,
  dihedral: true,
  bothHalves: true,
  transparency: 0,
  // the other panels are always shown as gray ghosts, 80 % transparent, so it is plain which one is being worked on
  ghostPanels: true,
  grayGhosts: true,
  ghostTransparency: 0.8,
};

/** Where the camera sits, as a direction from the wing, until the user moves it. */
const START_DIR: [number, number, number] = [1, 0.7, 1];

/** The orientation cube's faces: the world direction each looks along, and where it sits on the cube. */
/** The faces are named as for an aircraft: the nose is at the front, the tail at the back, and the side you see is the side of the aircraft that faces you. */
const CUBE_FACES = [
  { label: "Left", dir: [0, 0, 1], css: "translateZ(var(--half))" },
  { label: "Right", dir: [0, 0, -1], css: "rotateY(180deg) translateZ(var(--half))" },
  { label: "Back", dir: [1, 0, 0.001], css: "rotateY(90deg) translateZ(var(--half))" },
  { label: "Front", dir: [-1, 0, 0.001], css: "rotateY(-90deg) translateZ(var(--half))" },
  { label: "Top", dir: [0, 1, 0.001], css: "rotateX(90deg) translateZ(var(--half))" },
  { label: "Bottom", dir: [0, -1, 0.001], css: "rotateX(-90deg) translateZ(var(--half))" },
] as const;

/** CSS matrix that turns the cube the way the camera has turned the world. */
const FLIP_Y = new THREE.Matrix4().makeScale(1, -1, 1);
function cubeTransform(cam: THREE.Camera): string {
  cam.updateMatrixWorld();
  const m = cam.matrixWorldInverse.clone();
  m.setPosition(0, 0, 0);
  m.premultiply(FLIP_Y).multiply(FLIP_Y); // three has y up, CSS has y down
  return `matrix3d(${m.elements.join(",")})`;
}

/**
 * Geometry that has not changed is not built again. Building a rib's extrusion or a member's normals is most of what drawing the wing
 * costs, and a drag on a slider changes one part at a time, so each geometry is kept under a hash of its numbers and handed back when the
 * same part comes round again. Parts no longer in the wing are disposed of after each build.
 */
const geometryCache = new Map<string, THREE.BufferGeometry>();

/** FNV-1a over the numbers, to a tenth of a micron: the same shape gives the same string. */
function hashNumbers(values: Iterable<number>): string {
  let h = 0x811c9dc5;
  let n = 0;
  for (const v of values) {
    h ^= Math.round(v * 1000) | 0;
    h = Math.imul(h, 0x01000193);
    n++;
  }
  return `${n}:${(h >>> 0).toString(16)}`;
}

function* ringNumbers(rings: Path[]): Generator<number> {
  for (const r of rings) {
    yield r.length;
    for (const p of r) {
      yield p.x;
      yield p.y;
    }
  }
}

/**
 * The outline(s) of a part where the plane z = `z` passes through it: every triangle the plane crosses gives a short segment, and the
 * segments are joined end to end into closed loops. In world x and y.
 */
function sliceMesh(mesh: THREE.Mesh, z: number): { x: number; y: number }[][] {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const index = geo.index;
  const m = mesh.matrixWorld;
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const segs: [number, number, number, number][] = [];
  const count = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) tri[k].fromBufferAttribute(pos, index ? index.getX(t * 3 + k) : t * 3 + k).applyMatrix4(m);
    const pts: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const da = a.z - z;
      const db = b.z - z;
      if (da < 0 !== db < 0) {
        const f = da / (da - db);
        pts.push([a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f]);
      }
    }
    if (pts.length === 2) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
  }
  // join them: ends that meet (to a thousandth of a millimetre) are the same point
  const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  const at = new Map<string, number[]>();
  segs.forEach((sg, i) => {
    for (const k of [key(sg[0], sg[1]), key(sg[2], sg[3])]) {
      const l = at.get(k);
      if (l) l.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Array<boolean>(segs.length).fill(false);
  const loops: { x: number; y: number }[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop = [{ x: segs[i][0], y: segs[i][1] }];
    let end: [number, number] = [segs[i][2], segs[i][3]];
    for (;;) {
      loop.push({ x: end[0], y: end[1] });
      const next = (at.get(key(end[0], end[1])) ?? []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = true;
      const sg = segs[next];
      end = key(sg[0], sg[1]) === key(end[0], end[1]) ? [sg[2], sg[3]] : [sg[0], sg[1]];
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Millimetres of the part that one repeat of the hatching covers. */
const HATCH_MM = 5;
const hatchTextures = new Map<string, THREE.CanvasTexture>();
const capMaterials = new Map<string, THREE.MeshBasicMaterial>();

/** The material of a cut face: the part's own colour with darker diagonal hatching, drawn only where the stencil is set. */
function capMaterial(colour: string): THREE.MeshBasicMaterial {
  let m = capMaterials.get(colour);
  if (m) return m;
  let tex = hatchTextures.get(colour);
  if (!tex) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const c = canvas.getContext("2d")!;
    const base = new THREE.Color(colour);
    c.fillStyle = `#${base.getHexString()}`;
    c.fillRect(0, 0, 32, 32);
    c.strokeStyle = `#${base.clone().multiplyScalar(0.5).getHexString()}`;
    c.lineWidth = 5;
    c.beginPath();
    for (const o of [-16, 0, 16]) {
      c.moveTo(o, 32 + 4);
      c.lineTo(o + 36, -4);
    }
    c.stroke();
    tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    hatchTextures.set(colour, tex);
  }
  m = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  capMaterials.set(colour, m);
  return m;
}

function cachedGeometry(key: string, used: Set<string>, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  used.add(key);
  let g = geometryCache.get(key);
  if (!g) {
    g = make();
    geometryCache.set(key, g);
  }
  return g;
}

export function shapeFrom(outline: Path[], holes: Path[]): THREE.Shape[] {
  return outline.map((ring) => {
    const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, p.y)));
    for (const hole of holes) {
      shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
    }
    return shape;
  });
}

export function Viewport3D({
  result,
  options,
  stale,
  selectedPanelId = null,
  leftInset = 0,
  focusPanelId = null,
  panelNames = {},
  coverLeft = 0,
}: {
  result: GeometryResult | null;
  options: ViewOptions;
  stale: boolean;
  selectedPanelId?: string | null;
  /** pixels at the left that something else covers: the wing is framed and centred in the rest, though the canvas runs underneath */
  leftInset?: number;
  /**
   * The panel open in the builder. Only its right-hand side is drawn in full: the left half of the wing is ghosted like the other
   * panels, and the camera is framed on this panel (and turns about its centre) when it is opened.
   */
  focusPanelId?: string | null;
  /** panel names by id, for saying which panel the cross-section is in */
  panelNames?: Record<string, string>;
  /** pixels at the left that solid parts of the page cover, details cards included: what is drawn over the wing keeps clear of them */
  coverLeft?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<THREE.Scene | null>(null);
  const camera = useRef<THREE.PerspectiveCamera | null>(null);
  const controls = useRef<OrbitControls | null>(null);
  const content = useRef<THREE.Group | null>(null);
  const renderer = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef = useRef<(force?: boolean, subject?: THREE.Box3) => void>(() => {});
  const insetRef = useRef(leftInset);
  insetRef.current = leftInset;
  const resizeRef = useRef<() => void>(() => {});
  const cube = useRef<HTMLDivElement>(null);
  const framed = useRef(false);
  // the right-hand box of each panel, for framing; when the camera was last framed on a panel, and until when a change of the covered
  // width at the left still counts as part of the same opening
  const panelBoxes = useRef(new Map<string, THREE.Box3>());
  const lastFramedKey = useRef<string | null>(null);
  const reframeUntil = useRef(0);
  // The cut plane: an imaginary plane across the span that can be slid along it. Everything on one side is hidden and the section of the
  // wing at the plane is filled in. `z` is where it is along the span (world z); `keepNegative` is which side stays.
  const units = useStore((st) => st.doc.displayUnits);
  const [cut, setCut] = useState({ on: false, z: 0, keepNegative: true });
  const cutRef = useRef(cut);
  cutRef.current = cut;
  const clipPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e7));
  const cutRange = useRef<[number, number]>([-1000, 1000]);
  const gizmo = useRef<THREE.Object3D | null>(null);
  // the arrow that is the plane's handle, and the invisible fatter shape that is what the pointer actually hits
  const arrow = useRef<THREE.Object3D | null>(null);
  const arrowHit = useRef<THREE.Object3D | null>(null);
  // one flat face per part, drawn only where the plane passes through that part, in the part's own colour with a hatching over it
  const capQuads = useRef<THREE.Object3D[]>([]);
  // what to show for each part, and the stretch of the span it covers: its passes and cap are only on while the plane is inside that stretch
  const capSets = useRef<{ objs: THREE.Object3D[]; lo: number; hi: number }[]>([]);
  // the parts the plane can cut, for drawing the cross-section straight on; and the drawing itself, for the current position
  const sliceParts = useRef<{ mesh: THREE.Mesh; colour: string; lo: number; hi: number }[]>([]);
  const [builtTick, setBuiltTick] = useState(0);
  // The window on the cross-section drawing once it has been zoomed or moved by hand (null: fitted to what is there). Wheel zooms about the
  // pointer, shift and wheel moves along it, and dragging moves it.
  type Win = { cx: number; cy: number; w: number; h: number };
  const [win, setWin] = useState<Win | null>(null);
  const xsSvg = useRef<SVGSVGElement | null>(null);
  const xsLive = useRef<{ win: Win | null; base: Win }>({ win: null, base: { cx: 0, cy: 0, w: 1, h: 1 } });
  const [section, setSection] = useState<{ parts: { colour: string; d: string }[]; outline: string; box: [number, number, number, number] } | null>(null);
  const [failed, setFailed] = useState(false);

  // --- set-up, once -------------------------------------------------------
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let r: THREE.WebGLRenderer;
    try {
      // the stencil buffer is for the cut plane's cross-section; local clipping is what hides one side of the wing
      r = new THREE.WebGLRenderer({ antialias: true, alpha: false, stencil: true });
      r.localClippingEnabled = true;
    } catch {
      setFailed(true);
      return;
    }
    renderer.current = r;
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(r.domElement);
    r.domElement.style.display = "block";
    r.domElement.setAttribute("tabindex", "0");

    const s = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(42, 1, 1, 20000);
    cam.position.set(900, 650, 1100);
    const c = new OrbitControls(cam, r.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;

    s.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(600, 1100, 800);
    s.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-700, -300, -500);
    s.add(fill);

    const g = new THREE.Group();
    s.add(g);
    content.current = g;
    scene.current = s;
    camera.current = cam;
    controls.current = c;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      r.setSize(w, h); // updates the CSS size too — without it a 2x DPR
                       // canvas lays out at twice its intended size
      // Something may cover the left of the canvas (the builder, which is see-through where it has nothing to show). Frame
      // the wing for the part that is not covered, and draw that part in the middle of it.
      const inset = Math.min(insetRef.current, w - 1);
      cam.aspect = (w - inset) / h;
      cam.updateProjectionMatrix();
      if (inset > 0) cam.setViewOffset(w - inset, h, -inset, 0, w, h);
      else cam.clearViewOffset();
      // A narrower viewport can push the wing out of shot. Re-frame only when
      // that has actually happened, so resizing does not undo a deliberate orbit.
      frameRef.current(false);
    };
    resizeRef.current = resize;
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const cubeEl = cube;
    let raf = 0;
    const tick = () => {
      c.update();
      r.render(s, cam);
      if (cubeEl.current) cubeEl.current.style.transform = cubeTransform(cam);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      c.dispose();
      r.dispose();
      el.removeChild(r.domElement);
    };
  }, []);

  // the covered part changed (the builder opened, closed or resized): fit the view to what is left
  useEffect(() => {
    resizeRef.current();
  }, [leftInset]);

  // --- theme --------------------------------------------------------------
  useEffect(() => {
    const t = viewTheme();
    if (scene.current) scene.current.background = new THREE.Color(t.viewport);
  });

  // --- rebuild the scene when geometry or options change ------------------
  useEffect(() => {
    const g = content.current;
    if (!g || !result) return;
    const t = viewTheme();

    const cachedGeometries = new Set<THREE.BufferGeometry>(geometryCache.values());
    while (g.children.length) {
      const child = g.children.pop()!;
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        // geometry in geometryCache is disposed there when no longer used; anything else (the cut plane's frame and cap) is disposed of here
        if (m.geometry && !cachedGeometries.has(m.geometry)) m.geometry.dispose();
        if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
        else (m.material as THREE.Material | undefined)?.dispose?.();
      });
    }

    if (options.axes) {
      const axes = new THREE.AxesHelper(400);
      g.add(axes);
    }

    const opacity = 1 - options.transparency;
    const ghosts = ghostedPanels(
      [...new Set(result.ribs.map((r) => r.panelId))],
      selectedPanelId,
      options.ghostPanels,
    );
    const gOpacity = Math.min(opacity, ghostOpacity(options.ghostTransparency));
    /** A material for a part of a panel: the part's own colour, or a faint (optionally grey) ghost of it. */
    const material = (colour: string, ghost: boolean, soft = false) =>
      new THREE.MeshLambertMaterial({
        color: new THREE.Color(ghost && options.grayGhosts ? t.ghost : colour),
        transparent: ghost || soft || opacity < 1,
        opacity: ghost ? gOpacity : soft ? Math.min(0.28, opacity) : opacity,
        depthWrite: !(ghost || soft),
        side: THREE.DoubleSide,
        clippingPlanes: [clipPlane.current],
      });
    const ribMat = material(t.rib, false);
    const ribGhostMat = material(t.rib, true);

    const halves: THREE.Group[] = [];
    // The right wing runs out towards -z (the Right face of the orientation cube looks along +z from the other side), so it is the
    // flipped copy; the left wing is the geometry as built. The right wing is the one that is worked on, framed and kept in colour.
    const half = new THREE.Group();
    half.scale.z = -1;
    halves.push(half);
    if (options.bothHalves) {
      const mirror = new THREE.Group();
      halves.push(mirror);
    }

    // --- lofted members -------------------------------------------------
    const solidColour: Record<string, string> = {
      spar: t.spar,
      webbing: read("--wb-geo-webbing", "#56b4e9"),
      sheeting: read("--wb-geo-sheeting", "#c9a45c"),
      comb: read("--wb-geo-comb", "#f0e442"),
      leadingEdge: t.le,
      trailingEdge: t.te,
      leadingEdgeExcess: t.le,
      trailingEdgeExcess: t.te,
    };
    const solidShown: Record<string, boolean> = {
      spar: options.spars,
      webbing: options.webbing,
      sheeting: options.sheeting,
      comb: options.combs,
      leadingEdge: options.leadingEdge,
      trailingEdge: options.trailingEdge,
      leadingEdgeExcess: options.leadingEdge,
      trailingEdgeExcess: options.trailingEdge,
    };
    // One material per kind of part, and a ghost version of each. Excess stock is what gets carved
    // away: always drawn as a faint copy of the same wood, so the part that stays reads as solid.
    const solidMats = new Map<string, THREE.Material>();
    const solidGhostMats = new Map<string, THREE.Material>();
    for (const [kind, colour] of Object.entries(solidColour)) {
      solidMats.set(kind, material(colour, false, kind.endsWith("Excess")));
      solidGhostMats.set(kind, material(colour, true));
    }
    let ghostedMeshes = 0;
    let customMeshes = 0;
    // A part with a colour of its own: one material per colour, shared between parts that use it.
    const ownMats = new Map<string, THREE.Material>();
    const ownMaterial = (colour: string, ghost: boolean) => {
      const key = `${colour}|${ghost}`;
      let m = ownMats.get(key);
      if (!m) ownMats.set(key, (m = material(colour, ghost)));
      return m;
    };

    // With a feature open: it is drawn as set, and the rest of its panel is faded but keeps its colour.
    const focus = options.focus ?? null;
    const isFocused = (id: string) => !!focus && focus.ids.some((f) => id === f || id.startsWith(`${f}-`));
    const fades = new Map<string, THREE.Material>();
    const faded = (colour: string, transparency: number) => {
      const key = `${colour}|${transparency}`;
      let m = fades.get(key);
      if (!m) {
        const op = Math.max(0.02, 1 - transparency);
        fades.set(key, (m = new THREE.MeshLambertMaterial({ color: new THREE.Color(colour), transparent: op < 1, opacity: op, depthWrite: op >= 1, side: THREE.DoubleSide, clippingPlanes: [clipPlane.current] })));
      }
      return m;
    };
    const hidden = options.hiddenIds ?? [];
    const isHidden = (id: string) => hidden.some((f) => id === f || id.startsWith(`${f}-`));
    const ribFaded = focus ? faded(t.rib, options.panelTransparency ?? 0.9) : null;

    // With the cut plane on, every solid part also draws into the stencil buffer (back faces count up, front faces count down), so the
    // stencil is non-zero exactly where the plane passes through material: the cap is drawn there.
    const stencilMats = cut.on
      ? [THREE.BackSide, THREE.FrontSide].map(
          (side, i) =>
            new THREE.MeshBasicMaterial({
              side,
              colorWrite: false,
              depthWrite: false,
              depthTest: false,
              clippingPlanes: [clipPlane.current],
              stencilWrite: true,
              stencilFunc: THREE.AlwaysStencilFunc,
              stencilFail: i === 0 ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp,
              stencilZFail: i === 0 ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp,
              stencilZPass: i === 0 ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp,
            }),
        )
      : [];
    // Each part is kept here, with its colour, to be given its stencil passes and its cap once the whole wing is in place.
    const capParts: { container: THREE.Group; mesh: THREE.Mesh; colour: string }[] = [];
    const addStencil = (container: THREE.Group, mesh: THREE.Mesh, colour: string) => capParts.push({ container, mesh, colour });
    const usedGeometry = new Set<string>();
    const noCut = options.noCutStockIds ?? [];
    for (const solid of result.solids) {
      if (!solidShown[solid.kind]) continue;
      if (solid.kind.endsWith("Excess") && noCut.some((f) => solid.id.startsWith(`${f}-`))) continue;
      const geom = cachedGeometry(`s:${hashNumbers(solid.positions)}`, usedGeometry, () => {
        const built = new THREE.BufferGeometry();
        built.setAttribute("position", new THREE.Float32BufferAttribute(solid.positions, 3));
        built.computeVertexNormals();
        return built;
      });
      const ghost = ghosts.has(solid.panelId);
      const inFocusPanel = !!focus && solid.panelId === focus.panelId;
      for (const container of halves) {
        // with a panel open, the whole left half of the wing is a ghost, like the other panels
        const ghostHere = ghost || (!!focusPanelId && container !== half);
        let mat = solid.color ? ownMaterial(solid.color, ghostHere) : (ghostHere ? solidGhostMats : solidMats).get(solid.kind)!;
        if (inFocusPanel && !ghostHere) {
          const colour = solid.color ?? solidColour[solid.kind];
          const own = isFocused(solid.id);
          // the carved-away excess stays a faint copy of the wood whichever is open
          if (!solid.kind.endsWith("Excess")) mat = faded(colour, own ? (options.featureTransparency ?? 0) : (options.panelTransparency ?? 0.9));
        }
        // a hidden feature is 95 % transparent, whatever else is open
        if (!ghostHere && isHidden(solid.id)) mat = faded(solid.color ?? solidColour[solid.kind], 0.95);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.userData.panelId = solid.panelId;
        container.add(mesh);
        // the carved-away stock is not material, and a hidden feature has no cross-section to show
        if (cut.on && !ghostHere && !solid.kind.endsWith("Excess") && !isHidden(solid.id)) addStencil(container, mesh, solid.color ?? solidColour[solid.kind]);
        if (ghostHere) ghostedMeshes++;
        if (solid.color) customMeshes++;
      }
    }

    if (options.ribs) {
      for (const rib of result.ribs) {
        if (rib.outline.length === 0) continue;
        const geom = cachedGeometry(`r:${rib.thicknessMm}|${hashNumbers(ringNumbers([...rib.outline, ...rib.holes]))}|${rib.outline.length}`, usedGeometry, () => {
          const built = new THREE.ExtrudeGeometry(shapeFrom(rib.outline, rib.holes), { depth: rib.thicknessMm, bevelEnabled: false });
          built.translate(0, 0, -rib.thicknessMm / 2);
          return built;
        });
        const ghost = ghosts.has(rib.panelId);
        for (const container of halves) {
          const ghostHere = ghost || (!!focusPanelId && container !== half);
          const mesh = new THREE.Mesh(geom, ghostHere ? ribGhostMat : focus && rib.panelId === focus.panelId && ribFaded ? ribFaded : ribMat);
          mesh.userData.panelId = rib.panelId;
          if (ghostHere) ghostedMeshes++;
          mesh.position.set(rib.origin[0], rib.origin[1], rib.origin[2]);
          // The rib is extruded along its local z, which is already the spanwise
          // axis, so it needs no base rotation. Dihedral tilts it about the
          // chordwise axis so its face stays normal to the panel's span.
          if (options.dihedral) mesh.rotation.x = -rib.dihedralRad;
          container.add(mesh);
          if (cut.on && !ghostHere) addStencil(container, mesh, t.rib);
        }
      }
    }

    for (const h of halves) g.add(h);
    gizmo.current = null;
    arrow.current = null;
    arrowHit.current = null;
    capQuads.current = [];
    capSets.current = [];
    sliceParts.current = [];
    if (cut.on) {
      const wing = new THREE.Box3().setFromObject(g);
      if (!wing.isEmpty()) {
        cutRange.current = [wing.min.z, wing.max.z];
        const c = wing.getCenter(new THREE.Vector3());
        const sz = wing.getSize(new THREE.Vector3());
        const accent = new THREE.Color(read("--wb-accent", "#6d4ae0"));
        // The section. Each part has its own cap, in its own colour with a hatching over it, so the cut face is told apart from the part
        // and from its neighbours. A part draws into the stencil (the two passes), then its cap is drawn only where that left the stencil
        // non-zero, then the stencil is cleared for the next part. The draw order is what keeps the parts apart.
        g.updateMatrixWorld(true);
        capParts.forEach(({ container, mesh, colour }, idx) => {
          const base = 10 + idx * 3;
          const part = new THREE.Box3().setFromObject(mesh);
          if (part.isEmpty()) return;
          const set: { objs: THREE.Object3D[]; lo: number; hi: number } = { objs: [], lo: part.min.z, hi: part.max.z };
          stencilMats.forEach((m, k) => {
            const st = new THREE.Mesh(mesh.geometry, m);
            st.position.copy(mesh.position);
            st.rotation.copy(mesh.rotation);
            st.renderOrder = base + k;
            container.add(st);
            set.objs.push(st);
          });
          const pw = part.max.x - part.min.x + 2;
          const ph = part.max.y - part.min.y + 2;
          const geo = new THREE.PlaneGeometry(pw, ph);
          // the hatching repeats every few millimetres of the part, whatever its size
          const uv = geo.attributes.uv as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * pw) / HATCH_MM, (uv.getY(i) * ph) / HATCH_MM);
          const cap = new THREE.Mesh(geo, capMaterial(colour));
          cap.position.set((part.min.x + part.max.x) / 2, (part.min.y + part.max.y) / 2, cutRef.current.z);
          cap.renderOrder = base + 2;
          cap.onAfterRender = (renderer) => renderer.clearStencil();
          g.add(cap);
          capQuads.current.push(cap);
          set.objs.push(cap);
          // only a part the plane actually passes through has a cross-section: where the plane is outside it (before its start or past its
          // end) nothing of it is drawn into the stencil, so an end of a part is never mistaken for a cut
          const inside = cutRef.current.z >= set.lo && cutRef.current.z <= set.hi;
          for (const o of set.objs) o.visible = inside;
          capSets.current.push(set);
          sliceParts.current.push({ mesh, colour, lo: set.lo, hi: set.hi });
        });
        setBuiltTick((n) => n + 1);
        // the handle: a faint frame of the plane, which is what is dragged
        const w = Math.max(sz.x, 200) * 1.15;
        const h = Math.max(sz.y, 120) * 2.2;
        const frame = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
        );
        const edge = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2, -h / 2, 0), new THREE.Vector3(w / 2, -h / 2, 0), new THREE.Vector3(w / 2, h / 2, 0), new THREE.Vector3(-w / 2, h / 2, 0)]),
          new THREE.LineBasicMaterial({ color: accent }),
        );
        frame.add(edge);
        frame.position.set(c.x, c.y, cutRef.current.z);
        frame.renderOrder = 2;
        g.add(frame);
        gizmo.current = frame;
        // The handle: a double-headed arrow along the span, level with the plane, showing which way it slides. It is drawn on top of
        // everything, and is the only part that is dragged.
        // sized to the wing, so it is easy to see and to pick up whether the wing is long or short
        const u = Math.max(sz.x * 0.5, sz.z * 0.06);
        const arrowMat = new THREE.MeshBasicMaterial({ color: accent, depthTest: false, transparent: true });
        const grp = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(u * 0.06, u * 0.06, u * 2, 16), arrowMat);
        grp.add(shaft);
        for (const dir of [1, -1]) {
          const head = new THREE.Mesh(new THREE.ConeGeometry(u * 0.16, u * 0.34, 20), arrowMat);
          head.position.y = dir * (u + u * 0.17);
          head.rotation.z = dir === 1 ? 0 : Math.PI;
          grp.add(head);
        }
        grp.rotation.x = Math.PI / 2; // the cylinders run along y; turn them to run along the span, z
        const holder = new THREE.Group();
        holder.add(grp);
        // beside the wing, past the trailing edge of its whole extent, so the arrow never touches it or covers the cross-section
        holder.position.set(wing.max.x + u * 0.8, c.y, cutRef.current.z);
        holder.renderOrder = 3;
        grp.traverse((o) => (o.renderOrder = 3));
        g.add(holder);
        arrow.current = holder;
        // a wider, invisible stand-in for the pointer to hit: the arrow itself is thin
        const hitShape = new THREE.Mesh(new THREE.CylinderGeometry(u * 0.22, u * 0.22, u * 2.7, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hitShape.rotation.x = Math.PI / 2;
        const hitHolder = new THREE.Group();
        hitHolder.add(hitShape);
        hitHolder.position.copy(holder.position);
        g.add(hitHolder);
        arrowHit.current = hitHolder;
      }
    }
    // geometry of parts that are no longer in the wing
    for (const [key, geo] of geometryCache) {
      if (!usedGeometry.has(key)) {
        geo.dispose();
        geometryCache.delete(key);
      }
    }
    // Tests and assistive tech can read how many parts are drawn as ghosts without looking at pixels.
    host.current?.setAttribute("data-ghosted", String(ghostedMeshes));
    host.current?.setAttribute("data-custom-coloured", String(customMeshes));

    // Where each panel is, on the right-hand side, for framing the camera on it. (The view itself is left alone here: a change to the
    // wing, or a different feature, must not move the camera.)
    half.updateMatrixWorld(true);
    const boxes = new Map<string, THREE.Box3>();
    for (const m of half.children) {
      const id = m.userData.panelId as string | undefined;
      if (!id) continue;
      const b = new THREE.Box3().setFromObject(m);
      if (b.isEmpty()) continue;
      const have = boxes.get(id);
      if (have) have.union(b);
      else boxes.set(id, b);
    }
    panelBoxes.current = boxes;
  }, [result, options, selectedPanelId, focusPanelId, cut.on]);

  // --- the cut plane ----------------------------------------------------
  // Moving it changes only the plane and the two things drawn at it; nothing is rebuilt.
  useEffect(() => {
    const p = clipPlane.current;
    if (!cut.on) p.set(new THREE.Vector3(0, 0, -1), 1e7);
    else if (cut.keepNegative) p.set(new THREE.Vector3(0, 0, -1), cut.z);
    else p.set(new THREE.Vector3(0, 0, 1), -cut.z);
    for (const o of [gizmo.current, arrow.current, arrowHit.current, ...capQuads.current]) if (o) o.position.z = cut.z;
    for (const set of capSets.current) {
      const inside = cut.on && cut.z >= set.lo && cut.z <= set.hi;
      for (const o of set.objs) o.visible = inside;
    }
  }, [cut]);

  // The cross-section as a flat drawing, seen straight on from the side that is kept: every part the plane passes through, in its colour.
  useEffect(() => {
    if (!cut.on) {
      setSection(null);
      setWin(null);
      return;
    }
    const flip = cut.keepNegative ? 1 : -1; // seen from the kept side, so from the other side the picture is the mirror of the first
    const parts: { colour: string; d: string }[] = [];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of sliceParts.current) {
      if (cut.z < p.lo || cut.z > p.hi) continue;
      const loops = sliceMesh(p.mesh, cut.z);
      if (loops.length === 0) continue;
      let d = "";
      for (const l of loops) {
        d += l.map((q, i) => `${i ? "L" : "M"}${(flip * q.x).toFixed(2)} ${(-q.y).toFixed(2)}`).join("") + "Z";
        for (const q of l) {
          x0 = Math.min(x0, flip * q.x);
          x1 = Math.max(x1, flip * q.x);
          y0 = Math.min(y0, -q.y);
          y1 = Math.max(y1, -q.y);
        }
      }
      parts.push({ colour: p.colour, d });
    }
    // The original airfoil at the plane, before any feature: the sections of the two ribs either side of it, blended by how far between
    // them the plane is. The same points in each rib, so they blend point for point; where they are not, the nearer rib's is used.
    let outline = "";
    if (result && result.ribs.length > 0) {
      const at = Math.abs(cut.z);
      const ribs = [...result.ribs].sort((a, b) => a.origin[2] - b.origin[2]);
      const next = ribs.findIndex((r) => r.origin[2] >= at);
      const a = next <= 0 ? ribs[0] : ribs[next - 1];
      const b = next === -1 ? ribs[ribs.length - 1] : ribs[Math.max(next, 0)];
      // Each point of the section is joined to the same point of the next rib, and the plane cuts that line where its z is the plane's. A rib
      // is tilted by the dihedral, so a point near the top of the section is further along the span than one near the bottom: the cut is not
      // at the same fraction between the ribs for every point, and doing it point by point is what keeps the outline on the parts, which are
      // cut the same way.
      const world = (r: (typeof ribs)[number], q: { x: number; y: number }) => ({
        x: r.origin[0] + q.x,
        y: r.origin[1] + q.y * Math.cos(r.dihedralRad),
        z: r.origin[2] - q.y * Math.sin(r.dihedralRad),
      });
      const same = a.silhouette.length === b.silhouette.length;
      const pts = a.silhouette.map((q, i) => {
        const pa = world(a, q);
        if (!same || a === b) return pa;
        const pb = world(b, b.silhouette[i]);
        const t = pb.z === pa.z ? 0 : Math.min(1.5, Math.max(-0.5, (at - pa.z) / (pb.z - pa.z)));
        return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
      });
      outline = pts.map((q, i) => `${i ? "L" : "M"}${(flip * q.x).toFixed(2)} ${(-q.y).toFixed(2)}`).join("") + "Z";
      for (const q of pts) {
        x0 = Math.min(x0, flip * q.x);
        x1 = Math.max(x1, flip * q.x);
        y0 = Math.min(y0, -q.y);
        y1 = Math.max(y1, -q.y);
      }
    }
    const box: [number, number, number, number] = Number.isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : [0, 0, 1, 1];
    setSection({ parts, outline, box });
    // A zoomed window follows the section as the plane is slid: the zoom stays, and the window is put back over the middle of the section
    // (which moves with the wing's sweep and dihedral), so it does not drift out of view.
    setWin((w) => (w ? { ...w, cx: box[0] + box[2] / 2, cy: box[1] + box[3] / 2 } : w));
  }, [cut.on, cut.z, cut.keepNegative, builtTick, result]);

  // Dragging the plane's arrow slides it along the span. The orbit is switched off for the drag, and back on after.
  useEffect(() => {
    const el = renderer.current?.domElement;
    const cam = camera.current;
    const ctrl = controls.current;
    if (!el || !cam || !ctrl || !cut.on) return;
    const ray = new THREE.Raycaster();
    let dragging = false;
    const ndc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const over = (e: PointerEvent) => {
      const f = arrowHit.current;
      if (!f) return false;
      ray.setFromCamera(ndc(e), cam);
      return ray.intersectObject(f, true).length > 0;
    };
    // Where along the span the pointer is: the point under it on the horizontal plane through the arrow, as a z.
    const spanAt = (e: PointerEvent): number | null => {
      ray.setFromCamera(ndc(e), cam);
      const y = arrow.current ? arrow.current.position.y : 0;
      const hit = new THREE.Vector3();
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit) ? hit.z : null;
    };
    // The plane keeps the distance it had from the pointer when the arrow was picked up, so it does not jump to the pointer.
    let grab = 0;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !over(e)) return;
      const at = spanAt(e);
      grab = at === null ? 0 : cutRef.current.z - at;
      dragging = true;
      ctrl.enabled = false;
      el.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!dragging) {
        el.style.cursor = over(e) ? "grab" : "";
        return;
      }
      el.style.cursor = "grabbing";
      const at = spanAt(e);
      if (at !== null) {
        const [lo, hi] = cutRange.current;
        setCut((c) => ({ ...c, z: Math.min(hi, Math.max(lo, at + grab)) }));
      }
    };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      ctrl.enabled = true;
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.style.cursor = "";
      ctrl.enabled = true;
    };
  }, [cut.on]);

  /**
   * Where the plane is, in the wing's own terms: which panel, and at which rib or between which two. The wing is the same either side of
   * the middle, so the distance from the middle is what counts.
   */
  const cutWhere = (): { panel: string; rib: string; along: string; centre: string } | null => {
    if (!cut.on || !result || result.ribs.length === 0) return null;
    const at = Math.abs(cut.z);
    const ribs = [...result.ribs].sort((a, b) => a.origin[2] - b.origin[2]);
    const name = (id: string) => panelNames[id] ?? "Panel";
    const num = (r: (typeof ribs)[number]) => r.index + 1;
    let panelId = ribs[0].panelId;
    let rib: string;
    // A rib is a slab, tilted by the dihedral, so the plane can meet it at one height and miss it at another: it counts as being on the
    // rib if it meets it anywhere. The nearest, if it is on more than one.
    const reach = (r: (typeof ribs)[number]) => {
      const ys = r.outline.flat().map((p) => p.y);
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      const sin = Math.sin(r.dihedralRad);
      const cos = Math.cos(r.dihedralRad);
      const zs = [lo, hi].flatMap((y) => [-r.thicknessMm / 2, r.thicknessMm / 2].map((z) => r.origin[2] - y * sin + z * cos));
      return [Math.min(...zs), Math.max(...zs)] as const;
    };
    const touching = ribs.filter((r) => {
      const [lo, hi] = reach(r);
      return at >= lo - 1e-6 && at <= hi + 1e-6;
    });
    const on = touching.sort((a, b) => Math.abs(a.origin[2] - at) - Math.abs(b.origin[2] - at))[0];
    const next = ribs.findIndex((r) => r.origin[2] > at);
    if (on) {
      panelId = on.panelId;
      rib = `at rib ${num(on)}`;
    } else if (next === 0) {
      rib = `before rib ${num(ribs[0])}`;
    } else if (next === -1) {
      const last = ribs[ribs.length - 1];
      panelId = last.panelId;
      rib = `past rib ${num(last)}`;
    } else {
      const a = ribs[next - 1];
      const b = ribs[next];
      panelId = a.panelId;
      rib = a.panelId === b.panelId ? `between rib ${num(a)} and rib ${num(b)}` : `between rib ${num(a)} and ${name(b.panelId)} rib ${num(b)}`;
    }
    // how far along its own panel the plane is, from the panel's root rib, and how far from the middle of the wing
    const root = Math.min(...ribs.filter((r) => r.panelId === panelId).map((r) => r.origin[2]));
    const fmt = (mm: number) => formatLength(mm, units, units === "in" ? 2 : 1);
    return {
      panel: `${name(panelId)} (${cut.z < 0 ? "right" : "left"} wing)`,
      rib: rib.charAt(0).toUpperCase() + rib.slice(1),
      along: `${fmt(Math.max(0, at - root))} from panel`,
      centre: `${fmt(at)} from center`,
    };
  };

  const toggleCut = () => {
    if (cut.on) {
      setCut({ ...cut, on: false });
      return;
    }
    // it starts part way along the right wing, with the outboard part kept, so the cut face is turned to the camera's side
    const box = content.current ? new THREE.Box3().setFromObject(content.current) : null;
    const z = box && !box.isEmpty() ? (box.min.z < 0 ? box.min.z * 0.4 : (box.min.z + box.max.z) / 2) : 0;
    setCut({ on: true, z, keepNegative: true });
  };

  // --- framing ------------------------------------------------------------
  frameRef.current = (force = true, subject?: THREE.Box3) => {
    const cam = camera.current;
    const ctrl = controls.current;
    const g = content.current;
    if (!cam || !ctrl || !g) return;
    const box = subject ?? new THREE.Box3().setFromObject(g);
    if (box.isEmpty()) return;

    if (!force) {
      cam.updateMatrixWorld();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
      );
      if (frustum.intersectsBox(box)) return; // still in shot; leave the camera alone
    }
    const size = box.getSize(new THREE.Vector3()).length() || 1000;
    const centre = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(...START_DIR).normalize();

    // Frame for the narrower of the two fields of view. Using the vertical FOV
    // alone pushes the wing off the sides of a tall, narrow viewport — which is
    // exactly what a phone is.
    const vFov = (cam.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
    const distance = Math.max(size / 2 / Math.tan(vFov / 2), size / 2 / Math.tan(hFov / 2)) * 1.15;
    cam.position.copy(centre.clone().add(dir.multiplyScalar(distance)));
    ctrl.target.copy(centre);
    ctrl.update();
  };

  // Frame the wing once, when it first appears. After that, an edit keeps the user's view unless
  // the wing has left the shot.
  useEffect(() => {
    if (!result || (result.ribs.length === 0 && result.solids.length === 0)) return;
    frameRef.current(!framed.current);
    framed.current = true;
  }, [result]);

  // Opening a panel frames the camera on its right-hand side, always from the same direction and with the same margin, turning about the
  // middle of it; closing the builder frames the whole wing the same way. Nothing else moves the view: another feature on the same
  // panel, an edit, new geometry. The width the builder covers at the left settles just after it opens, so for a moment a change of it
  // is part of the same opening and frames again.
  useEffect(() => {
    const key = focusPanelId ?? "";
    if (lastFramedKey.current === null) {
      lastFramedKey.current = key; // the first showing is framed by the effect above
      return;
    }
    const now = performance.now();
    if (key === lastFramedKey.current && now > reframeUntil.current) return;
    if (key !== lastFramedKey.current) reframeUntil.current = now + 800;
    lastFramedKey.current = key;
    const box = focusPanelId ? panelBoxes.current.get(focusPanelId) : undefined;
    frameRef.current(true, box && !box.isEmpty() ? box : undefined);
  }, [focusPanelId, leftInset]);

  /** Turn the camera to look at the wing from `dir`, keeping the distance and target. */
  const snapTo = (dir: readonly number[]) => {
    const cam = camera.current;
    const ctrl = controls.current;
    if (!cam || !ctrl) return;
    const offset = cam.position.clone().sub(ctrl.target);
    const dist = offset.length();
    const from = offset.clone().normalize();
    const to = new THREE.Vector3(...dir).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 220);
      const e = 1 - (1 - t) ** 3;
      const part = new THREE.Quaternion().slerp(q, e);
      cam.position.copy(ctrl.target).add(from.clone().applyQuaternion(part).multiplyScalar(dist));
      ctrl.update();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const base: Win = section
    ? { cx: section.box[0] + section.box[2] / 2, cy: section.box[1] + section.box[3] / 2, w: Math.max(section.box[2], 1) + 8, h: Math.max(section.box[3], 1) + 8 }
    : { cx: 0, cy: 0, w: 1, h: 1 };
  const shown = win ?? base;
  xsLive.current = { win, base };

  // wheel on the drawing: zoom about the pointer; with shift, move along it
  useEffect(() => {
    const svg = xsSvg.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { win: w0, base: b0 } = xsLive.current;
      const v = w0 ?? b0;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      if (e.shiftKey) {
        setWin({ ...v, cx: v.cx + (e.deltaY + e.deltaX) * (v.w / Math.max(svg.clientWidth, 1)) * 0.5 });
        return;
      }
      const k = Math.min(Math.max(e.deltaY < 0 ? 1 / 1.15 : 1.15, 0.2), 5);
      const w2 = Math.min(Math.max(v.w * k, b0.w / 40), b0.w * 8);
      const f = w2 / v.w;
      setWin({ cx: pt.x - (pt.x - v.cx) * f, cy: pt.y - (pt.y - v.cy) * f, w: w2, h: v.h * f });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [cut.on, section?.outline]);
  const xsDrag = useRef<{ x: number; y: number } | null>(null);

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-viewport p-8 text-center">
        <strong className="text-sm font-medium text-fg">This browser cannot draw the 3D view</strong>
        <p className="max-w-sm text-xs text-muted">
          WebGL is unavailable or switched off. Everything else still works: the panel list, the rib preview
          in the builder, and both exports all read from the same geometry.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-viewport">
      <div ref={host} className="h-full w-full overflow-hidden" />
      <div className="absolute right-4 top-40 flex flex-col items-end gap-2 text-xs">
        <button
          type="button"
          aria-pressed={cut.on}
          onClick={toggleCut}
          title="Slice the wing with a plane across the span: hide one side and see the cross-section"
          className={`rounded-sm border px-3 py-1.5 shadow-card ${cut.on ? "border-accent bg-selected text-on-selected" : "border-border-input bg-surface-raised text-muted hover:text-fg"}`}
        >
          Cross Section View
        </button>
        {cut.on && (
          <div className="flex flex-col items-end gap-2 rounded-md border border-border bg-surface-raised p-2 shadow-card">
            <label className="flex items-center gap-2">
              <span className="text-muted">Position</span>
              <input
                type="range"
                aria-label="Cross Section View position"
                min={Math.floor(cutRange.current[0])}
                max={Math.ceil(cutRange.current[1])}
                step={1}
                value={Math.round(cut.z)}
                onChange={(e) => setCut({ ...cut, z: Number(e.target.value) })}
                className="w-32"
              />
            </label>
            <button type="button" onClick={() => setCut({ ...cut, keepNegative: !cut.keepNegative })} className="rounded-sm border border-border-input bg-input-bg px-2 py-1 text-muted hover:text-fg">
              Flip
            </button>
            {(() => {
              const w = cutWhere();
              return (
                w && (
                  <div aria-live="polite" aria-label="Where the cross-section is" className="text-right text-micro leading-snug text-muted">
                    <div>{w.panel}</div>
                    <div>{w.rib}</div>
                    <div>{w.along}</div>
                    <div>{w.centre}</div>
                  </div>
                )
              );
            })()}
          </div>
        )}
      </div>
      {cut.on && (
        <figure
          aria-label="Cross-section, straight on"
          className="absolute top-3 flex h-[22rem] flex-col rounded-md border border-border/70 bg-surface-raised/45 p-2 backdrop-blur-md"
          style={{ left: Math.max(leftInset, coverLeft) + 16, right: 170 }}
        >
          <figcaption className="flex items-center justify-between px-1 text-micro text-muted">
            <span>Cross-section, straight on · scroll to zoom, drag to move</span>
            {win && (
              <button type="button" onClick={() => setWin(null)} className="rounded-sm px-1 hover:text-fg">
                Reset view
              </button>
            )}
          </figcaption>
          {section && section.outline ? (
            <svg
              ref={xsSvg}
              className="min-h-0 w-full flex-1 cursor-grab touch-none active:cursor-grabbing"
              viewBox={`${shown.cx - shown.w / 2} ${shown.cy - shown.h / 2} ${shown.w} ${shown.h}`}
              preserveAspectRatio="xMidYMid meet"
              onDoubleClick={() => setWin(null)}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                xsDrag.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerMove={(e) => {
                const d = xsDrag.current;
                if (!d) return;
                const svg = e.currentTarget;
                const v = xsLive.current.win ?? xsLive.current.base;
                // user units per screen pixel: the drawing is scaled to fit whichever way it is the tighter
                const per = 1 / Math.min(svg.clientWidth / v.w, svg.clientHeight / v.h);
                xsDrag.current = { x: e.clientX, y: e.clientY };
                setWin({ ...v, cx: v.cx - (e.clientX - d.x) * per, cy: v.cy - (e.clientY - d.y) * per });
              }}
              onPointerUp={() => (xsDrag.current = null)}
              onPointerCancel={() => (xsDrag.current = null)}
              role="img"
              aria-label="The wing cut by the plane, seen straight on"
            >
              <defs>
                {[...new Set(section.parts.map((p) => p.colour))].map((c, i) => (
                  <pattern key={c} id={`xs-hatch-${i}`} patternUnits="userSpaceOnUse" width="1.6" height="1.6" patternTransform="rotate(45)">
                    <rect width="1.6" height="1.6" fill={`#${new THREE.Color(c).lerp(new THREE.Color("#ffffff"), 0.62).getHexString()}`} />
                    <line x1="0" y1="0" x2="0" y2="1.6" stroke={`#${new THREE.Color(c).lerp(new THREE.Color("#ffffff"), 0.3).getHexString()}`} strokeWidth="0.45" />
                  </pattern>
                ))}
              </defs>
              {/* the airfoil as it was before any feature, as a thin line behind the parts */}
              <path d={section.outline} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" className="text-muted" />
              {section.parts.map((p, i) => (
                <path
                  key={i}
                  d={p.d}
                  fillRule="evenodd"
                  fill={`url(#xs-hatch-${[...new Set(section.parts.map((q) => q.colour))].indexOf(p.colour)})`}
                  stroke={p.colour}
                  strokeOpacity="0.85"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
              ))}
            </svg>
          ) : (
            <p className="flex flex-1 items-center justify-center text-xs text-muted">Nothing to show here.</p>
          )}
        </figure>
      )}
      {stale && (
        <span className="absolute left-4 top-4 rounded-pill border border-border bg-surface-raised px-4 py-1 text-micro text-muted">
          Recomputing…
        </span>
      )}
      <div
        role="group"
        aria-label="View orientation"
        className="absolute right-4 top-4 h-24 w-24 [perspective:300px]"
        style={{ "--half": "32px" } as React.CSSProperties}
      >
        <div ref={cube} className="relative mx-auto mt-8 h-16 w-16 [transform-style:preserve-3d]">
          {CUBE_FACES.map((f) => (
            <button
              key={f.label}
              type="button"
              aria-label={`View from the ${f.label.toLowerCase()}`}
              title={f.label}
              onClick={() => snapTo(f.dir)}
              style={{ transform: f.css }}
              className="absolute inset-0 flex items-center justify-center rounded-sm border border-border-strong bg-surface-raised text-micro text-fg opacity-90 hover:bg-selected hover:text-on-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {result && result.ribs.length === 0 && result.solids.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-muted">
          <strong className="text-sm font-medium text-fg">Nothing to show yet</strong>
          <span className="text-xs">Add a panel and generate its ribs.</span>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {result
          ? `Wing view: ${result.ribs.length} ribs and ${result.solids.filter((x) => !x.kind.endsWith("Excess")).length} structural members across ${new Set(result.ribs.map((r) => r.panelId)).size} panels.${(() => {
              const n = ghostedPanels([...new Set(result.ribs.map((r) => r.panelId))], selectedPanelId, options.ghostPanels).size;
              return n > 0 ? ` ${n} ${n === 1 ? "panel" : "panels"} shown as ghosts.` : "";
            })()}`
          : "Wing view loading."}
      </p>
    </div>
  );
}
