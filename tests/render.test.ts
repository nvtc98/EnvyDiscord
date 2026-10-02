import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/data/cards';
import { chooseAction } from '../src/engine/ai';
import { createBattle, resolveTurn } from '../src/engine/battle';
import { createFighter } from '../src/engine/fighter';
import { renderBattle, renderBattleEnd } from '../src/discord/battle-view';
import { cardEmbed } from '../src/discord/render';
import { mulberry32 } from '../src/util/rng';

// Discord rejects payloads that break these limits, and we cannot hit the real API in tests.
describe('Discord payload limits', () => {
  it('every battle screen fits embed + button limits through a whole game', () => {
    const rng = mulberry32(5);
    const team = (offset: number) => CARDS.slice(offset, offset + 3).map((c) => createFighter(c, 5));
    let battle = createBattle(team(0), team(10));
    let log: string[] = [];
    while (!battle.winner) {
      const view = renderBattle(battle, log, 'abc123');
      const embed = view.embeds[0].toJSON();
      expect(embed.fields!.every((f) => f.value.length > 0 && f.value.length <= 1024)).toBe(true);
      expect(view.components.length).toBeLessThanOrEqual(5);
      for (const row of view.components) {
        const json = row.toJSON();
        expect(json.components.length).toBeGreaterThan(0);
        expect(json.components.length).toBeLessThanOrEqual(5);
        for (const button of json.components) {
          expect('label' in button && button.label!.length <= 80).toBe(true);
          expect('custom_id' in button && button.custom_id!.length <= 100).toBe(true);
        }
      }
      const result = resolveTurn(
        battle,
        chooseAction(battle, 'player', 'normal', rng),
        chooseAction(battle, 'enemy', 'normal', rng),
      );
      battle = result.battle;
      log = result.log;
    }
    const end = renderBattleEnd(battle, log, 'done').embeds[0].toJSON();
    expect(end.title).toMatch(/Victory|Defeat/);
  });

  it('every card renders as a valid embed', () => {
    for (const card of CARDS) expect(() => cardEmbed(card, 3).toJSON(), card.id).not.toThrow();
  });
});
