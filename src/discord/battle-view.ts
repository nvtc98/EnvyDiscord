import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { Battle, Side } from '../engine/types';
import { attach } from './images';
import { ELEMENT_EMOJI, hpBar } from './render';

function sideBlock(side: Side): string {
  const active = side.fighters[side.active];
  const lines = [
    `${ELEMENT_EMOJI[active.element]} **${active.name}** Lv ${active.level}`,
    `${hpBar(active.hp, active.maxHp)} ${active.hp}/${active.maxHp}${active.shield > 0 ? ` · 🛡️ ${active.shield}` : ''}`,
  ];
  const bench = side.fighters
    .filter((_, i) => i !== side.active)
    .map((f) => `${f.hp > 0 ? ELEMENT_EMOJI[f.element] : '☠️'} ${f.name} ${f.hp}/${f.maxHp}`);
  if (bench.length > 0) lines.push(`Bench: ${bench.join(' · ')}`);
  return lines.join('\n');
}

/**
 * With an image the picture shows both teams, so the embed only carries the turn log.
 * Without one (images unavailable) the embed shows both teams as text.
 */
function baseEmbed(battle: Battle, log: string[], title: string, color: number, hasImage: boolean): EmbedBuilder {
  const logText = (log.join('\n') || 'Choose your move!').slice(0, 1000);
  const embed = new EmbedBuilder().setColor(color).setTitle(title);
  if (hasImage) return embed.setDescription(logText);
  return embed.addFields(
    { name: 'You', value: sideBlock(battle.player) },
    { name: 'Enemy', value: sideBlock(battle.enemy) },
    { name: 'Last turn', value: logText },
  );
}

function imageFiles(image: Buffer | undefined, name: string) {
  return image ? [attach(image, name)] : [];
}

export function renderBattle(battle: Battle, log: string[], battleId: string, image?: Buffer) {
  const me = battle.player.fighters[battle.player.active];
  const skills = new ActionRowBuilder<ButtonBuilder>();
  me.skills.forEach((skill, index) => {
    const cooldown = me.cooldowns[index];
    const icon = skill.kind === 'attack' ? '⚔️' : skill.kind === 'heal' ? '💚' : '🛡️';
    skills.addComponents(
      new ButtonBuilder()
        .setCustomId(`battle:${battleId}:skill:${index}`)
        .setLabel(cooldown > 0 ? `${skill.name} (${cooldown})` : skill.name)
        .setEmoji(icon)
        .setStyle(skill.kind === 'attack' ? ButtonStyle.Primary : skill.kind === 'heal' ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(cooldown > 0),
    );
  });

  const others = new ActionRowBuilder<ButtonBuilder>();
  battle.player.fighters.forEach((fighter, index) => {
    if (index === battle.player.active || fighter.hp <= 0) return;
    others.addComponents(
      new ButtonBuilder()
        .setCustomId(`battle:${battleId}:switch:${index}`)
        .setLabel(`Switch: ${fighter.name}`)
        .setEmoji(ELEMENT_EMOJI[fighter.element])
        .setStyle(ButtonStyle.Secondary),
    );
  });
  others.addComponents(
    new ButtonBuilder().setCustomId(`battle:${battleId}:forfeit`).setLabel('Forfeit').setStyle(ButtonStyle.Danger),
  );

  return {
    content: '',
    embeds: [baseEmbed(battle, log, `⚔️ Turn ${battle.turn}`, 0x6366f1, Boolean(image))],
    components: [skills, others],
    files: imageFiles(image, `battle-${battleId}-${battle.turn}.png`),
  };
}

export function renderBattleEnd(battle: Battle, log: string[], summary: string, image?: Buffer) {
  const won = battle.winner === 'player';
  const embed = baseEmbed(battle, log, won ? '🏆 Victory!' : '💀 Defeat', won ? 0x22c55e : 0xef4444, Boolean(image));
  if (image) embed.setDescription(`${summary}\n\n${log.join('\n')}`.slice(0, 1000));
  else embed.setDescription(summary);
  return {
    content: '',
    embeds: [embed],
    components: [] as ActionRowBuilder<ButtonBuilder>[],
    files: imageFiles(image, `battle-end-${battle.turn}.png`),
  };
}
