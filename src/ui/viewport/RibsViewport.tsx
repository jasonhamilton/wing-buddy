/**
 * A small 3D view of one panel's ribs, to turn round and look at: drag to orbit, scroll to zoom. Only the ribs, each
 * extruded by its own thickness, half ribs cut, the selected rib in the accent colour. It turns about the centre of
 * the panel section (the middle of the ribs' extent) and stays centred on it as the ribs change. It shows the right
 * wing, as the main view and the planform do: root at the left, the tip running off to the right. It shows the ribs as
 * they start: the airfoil section of each rib before any feature touches it, but a half rib is still the half it was
 * defined as. A light grey veil over the panel's whole airfoil surface can be switched on and off, just enough to see
 * its shape. The panel is fitted into the frame whole when it first shows and whenever its size changes. The view is
 * perspective or orthographic, switched at the corner. It draws when something changes, not continuously.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GeometryResult } from "../../geometry/types";
import { shapeFrom } from "./Viewport3D";
import { viewTheme } from "./theme";

export type Projection = "perspective" | "orthographic";

const START_DIR = new THREE.Vector3(0.8, 0.55, 1).normalize();
/** How much of the frame the panel may fill, across or up and down: the rest is margin. */
const FIT = 0.88;

type Rig = {
  r: THREE.WebGLRenderer;
  scene: THREE.Scene;
  persp: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
  cam: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  ctl: OrbitControls;
  group: THREE.Group;
  /** half the height the orthographic view shows at zoom 1 */
  halfH: number;
  /** the radius of the panel section the camera was last fitted to */
  radius: number;
  /** the points of the panel section the camera was fitted to, to fit again if the frame changes shape */
  points: THREE.Vector3[];
  aspect: number;
  draw: () => void;
  dom: HTMLCanvasElement;
  host: HTMLElement | null;
};

/**
 * Put the camera where the whole panel fits: along `dir` from `centre`, as near as keeps every point of it inside the
 * frame with a margin. Works from the corners as this camera sees them, so a wide frame and a tall one both fit.
 */
function fitCamera(t: Rig, points: THREE.Vector3[], centre: THREE.Vector3, dir: THREE.Vector3) {
  const back = dir.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right).normalize();
  const tanHalf = Math.tan((t.persp.fov * Math.PI) / 360);
  let dist = 1;
  let halfH = 1;
  for (const p of points) {
    const d = p.clone().sub(centre);
    const x = Math.abs(d.dot(right));
    const y = Math.abs(d.dot(up));
    const zc = d.dot(back); // how far toward the camera the point is
    // seen from `dist` away, a point is `dist - zc` deep, and the frame is that deep times tan wide and high
    dist = Math.max(dist, zc + Math.max(x / (tanHalf * t.aspect * FIT), y / (tanHalf * FIT)));
    halfH = Math.max(halfH, y / FIT, x / (t.aspect * FIT));
  }
  t.halfH = halfH;
  t.ortho.zoom = 1;
  fitOrtho(t);
  t.cam.up.set(0, 1, 0);
  t.cam.position.copy(centre).addScaledVector(back, t.cam === t.persp ? dist : Math.max(dist, halfH * 4, 1000));
  t.cam.lookAt(centre);
}

const fitOrtho = (t: Rig) => {
  const o = t.ortho;
  o.left = -t.halfH * t.aspect;
  o.right = t.halfH * t.aspect;
  o.top = t.halfH;
  o.bottom = -t.halfH;
  o.updateProjectionMatrix();
};

