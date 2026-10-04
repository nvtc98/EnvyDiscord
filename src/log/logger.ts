import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { todayKey } from '../game/gacha';

type Stream = 'game' | 'messages';
type Data = Record<string, unknown>;

/**
 * Two append-only streams, one JSON object per line (JSON Lines), one file per day:
 *   logs/game-2026-10-03.jsonl      gameplay: daily packs, battles, team changes
 *   logs/messages-2026-10-03.jsonl  everything the bot receives or sends
 * Logging must never break the bot, so write failures are only warned about.
 */
export interface Logger {
  game(type: string, data?: Data): void;
  message(type: string, data?: Data): void;
  /** Message text as it should appear in the log: the text itself, or a placeholder when content logging is off. */
  text(content: string | null | undefined): string | undefined;
  readonly logContent: boolean;
  /** Resolves once every queued line has been written. */
  flush(): Promise<void>;
}

export class JsonlLogger implements Logger {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly timezone: string,
    readonly logContent = true,
    private readonly now: () => Date = () => new Date(),
  ) {}

  game(type: string, data: Data = {}): void {
    this.write('game', type, data);
  }

  message(type: string, data: Data = {}): void {
    this.write('messages', type, data);
  }

  text(content: string | null | undefined): string | undefined {
    if (content === null || content === undefined) return undefined;
    return this.logContent ? content : `[hidden, ${content.length} chars]`;
  }

  flush(): Promise<void> {
    return this.pending;
  }

  private write(stream: Stream, type: string, data: Data): void {
    const at = this.now();
    const line = `${JSON.stringify({ ts: at.toISOString(), type, ...data })}\n`;
    const file = join(this.dir, `${stream}-${todayKey(at, this.timezone)}.jsonl`);
    this.pending = this.pending
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        await appendFile(file, line, 'utf8');
      })
      .catch((error: Error) => console.warn(`Could not write log ${file}: ${error.message}`));
  }
}

/** Logger that drops everything. Used by tests and anywhere logging is not wanted. */
export const nullLogger: Logger = {
  game() {},
  message() {},
  text: (content) => content ?? undefined,
  logContent: true,
  flush: async () => {},
};
