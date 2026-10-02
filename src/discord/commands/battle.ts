import { randomBytes } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { chooseAction, type Difficulty } from '../../engine/ai';
import { createBattle, forfeit, isLegal, resolveTurn } from '../../engine/battle';
import { createFighter } from '../../engine/fighter';
import type { Action, Battle } from '../../engine/types';
import { applyBattleResult, generateEnemyTeam } from '../../game/pve';
import { resolveTeam } from '../../game/team';
import { slash, type Command } from '../command';
import { renderBattle, renderBattleEnd } from '../battle-view';
import { tryRender } from '../images';

interface Session {
  id: string;
  battle: Battle;
  difficulty: Difficulty;
  log: string[];
  touched: number;
}

/** Battles live in memory only, one per user. A restart drops unfinished battles. */
const sessions = new Map<string, Session>();
const IDLE_MS = 30 * 60 * 1000;

function purgeIdle(now: number): void {
  for (const [userId, session] of sessions) {
    if (now - session.touched > IDLE_MS) sessions.delete(userId);
  }
}

export const battleCommand: Command = {
  data: slash('battle', 'Fight the AI in a 3v3 match').addStringOption((option) =>
    option
      .setName('difficulty')
      .setDescription('AI difficulty (default: normal)')
      .addChoices({ name: 'Easy', value: 'easy' }, { name: 'Normal', value: 'normal' }, { name: 'Hard', value: 'hard' }),
  ),

  async execute(interaction, ctx) {
    const player = ctx.repo.get(interaction.user.id);
    const team = resolveTeam(player, ctx.cardIndex);
    if (!team) {
      await interaction.reply({
        content: 'You need at least 3 different cards. Use `/daily` to get some!',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const difficulty = (interaction.options.getString('difficulty') ?? 'normal') as Difficulty;
    const battle = createBattle(
      team.map((m) => createFighter(m.def, m.level)),
      generateEnemyTeam(ctx.cards, difficulty, ctx.rng),
    );
    const now = Date.now();
    purgeIdle(now);
    const session: Session = { id: randomBytes(3).toString('hex'), battle, difficulty, log: [], touched: now };
    sessions.set(interaction.user.id, session);

    const image = await tryRender(ctx, (r) => r.battle(battle));
    await interaction.reply({ ...renderBattle(battle, [], session.id, image ?? undefined), flags: MessageFlags.Ephemeral });
  },

  async component(interaction, ctx) {
    if (!interaction.isButton()) return;
    const [, battleId, kind, arg] = interaction.customId.split(':');
    const userId = interaction.user.id;
    const session = sessions.get(userId);

    if (!session || session.id !== battleId) {
      await interaction.update({
        content: '⌛ This battle has ended or expired. Use `/battle` to play again.',
        embeds: [],
        components: [],
      });
      return;
    }

    let next: { battle: Battle; log: string[] };
    if (kind === 'forfeit') {
      next = { battle: forfeit(session.battle, 'player'), log: ['You forfeited.'] };
    } else if (kind === 'skill' || kind === 'switch') {
      const action: Action = { type: kind, index: Number(arg) };
      if (!isLegal(session.battle, 'player', action)) {
        await interaction.reply({ content: "That action isn't available right now.", flags: MessageFlags.Ephemeral });
        return;
      }
      const enemyAction = chooseAction(session.battle, 'enemy', session.difficulty, ctx.rng);
      next = resolveTurn(session.battle, action, enemyAction);
    } else {
      return;
    }

    session.battle = next.battle;
    session.log = next.log;
    session.touched = Date.now();

    const image = (await tryRender(ctx, (r) => r.battle(next.battle))) ?? undefined;
    if (!next.battle.winner) {
      // `attachments: []` drops the previous turn's image so only the new one stays.
      await interaction.update({ ...renderBattle(next.battle, next.log, session.id, image), attachments: [] });
      return;
    }

    sessions.delete(userId);
    const won = next.battle.winner === 'player';
    const player = ctx.repo.get(userId);
    const coins = applyBattleResult(player, session.difficulty, won);
    await ctx.repo.save(player);
    const summary = won ? `You won! **+${coins} coins**` : `You lost. **+${coins} coins** as consolation.`;
    await interaction.update({ ...renderBattleEnd(next.battle, next.log, summary, image), attachments: [] });
  },
};
