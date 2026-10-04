import { MessageFlags } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sayLaterCommand } from '../src/discord/commands/say-later';
import { nullLogger } from '../src/log/logger';

const ctx = { log: nullLogger } as never;

function call(userId: string, seconds = 60, content = 'hello @everyone') {
  const followUp = vi.fn(async () => undefined);
  const reply = vi.fn(async () => undefined);
  const interaction = {
    id: `i-${Math.random()}`,
    user: { id: userId },
    reply,
    followUp,
    options: { getString: () => content, getInteger: () => seconds },
  };
  return { interaction: interaction as never, reply, followUp };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('/say-later', () => {
  it('confirms privately now and speaks publicly, without pings, after the delay', async () => {
    const { interaction, reply, followUp } = call('a', 30);
    await sayLaterCommand.execute(interaction, ctx);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, content: expect.stringContaining('30s') }));
    expect(followUp).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(followUp).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(followUp).toHaveBeenCalledWith({ content: 'hello @everyone', allowedMentions: { parse: [] } });
  });

  it('allows at most 3 waiting messages per user and frees a slot once one is sent', async () => {
    for (let i = 0; i < 3; i++) await sayLaterCommand.execute(call('b', 60).interaction, ctx);
    const blocked = call('b', 60);
    await sayLaterCommand.execute(blocked.interaction, ctx);
    expect(blocked.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('already have 3') }));
    expect(blocked.followUp).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    const allowed = call('b', 60);
    await sayLaterCommand.execute(allowed.interaction, ctx);
    expect(allowed.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('60s') }));
  });

  it('does not count against other users', async () => {
    for (let i = 0; i < 3; i++) await sayLaterCommand.execute(call('c', 60).interaction, ctx);
    const other = call('d', 60);
    await sayLaterCommand.execute(other.interaction, ctx);
    expect(other.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('60s') }));
    await vi.advanceTimersByTimeAsync(60_000);
  });

  it('survives an expired interaction token and still frees the slot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = call('e', 10);
    first.followUp.mockRejectedValue(new Error('Invalid Webhook Token'));
    await sayLaterCommand.execute(first.interaction, ctx);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(warn).toHaveBeenCalled();
    for (let i = 0; i < 3; i++) {
      const next = call('e', 60);
      await sayLaterCommand.execute(next.interaction, ctx);
      expect(next.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('60s') }));
    }
    await vi.advanceTimersByTimeAsync(60_000);
    warn.mockRestore();
  });

  it('only accepts delays inside the 15-minute token window', () => {
    const json = sayLaterCommand.data.toJSON() as { options?: { name: string; min_value?: number; max_value?: number }[] };
    const seconds = json.options!.find((o) => o.name === 'seconds')!;
    expect(seconds.min_value).toBe(5);
    expect(seconds.max_value).toBe(840); // 14 min, under the 15 min limit
  });
});
