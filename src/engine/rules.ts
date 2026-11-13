export type Side = 'player' | 'cpu';
export type Box = 'left' | 'right';

export interface MatchState {
  score: Record<Side, number>;
  games: Record<Side, number>;
  gamesToWin: number;
  server: Side;
  box: Box;
  /** True when the server just won the serve and picks a box. */
  newHand: boolean;
  /** Set once a game ends, until the next game starts. */
  gameWinner: Side | null;
  matchWinner: Side | null;
}

export const other = (s: Side): Side => (s === 'player' ? 'cpu' : 'player');

export function newMatch(gamesToWin: number, firstServer: Side): MatchState {
  return {
    score: { player: 0, cpu: 0 },
    games: { player: 0, cpu: 0 },
    gamesToWin,
    server: firstServer,
    box: 'right',
    newHand: true,
    gameWinner: null,
    matchWinner: null,
  };
}

/** A game is won at 11, or by two clear points once both reach 10. */
export function isGameWon(own: number, opp: number): boolean {
  return own >= 11 && own - opp >= 2;
}

/** Point-a-rally scoring: the rally winner scores and serves next. */
export function awardRally(s: MatchState, winner: Side): MatchState {
  const next: MatchState = { ...s, score: { ...s.score }, games: { ...s.games } };
  next.score[winner]++;
  if (winner === s.server) {
    next.box = s.box === 'left' ? 'right' : 'left';
    next.newHand = false;
  } else {
    next.server = winner;
    next.newHand = true;
  }
  if (isGameWon(next.score[winner], next.score[other(winner)])) {
    next.games[winner]++;
    next.gameWinner = winner;
    if (next.games[winner] >= s.gamesToWin) next.matchWinner = winner;
  }
  return next;
}

/** Winner of the previous game serves first in the next one. */
export function startNextGame(s: MatchState): MatchState {
  if (!s.gameWinner || s.matchWinner) return s;
  return {
    ...s,
    score: { player: 0, cpu: 0 },
    server: s.gameWinner,
    newHand: true,
    gameWinner: null,
  };
}
