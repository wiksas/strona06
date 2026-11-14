import type { Outfit } from './court/figure';
import { MAX_LEVEL, type Progress } from './engine/progress';
import type { Side } from './engine/rules';

export interface Profile {
  name: string;
  outfit: Outfit;
  progress: Progress;
}

export const CPU_OUTFIT: Outfit = { shirt: '#2b2d31', shorts: '#f4f1ea' };

/** Shirt choices; the CPU's charcoal is deliberately absent. */
export const SHIRTS: { color: string; label: string }[] = [
  { color: '#1f5fa8', label: 'Niebieska' },
  { color: '#2e7d4f', label: 'Zielona' },
  { color: '#d9631e', label: 'Pomarańczowa' },
  { color: '#b3202a', label: 'Czerwona' },
  { color: '#138086', label: 'Morska' },
  { color: '#e8b400', label: 'Żółta' },
  { color: '#f2f0ea', label: 'Biała' },
];

export const SHORTS: { color: string; label: string }[] = [
  { color: '#f4f1ea', label: 'Białe' },
  { color: '#1d2b4f', label: 'Granatowe' },
  { color: '#6b6f76', label: 'Szare' },
  { color: '#2e7d4f', label: 'Zielone' },
];

const DEFAULTS: Record<Side, Profile> = {
  p1: { name: 'Gracz 1', outfit: { shirt: '#1f5fa8', shorts: '#f4f1ea' }, progress: { level: 1, xp: 0 } },
  p2: { name: 'Gracz 2', outfit: { shirt: '#2e7d4f', shorts: '#1d2b4f' }, progress: { level: 1, xp: 0 } },
};

const KEY = 'sklosz.profiles.v1';
const LEGACY_PROGRESS_KEY = 'sklosz.progress.v1';

function cleanProgress(p: Partial<Progress> | undefined): Progress {
  const level = Math.min(Math.max(Math.floor(Number(p?.level) || 1), 1), MAX_LEVEL);
  return { level, xp: Math.max(Number(p?.xp) || 0, 0) };
}

function cleanProfile(raw: Partial<Profile> | undefined, fallback: Profile): Profile {
  const shirt = SHIRTS.some((s) => s.color === raw?.outfit?.shirt) ? raw!.outfit!.shirt : fallback.outfit.shirt;
  const shorts = SHORTS.some((s) => s.color === raw?.outfit?.shorts) ? raw!.outfit!.shorts : fallback.outfit.shorts;
  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 16) : fallback.name;
  return { name, outfit: { shirt, shorts }, progress: cleanProgress(raw?.progress) };
}

/** `saved: false` means storage is unavailable (private mode, blocked cookies). */
export function loadProfiles(): { profiles: Record<Side, Profile>; saved: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Record<Side, Partial<Profile>>> | null;
    const profiles = { p1: cleanProfile(raw?.p1, DEFAULTS.p1), p2: cleanProfile(raw?.p2, DEFAULTS.p2) };
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_PROGRESS_KEY);
      if (legacy) profiles.p1.progress = cleanProgress(JSON.parse(legacy));
    }
    if (profiles.p1.outfit.shirt === profiles.p2.outfit.shirt) profiles.p2.outfit.shirt = SHIRTS.find((s) => s.color !== profiles.p1.outfit.shirt)!.color;
    return { profiles, saved: true };
  } catch {
    return { profiles: structuredClone(DEFAULTS), saved: false };
  }
}

export function saveProfiles(p: Record<Side, Profile>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}
