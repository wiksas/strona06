import * as THREE from 'three';
import type { Vec2 } from '../engine/rally';

export interface Outfit {
  shirt: string;
  shorts: string;
}

const SKIN = '#d9a679';
const HAIR = '#3b2a1e';
const SHOE = '#f4f1ea';
const RACKET = '#1b1f24';
/** Metres of running per full stride cycle. */
const STRIDE = 1.5;

function limb(radiusTop: number, radiusBottom: number, length: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 12), mat);
  m.position.y = -length / 2;
  return m;
}

/**
 * Jointed player model facing +z, right-handed (racket hand on -x).
 * Joints are groups so the run cycle and swing only rotate pivots.
 */
export class Figure {
  readonly root = new THREE.Group();
  private shirt = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  private shorts = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  private hips = new THREE.Group();
  private legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private arms: { shoulder: THREE.Group; elbow: THREE.Group }[] = [];
  private marker: THREE.Mesh;
  private phase = 0;
  private last: Vec2 | null = null;
  private swingT = -1;

  constructor(outfit: Outfit) {
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 });
    const shoe = new THREE.MeshStandardMaterial({ color: SHOE, roughness: 0.6 });

    this.hips.position.y = 0.94;
    this.root.add(this.hips);

    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.24, 16), this.shorts);
    pelvis.scale.z = 0.75;
    this.hips.add(pelvis);

    for (const side of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.09, -0.04, 0);
      const thigh = limb(0.075, 0.06, 0.44, skin);
      const shortsLeg = limb(0.09, 0.085, 0.2, this.shorts);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      const shin = limb(0.058, 0.045, 0.44, skin);
      const kneeCap = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), skin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), shoe);
      foot.position.set(0, -0.46, 0.05);
      knee.add(shin, kneeCap, foot);
      hip.add(thigh, shortsLeg, knee);
      this.hips.add(hip);
      this.legs.push({ hip, knee });
    }

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.52, 16), this.shirt);
    torso.scale.z = 0.62;
    torso.position.y = 0.36;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10), skin);
    neck.position.y = 0.67;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 16), skin);
    head.scale.set(0.92, 1.08, 1);
    head.position.y = 0.81;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.9 }));
    hair.position.set(0, 0.83, -0.01);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skin);
    nose.position.set(0, 0.8, 0.1);
    this.hips.add(torso, neck, head, hair, nose);

    // Index 0 is the racket arm (right hand, -x).
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.22, 0.58, 0);
      const sleeve = limb(0.068, 0.062, 0.14, this.shirt);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), this.shirt);
      const upper = limb(0.055, 0.048, 0.28, skin);
      const elbow = new THREE.Group();
      elbow.position.y = -0.28;
      const fore = limb(0.046, 0.038, 0.25, skin);
      const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), skin);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin);
      hand.position.y = -0.27;
      elbow.add(fore, elbowJoint, hand);
      if (side === -1) elbow.add(this.buildRacket());
      shoulder.add(cap, sleeve, upper, elbow);
      this.hips.add(shoulder);
      this.arms.push({ shoulder, elbow });
    }

    this.marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.16, 3),
      new THREE.MeshBasicMaterial({ color: '#f5c400' }),
    );
    this.marker.rotation.x = Math.PI;
    this.marker.position.y = 2.12;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(this.marker.geometry), new THREE.LineBasicMaterial({ color: '#1b1f24' }));
    this.marker.add(edge);
    this.marker.visible = false;
    this.root.add(this.marker);

    this.setOutfit(outfit);
    this.pose(0, 0);
  }

  /** Racket grip sits in the hand; the 686 mm racket extends along the forearm. */
  private buildRacket(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: RACKET, roughness: 0.5 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.3, 8), mat);
    handle.position.y = -0.1;
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.009, 8, 28), mat);
    frame.scale.y = 1.25;
    frame.position.y = -0.38;
    const strings = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 24),
      new THREE.MeshBasicMaterial({ color: '#e8e2d4', transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    );
    strings.scale.y = 1.25;
    strings.position.y = -0.38;
    g.add(handle, frame, strings);
    g.position.y = -0.27;
    g.rotation.y = Math.PI / 2;
    return g;
  }

  setOutfit(o: Outfit): void {
    this.shirt.color.set(o.shirt);
    this.shorts.color.set(o.shorts);
  }

  setActive(active: boolean): void {
    this.marker.visible = active;
  }

  /** Starts a forehand swing; it plays over the next frames of `place`. */
  swing(): void {
    this.swingT = 0;
  }

  /** Moves the figure; stride is driven by the distance covered, not by time. */
  place(p: Vec2, face: Vec2, dt: number): void {
    const moved = this.last ? Math.hypot(p.x - this.last.x, p.z - this.last.z) : 0;
    this.last = { ...p };
    this.root.position.set(p.x, 0, p.z);
    this.root.rotation.y = Math.atan2(face.x - p.x, face.z - p.z);
    const speed = dt > 0 ? moved / dt : 0;
    if (moved > 0.0005) this.phase += (moved / STRIDE) * Math.PI * 2;
    if (this.swingT >= 0) this.swingT += dt;
    if (this.swingT > 0.35) this.swingT = -1;
    this.pose(Math.min(speed / 4, 1), this.swingT);
  }

  private pose(run: number, swingT: number): void {
    const s = Math.sin(this.phase);
    const [l, r] = this.legs;
    l.hip.rotation.x = s * 0.7 * run - 0.15;
    r.hip.rotation.x = -s * 0.7 * run - 0.15;
    l.knee.rotation.x = 0.25 + Math.max(0, -s) * 0.9 * run;
    r.knee.rotation.x = 0.25 + Math.max(0, s) * 0.9 * run;
    this.hips.position.y = 0.92 - 0.04 * (1 - run) + Math.abs(Math.cos(this.phase)) * 0.03 * run;

    const [racketArm, freeArm] = this.arms;
    freeArm.shoulder.rotation.set(-s * 0.6 * run - 0.3, 0, 0.25);
    freeArm.elbow.rotation.x = -0.9;
    if (swingT >= 0) {
      // Back-swing to follow-through across the body.
      const k = swingT / 0.35;
      racketArm.shoulder.rotation.set(-1.2 + k * 0.6, 0, -1.3 + k * 2.4);
      racketArm.elbow.rotation.x = -0.4;
    } else {
      racketArm.shoulder.rotation.set(-0.55 + s * 0.3 * run, 0, -0.35);
      racketArm.elbow.rotation.x = -1.35;
    }
  }
}
