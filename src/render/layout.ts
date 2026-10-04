import { readFile } from 'node:fs/promises';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextField extends Rect {
  fontSize: number;
  weight: 400 | 700;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight?: number;
  maxLines?: number;
  padding?: number;
}

/** Where everything goes on a card, in Dextrous pixels. Loaded from assets/frames/layout.json. */
export interface CardLayout {
  card: { width: number; height: number; cornerRadius: number };
  art: Rect;
  frame: { opacity: number };
  fields: Record<'name' | 'description' | 'cost' | 'power', TextField>;
}

const num = (v: unknown, label: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`layout.json: "${label}" must be a number`);
  return v;
};

function rect(v: unknown, label: string): Rect {
  const r = (v ?? {}) as Record<string, unknown>;
  return { x: num(r.x, `${label}.x`), y: num(r.y, `${label}.y`), width: num(r.width, `${label}.width`), height: num(r.height, `${label}.height`) };
}

function field(v: unknown, label: string): TextField {
  const f = (v ?? {}) as Record<string, unknown>;
  const weight = f.weight === 400 || f.weight === 700 ? f.weight : 400;
  const align = f.align === 'left' || f.align === 'right' ? f.align : 'center';
  return {
    ...rect(f, label),
    fontSize: num(f.fontSize, `${label}.fontSize`),
    weight,
    color: typeof f.color === 'string' ? f.color : '#ffffff',
    align,
    lineHeight: typeof f.lineHeight === 'number' ? f.lineHeight : undefined,
    maxLines: typeof f.maxLines === 'number' ? f.maxLines : undefined,
    padding: typeof f.padding === 'number' ? f.padding : undefined,
  };
}

export function parseLayout(json: unknown): CardLayout {
  const j = (json ?? {}) as Record<string, any>;
  const card = j.card ?? {};
  return {
    card: { width: num(card.width, 'card.width'), height: num(card.height, 'card.height'), cornerRadius: num(card.cornerRadius ?? 10, 'card.cornerRadius') },
    art: rect(j.art, 'art'),
    frame: { opacity: typeof j.frame?.opacity === 'number' ? j.frame.opacity : 1 },
    fields: { name: field(j.fields?.name, 'fields.name'), description: field(j.fields?.description, 'fields.description'), cost: field(j.fields?.cost, 'fields.cost'), power: field(j.fields?.power, 'fields.power') },
  };
}

export async function loadLayout(path: string): Promise<CardLayout> {
  return parseLayout(JSON.parse(await readFile(path, 'utf8')));
}

/** Used when assets/frames/layout.json is missing. Same numbers as the file shipped in the repo. */
export const DEFAULT_LAYOUT: CardLayout = {
  card: { width: 240, height: 336, cornerRadius: 10 },
  art: { x: 0, y: 0, width: 240, height: 336 },
  frame: { opacity: 1 },
  fields: {
    name: { x: 6, y: 228, width: 228, height: 24, fontSize: 15, weight: 700, color: '#ffffff', align: 'center', maxLines: 1 },
    description: { x: 18, y: 252, width: 204, height: 72, fontSize: 15, weight: 400, color: '#ffffff', align: 'center', lineHeight: 1.1, maxLines: 5, padding: 4 },
    cost: { x: -6, y: -6, width: 42, height: 42, fontSize: 16, weight: 700, color: '#ffffff', align: 'center' },
    power: { x: 204, y: -6, width: 42, height: 42, fontSize: 16, weight: 700, color: '#ffffff', align: 'center' },
  },
};
