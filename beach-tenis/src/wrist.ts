import * as THREE from "three";

// Pulso. Os 12 golpes de mocap chegam com um desvio fixo de ~110–125° no eixo X da mão (diferença de eixo entre o
// esqueleto do BVH e o osso da Mixamo): a mão fica dobrada >100° em quase todos os quadros, a torção medida no eixo
// errado passa de 400° e a pele "vira laço". Duas correções, feitas uma vez ao carregar:
//  1) cleanWrists: estima o desvio de cada mão a partir dos próprios clipes (rotação média), tira ele e ainda
//     filtra/limita a torção e a flexão que sobrarem;
//  2) WristTwist: dois ossos auxiliares no antebraço que dividem a torção da mão ao longo do antebraço.
const D2R = Math.PI / 180;
const TW_MAX = 110 * D2R;
const BEND_MAX = 80 * D2R;
const MIN_OFFSET = 25 * D2R;      // abaixo disso o clipe já vem limpo (ex.: GLB reexportado com o retarget corrigido)
const FRAC = [0.4, 0.8];          // fração da torção da mão em cada osso auxiliar
const KNOT = [0, 0.4, 0.8];       // centro de cada segmento (antebraço, T1, T2): 0 = cotovelo, 1 = pulso

export interface HandInfo { axis: THREE.Vector3; rest: THREE.Quaternion; }

function median(a: number[], w: number): number[] {
  const n = a.length, h = w >> 1, out: number[] = new Array(n);
  for (let i = 0; i < n; i++) { const s: number[] = []; for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) s.push(a[j]); s.sort((x, y) => x - y); out[i] = s[s.length >> 1]; }
  return out;
}

/** torção (rad, −π..π) de q em torno de axis */
function twistOf(q: THREE.Quaternion, axis: THREE.Vector3): number {
  const s = q.w < 0 ? -1 : 1;
  return 2 * Math.atan2(s * (q.x * axis.x + q.y * axis.y + q.z * axis.z), s * q.w);
}

const flip = (q: THREE.Quaternion) => { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; return q; };

/** rotação média de uma nuvem de quaternions (autovetor dominante de Σ qqᵀ; o sinal de q não importa) */
function meanRotation(A: number[]): THREE.Quaternion {
  let bi = 0; for (let i = 1; i < 4; i++) if (A[i * 5] > A[bi * 5]) bi = i;
  let v = [A[bi * 4], A[bi * 4 + 1], A[bi * 4 + 2], A[bi * 4 + 3]];
  for (let it = 0; it < 60; it++) {
    const nv = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) nv[i] += A[i * 4 + j] * v[j];
    const len = Math.hypot(nv[0], nv[1], nv[2], nv[3]) || 1; v = nv.map((x) => x / len);
  }
  const q = new THREE.Quaternion(v[0], v[1], v[2], v[3]).normalize(); return q.w < 0 ? flip(q) : q;
}

