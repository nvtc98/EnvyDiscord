import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbedBuilder, Events, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { describeInteraction, describePayload, instrument } from '../src/log/instrument';
import { logDirectMessages } from '../src/log/inbound';
import { JsonlLogger, nullLogger } from '../src/log/logger';

const tmp = () => mkdtemp(join(tmpdir(), 'logs-'));
const readLines = async (file: string) => (await readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));

describe('JsonlLogger', () => {
  it('appends one JSON object per line to separate game and message files', async () => {
    const dir = await tmp();
    const log = new JsonlLogger(dir, 'UTC', true, () => new Date('2026-10-03T08:00:00Z'));
    log.game('daily_claimed', { userId: '1', coins: 30 });
    log.game('team_set', { userId: '1' });
    log.message('interaction', { name: 'daily' });
    await log.flush();

    expect((await readdir(dir)).sort()).toEqual(['game-2026-10-03.jsonl', 'messages-2026-10-03.jsonl']);
    const game = await readLines(join(dir, 'game-2026-10-03.jsonl'));
    expect(game).toEqual([
      { ts: '2026-10-03T08:00:00.000Z', type: 'daily_claimed', userId: '1', coins: 30 },
      { ts: '2026-10-03T08:00:00.000Z', type: 'team_set', userId: '1' },
    ]);
    expect(await readLines(join(dir, 'messages-2026-10-03.jsonl'))).toHaveLength(1);
  });

  it('starts a new file when the day changes in the configured timezone', async () => {
    const dir = await tmp();
    let now = new Date('2026-10-03T16:30:00Z'); // 23:30 in Vietnam
    const log = new JsonlLogger(dir, 'Asia/Ho_Chi_Minh', true, () => now);
    log.game('a');
    now = new Date('2026-10-03T17:30:00Z'); // 00:30 next day in Vietnam
    log.game('b');
    await log.flush();
    expect((await readdir(dir)).sort()).toEqual(['game-2026-10-03.jsonl', 'game-2026-10-04.jsonl']);
  });

  it('keeps every line when many writes happen at once', async () => {
    const dir = await tmp();
    const log = new JsonlLogger(dir, 'UTC', true, () => new Date('2026-10-03T00:00:00Z'));
    for (let i = 0; i < 200; i++) log.game('n', { i });
    await log.flush();
    const lines = await readLines(join(dir, 'game-2026-10-03.jsonl'));
    expect(lines.map((l) => l.i)).toEqual([...Array(200).keys()]);
  });

  it('hides message text when content logging is off', () => {
    const log = new JsonlLogger('unused', 'UTC', false);
    expect(log.text('secret words')).toBe('[hidden, 12 chars]');
    expect(new JsonlLogger('unused', 'UTC', true).text('secret words')).toBe('secret words');
    expect(log.text(undefined)).toBeUndefined();
  });

  it('never throws when the log cannot be written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const blocked = await tmp();
    const log = new JsonlLogger(join(blocked, 'game-2026-10-03.jsonl', 'nope'), 'UTC', true, () => new Date('2026-10-03T00:00:00Z'));
    // A directory path that is really a file makes mkdir/append fail.
    await import('node:fs/promises').then((fs) => fs.writeFile(join(blocked, 'game-2026-10-03.jsonl'), 'x'));
    expect(() => log.game('x')).not.toThrow();
    await expect(log.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('config', () => {
  it('reads log settings with safe defaults', () => {
    const saved = { ...process.env };
    process.env.DISCORD_TOKEN = 'x';
    delete process.env.LOG_DIR;
    delete process.env.LOG_CONTENT;
    expect(loadConfig()).toMatchObject({ logDir: 'logs', logContent: true });
    process.env.LOG_CONTENT = 'FALSE';
    process.env.LOG_DIR = '/var/log/bot';
    expect(loadConfig()).toMatchObject({ logDir: '/var/log/bot', logContent: false });
    process.env = saved;
  });
});

describe('instrument', () => {
  function fakeInteraction() {
    const calls: unknown[] = [];
    const interaction = {
      id: 'int1',
      channelId: 'chan1',
      user: { id: 'user1' },
      reply: async (p: unknown) => (calls.push(['reply', p]), 'replied'),
      followUp: async (p: unknown) => (calls.push(['followUp', p]), 'followed'),
    };
    return { interaction, calls };
  }
  function spyLogger() {
    const entries: { type: string; data: Record<string, unknown> }[] = [];
    return { ...nullLogger, message: (type: string, data: Record<string, unknown> = {}) => void entries.push({ type, data }), entries };
  }

  it('logs what the bot says while still delivering it and returning the result', async () => {
    const { interaction, calls } = fakeInteraction();
    const log = spyLogger();
    instrument(interaction as never, log);

    const embed = new EmbedBuilder().setTitle('Daily pack').setDescription('You got a card');
    const result = await interaction.reply({ content: 'hi', embeds: [embed], flags: MessageFlags.Ephemeral } as never);
    await interaction.followUp('plain text' as never);

    expect(result).toBe('replied');
    expect(calls).toHaveLength(2);
    expect(log.entries[0]).toMatchObject({
      type: 'bot_response',
      data: { method: 'reply', interactionId: 'int1', userId: 'user1', channelId: 'chan1', content: 'hi', ephemeral: true, embeds: [{ title: 'Daily pack', description: 'You got a card', fields: 0 }] },
    });
    expect(log.entries[1].data).toMatchObject({ method: 'followUp', content: 'plain text', ephemeral: false });
  });

  it('does not log a response that failed to send', async () => {
    const log = spyLogger();
    const interaction = { id: 'i', user: { id: 'u' }, reply: async () => { throw new Error('discord said no'); } };
    instrument(interaction as never, log);
    await expect(interaction.reply()).rejects.toThrow('discord said no');
    expect(log.entries).toHaveLength(0);
  });

  it('skips methods the interaction does not have', () => {
    const interaction = { id: 'i', user: { id: 'u' }, reply: async () => 1 } as Record<string, unknown>;
    instrument(interaction as never, nullLogger);
    expect(interaction.update).toBeUndefined();
  });

  it('describePayload respects hidden content mode and lists attachment names', () => {
    const hidden = new JsonlLogger('unused', 'UTC', false);
    expect(describePayload({ content: 'abc', files: [{ name: 'battle-1.png' }] }, hidden)).toMatchObject({
      content: '[hidden, 3 chars]',
      files: ['battle-1.png'],
    });
  });

  it('describeInteraction records command options, or only their names when content is hidden', () => {
    const command = {
      id: 'i', user: { id: 'u', username: 'bob' }, guildId: null, channelId: 'c', context: 1, commandName: 'say',
      isChatInputCommand: () => true, isMessageComponent: () => false, isModalSubmit: () => false,
      options: { data: [{ name: 'content', value: 'hello' }] },
    };
    expect(describeInteraction(command as never, nullLogger)).toMatchObject({ kind: 'command', name: 'say', username: 'bob', options: [{ name: 'content', value: 'hello' }] });
    expect(describeInteraction(command as never, new JsonlLogger('x', 'UTC', false))).toMatchObject({ options: [{ name: 'content' }] });
    const autocomplete = { ...command, isChatInputCommand: () => false, isMessageComponent: () => false, isModalSubmit: () => false };
    expect(describeInteraction(autocomplete as never, nullLogger)).toBeNull();
  });

  it('describeInteraction records a submitted form with its values, or just the field names when content is hidden', () => {
    const modal = {
      id: 'i', user: { id: 'u', username: 'bob' }, guildId: null, channelId: 'c', context: 1, customId: 'story:ask_name:text',
      isChatInputCommand: () => false, isMessageComponent: () => false, isModalSubmit: () => true,
      fields: { fields: new Map([['text', { customId: 'text', value: 'Ocean' }]]) },
    };
    expect(describeInteraction(modal as never, nullLogger)).toMatchObject({ kind: 'modal', customId: 'story:ask_name:text', fields: [{ name: 'text', value: 'Ocean' }] });
    expect(describeInteraction(modal as never, new JsonlLogger('x', 'UTC', false))).toMatchObject({ fields: [{ name: 'text' }] });
  });
});

describe('logDirectMessages (replies to messages the bot sent first)', () => {
  function setup() {
    const client = Object.assign(new EventEmitter(), { user: { id: 'bot' } });
    const entries: { type: string; data: Record<string, unknown> }[] = [];
    const log = { ...nullLogger, message: (type: string, data: Record<string, unknown> = {}) => void entries.push({ type, data }) };
    logDirectMessages(client as never, log);
    const dm = (author: string, content: string, recipientId = 'human') => ({
      id: `m-${content}`, channelId: 'dmchan', content, author: { id: author, username: author },
      attachments: new Map([['a', { name: 'pic.png' }]]),
      channel: { isDMBased: () => true, recipientId },
    });
    return { client, entries, dm };
  }

  it('logs a user replying to the bot as an incoming message', () => {
    const { client, entries, dm } = setup();
    client.emit(Events.MessageCreate, dm('human', 'I accept the challenge'));
    expect(entries[0]).toMatchObject({
      type: 'dm_message',
      data: { direction: 'in', userId: 'human', username: 'human', content: 'I accept the challenge', attachments: ['pic.png'] },
    });
  });

  it('logs the bot\'s own messages as outgoing, attributed to the person it wrote to', () => {
    const { client, entries, dm } = setup();
    client.emit(Events.MessageCreate, dm('bot', 'You have been challenged', 'human'));
    expect(entries[0].data).toMatchObject({ direction: 'out', userId: 'human', content: 'You have been challenged' });
  });

  it('ignores messages that are not DMs', () => {
    const { client, entries, dm } = setup();
    client.emit(Events.MessageCreate, { ...dm('human', 'in a server'), channel: { isDMBased: () => false } });
    expect(entries).toHaveLength(0);
  });
});
