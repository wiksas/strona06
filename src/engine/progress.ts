export const MAX_LEVEL = 10;

export interface Progress {
  level: number;
  /** Experience collected inside the current level. */
  xp: number;
}

export const XP = { rally: 10, winner: 6, game: 30, match: 80 } as const;

export function xpToNext(level: number): number {
  return 80 + 50 * (level - 1);
}

export function addXp(p: Progress, amount: number): { progress: Progress; levelsGained: number } {
  let { level, xp } = p;
  xp += amount;
  let gained = 0;
  while (level < MAX_LEVEL && xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level++;
    gained++;
  }
  if (level === MAX_LEVEL) xp = Math.min(xp, xpToNext(level));
  return { progress: { level, xp }, levelsGained: gained };
}
