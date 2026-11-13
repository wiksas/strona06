import { COURT, sideOutHeight } from '../court/dimensions';

export interface Vec3 { x: number; y: number; z: number }
export type Surface = 'front' | 'left' | 'right' | 'back' | 'floor' | 'ceiling';

export interface Contact {
  surface: Surface;
  t: number;
  p: Vec3;
  /** Touched the tin, an out line or the area above it. */
  out: boolean;
  tin: boolean;
}

export interface Flight {
  /** Ball centre every SAMPLE_DT seconds, starting at t = 0. */
  samples: Vec3[];
  contacts: Contact[];
  /** Time the flight stops: second bounce, an out/tin contact, or the time cap. */
  end: number;
}

export const SAMPLE_DT = 1 / 120;
const SUBSTEPS = 2;
const G = 9.81;
/** Quadratic drag 0.5·ρ·Cd·A/m for a 24 g, 40 mm ball. */
const DRAG = 0.0157;
const FLOOR_RESTITUTION = 0.38;
const FLOOR_FRICTION = 0.78;
const WALL_RESTITUTION = 0.55;
const WALL_FRICTION = 0.85;
const MAX_TIME = 6;

const r = COURT.ballRadius;

export function simulate(p0: Vec3, v0: Vec3, opts: { stopAtFirst?: boolean } = {}): Flight {
  const p = { ...p0 };
  const v = { ...v0 };
  const samples: Vec3[] = [{ ...p }];
  const contacts: Contact[] = [];
  const h = SAMPLE_DT / SUBSTEPS;
  let floorHits = 0;
  let t = 0;

  const hit = (surface: Surface): boolean => {
    let out = false;
    let tin = false;
    if (surface === 'front') {
      tin = p.y - r <= COURT.tin;
      out = p.y + r >= COURT.frontOut;
    } else if (surface === 'left' || surface === 'right') {
      out = p.y + r >= sideOutHeight(p.z);
    } else if (surface === 'back') {
      out = p.y + r >= COURT.backOut;
    } else if (surface === 'ceiling') {
      out = true;
    }
    contacts.push({ surface, t, p: { ...p }, out, tin });
    if (surface === 'floor') floorHits++;
    return out || tin || floorHits >= 2 || !!opts.stopAtFirst;
  };

  while (t < MAX_TIME) {
    let stop = false;
    for (let s = 0; s < SUBSTEPS && !stop; s++) {
      const speed = Math.hypot(v.x, v.y, v.z);
      v.x -= DRAG * speed * v.x * h;
      v.y -= (G + DRAG * speed * v.y) * h;
      v.z -= DRAG * speed * v.z * h;
      p.x += v.x * h;
      p.y += v.y * h;
      p.z += v.z * h;
      t += h;

      if (p.y < r) {
        p.y = r;
        v.y = -v.y * FLOOR_RESTITUTION;
        v.x *= FLOOR_FRICTION;
        v.z *= FLOOR_FRICTION;
        stop = hit('floor');
      } else if (p.y > COURT.ceiling - r) {
        p.y = COURT.ceiling - r;
        v.y = -v.y * WALL_RESTITUTION;
        stop = hit('ceiling');
      }
      if (!stop && p.z < r) {
        p.z = r;
        v.z = -v.z * WALL_RESTITUTION;
        v.x *= WALL_FRICTION;
        v.y *= WALL_FRICTION;
        stop = hit('front');
      } else if (!stop && p.z > COURT.length - r) {
        p.z = COURT.length - r;
        v.z = -v.z * WALL_RESTITUTION;
        v.x *= WALL_FRICTION;
        v.y *= WALL_FRICTION;
        stop = hit('back');
      }
      if (!stop && p.x < r) {
        p.x = r;
        v.x = -v.x * WALL_RESTITUTION;
        v.z *= WALL_FRICTION;
        v.y *= WALL_FRICTION;
        stop = hit('left');
      } else if (!stop && p.x > COURT.width - r) {
        p.x = COURT.width - r;
        v.x = -v.x * WALL_RESTITUTION;
        v.z *= WALL_FRICTION;
        v.y *= WALL_FRICTION;
        stop = hit('right');
      }
    }
    samples.push({ ...p });
    if (stop) break;
  }
  return { samples, contacts, end: (samples.length - 1) * SAMPLE_DT };
}

export function sampleAt(f: Flight, t: number): Vec3 {
  const i = Math.min(Math.max(t / SAMPLE_DT, 0), f.samples.length - 1);
  const a = f.samples[Math.floor(i)];
  const b = f.samples[Math.ceil(i)];
  const k = i - Math.floor(i);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}
