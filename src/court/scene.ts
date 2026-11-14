import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { COURT, sideOutHeight } from './dimensions';
import type { Vec3 } from '../engine/physics';
import type { Vec2 } from '../engine/rally';
import type { Side } from '../engine/rules';
import type { Target } from '../engine/shots';
import { Figure, type Outfit } from './figure';
import { LINE_HALF_WIDTH, SWING_ROOM } from '../engine/clearance';

export type PickSurface = 'front' | 'left' | 'right' | 'floor';
export interface Pick { surface: PickSurface; p: Vec3 }

const { width: W, length: L } = COURT;
const LINE = '#c8102e';
const DEFAULT_OUTFIT: Outfit = { shirt: '#1f5fa8', shorts: '#f4f1ea' };
export const VIEWS = {
  back: { pos: [W / 2, 3.6, L + 4.6], target: [W / 2, 1.3, L * 0.45] },
  top: { pos: [W / 2, 16, L / 2 + 0.01], target: [W / 2, 0, L / 2] },
  side: { pos: [W + 6.5, 4, L * 0.55], target: [W / 2, 1.2, L * 0.5] },
} as const;

/** Maple boards running front to back, drawn once into a canvas texture. */
function mapleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const g = c.getContext('2d')!;
  const boards = 16;
  const bw = c.width / boards;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < boards; i++) {
    let y = -rnd() * 300;
    while (y < c.height) {
      const len = 220 + rnd() * 320;
      const l = 80 + rnd() * 7;
      g.fillStyle = `hsl(${34 + rnd() * 4}, ${52 + rnd() * 10}%, ${l}%)`;
      g.fillRect(i * bw, y, bw, len);
      g.strokeStyle = 'rgba(120, 80, 40, 0.18)';
      g.strokeRect(i * bw + 0.5, y + 0.5, bw - 1, len - 1);
      y += len;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class CourtView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private ray = new THREE.Raycaster();
  private pickables: THREE.Mesh[] = [];
  private fadeWalls: { mesh: THREE.Mesh; normal: THREE.Vector3; point: THREE.Vector3 }[] = [];
  private players = {} as Record<Side, Figure>;
  private ball: THREE.Group;
  private aim: THREE.Group;
  private aimSpread: THREE.Mesh;
  private moveMarker: THREE.Mesh;
  private path: THREE.Line;
  private zone = new THREE.Group();
  private zoneLine: THREE.Mesh;
  private onFrame: ((now: number) => void) | null = null;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor('#efe9df');
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Kort 3D. Przeciągnij, aby obrócić; stuknij ścianę lub podłogę, aby wybrać punkt. Strzałki przesuwają wybrany punkt.');
    this.renderer.domElement.setAttribute('role', 'application');

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 24;
    this.controls.enablePan = false;
    this.setView('back');

    this.scene.add(new THREE.HemisphereLight('#fffaf0', '#c9a777', 1.6));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.4);
    sun.position.set(W / 2, 8, L * 0.7);
    this.scene.add(sun);

    this.buildCourt();
    for (const side of ['p1', 'p2'] as const) {
      this.players[side] = new Figure(DEFAULT_OUTFIT);
      this.scene.add(this.players[side].root);
    }
    this.ball = this.buildBall();

    this.aim = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.085, 32), new THREE.MeshBasicMaterial({ color: '#1b1f24' }));
    this.aimSpread = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 64),
      new THREE.MeshBasicMaterial({ color: '#1b1f24', transparent: true, opacity: 0.55 }),
    );
    const fill = new THREE.Mesh(new THREE.CircleGeometry(0.96, 64), new THREE.MeshBasicMaterial({ color: '#f5c400', transparent: true, opacity: 0.35 }));
    this.aimSpread.add(fill);
    this.aim.add(dot, this.aimSpread);
    this.aim.visible = false;
    this.scene.add(this.aim);

    this.moveMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 40),
      new THREE.MeshBasicMaterial({ color: DEFAULT_OUTFIT.shirt }),
    );
    this.moveMarker.rotation.x = -Math.PI / 2;
    this.moveMarker.visible = false;
    this.scene.add(this.moveMarker);

    this.path = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: '#1b1f24', dashSize: 0.12, gapSize: 0.08 }),
    );
    this.path.visible = false;
    this.scene.add(this.path);

    const red = (opacity: number) => new THREE.MeshBasicMaterial({ color: LINE, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const swingFill = new THREE.Mesh(new THREE.CircleGeometry(SWING_ROOM, 48), red(0.16));
    const swingRing = new THREE.Mesh(new THREE.RingGeometry(SWING_ROOM - 0.05, SWING_ROOM, 48), red(0.8));
    swingFill.name = 'swing';
    swingRing.name = 'swing-ring';
    this.zoneLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), red(0.16));
    for (const m of [swingFill, swingRing, this.zoneLine]) m.rotation.x = -Math.PI / 2;
    this.zone.add(swingFill, swingRing, this.zoneLine);
    this.zone.visible = false;
    this.scene.add(this.zone);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop((now) => {
      this.onFrame?.(now);
      this.controls.update();
      this.updateWallFade();
      this.renderer.render(this.scene, this.camera);
    });
  }

  setFrameHandler(fn: ((now: number) => void) | null): void {
    this.onFrame = fn;
  }

  setView(name: keyof typeof VIEWS): void {
    const v = VIEWS[name];
    this.camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
    this.controls.target.set(v.target[0], v.target[1], v.target[2]);
    this.controls.update();
  }

  /** Orbit around the court by `angle` radians. */
  rotate(angle: number): void {
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.camera.position.copy(t).add(off);
    this.controls.update();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole court in frame on narrow portrait screens.
    this.camera.fov = w / h < 0.9 ? 64 : 50;
    this.camera.updateProjectionMatrix();
  }

  private buildCourt(): void {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshStandardMaterial({ map: mapleTexture(), roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, L / 2);
    floor.userData.surface = 'floor';
    this.scene.add(floor);
    this.pickables.push(floor);

    const wallMat = () => new THREE.MeshStandardMaterial({ color: '#f7f5f0', roughness: 0.9, transparent: true, side: THREE.DoubleSide });
    const H = COURT.ceiling;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat());
    front.position.set(W / 2, H / 2, 0);
    front.userData.surface = 'front';
    const left = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat());
    left.rotation.y = Math.PI / 2;
    left.position.set(0, H / 2, L / 2);
    left.userData.surface = 'left';
    const right = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat());
    right.rotation.y = -Math.PI / 2;
    right.position.set(W, H / 2, L / 2);
    right.userData.surface = 'right';
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({ color: '#cfe3e6', transparent: true, opacity: 0.12, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    );
    back.position.set(W / 2, H / 2, L);
    this.scene.add(front, left, right, back);
    this.pickables.push(front, left, right);
    this.fadeWalls.push(
      { mesh: front, normal: new THREE.Vector3(0, 0, 1), point: new THREE.Vector3(0, 0, 0) },
      { mesh: left, normal: new THREE.Vector3(1, 0, 0), point: new THREE.Vector3(0, 0, 0) },
      { mesh: right, normal: new THREE.Vector3(-1, 0, 0), point: new THREE.Vector3(W, 0, 0) },
    );

    const tin = new THREE.Mesh(new THREE.PlaneGeometry(W, COURT.tin - 0.05), new THREE.MeshStandardMaterial({ color: '#d9d2c4', roughness: 1 }));
    tin.position.set(W / 2, (COURT.tin - 0.05) / 2, 0.004);
    this.scene.add(tin);

    const lw = COURT.lineWidth;
    const mat = new THREE.MeshBasicMaterial({ color: LINE, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
    const quad = (pts: [number, number, number][]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      this.scene.add(new THREE.Mesh(g, mat));
    };
    const e = 0.006;
    const frontBand = (y0: number, y1: number) => quad([[0, y0, e], [W, y0, e], [W, y1, e], [0, y1, e]]);
    frontBand(COURT.frontOut, COURT.frontOut + lw);
    frontBand(COURT.serviceLine - lw, COURT.serviceLine);
    frontBand(COURT.tin - lw, COURT.tin);
    for (const x of [e, W - e]) {
      const y0 = sideOutHeight(0);
      const y1 = sideOutHeight(L);
      quad([[x, y0, 0], [x, y1, L], [x, y1 + lw, L], [x, y0 + lw, 0]]);
    }
    quad([[0, COURT.backOut, L - e], [W, COURT.backOut, L - e], [W, COURT.backOut + lw, L - e], [0, COURT.backOut + lw, L - e]]);
    const floorRect = (x0: number, z0: number, x1: number, z1: number) => quad([[x0, e, z0], [x1, e, z0], [x1, e, z1], [x0, e, z1]]);
    const s = COURT.shortLine;
    const b = COURT.serviceBox;
    floorRect(0, s - lw, W, s);
    floorRect(W / 2 - lw / 2, s, W / 2 + lw / 2, L);
    floorRect(b - lw, s, b, s + b);
    floorRect(0, s + b - lw, b, s + b);
    floorRect(W - b, s, W - b + lw, s + b);
    floorRect(W - b, s + b - lw, W, s + b);
  }

  /** Walls between the camera and the court turn see-through so play stays visible. */
  private updateWallFade(): void {
    const cam = this.camera.position;
    for (const w of this.fadeWalls) {
      const behind = cam.clone().sub(w.point).dot(w.normal) < 0;
      (w.mesh.material as THREE.MeshStandardMaterial).opacity = behind ? 0.18 : 1;
      (w.mesh.material as THREE.MeshStandardMaterial).depthWrite = !behind;
    }
  }

  /** Ball drawn at ~2.5x real size; the real 40 mm ball is invisible from behind the court. */
  private buildBall(): THREE.Group {
    const g = new THREE.Group();
    const R = 0.05;
    g.add(new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.6 })));
    const dotMat = new THREE.MeshBasicMaterial({ color: '#f5c400' });
    for (const a of [-0.35, 0.35]) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(R * 0.32, 12, 8), dotMat);
      d.position.set(Math.sin(a) * R * 0.85, 0.2 * R, Math.cos(a) * R * 0.85);
      g.add(d);
    }
    this.scene.add(g);
    return g;
  }

  setBall(p: Vec3 | null): void {
    this.ball.visible = !!p;
    if (p) {
      this.ball.position.set(p.x, p.y, p.z);
      this.ball.rotation.y += 0.15;
    }
  }

  /** `dt` seconds since the last placement drives the run cycle; 0 for a jump cut. */
  setPlayer(side: Side, p: Vec2, faceToward: Vec2 | null, dt: number): void {
    this.players[side].place(p, faceToward ?? { x: p.x, z: 0 }, dt);
  }

  setOutfit(side: Side, outfit: Outfit): void {
    this.players[side].setOutfit(outfit);
  }

  /** Yellow marker above the player who decides now; null hides both. */
  setActive(side: Side | null): void {
    this.players.p1.setActive(side === 'p1');
    this.players.p2.setActive(side === 'p2');
  }

  swing(side: Side): void {
    this.players[side].swing();
  }

  showAim(target: Target | null, spread: number): void {
    this.aim.visible = !!target;
    if (!target) return;
    const o = 0.012;
    if (target.surface === 'front') {
      this.aim.position.set(target.u, target.v, o);
      this.aim.rotation.set(0, 0, 0);
    } else {
      const left = target.surface === 'left';
      this.aim.position.set(left ? o : W - o, target.v, target.u);
      this.aim.rotation.set(0, left ? Math.PI / 2 : -Math.PI / 2, 0);
    }
    this.aimSpread.scale.setScalar(Math.max(spread, 0.06));
  }

  /** Red floor zones the previous striker must leave: swing room and the line to the front wall. */
  showZone(stand: Vec2 | null, ball?: Vec3): void {
    this.zone.visible = !!stand;
    if (!stand || !ball) return;
    for (const name of ['swing', 'swing-ring']) this.zone.getObjectByName(name)!.position.set(stand.x, 0.014, stand.z);
    const len = Math.max(ball.z - 0.3, 0.1);
    this.zoneLine.scale.set(LINE_HALF_WIDTH * 2, len, 1);
    this.zoneLine.position.set(ball.x, 0.013, len / 2);
  }

  showMove(p: Vec2 | null, color?: string): void {
    this.moveMarker.visible = !!p;
    if (color) (this.moveMarker.material as THREE.MeshBasicMaterial).color.set(color);
    if (p) this.moveMarker.position.set(p.x, 0.012, p.z);
  }

  showPath(points: Vec3[] | null): void {
    this.path.visible = !!points;
    if (!points) return;
    this.path.geometry.dispose();
    this.path.geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    this.path.computeLineDistances();
  }

  pick(clientX: number, clientY: number, allowed: PickSurface[]): Pick | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    // Faded walls are ignored so the player can tap through them.
    const meshes = this.pickables.filter((m) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      return allowed.includes(m.userData.surface) && (m.userData.surface === 'floor' || mat.opacity > 0.5);
    });
    const hit = this.ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    return { surface: hit.object.userData.surface, p: { x: hit.point.x, y: hit.point.y, z: hit.point.z } };
  }

  /** Calls back on taps; drags rotate the camera instead. */
  onTap(cb: (x: number, y: number) => void): void {
    const el = this.renderer.domElement;
    let start: { x: number; y: number; t: number } | null = null;
    el.addEventListener('pointerdown', (e) => (start = { x: e.clientX, y: e.clientY, t: performance.now() }));
    el.addEventListener('pointerup', (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8 && performance.now() - start.t < 500) cb(e.clientX, e.clientY);
      start = null;
    });
  }
}
