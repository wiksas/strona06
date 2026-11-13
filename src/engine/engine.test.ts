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
    const s = awardRally(newMatch(2, 'player'), 'player');
    expect(s.score.player).toBe(1);
    expect(s.server).toBe('player');
    expect(s.box).toBe('left');
    expect(s.newHand).toBe(false);
  });

  it('receiver scores and takes the serve', () => {
    const s = awardRally(newMatch(2, 'player'), 'cpu');
    expect(s.score.cpu).toBe(1);
    expect(s.server).toBe('cpu');
    expect(s.newHand).toBe(true);
  });

  it('needs a two-point lead after 10:10', () => {
    let s = play(newMatch(2, 'player'), [...Array(10).fill('player'), ...Array(10).fill('cpu')]);
    s = awardRally(s, 'player');
    expect(s.gameWinner).toBeNull();
    s = awardRally(s, 'cpu');
    s = awardRally(s, 'cpu');
    expect(s.score).toEqual({ player: 11, cpu: 12 });
    expect(s.gameWinner).toBeNull();
    s = awardRally(s, 'cpu');
    expect(s.gameWinner).toBe('cpu');
    expect(s.games.cpu).toBe(1);
  });

  it('game winner serves first in the next game and the match ends at the target', () => {
    let s = play(newMatch(1, 'cpu'), Array(11).fill('player'));
    expect(s.matchWinner).toBe('player');
    s = play(newMatch(2, 'cpu'), Array(11).fill('player'));
    s = startNextGame(s);
    expect(s.score).toEqual({ player: 0, cpu: 0 });
    expect(s.server).toBe('player');
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
