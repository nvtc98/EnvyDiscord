import { EmbedBuilder } from 'discord.js';
import { createFighter } from '../engine/fighter';
import type { CardDef, Element, Rarity, Skill } from '../engine/types';

export const ELEMENT_EMOJI: Record<Element, string> = { fire: '🔥', water: '💧', grass: '🌿' };
export const ELEMENT_NAME: Record<Element, string> = { fire: 'Fire', water: 'Water', grass: 'Grass' };
export const RARITY_LABEL: Record<Rarity, string> = {
  common: '⚪ Common',
  rare: '🔵 Rare',
  epic: '🟣 Epic',
  legendary: '🟡 Legendary',
};
const RARITY_COLOR: Record<Rarity, number> = {
  common: 0x9ca3af,
  rare: 0x3b82f6,
  epic: 0x8b5cf6,
  legendary: 0xf59e0b,
};

export function hpBar(hp: number, max: number, length = 10): string {
  const filled = hp > 0 ? Math.max(1, Math.round((hp / max) * length)) : 0;
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

export function skillSummary(skill: Skill): string {
  const cooldown = skill.cooldown > 0 ? ` · cooldown ${skill.cooldown} ${skill.cooldown === 1 ? 'turn' : 'turns'}` : '';
  switch (skill.kind) {
    case 'attack':
      return `⚔️ **${skill.name}** — damage ×${skill.power}${cooldown}`;
    case 'heal':
      return `💚 **${skill.name}** — heals ${Math.round(skill.power * 100)}% HP${cooldown}`;
    case 'shield':
      return `🛡️ **${skill.name}** — shield of ${Math.round(skill.power * 100)}% HP${cooldown}`;
  }
}

export function statsLine(stats: { maxHp: number; atk: number; def: number; spd: number }): string {
  return `❤️ ${stats.maxHp} · ⚔️ ${stats.atk} · 🛡️ ${stats.def} · 💨 ${stats.spd}`;
}

export function cardEmbed(def: CardDef, level = 1, footer?: string): EmbedBuilder {
  const stats = createFighter(def, level);
  const embed = new EmbedBuilder()
    .setColor(RARITY_COLOR[def.rarity])
    .setTitle(`${ELEMENT_EMOJI[def.element]} ${def.name}`)
    .setDescription(
      `${RARITY_LABEL[def.rarity]} · ${ELEMENT_NAME[def.element]} type · Lv ${stats.level}\n${statsLine(stats)}`,
    )
    .addFields({ name: 'Skills', value: def.skills.map(skillSummary).join('\n') });
  if (footer) embed.setFooter({ text: footer });
  return embed;
}
