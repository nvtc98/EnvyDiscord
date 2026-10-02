import { describe, expect, it, vi } from 'vitest';
import { commands } from '../src/discord/commands';
import { sayCommand } from '../src/discord/commands/say';

describe('command registration', () => {
  it('registers every command for guild + user install in guilds, bot DM and private channels', () => {
    expect(commands.map((c) => c.data.name).sort()).toEqual(
      ['battle', 'card', 'collection', 'daily', 'merciful', 'profile', 'say', 'team'],
    );
    for (const command of commands) {
      const json = command.data.toJSON();
      expect(json.integration_types, command.data.name).toEqual([0, 1]);
      expect(json.contexts, command.data.name).toEqual([0, 1, 2]);
    }
  });
});

describe('/say', () => {
  it('repeats the text verbatim without allowing any pings', async () => {
    const reply = vi.fn();
    const interaction = { options: { getString: () => '@everyone Merciful be' }, reply };
    await sayCommand.execute(interaction as never, {} as never);
    expect(reply).toHaveBeenCalledWith({
      content: '@everyone Merciful be',
      allowedMentions: { parse: [] },
    });
  });

  it('caps the input at the Discord message limit', () => {
    const json = sayCommand.data.toJSON() as { options?: { max_length?: number; required?: boolean }[] };
    const option = json.options![0];
    expect(option.max_length).toBe(2000);
    expect(option.required).toBe(true);
  });
});
