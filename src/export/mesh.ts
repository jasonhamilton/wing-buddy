/**
 * Turn a soup of loose triangles into a mesh a solid modeller will accept: shared vertices, no
 * degenerate faces, every face wound the same way, and a surface with no holes in it.
 */
export type Mesh = { points: [number, number, number][]; faces: [number, number, number][] };

const WELD = 1e4; // vertices closer than 0.1 micrometre are the same vertex

export function buildMesh(positions: number[]): Mesh {
  const points: [number, number, number][] = [];
  const index = new Map<string, number>();
  const idOf = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`;
    let i = index.get(key);
    if (i === undefined) {
      i = points.length;
      points.push([Math.round(x * WELD) / WELD, Math.round(y * WELD) / WELD, Math.round(z * WELD) / WELD]);
      index.set(key, i);
    }
    return i;
  };

  let faces: [number, number, number][] = [];
  for (let t = 0; t + 8 < positions.length; t += 9) {
    const a = idOf(positions[t], positions[t + 1], positions[t + 2]);
    const b = idOf(positions[t + 3], positions[t + 4], positions[t + 5]);
    const c = idOf(positions[t + 6], positions[t + 7], positions[t + 8]);
    if (a === b || b === c || a === c) continue;
    if (areaOf(points[a], points[b], points[c]) < 1e-9) continue; // collinear: a face with no area
    faces.push([a, b, c]);
  }

  faces = orient(faces);
  // Wound so the outside is on the clockwise side, which is how OpenSCAD wants it: negative volume
  // by the usual counter-clockwise rule. Flip the whole mesh if it came out the other way.
  if (volumeOf(points, faces) > 0) faces = faces.map(([a, b, c]) => [a, c, b]);
  return { points, faces };
}

function areaOf(a: number[], b: number[], c: number[]): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

function volumeOf(p: number[][], f: [number, number, number][]): number {
  let v = 0;
  for (const [a, b, c] of f) {
    v +=
      (p[a][0] * (p[b][1] * p[c][2] - p[b][2] * p[c][1]) -
        p[a][1] * (p[b][0] * p[c][2] - p[b][2] * p[c][0]) +
        p[a][2] * (p[b][0] * p[c][1] - p[b][1] * p[c][0])) /
      6;
  }
  return v;
}

/** Flip faces until neighbours agree: two faces sharing an edge must traverse it in opposite directions. */
function orient(faces: [number, number, number][]): [number, number, number][] {
  const out = faces.map((f) => [...f] as [number, number, number]);
  const edgeFaces = new Map<string, number[]>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  out.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const e = key(f[k], f[(k + 1) % 3]);
      (edgeFaces.get(e) ?? edgeFaces.set(e, []).get(e)!).push(i);
    }
  });
  const dir = (f: number[], a: number, b: number) => {
    for (let k = 0; k < 3; k++) if (f[k] === a && f[(k + 1) % 3] === b) return 1;
    return -1;
  };
  const seen = new Array(out.length).fill(false);
  for (let s = 0; s < out.length; s++) {
    if (seen[s]) continue;
    seen[s] = true;
    const stack = [s];
    while (stack.length) {
      const i = stack.pop()!;
      const f = out[i];
      for (let k = 0; k < 3; k++) {
        const a = f[k];
        const b = f[(k + 1) % 3];
        for (const j of edgeFaces.get(key(a, b)) ?? []) {
          if (j === i || seen[j]) continue;
          // neighbour must run b -> a; if it runs a -> b it is wound the other way, so flip it
          if (dir(out[j], a, b) === 1) out[j] = [out[j][0], out[j][2], out[j][1]];
          seen[j] = true;
          stack.push(j);
        }
      }
    }
  }
  return out;
}

export type MeshReport = {
  /** every edge belongs to exactly two faces */
  closed: boolean;
  /** every edge is walked once in each direction */
  consistent: boolean;
  degenerate: number;
  /** signed: negative when wound the way OpenSCAD wants */
  volume: number;
};

export function meshReport(m: Mesh): MeshReport {
  const count = new Map<string, number>();
  const directed = new Map<string, number>();
  let degenerate = 0;
  for (const [a, b, c] of m.faces) {
    if (areaOf(m.points[a], m.points[b], m.points[c]) < 1e-9) degenerate++;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const und = u < v ? `${u}_${v}` : `${v}_${u}`;
      count.set(und, (count.get(und) ?? 0) + 1);
      directed.set(`${u}>${v}`, (directed.get(`${u}>${v}`) ?? 0) + 1);
    }
  }
  const closed = [...count.values()].every((n) => n === 2);
  const consistent = [...directed.values()].every((n) => n === 1);
  return { closed, consistent, degenerate, volume: volumeOf(m.points, m.faces) };
}
