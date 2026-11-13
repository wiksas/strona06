import { COURT } from '../court/dimensions';
import type { Vec2 } from './rally';
import type { ShotInput, Target } from './shots';

export type ShotKind = 'drive' | 'cross' | 'drop' | 'crossDrop' | 'boast' | 'lob' | 'serveLob' | 'serveHard';

export const SHOT_LABEL: Record<ShotKind, string> = {
  drive: 'Drive wzdłuż ściany',
  cross: 'Cross',
  drop: 'Drop',
  crossDrop: 'Drop po krosie',
  boast: 'Boast',
  lob: 'Lob',
  serveLob: 'Serwis lobem',
  serveHard: 'Serwis płaski',
};

export const RALLY_SHOTS: ShotKind[] = ['drive', 'cross', 'drop', 'crossDrop', 'boast', 'lob'];
export const SERVE_SHOTS: ShotKind[] = ['serveLob', 'serveHard'];

/** Front-wall x that sends the ball, after one front-wall reflection, through (x, z). */
function mirrorAim(from: Vec2, x: number, z: number): number {
  return from.x + ((x - from.x) * from.z) / (from.z + z);
}

const clampU = (u: number) => Math.min(Math.max(u, 0.15), COURT.width - 0.15);

export function presetShot(kind: ShotKind, from: Vec2): ShotInput {
  const W = COURT.width;
  const leftHalf = from.x < W / 2;
  const near = leftHalf ? 0 : W;
  const far = leftHalf ? W : 0;
  const inward = leftHalf ? 1 : -1;
  const front = (u: number, v: number): Target => ({ surface: 'front', u: clampU(u), v });
  switch (kind) {
    case 'drive':
      return { target: front(near + inward * 0.55, 1.5), power: 0.72 };
    case 'cross':
      return { target: front(mirrorAim(from, far, 7.2), 1.45), power: 0.7 };
    case 'drop':
      return { target: front(near + inward * 0.4, 0.72), power: 0.1 };
    case 'crossDrop':
      return { target: front(far - inward * 0.6, 0.75), power: 0.16 };
    case 'boast':
      return {
        target: { surface: leftHalf ? 'left' : 'right', u: Math.max(from.z * 0.5, 1.2), v: 0.95 },
        power: 0.6,
      };
    case 'lob':
      return { target: front(mirrorAim(from, far - inward * 0.8, 8.6), 3.6), power: 0.22 };
    case 'serveLob':
      return { target: front(mirrorAim(from, far - inward * 1.4, 8.6), 3.4), power: 0.2 };
    case 'serveHard':
      return { target: front(mirrorAim(from, far - inward * 1.2, 7.4), 2.3), power: 0.28 };
  }
}