export function RibsViewport({ result, panelId, selectedRibId }: { result: GeometryResult | null; panelId: string; selectedRibId: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const rig = useRef<Rig | null>(null);
  const framed = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [count, setCount] = useState(0);
  const [projection, setProjection] = useState<Projection>("perspective");
  const [showVeil, setShowVeil] = useState(true);

  // set-up, once
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let r: THREE.WebGLRenderer;
    try {
      r = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(r.domElement);
    r.domElement.style.display = "block";
    r.domElement.setAttribute("tabindex", "0");
    const scene = new THREE.Scene();
    const persp = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    persp.position.set(300, 200, 400);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(500, 900, 700);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-600, -200, -400);
    scene.add(fill);
    const group = new THREE.Group();
    // The wing is built along +z, which is the pilot's left. The right wing is its mirror, as in the main view.
    group.scale.z = -1;
    scene.add(group);

    const t = { r, scene, persp, ortho, cam: persp, group, halfH: 200, radius: 0, points: [], aspect: 1, dom: r.domElement, host: el } as unknown as Rig;
    t.draw = () => {
      scene.background = new THREE.Color(viewTheme().viewport);
      r.render(scene, t.cam);
      // where it turns about, for anyone (or any test) who wants to know
      el.setAttribute("data-pivot", t.ctl.target.toArray().map((n) => Math.round(n * 10) / 10).join(","));
      el.setAttribute("data-camera", t.cam.position.toArray().map((n) => Math.round(n * 10) / 10).join(","));
    };
    t.ctl = new OrbitControls(persp, r.domElement);
    t.ctl.addEventListener("change", t.draw);
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      r.setSize(w, h);
      const reshaped = Math.abs(w / h - t.aspect) > 0.03 * t.aspect;
      t.aspect = w / h;
      persp.aspect = t.aspect;
      persp.updateProjectionMatrix();
      fitOrtho(t);
      // A frame of a different shape (the window or the layout changed): fit the panel to it again, looking the same way.
      if (reshaped && t.points.length) {
        const dir = t.cam.position.clone().sub(t.ctl.target).normalize();
        fitCamera(t, t.points, t.ctl.target.clone(), dir);
        t.ctl.update();
      }
      t.draw();
    };
    rig.current = t;
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      t.ctl.dispose();
      r.dispose();
      el.removeChild(r.domElement);
      rig.current = null;
    };
  }, []);

  // the ribs
  useEffect(() => {
    const t = rig.current;
    if (!t || !result) return;
    const ribs = result.ribs.filter((x) => x.panelId === panelId).sort((a, b) => a.index - b.index);
    const theme = viewTheme();
    while (t.group.children.length) {
      const child = t.group.children.pop()!;
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
    }
    const ribMat = new THREE.MeshStandardMaterial({ color: theme.rib, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    const pickMat = new THREE.MeshStandardMaterial({ color: theme.accent, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
    const first = ribs[0];
    // Each rib sits at its own place along the panel, turned by the dihedral: one frame per rib holds its part.
    const place = (rib: (typeof ribs)[number], obj: THREE.Object3D) => {
      obj.position.set(rib.origin[0] - first.origin[0], rib.origin[1] - first.origin[1], rib.origin[2] - first.origin[2]);
      obj.rotation.x = -rib.dihedralRad;
    };
    for (const rib of ribs) {
      // The rib as it starts: its airfoil section before any feature cuts it, but a half rib is the half it was defined as.
      const outline = rib.profile;
      if (outline.length === 0 || outline[0].length === 0) continue;
      const frame = new THREE.Group();
      place(rib, frame);
      const geom = new THREE.ExtrudeGeometry(shapeFrom(outline, []), { depth: rib.thicknessMm, bevelEnabled: false });
      geom.translate(0, 0, -rib.thicknessMm / 2);
      frame.add(new THREE.Mesh(geom, rib.ribId === selectedRibId ? pickMat : ribMat));
      t.group.add(frame);
    }

    // The veil: a skin through the unaltered profiles from the root rib to the tip rib.
    let veil = 0;
    const rings = ribs.map((rib) => rib.silhouette);
    if (showVeil && rings.length > 1 && rings.every((ring) => ring.length === rings[0].length && ring.length > 2)) {
      const n = rings[0].length;
      const pos: number[] = [];
      ribs.forEach((rib, k) => {
        const c = Math.cos(-rib.dihedralRad);
        const sn = Math.sin(-rib.dihedralRad);
        for (const q of rings[k]) {
          // a point of the profile (x, y, 0) turned about x by the dihedral, then moved to the rib's place
          pos.push(rib.origin[0] - first.origin[0] + q.x, rib.origin[1] - first.origin[1] + q.y * c, rib.origin[2] - first.origin[2] + q.y * sn);
        }
      });
      const idx: number[] = [];
      for (let k = 0; k < rings.length - 1; k++) {
        for (let i = 0; i < n; i++) {
          const a0 = k * n + i;
          const a1 = k * n + ((i + 1) % n);
          const b0 = (k + 1) * n + i;
          const b1 = (k + 1) * n + ((i + 1) % n);
          idx.push(a0, b0, a1, a1, b0, b1);
        }
      }
      const vg = new THREE.BufferGeometry();
      vg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      vg.setIndex(idx);
      vg.computeVertexNormals();
      const vm = new THREE.Mesh(vg, new THREE.MeshStandardMaterial({ color: theme.ghost, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false, roughness: 0.9, metalness: 0 }));
      vm.renderOrder = 2;
      t.group.add(vm);
      veil = 1;
    }
    t.host?.setAttribute("data-veil", String(veil));
    setCount(ribs.length);

    if (ribs.length) {
      // The pivot and the framing come from the panel section itself (every rib's unaltered profile, in place), not from
      // whatever is drawn, so switching the surface on or off, picking a rib, or cutting the ribs with a feature never
      // moves the camera.
      const points: THREE.Vector3[] = [];
      for (const rib of ribs) {
        const c = Math.cos(-rib.dihedralRad);
        const sn = Math.sin(-rib.dihedralRad);
        const ring = rib.silhouette.length ? rib.silhouette : (rib.profile[0] ?? []);
        for (const q of ring) points.push(new THREE.Vector3(rib.origin[0] - first.origin[0] + q.x, rib.origin[1] - first.origin[1] + q.y * c, (rib.origin[2] - first.origin[2] + q.y * sn) * t.group.scale.z)); // z: the group is mirrored to show the right wing
      }
      const box = new THREE.Box3().setFromPoints(points);
      const centre = box.getCenter(new THREE.Vector3());
      const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
      t.points = points;
      const sized = Math.abs(radius - t.radius) > Math.max(1, 0.01 * radius); // the panel grew or shrank
      if (framed.current !== panelId || sized) {
        // Fit the whole panel in the frame: first time this panel shows, and when its size changes. The way the user is
        // looking is kept; the first time it is the starting direction.
        const dir = framed.current === panelId ? t.cam.position.clone().sub(t.ctl.target).normalize() : START_DIR.clone();
        t.ctl.target.copy(centre);
        fitCamera(t, points, centre, dir);
        framed.current = panelId;
        t.radius = radius;
      } else {
        // Only the position of the section changed (not its size): the pivot stays its centre, and the camera moves with it by
        // the same amount, so the view does not jump. When nothing about the section changed this is no movement at all.
        const delta = centre.clone().sub(t.ctl.target);
        if (delta.lengthSq() > 1e-6) {
          t.ctl.target.copy(centre);
          t.cam.position.add(delta);
        }
      }
      t.ctl.update();
    }
    t.draw();
  }, [result, panelId, selectedRibId, showVeil]);

  // perspective or orthographic: the same view, the same pivot, a different camera
  useEffect(() => {
    const t = rig.current;
    if (!t || t.cam === (projection === "perspective" ? t.persp : t.ortho)) return;
    const target = t.ctl.target.clone();
    const dir = t.cam.position.clone().sub(target);
    const dist = dir.length();
    dir.normalize();
    const tanHalf = Math.tan((t.persp.fov * Math.PI) / 360);
    const next = projection === "perspective" ? t.persp : t.ortho;
    let distance = dist;
    if (projection === "orthographic") {
      // what the perspective camera saw across the pivot becomes what the orthographic one shows
      t.halfH = dist * tanHalf;
      t.ortho.zoom = 1;
      fitOrtho(t);
      distance = Math.max(dist, 1000);
    } else {
      distance = t.halfH / t.ortho.zoom / tanHalf;
    }
    t.ctl.dispose();
    next.position.copy(target).addScaledVector(dir, distance);
    next.up.set(0, 1, 0);
    next.lookAt(target);
    t.cam = next;
    t.ctl = new OrbitControls(next, t.dom);
    t.ctl.target.copy(target);
    t.ctl.addEventListener("change", t.draw);
    t.ctl.update();
    t.draw();
  }, [projection]);

  if (failed) return <p className="rounded-md bg-surface-sunken px-3 py-6 text-center text-xs text-muted">The 3D view could not start in this browser.</p>;
  return (
    <div className="relative">
      <div
        ref={host}
        data-ribs-viewport
        data-rib-count={count}
        data-projection={projection}
        role="group"
        aria-label={`3D view of the ${count} ribs. Drag to turn it, scroll to zoom.`}
        className="h-80 w-full overflow-hidden rounded-md border border-border bg-viewport"
      />
      <label className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-sm border border-border-input bg-surface-raised px-2 py-1 text-xs shadow-card">
        <input type="checkbox" checked={showVeil} onChange={(e) => setShowVeil(e.target.checked)} />
        Airfoil surface
      </label>
      <div role="group" aria-label="View" className="absolute right-2 top-2 flex overflow-hidden rounded-sm border border-border-input bg-surface-raised text-xs shadow-card">
        {(["perspective", "orthographic"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={projection === p}
            onClick={() => setProjection(p)}
            className={`h-6 px-2 ${projection === p ? "bg-selected text-on-selected" : "text-muted hover:text-fg"}`}
          >
            {p === "perspective" ? "Perspective" : "Orthographic"}
          </button>
        ))}
      </div>
    </div>
  );
}