export function cleanWrists(clips: THREE.AnimationClip[], hands: Record<string, HandInfo>, isMocap: (clip: string) => boolean): void {
  const q = new THREE.Quaternion(), t = new THREE.Quaternion(), o = new THREE.Quaternion(), prev = new THREE.Quaternion(), id = new THREE.Quaternion(), tmp = new THREE.Quaternion();
  const find = (clip: THREE.AnimationClip, side: string) => clip.tracks.find((tr) => new RegExp(`${side}Hand\\.quaternion$`).test(tr.name));
  for (const side of ["Left", "Right"]) {
    const hi = hands[side]; if (!hi) continue;
    const b = hi.axis, ri = hi.rest.clone().invert();
    // 1) desvio fixo: rotação média de (rest⁻¹ · q) em todos os quadros dos clipes de mocap
    const A = new Array(16).fill(0); let count = 0;
    for (const clip of clips) { if (!isMocap(clip.name)) continue; const tr = find(clip, side); if (!tr) continue;
      const v = tr.values; for (let k = 0; k < v.length / 4; k++) { q.set(v[4 * k], v[4 * k + 1], v[4 * k + 2], v[4 * k + 3]); o.copy(ri).multiply(q); const d = [o.x, o.y, o.z, o.w]; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) A[i * 4 + j] += d[i] * d[j]; count++; } }
    if (!count) continue;
    const off = meanRotation(A); const offInv = (2 * Math.acos(Math.min(1, off.w)) > MIN_OFFSET) ? off.clone().invert() : id.clone();
    // 2) clipe a clipe: tira o desvio (q' = q · offset⁻¹, no referencial da mão), filtra e limita torção e flexão
    for (const clip of clips) {
      if (!isMocap(clip.name)) continue; const tr = find(clip, side); if (!tr) continue;
      const v = tr.values as Float32Array, n = v.length / 4;
      const th: number[] = [], swing: THREE.Quaternion[] = []; let last = 0;
      for (let k = 0; k < n; k++) {
        q.set(v[4 * k], v[4 * k + 1], v[4 * k + 2], v[4 * k + 3]).multiply(offInv); if (q.w < 0) flip(q);
        const t0 = twistOf(q, b);
        swing.push(t.setFromAxisAngle(b, t0).invert().multiply(q).clone());       // q = twist · swing
        let u = t0; if (k > 0) { while (u - last > Math.PI) u -= 2 * Math.PI; while (u - last < -Math.PI) u += 2 * Math.PI; }
        last = u; th.push(u);
      }
      let f = median(th, 5).map((x) => THREE.MathUtils.clamp(x, -TW_MAX, TW_MAX));
      { const g = f; f = g.map((x, i) => 0.25 * g[Math.max(0, i - 1)] + 0.5 * x + 0.25 * g[Math.min(n - 1, i + 1)]); }
      for (let k = 0; k < n; k++) {
        const s = swing[k]; if (s.w < 0) flip(s);
        const ang = 2 * Math.acos(Math.min(1, s.w));
        if (ang > BEND_MAX) { tmp.copy(s); s.copy(id).slerp(tmp, BEND_MAX / ang); }
        o.copy(t.setFromAxisAngle(b, f[k])).multiply(s);
        if (k > 0 && o.dot(prev) < 0) flip(o);
        prev.copy(o); v[4 * k] = o.x; v[4 * k + 1] = o.y; v[4 * k + 2] = o.z; v[4 * k + 3] = o.w;
      }
    }
  }
}

interface Side { hand: THREE.Bone; axis: THREE.Vector3; rest: number; t1: THREE.Bone; t2: THREE.Bone; }

export class WristTwist {
  sides: Side[] = [];
  private q = new THREE.Quaternion();

  /** eixo do antebraço (no espaço local do antebraço) e rotação de repouso de cada mão */
  static hands(root: THREE.Object3D): Record<string, HandInfo> {
    const out: Record<string, HandInfo> = {};
    root.traverse((o) => { const m = /(Left|Right)Hand$/.exec(o.name); if (m && (o as THREE.Bone).isBone) out[m[1]] = { axis: o.position.clone().normalize(), rest: o.quaternion.clone() }; });
    return out;
  }

