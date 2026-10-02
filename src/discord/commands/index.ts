import type { Command } from '../command';
import { battleCommand } from './battle';
import { cardCommand } from './card';
import { collectionCommand } from './collection';
import { dailyCommand } from './daily';
import { mercifulCommand } from './merciful';
import { profileCommand } from './profile';
import { sayCommand } from './say';
import { teamCommand } from './team';

export const commands: Command[] = [
  dailyCommand,
  collectionCommand,
  cardCommand,
  teamCommand,
  battleCommand,
  profileCommand,
  mercifulCommand,
  sayCommand,
];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
