/** Body text and numbers. */
export const FONT_FAMILY = 'GameFont';
/** Headings in the battle scene: a classical, engraved-looking serif. */
export const TITLE_FONT = 'GameTitle';
/** Card text (name, rules text, cost, power): the typeface used by the Dextrous frame design. */
export const CARD_FONT = 'CardText';

/** The look: near-black surfaces, bone-colored text, tarnished metal and dried-blood accents. */
export const PALETTE = {
  panel: '#0d0b12',
  panelRaised: '#171320',
  inset: '#07060a',
  text: '#e6dfd0',
  textSoft: '#c4bcab',
  muted: '#8f887b',
  gold: '#c9973a',
  blood: '#9b1d2e',
  hpHigh: '#3f9d63',
  hpMid: '#c79a2b',
  hpLow: '#b3261e',
  energy: '#5bb0e8',
  mine: '#5b82b8',
  theirs: '#c4485a',
};

/** Border color of a frame when no frame file exists for that tier (tier 1 matches the Dextrous "Blue" frame). */
export const TIER_BORDER = ['#000000', '#000000', '#5b6470', '#a9743a', '#9fb6d9', '#d4a437'] as const;

/** Colors for Discord embeds (the text parts of a reply), kept in the same family as the images. */
export const EMBED_COLOR = {
  neutral: 0x3a2f4a,
  battle: 0x6b2737,
  victory: 0xb8893a,
  defeat: 0x5c1a1f,
  daily: 0x8a6d1d,
  profile: 0x2f4a4a,
};
