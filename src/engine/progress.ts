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

const KEY = 'sklosz.progress.v1';

/** `saved: false` means storage is unavailable (private mode, blocked cookies). */
export function loadProgress(): { progress: Progress; saved: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { progress: { level: 1, xp: 0 }, saved: true };
    const p = JSON.parse(raw) as Partial<Progress>;
    const level = Math.min(Math.max(Math.floor(Number(p.level) || 1), 1), MAX_LEVEL);
    const xp = Math.max(Number(p.xp) || 0, 0);
    return { progress: { level, xp }, saved: true };
  } catch {
    return { progress: { level: 1, xp: 0 }, saved: false };
  }
}

export function saveProgress(p: Progress): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}
