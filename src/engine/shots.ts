import { COURT } from '../court/dimensions';
import { simulate, type Flight, type Vec3 } from './physics';

/** A point on a wall the striker aims at. front: u = x, v = y. left/right: u = z, v = y. */
export interface Target {
  surface: 'front' | 'left' | 'right';
  u: number;
  v: number;
}

export interface ShotInput {
  target: Target;
  /** 0..1 slider value. */
  power: number;
}

export const MIN_SPEED = 9;
export const MAX_SPEED = 42;

export function powerToSpeed(power: number): number {
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.min(Math.max(power, 0), 1);
}

export function targetPoint(t: Target): Vec3 {
  if (t.surface === 'front') return { x: t.u, y: t.v, z: 0 };
  return { x: t.surface === 'left' ? 0 : COURT.width, y: t.v, z: t.u };
}

function planeCoords(surface: Target['surface'], p: Vec3): [number, number] {
  return surface === 'front' ? [p.x, p.y] : [p.z, p.y];
}

/**
 * Launch velocity whose first wall contact lands on the target at the given speed.
 * Shooting method: aim at a virtual point and shift it by the miss until it converges.
 */
export function solveLaunch(from: Vec3, target: Target, speed: number): Vec3 {
  const goal = targetPoint(target);
  const aim = { ...goal };
  let best = velocityTowards(from, aim, speed);
  let bestMiss = Infinity;
  for (let i = 0; i < 10; i++) {
    const v = velocityTowards(from, aim, speed);
    const f = simulate(from, v, { stopAtFirst: true });
    const c = f.contacts[0];
    let du: number;
    let dv: number;
    if (!c || c.surface === 'floor' || (c.surface !== target.surface)) {
      // Fell short or hit another surface first: lift the aim and pull it toward the goal.
      du = 0;
      dv = c && c.surface !== 'floor' && c.p.y > goal.y ? -0.5 : 0.6;
    } else {
      const [gu, gv] = planeCoords(target.surface, goal);
      const [hu, hv] = planeCoords(target.surface, c.p);
      du = gu - hu;
      dv = gv - hv;
      const miss = Math.hypot(du, dv);
      if (miss < bestMiss) {
        bestMiss = miss;
        best = v;
      }
      if (miss < 0.01) break;
    }
    if (target.surface === 'front') aim.x += du;
    else aim.z += du;
    aim.y += dv;
  }
  return best;
}

function velocityTowards(from: Vec3, to: Vec3, speed: number): Vec3 {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const n = Math.hypot(d.x, d.y, d.z) || 1;
  return { x: (d.x / n) * speed, y: (d.y / n) * speed, z: (d.z / n) * speed };
}

/** Aim spread (1 sigma, metres on the wall) and power spread for a skill level 1..10. */
export function accuracy(level: number): { aim: number; power: number } {
  const l = Math.min(Math.max(level, 1), 10) - 1;
  return { aim: 0.26 * Math.pow(0.82, l), power: 0.07 * Math.pow(0.8, l) };
}

/** Pressure 0 (set, balanced) .. 1 (stretched) widens the spread up to 2.2x. */
export function pressureFactor(pressure: number): number {
  return 1 + 1.2 * Math.min(Math.max(pressure, 0), 1);
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The shot the striker actually plays once skill spread is applied. */
export function executeShot(
  from: Vec3,
  shot: ShotInput,
  level: number,
  pressure: number,
  rand: () => number,
): { input: ShotInput; flight: Flight } {
  const acc = accuracy(level);
  const k = pressureFactor(pressure);
  const target: Target = {
    ...shot.target,
    u: shot.target.u + gaussian(rand) * acc.aim * k,
    v: shot.target.v + gaussian(rand) * acc.aim * k,
  };
  const power = Math.min(Math.max(shot.power + gaussian(rand) * acc.power * k, 0), 1);
  const input = { target, power };
  return { input, flight: flightFor(from, input) };
}

export function flightFor(from: Vec3, shot: ShotInput): Flight {
  return simulate(from, solveLaunch(from, shot.target, powerToSpeed(shot.power)));
}
