import { DiscordAPIError, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { dmCommand } from '../src/discord/commands/dm';

const TARGET = '1555622989335232643';

function setup({ ownerId = 'owner', caller = 'owner', options = {}, send = vi.fn(async () => undefined) } = {}) {
  const reply = vi.fn();
  const fetchUser = vi.fn(async (id: string) => ({ id, username: 'bob', bot: false, send }));
  const values: Record<string, string | null> = { message: 'hello @everyone', 'user-id': TARGET, ...options };
  const interaction = {
    user: { id: caller },
    reply,
    client: { application: { fetch: async () => ({ owner: { id: ownerId } }) }, users: { fetch: fetchUser } },
    options: {
      getUser: () => null,
      getString: (name: string) => values[name] ?? null,
    },
  };
  return { interaction: interaction as never, reply, send, fetchUser };
}

const apiError = (code: number) =>
  new DiscordAPIError({ message: 'nope', code }, code, 403, 'POST', '/users/@me/channels', {});

describe('/dm', () => {
  it('sends the message verbatim, without pings, and confirms privately', async () => {
    const { interaction, reply, send } = setup();
    await dmCommand.execute(interaction, {} as never);
    expect(send).toHaveBeenCalledWith({ content: 'hello @everyone', allowedMentions: { parse: [] } });
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, content: expect.stringContaining('bob') }));
  });

  it('refuses anyone who is not the bot owner and never contacts the target', async () => {
    const { interaction, reply, send, fetchUser } = setup({ caller: 'stranger' });
    await dmCommand.execute(interaction, {} as never);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Only the bot owner') }));
    expect(fetchUser).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([['abc'], ['123'], ['']])('rejects an invalid user id %j', async (bad) => {
    const { interaction, reply, send } = setup({ options: { 'user-id': bad } });
    await dmCommand.execute(interaction, {} as never);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('valid numeric') }));
    expect(send).not.toHaveBeenCalled();
  });

  it('explains Discord refusing the DM (error 50007) instead of crashing', async () => {
    const send = vi.fn(async () => {
      throw apiError(50007);
    });
    const { interaction, reply } = setup({ send });
    await dmCommand.execute(interaction, {} as never);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('share a server') }));
  });

  it('rethrows unexpected errors so the global handler reports them', async () => {
    const send = vi.fn(async () => {
      throw new Error('network down');
    });
    const { interaction } = setup({ send });
    await expect(dmCommand.execute(interaction, {} as never)).rejects.toThrow('network down');
  });
});
