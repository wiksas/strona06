import { COURT } from '../court/dimensions';
import { REACTION, RUN_SPEED, type Intercept, type Vec2 } from './rally';

/**
 * WSF: after playing the ball the player must give the opponent room to swing and a
 * direct line from the ball to the front wall. Both are modelled as floor zones.
 */
export type Blocking = 'swing' | 'line';

/** Radius around the striker's stance that the swing needs. */
export const SWING_ROOM = 1.0;
/** Half-width of the straight corridor from the ball to the front wall. */
export const LINE_HALF_WIDTH = 0.45;
/** Time the striker spends preparing; a clearing run longer than this earns a let. */
export const CLEAR_TIME = 0.75;

export function blocking(p: Vec2, ic: Intercept): Blocking | null {
  if (Math.hypot(p.x - ic.stand.x, p.z - ic.stand.z) < SWING_ROOM) return 'swing';
  if (p.z < ic.ball.z - 0.3 && Math.abs(p.x - ic.ball.x) < LINE_HALF_WIDTH) return 'line';
  return null;
}

/** Nearest legal spot out of both zones, preferring the T side of the court. */
export function clearSpot(p: Vec2, ic: Intercept): Vec2 {
  let best: Vec2 | null = null;
  let bestCost = Infinity;
  for (let r = SWING_ROOM + 0.15; r <= 3.2; r += 0.25) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const c = { x: ic.stand.x + Math.cos(ang) * r, z: ic.stand.z + Math.sin(ang) * r };
      if (c.x < 0.35 || c.x > COURT.width - 0.35 || c.z < 0.5 || c.z > COURT.length - 0.35) continue;
      if (blocking(c, ic)) continue;
      const cost = Math.hypot(c.x - p.x, c.z - p.z) + Math.hypot(c.x - COURT.width / 2, c.z - COURT.shortLine) * 0.15;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
  }
  return best ?? p;
}

/** Seconds a clearing run takes, including the reaction to the opponent reaching the ball. */
export function clearDuration(from: Vec2, to: Vec2): number {
  return REACTION + Math.hypot(to.x - from.x, to.z - from.z) / RUN_SPEED;
}
