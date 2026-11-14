import { COURT } from '../court/dimensions';
import type { Flight, Vec3 } from './physics';
import {
  REACTION, RECOVERY, ballHitsBody, checkShot, findIntercept, positionAt,
  type Fault, type Intercept, type Move, type ShotCheck, type Vec2,
} from './rally';
import { other, type Box, type Side } from './rules';
import { executeShot, type ShotInput } from './shots';

export interface Striker {
  side: Side;
  /** Ball position at contact. */
  contact: Vec3;
  stand: Vec2;
  level: number;
  pressure: number;
}

export type Result =
  | { kind: 'continue'; intercept: Intercept }
  | { kind: 'point'; winner: Side; reason: string; fault?: Fault }
  | { kind: 'let'; reason: string };

export interface ShotOutcome {
  striker: Side;
  played: ShotInput;
  flight: Flight;
  check: ShotCheck;
  strikerMove: Move;
  /** Receiver motion before reacting to this shot. */
  receiverDrift: Move;
  /** Receiver motion after reacting; when the rally continues it ends at the intercept stand. */
  receiverMove: Move;
  result: Result;
  /** Seconds of play to animate. */
  duration: number;
}

const FAULT_TEXT: Record<Fault, string> = {
  tin: 'Piłka w blachę (tin)',
  out: 'Aut: piłka dotknęła linii autowej lub nad nią',
  down: 'Piłka odbiła się od podłogi przed ścianą frontową',
  'serve-low': 'Błąd serwisu: piłka na lub pod linią serwisową',
  'serve-side': 'Błąd serwisu: piłka najpierw w ścianę boczną',
  'serve-short': 'Błąd serwisu: piłka przed linią krótką',
  'serve-box': 'Błąd serwisu: piłka poza przeciwną ćwiartką',
};

export function playShot(opts: {
  striker: Striker;
  shot: ShotInput;
  moveTo: Vec2;
  /** Receiver's motion as of the strike: current position and the spot they were heading to. */
  receiver: Move;
  serveBox?: Box;
  rand: () => number;
}): ShotOutcome {
  const { striker, shot, moveTo, receiver, serveBox, rand } = opts;
  const receiverSide = other(striker.side);
  const { input, flight } = executeShot(striker.contact, shot, striker.level, striker.pressure, rand);
  const check = checkShot(flight, serveBox);
  const strikerMove: Move = { from: striker.stand, to: clampStand(moveTo), delay: RECOVERY };
  const base = { striker: striker.side, played: input, flight, check, strikerMove, receiverDrift: receiver };

  if (check.fault) {
    const at = flight.contacts.find((c) => c.tin || c.out || c.surface === 'floor')?.t ?? flight.end;
    return {
      ...base,
      receiverMove: receiver,
      result: { kind: 'point', winner: receiverSide, reason: FAULT_TEXT[check.fault], fault: check.fault },
      duration: at + 0.5,
    };
  }

  const intercept = findIntercept(flight, check, receiver);
  const hitBody = serveBox ? null : ballHitsBody(flight, check, receiver);
  if (hitBody) {
    const t = check.frontAt;
    if (hitBody === 'let') {
      return { ...base, receiverMove: receiver, result: { kind: 'let', reason: 'Let: piłka po ścianie bocznej trafiła rywala' }, duration: t + 0.4 };
    }
    const reason = 'Stroke: piłka trafiła rywala w drodze prosto na ścianę frontową';
    return { ...base, receiverMove: receiver, result: { kind: 'point', winner: striker.side, reason }, duration: t + 0.4 };
  }

  if (!intercept) {
    return {
      ...base,
      receiverMove: receiver,
      result: { kind: 'point', winner: striker.side, reason: 'Rywal nie dobiegł przed drugim odbiciem' },
      duration: flight.end + 0.4,
    };
  }
  return {
    ...base,
    receiverMove: chase(receiver, intercept),
    result: { kind: 'continue', intercept },
    duration: intercept.t,
  };
}

/** The receiver keeps drifting until reacting, then runs to the intercept stand. */
function chase(receiver: Move, intercept: Intercept): Move {
  return { from: positionAt(receiver, REACTION), to: intercept.stand, delay: REACTION };
}

function clampStand(p: Vec2): Vec2 {
  return {
    x: Math.min(Math.max(p.x, 0.3), COURT.width - 0.3),
    z: Math.min(Math.max(p.z, 0.6), COURT.length - 0.3),
  };
}

export function serveStand(box: Box): Vec2 {
  return { x: box === 'left' ? 0.8 : COURT.width - 0.8, z: COURT.shortLine + 0.8 };
}

export function receiveStand(serverBox: Box): Vec2 {
  return { x: serverBox === 'left' ? COURT.width - 1.9 : 1.9, z: COURT.shortLine + 2.3 };
}

export function serveContact(box: Box): Vec3 {
  const s = serveStand(box);
  return { x: s.x + (box === 'left' ? 0.45 : -0.45), y: 0.95, z: s.z - 0.35 };
}
