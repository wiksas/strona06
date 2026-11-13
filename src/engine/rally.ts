import { COURT } from '../court/dimensions';
import { SAMPLE_DT, sampleAt, type Flight, type Vec3 } from './physics';

export interface Vec2 { x: number; z: number }

/** Linear move toward a target after a delay, timed from the last strike; stands still once arrived. */
export interface Move {
  from: Vec2;
  to: Vec2;
  delay: number;
}

export const RUN_SPEED = 4.6;
export const REACTION = 0.2;
/** After a swing the striker needs a moment before moving off. */
export const RECOVERY = 0.15;
/** Arm plus racket: the ball can be struck this far from the body centre. */
export const REACH = 0.95;
const MIN_HIT_HEIGHT = 0.1;
const MAX_HIT_HEIGHT = 2.1;
/** Body radius used for obstruction checks. */
const BODY = 0.3;

export function positionAt(m: Move, t: number): Vec2 {
  const dx = m.to.x - m.from.x;
  const dz = m.to.z - m.from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return { ...m.to };
  const run = Math.min(Math.max(t - m.delay, 0) * RUN_SPEED, dist);
  return { x: m.from.x + (dx / dist) * run, z: m.from.z + (dz / dist) * run };
}

export type Fault = 'tin' | 'out' | 'down' | 'serve-low' | 'serve-side' | 'serve-short' | 'serve-box';

export interface ShotCheck {
  /** null when the shot is good. */
  fault: Fault | null;
  /** Time the ball touched the front wall (the receiver may only play it afterwards). */
  frontAt: number;
  /** Time of the first floor bounce after the front wall, or Infinity. */
  firstBounceAt: number;
}

/** Applies the return rules, plus the service rules when `serveFrom` is given. */
export function checkShot(f: Flight, serveFrom?: 'left' | 'right'): ShotCheck {
  let frontAt = Infinity;
  let firstBounceAt = Infinity;
  for (const c of f.contacts) {
    if (frontAt === Infinity) {
      if (c.surface === 'floor') return { fault: 'down', frontAt, firstBounceAt };
      if (serveFrom && c.surface !== 'front') return { fault: 'serve-side', frontAt, firstBounceAt };
      if (c.tin) return { fault: 'tin', frontAt, firstBounceAt };
      if (c.out) return { fault: 'out', frontAt, firstBounceAt };
      if (c.surface === 'front') {
        if (serveFrom && c.p.y - COURT.ballRadius <= COURT.serviceLine) {
          return { fault: 'serve-low', frontAt: c.t, firstBounceAt };
        }
        frontAt = c.t;
      }
      continue;
    }
    if (c.out) return { fault: 'out', frontAt, firstBounceAt };
    if (c.surface === 'floor') {
      firstBounceAt = c.t;
      if (serveFrom) {
        // Landing on the short line or half-court line is a fault.
        const pastShort = c.p.z - COURT.ballRadius > COURT.shortLine;
        const half = COURT.width / 2;
        const lw = COURT.lineWidth / 2 + COURT.ballRadius;
        const opposite = serveFrom === 'right' ? c.p.x < half - lw : c.p.x > half + lw;
        if (!pastShort) return { fault: 'serve-short', frontAt, firstBounceAt };
        if (!opposite) return { fault: 'serve-box', frontAt, firstBounceAt };
      }
      break;
    }
  }
  if (frontAt === Infinity) return { fault: 'down', frontAt, firstBounceAt };
  return { fault: null, frontAt, firstBounceAt };
}

export interface Intercept {
  t: number;
  ball: Vec3;
  /** Where the receiver stands to play it. */
  stand: Vec2;
  /** 0 balanced .. 1 at full stretch. */
  pressure: number;
}

/**
 * Best place for the receiver to take the ball between the front-wall contact
 * and the second bounce. Prefers the most spare time; null when unreachable.
 */
export function findIntercept(f: Flight, check: ShotCheck, receiver: Move): Intercept | null {
  let best: Intercept | null = null;
  let bestScore = -Infinity;
  const secondBounce = f.contacts.filter((c) => c.surface === 'floor')[1]?.t ?? f.end;
  const start = Math.ceil(check.frontAt / SAMPLE_DT) + 2;
  const stop = Math.floor(secondBounce / SAMPLE_DT) - 1;
  for (let i = start; i <= stop; i += 2) {
    const t = i * SAMPLE_DT;
    const b = f.samples[i];
    if (!b || b.y < MIN_HIT_HEIGHT || b.y > MAX_HIT_HEIGHT) continue;
    const here = positionAt(receiver, REACTION);
    const gap = Math.max(Math.hypot(b.x - here.x, b.z - here.z) - REACH * 0.75, 0);
    const spare = t - REACTION - gap / RUN_SPEED;
    if (spare < 0) continue;
    // Balls hugging a wall or at shoelace height are awkward even with time to spare.
    const wallGap = Math.min(b.x, COURT.width - b.x, COURT.length - b.z);
    const awkward = Math.max(0, 0.25 - wallGap) * 2.4 + Math.max(0, 0.3 - b.y) * 1.5;
    const pressure = Math.min(Math.max(1 - spare / 0.6, 0) + awkward, 1);
    const score = -pressure - t * 0.05;
    if (score > bestScore) {
      bestScore = score;
      const dx = here.x - b.x;
      const dz = here.z - b.z;
      const d = Math.hypot(dx, dz) || 1;
      const off = Math.min(d, REACH * 0.75);
      const stand = clampToCourt({ x: b.x + (dx / d) * off, z: b.z + (dz / d) * off });
      best = { t, ball: { ...b }, stand, pressure };
    }
  }
  return best;
}

function clampToCourt(p: Vec2): Vec2 {
  const m = BODY;
  return {
    x: Math.min(Math.max(p.x, m), COURT.width - m),
    z: Math.min(Math.max(p.z, m), COURT.length - m),
  };
}

export type Interference = { kind: 'let' } | { kind: 'stroke'; to: 'striker' | 'receiver' };

/**
 * Simplified WSF interference:
 * - ball strikes the non-striker on its way to the front wall: stroke to the striker if
 *   it was travelling straight to the front wall, otherwise a let;
 * - the previous striker stands where the receiver must play: stroke to the receiver if
 *   that was the spot they chose to move to (did not clear), let if they were still clearing.
 */
export function checkInterference(
  f: Flight,
  check: ShotCheck,
  receiver: Move,
  intercept: Intercept | null,
  striker: Move,
): Interference | null {
  const firstWall = f.contacts[0];
  const end = Math.min(check.frontAt, f.end);
  for (let t = 0.06; t < end; t += SAMPLE_DT * 2) {
    const b = sampleAt(f, t);
    const body = positionAt(receiver, Math.min(t, REACTION));
    if (b.y < 1.85 && Math.hypot(b.x - body.x, b.z - body.z) < BODY) {
      const direct = firstWall?.surface === 'front' && firstWall.t >= t;
      return direct ? { kind: 'stroke', to: 'striker' } : { kind: 'let' };
    }
  }
  if (!intercept) return null;
  const s = positionAt(striker, intercept.t);
  if (Math.hypot(s.x - intercept.stand.x, s.z - intercept.stand.z) < BODY * 1.8) {
    const chose = Math.hypot(striker.to.x - intercept.stand.x, striker.to.z - intercept.stand.z) < BODY * 1.8;
    return chose ? { kind: 'stroke', to: 'receiver' } : { kind: 'let' };
  }
  return null;
}