  /** cria T1/T2 em cada antebraço e passa para eles parte do peso do antebraço, conforme a posição ao longo dele */
  static attach(sm: THREE.SkinnedMesh): WristTwist | null {
    const sk = sm.skeleton, bones = sk.bones; const res = new WristTwist();
    const rest = sk.boneInverses.map((m) => m.clone().invert());
    const geo = sm.geometry, pos = geo.attributes.position, ix = geo.attributes.skinIndex, wt = geo.attributes.skinWeight;
    const newBones: THREE.Bone[] = [], newInv: THREE.Matrix4[] = [];
    const info: { fi: number; a: THREE.Vector3; u: THREE.Vector3; len: number; ids: number[] }[] = [];
    for (const side of ["Left", "Right"]) {
      const fi = bones.findIndex((b) => new RegExp(`${side}ForeArm$`).test(b.name)), hi = bones.findIndex((b) => new RegExp(`${side}Hand$`).test(b.name));
      if (fi < 0 || hi < 0) continue;
      const fore = bones[fi], hand = bones[hi];
      const a = new THREE.Vector3().setFromMatrixPosition(rest[fi]), bpos = new THREE.Vector3().setFromMatrixPosition(rest[hi]);
      const len = a.distanceTo(bpos); if (len < 1e-6) continue;
      const mk = (name: string, c: number): number => {
        const nb = new THREE.Bone(); nb.name = name; nb.position.copy(hand.position).multiplyScalar(c); fore.add(nb);
        newInv.push(rest[fi].clone().multiply(new THREE.Matrix4().makeTranslation(nb.position.x, nb.position.y, nb.position.z)).invert()); newBones.push(nb);
        return bones.length + newBones.length - 1;
      };
      const ids = [fi, mk(`BTTwist${side}1`, KNOT[1]), mk(`BTTwist${side}2`, KNOT[2])];
      const axis = hand.position.clone().normalize();
      res.sides.push({ hand, axis, rest: twistOf(hand.quaternion, axis), t1: newBones[newBones.length - 2], t2: newBones[newBones.length - 1] });
      info.push({ fi, a, u: bpos.clone().sub(a).divideScalar(len), len, ids });
    }
    if (!info.length) return null;
    const P = new THREE.Vector3(), J = [0, 0, 0, 0], W = [0, 0, 0, 0];
    for (let i = 0; i < wt.count; i++) {
      J[0] = ix.getX(i); J[1] = ix.getY(i); J[2] = ix.getZ(i); J[3] = ix.getW(i); W[0] = wt.getX(i); W[1] = wt.getY(i); W[2] = wt.getZ(i); W[3] = wt.getW(i);
      let changed = false; let ent = J.map((j, n) => ({ j, w: W[n] })).filter((e) => e.w > 0);
      for (const f of info) {
        const k = ent.findIndex((e) => e.j === f.fi); if (k < 0) continue;
        P.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(sm.bindMatrix);
        const t = THREE.MathUtils.clamp(P.sub(f.a).dot(f.u) / f.len, 0, 1);
        let h: number[];
        if (t <= KNOT[0]) h = [1, 0, 0];
        else if (t <= KNOT[1]) { const x = (t - KNOT[0]) / (KNOT[1] - KNOT[0]); h = [1 - x, x, 0]; }
        else if (t <= KNOT[2]) { const x = (t - KNOT[1]) / (KNOT[2] - KNOT[1]); h = [0, 1 - x, x]; }
        else h = [0, 0, 1];
        const wf = ent[k].w; ent.splice(k, 1);
        for (let n = 0; n < 3; n++) if (h[n] > 1e-4) ent.push({ j: f.ids[n], w: wf * h[n] });
        changed = true;
      }
      if (!changed) continue;
      ent.sort((x, y) => y.w - x.w); ent = ent.slice(0, 4);
      const sum = ent.reduce((s, e) => s + e.w, 0) || 1;
      // 8 bits com soma exata 255 (maior resto)
      const raw = ent.map((e) => (e.w / sum) * 255), q8 = raw.map(Math.floor); let rem = 255 - q8.reduce((s, x) => s + x, 0);
      raw.map((x, n) => [x - q8[n], n]).sort((p, q) => q[0] - p[0]).forEach(([, n]) => { if (rem > 0) { q8[n]++; rem--; } });
      while (ent.length < 4) { ent.push({ j: 0, w: 0 }); q8.push(0); }
      ix.setXYZW(i, ent[0].j, ent[1].j, ent[2].j, ent[3].j); wt.setXYZW(i, q8[0] / 255, q8[1] / 255, q8[2] / 255, q8[3] / 255);
    }
    ix.needsUpdate = true; wt.needsUpdate = true;
    const sk2 = new THREE.Skeleton([...bones, ...newBones], [...sk.boneInverses, ...newInv]);
    sk.dispose(); sm.bind(sk2, sm.bindMatrix);
    return res;
  }

  /** o mesmo ajuste para um clone do modelo (ossos achados por nome): a 2ª jogadora usa a pele já refeita com T1/T2 */
  cloneFor(root: THREE.Object3D): WristTwist {
    const r = new WristTwist(), by = (n: string) => root.getObjectByName(n) as THREE.Bone;
    for (const s of this.sides) r.sides.push({ hand: by(s.hand.name), axis: s.axis.clone(), rest: s.rest, t1: by(s.t1.name), t2: by(s.t2.name) });
    return r;
  }

  /** depois de cada mixer.update: T1/T2 giram uma fração da torção da mão */
  update(): void {
    for (const s of this.sides) {
      this.q.copy(s.hand.quaternion);
      const th = twistOf(this.q, s.axis) - s.rest;
      s.t1.quaternion.setFromAxisAngle(s.axis, FRAC[0] * th); s.t2.quaternion.setFromAxisAngle(s.axis, FRAC[1] * th);
    }
  }
}
