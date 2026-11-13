import { COURT, T_POSITION } from '../court/dimensions';
import { checkShot, findIntercept, type Move, type Vec2 } from './rally';
import type { Box } from './rules';
import { executeShot, type ShotInput } from './shots';
import { RALLY_SHOTS, SERVE_SHOTS, presetShot, type ShotKind } from './tactics';
import type { Striker } from './turn';

export interface Difficulty {
  id: 'easy' | 'club' | 'pro';
  label: string;
  level: number;
  /** Random noise added to each option's score; higher means sloppier choices. */
  noise: number;
  /** Monte Carlo samples per option: how well the CPU knows its own error. */
  samples: number;
}

export const DIFFICULTIES: Difficulty[] = [
  { id: 'easy', label: 'Początkujący', level: 2, noise: 0.7, samples: 1 },
  { id: 'club', label: 'Klubowy', level: 5, noise: 0.3, samples: 3 },
  { id: 'pro', label: 'Turniejowy', level: 8, noise: 0.08, samples: 5 },
];

export interface CpuDecision {
  kind: ShotKind;
  shot: ShotInput;
  moveTo: Vec2;
}

/**
 * Scores each tactical option by simulating it with the CPU's own spread against
 * where the player is heading: errors cost, unreachable balls win, stretched returns score.
 */
export function cpuDecide(opts: {
  striker: Striker;
  opponent: Move;
  difficulty: Difficulty;
  serveBox?: Box;
  rand: () => number;
}): CpuDecision {
  const { striker, opponent, difficulty, serveBox, rand } = opts;
  const kinds = serveBox ? SERVE_SHOTS : RALLY_SHOTS;
  let best: CpuDecision | null = null;
  let bestScore = -Infinity;
  for (const kind of kinds) {
    for (const jitter of [0, 1]) {
      const base = presetShot(kind, striker.stand);
      const shot: ShotInput = jitter
        ? { target: { ...base.target, u: base.target.u + (rand() - 0.5) * 0.6, v: base.target.v + (rand() - 0.5) * 0.3 }, power: base.power }
        : base;
      let total = 0;
      for (let i = 0; i < difficulty.samples; i++) {
        const { flight } = executeShot(striker.contact, shot, striker.level, striker.pressure, rand);
        const check = checkShot(flight, serveBox);
        if (check.fault) {
          total -= 1.2;
          continue;
        }
        const ic = findIntercept(flight, check, opponent);
        if (!ic) total += 1;
        else total += ic.pressure * 0.8 + (Math.hypot(ic.stand.x - T_POSITION.x, ic.stand.z - T_POSITION.z) / 5) * 0.3;
      }
      const score = total / difficulty.samples + (rand() - 0.5) * difficulty.noise;
      if (score > bestScore) {
        bestScore = score;
        best = { kind, shot, moveTo: cpuMoveTo(difficulty, rand) };
      }
    }
  }
  return best!;
}

/** Stronger CPUs recover to the T; weaker ones drift off it. */
function cpuMoveTo(d: Difficulty, rand: () => number): Vec2 {
  const spread = d.id === 'easy' ? 1.6 : d.id === 'club' ? 0.7 : 0.25;
  return {
    x: T_POSITION.x + (rand() - 0.5) * spread,
    z: Math.min(T_POSITION.z + (rand() - 0.3) * spread, COURT.length - 0.5),
  };
}

export function cpuPickBox(rand: () => number): Box {
  return rand() < 0.5 ? 'left' : 'right';
}
