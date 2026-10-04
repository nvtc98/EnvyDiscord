import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/data/cards';
import { collectionCommand } from '../src/discord/commands/collection';
import { dailyCommand } from '../src/discord/commands/daily';
import { deckCommand } from '../src/discord/commands/deck';
import { cardCommand } from '../src/discord/commands/card';
import { DECK_SIZE } from '../src/engine/types';
import { MAX_TIER } from '../src/game/player';
import { buttonInteraction, embedOf, lastPayload, makeCtx, ownEverything, rows, selectInteraction, slashInteraction } from './discord-helpers';

describe('/daily', () => {
  it('gives three cards, then refuses a second claim the same day', async () => {
    const ctx = makeCtx(2);
    const first = slashInteraction('u');
    await dailyCommand.execute(first as never, ctx);
    expect(embedOf(lastPayload(first.reply)).description).toMatch(/🆕/);
    expect(Object.keys(ctx.repo.get('u').cards)).toHaveLength(3);
    expect(ctx.log.entries.find((e) => e.type === 'daily_claimed')).toBeDefined();

    const second = slashInteraction('u');
    await dailyCommand.execute(second as never, ctx);
    expect(lastPayload(second.reply).content).toMatch(/already claimed/);
  });

  it('says the collection is complete once every card is at max tier, and gives nothing', async () => {
    const ctx = makeCtx(2);
    ownEverything(ctx, 'u', MAX_TIER);
    const call = slashInteraction('u');
    await dailyCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/collection is complete/);
    expect(ctx.repo.get('u').coins).toBe(0);
  });
});

describe('/collection', () => {
  it('shows three cards per page with working page buttons, and the counts in the footer', async () => {
    const ctx = makeCtx(2);
    ownEverything(ctx, 'u', 2);
    const call = slashInteraction('u');
    await collectionCommand.execute(call as never, ctx);
    let payload = lastPayload(call.reply);
    expect(embedOf(payload).fields).toHaveLength(3);
    expect(embedOf(payload).footer.text).toMatch(new RegExp(`Page 1/${Math.ceil(CARDS.length / 3)} · Owned ${CARDS.length}/${CARDS.length}`));
    expect(rows(payload)[0].components.map((c: any) => c.disabled)).toEqual([true, false]);

    const next = buttonInteraction('u', 'collection:1');
    await collectionCommand.component!(next as never, ctx);
    payload = lastPayload(next.update);
    expect(embedOf(payload).footer.text).toMatch(/Page 2\//);
    expect(payload.attachments).toEqual([]);
  });

  it('invites a new player to claim their first cards', async () => {
    const call = slashInteraction('nobody');
    await collectionCommand.execute(call as never, makeCtx());
    expect(embedOf(lastPayload(call.reply)).description).toMatch(/\/daily/);
  });
});

describe('/deck', () => {
  it('explains how guests work when the player owns fewer than 12 cards', async () => {
    const ctx = makeCtx();
    const call = slashInteraction('u');
    await deckCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/guest cards/);
    expect(lastPayload(call.reply).components).toBeUndefined();
  });

  it('offers exactly 12 picks, and saves the chosen deck', async () => {
    const ctx = makeCtx();
    ownEverything(ctx, 'u');
    const call = slashInteraction('u');
    await deckCommand.execute(call as never, ctx);
    const menu = rows(lastPayload(call.reply))[0].components[0];
    expect([menu.min_values, menu.max_values]).toEqual([DECK_SIZE, DECK_SIZE]);
    expect(menu.options).toHaveLength(CARDS.length);

    const chosen = menu.options.slice(0, DECK_SIZE).map((o: any) => o.value);
    const pick = selectInteraction('u', 'deck:select', chosen);
    await deckCommand.component!(pick as never, ctx);
    expect(ctx.repo.get('u').deck).toEqual(chosen);
    expect(lastPayload(pick.update).content).toMatch(/Deck saved/);
    expect(ctx.log.entries.find((e) => e.type === 'deck_set')).toBeDefined();
  });

  it('rejects a selection with the wrong size or cards the player does not own', async () => {
    const ctx = makeCtx();
    const player = ctx.repo.get('u');
    for (const c of CARDS.slice(0, 12)) player.cards[c.id] = 1;
    await ctx.repo.save(player);
    const tooFew = selectInteraction('u', 'deck:select', CARDS.slice(0, 11).map((c) => c.id));
    await deckCommand.component!(tooFew as never, ctx);
    expect(lastPayload(tooFew.update).content).toMatch(/Invalid selection/);
    const notOwned = selectInteraction('u', 'deck:select', CARDS.slice(3, 15).map((c) => c.id)); // includes cards 12..14
    await deckCommand.component!(notOwned as never, ctx);
    expect(lastPayload(notOwned.update).content).toMatch(/Invalid selection/);
    expect(ctx.repo.get('u').deck).toEqual([]);
  });
});

describe('/card', () => {
  it('shows cost, power and ability, and whether you own it', async () => {
    const ctx = makeCtx();
    const call = slashInteraction('u', { name: 'phoenix' });
    await cardCommand.execute(call as never, ctx);
    const embed = embedOf(lastPayload(call.reply));
    expect(embed.title).toBe('Phoenix');
    expect(embed.description).toMatch(/Cost 5.*Power 5/s);
    expect(embed.description).toMatch(/heal 4 HP/);
    expect(embed.footer.text).toMatch(/don't own/);
  });

  it('says so when no card matches', async () => {
    const call = slashInteraction('u', { name: 'nothing like this' });
    await cardCommand.execute(call as never, makeCtx());
    expect(lastPayload(call.reply).content).toMatch(/not found/);
  });
});
