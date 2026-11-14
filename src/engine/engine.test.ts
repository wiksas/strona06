import { describe, expect, it } from 'vitest';
import { COURT } from '../court/dimensions';
import { simulate } from './physics';
import { checkShot } from './rally';
import { awardRally, newMatch, startNextGame, type MatchState, type Side } from './rules';
import { flightFor } from './shots';
import { RALLY_SHOTS, SERVE_SHOTS, presetShot } from './tactics';
import { serveContact, serveStand } from './turn';

function play(s: MatchState, winners: Side[]): MatchState {
  return winners.reduce(awardRally, s);
}

describe('PAR-11 scoring', () => {
  it('server keeps serve and switches box after winning a rally', () => {
    const s = awardRally(newMatch(2, 'p1'), 'p1');
    expect(s.score.p1).toBe(1);
    expect(s.server).toBe('p1');
    expect(s.box).toBe('left');
    expect(s.newHand).toBe(false);
  });

  it('receiver scores and takes the serve', () => {
    const s = awardRally(newMatch(2, 'p1'), 'p2');
    expect(s.score.p2).toBe(1);
    expect(s.server).toBe('p2');
    expect(s.newHand).toBe(true);
  });

  it('needs a two-point lead after 10:10', () => {
    let s = play(newMatch(2, 'p1'), [...Array(10).fill('p1'), ...Array(10).fill('p2')]);
    s = awardRally(s, 'p1');
    expect(s.gameWinner).toBeNull();
    s = awardRally(s, 'p2');
    s = awardRally(s, 'p2');
    expect(s.score).toEqual({ p1: 11, p2: 12 });
    expect(s.gameWinner).toBeNull();
    s = awardRally(s, 'p2');
    expect(s.gameWinner).toBe('p2');
    expect(s.games.p2).toBe(1);
  });

  it('game winner serves first in the next game and the match ends at the target', () => {
    let s = play(newMatch(1, 'p2'), Array(11).fill('p1'));
    expect(s.matchWinner).toBe('p1');
    s = play(newMatch(2, 'p2'), Array(11).fill('p1'));
    s = startNextGame(s);
    expect(s.score).toEqual({ p1: 0, p2: 0 });
    expect(s.server).toBe('p1');
    expect(s.matchWinner).toBeNull();
  });
});

describe('shot rules', () => {
  const from = { x: 3.2, y: 0.8, z: 6 };

  it('flags the tin, the out line and a ball that bounces before the front wall', () => {
    expect(checkShot(simulate(from, { x: 0, y: 0, z: -20 })).fault).toBe('tin');
    expect(checkShot(simulate(from, { x: 0, y: 14, z: -14 })).fault).toBe('out');
    expect(checkShot(simulate(from, { x: 0, y: -6, z: -4 })).fault).toBe('down');
  });

  it('every rally preset is a legal shot when played without error', () => {
    for (const stand of [{ x: 1.4, z: 7.5 }, { x: 5, z: 4 }, { x: 3.2, z: 8.6 }]) {
      for (const kind of RALLY_SHOTS) {
        const shot = presetShot(kind, stand);
        const f = flightFor({ ...stand, y: 0.8 }, shot);
        expect(checkShot(f).fault, `${kind} from ${stand.x},${stand.z}`).toBeNull();
      }
    }
  });

  it('serve presets land in the opposite back quarter from both boxes', () => {
    for (const box of ['left', 'right'] as const) {
      for (const kind of SERVE_SHOTS) {
        const f = flightFor(serveContact(box), presetShot(kind, serveStand(box)));
        const c = checkShot(f, box);
        expect(c.fault, `${kind} from ${box}`).toBeNull();
        const bounce = f.contacts.find((x) => x.surface === 'floor')!;
        expect(bounce.p.z).toBeGreaterThan(COURT.shortLine);
      }
    }
  });

  it('a serve below the service line is a fault', () => {
    const f = flightFor(serveContact('right'), { target: { surface: 'front', u: 2, v: 1.2 }, power: 0.6 });
    expect(checkShot(f, 'right').fault).toBe('serve-low');
  });
});
