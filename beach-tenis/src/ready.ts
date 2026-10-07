import * as THREE from "three";

// Posição de espera do braço da raquete. Os clipes de parada/corrida são do pacote "Magic" (mão erguida na altura da
// cabeça, pose de conjuração), então a raquete ficava colada na cabeça. Aqui o braço direito desses clipes vira uma pose
// fixa: braço pendendo, cotovelo dobrado, raquete à frente com a cabeça para cima e a face na vertical.
// Calculado uma vez ao carregar, por rotações de junta (o cotovelo é uma dobradiça pura, sem torção na pele).
const D2R = Math.PI / 180;
export const READY = { drop: 66, forward: 30, elbow: 80 };   // braço abaixo da horizontal (°), para frente (°), flexão do cotovelo (°)

export function applyReadyPose(model: THREE.Object3D, clips: THREE.AnimationClip[], loco: readonly string[], gripQ: THREE.Quaternion): void {
  const find = (re: RegExp) => { let f: THREE.Bone | null = null; model.traverse((o) => { if (!f && (o as THREE.Bone).isBone && re.test(o.name)) f = o as THREE.Bone; }); return f as THREE.Bone | null; };
  const sh = find(/RightShoulder$/), arm = find(/RightArm$/), fore = find(/RightForeArm$/), hand = find(/RightHand$/);
  if (!sh || !arm || !fore || !hand) return;
  const V = THREE.Vector3, Q = THREE.Quaternion;
  model.updateMatrixWorld(true);
  const wq = (b: THREE.Object3D) => b.getWorldQuaternion(new Q());
  const Arest = wq(arm), armPos = arm.getWorldPosition(new V()), forePos = fore.getWorldPosition(new V());
  const d0 = forePos.sub(armPos).normalize();
  const restFore = fore.quaternion.clone(), restHand = hand.quaternion.clone();
  // orientação do pai do braço (clavícula) no primeiro quadro da parada: é a base em que a pose fixa vai ser aplicada
  const idle = clips.find((c) => c.name === "idle");
  const chain: THREE.Bone[] = []; for (let o: THREE.Object3D | null = sh; o && (o as THREE.Bone).isBone; o = o.parent) chain.push(o as THREE.Bone);
  const saved = chain.map((b) => b.quaternion.clone());
  if (idle) for (const b of chain) { const tr = idle.tracks.find((t) => t.name.endsWith(`${b.name}.quaternion`)); if (tr) b.quaternion.set(tr.values[0], tr.values[1], tr.values[2], tr.values[3]); }
  model.updateMatrixWorld(true); const P = wq(sh); chain.forEach((b, i) => b.quaternion.copy(saved[i])); model.updateMatrixWorld(true);

  // ombro: do braço aberto (T) para pendente; cotovelo: dobradiça em torno do eixo vertical do repouso
  const a = READY.drop * D2R, f = READY.forward * D2R;
  const d1 = new V(-Math.cos(a) * Math.cos(f), -Math.sin(a), Math.cos(a) * Math.sin(f)).normalize();
  const Ades = new Q().setFromUnitVectors(d0, d1).multiply(Arest);
  const qArm = P.clone().invert().multiply(Ades);
  const aE = new V(0, 1, 0).applyQuaternion(Arest.clone().invert());
  const qFore = new Q().setFromAxisAngle(aE, READY.elbow * D2R).multiply(restFore);
  // pulso: torção em torno do eixo do antebraço que deixa a face da raquete na vertical e a cabeça para cima/frente
  const bAxis = hand.position.clone().normalize(), Fw = Ades.clone().multiply(qFore);
  let best = 0, bestCost = 1e9, qHand = restHand.clone();
  for (let psi = -100; psi <= 100; psi += 2) {
    const qh = new Q().setFromAxisAngle(bAxis, psi * D2R).multiply(restHand);
    const rq = Fw.clone().multiply(qh).multiply(gripQ);
    const N = new V(0, 0, 1).applyQuaternion(rq), Y = new V(0, 1, 0).applyQuaternion(rq);
    const cost = 3 * Math.abs(N.y) + 2 * Math.abs(Y.y - 0.62) + 2 * Math.abs(Y.z - 0.65) + 0.004 * Math.abs(psi);
    if (cost < bestCost) { bestCost = cost; best = psi; qHand = qh; }
  }
  void best;
  const set = (tr: THREE.KeyframeTrack, q: THREE.Quaternion) => { const v = tr.values as Float32Array; for (let k = 0; k < v.length; k += 4) { v[k] = q.x; v[k + 1] = q.y; v[k + 2] = q.z; v[k + 3] = q.w; } };
  for (const c of clips) {
    if (!loco.includes(c.name)) continue;
    for (const tr of c.tracks) {
      if (tr.name.endsWith(`${arm.name}.quaternion`)) set(tr, qArm);
      else if (tr.name.endsWith(`${fore.name}.quaternion`)) set(tr, qFore);
      else if (tr.name.endsWith(`${hand.name}.quaternion`)) set(tr, qHand);
    }
  }
}
