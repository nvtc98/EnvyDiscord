import type { Element, Rarity, SkillKind } from '../engine/types';

export const FONT_FAMILY = 'GameFont';

export const RARITY_STYLE: Record<Rarity, { color: string; label: string }> = {
  common: { color: '#9ca3af', label: 'COMMON' },
  rare: { color: '#3b82f6', label: 'RARE' },
  epic: { color: '#a855f7', label: 'EPIC' },
  legendary: { color: '#f59e0b', label: 'LEGENDARY' },
};

/** `icon` is SVG path data on a 24x24 grid, drawn as vectors so no emoji font is needed. */
export const ELEMENT_STYLE: Record<Element, { dark: string; light: string; accent: string; icon: string }> = {
  fire: {
    dark: '#7f1d1d',
    light: '#f97316',
    accent: '#ea580c',
    icon: 'M12 1C13 6 18 9 18 15A6 6 0 0 1 6 15C6 12 8 10 9 8C9.5 10 10.5 11 11.5 11C11 8 11 4 12 1Z',
  },
  water: {
    dark: '#0c4a6e',
    light: '#38bdf8',
    accent: '#0284c7',
    icon: 'M12 2C12 2 5 10.5 5 15A7 7 0 0 0 19 15C19 10.5 12 2 12 2Z',
  },
  grass: {
    dark: '#14532d',
    light: '#86efac',
    accent: '#16a34a',
    icon: 'M20 3C11 3 4 8 4 16C4 18 5 20 5 20C6 15 9 12 14 10C10 13 8 16 8 20C16 20 20 13 20 3Z',
  },
};

export const KIND_COLOR: Record<SkillKind, string> = {
  attack: '#ef4444',
  heal: '#22c55e',
  shield: '#60a5fa',
};
