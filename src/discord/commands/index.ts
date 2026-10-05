import type { Command } from "../command";
import { adminCommand } from "./admin";
import { battleCommand } from "./battle";
import { cardCommand } from "./card";
import { collectionCommand } from "./collection";
import { dailyCommand } from "./daily";
import { deckCommand } from "./deck";
import { dmCommand } from "./dm";
import { inviteCommand } from "./invite";
import { profileCommand } from "./profile";
import { sayCommand } from "./say";
import { shopCommand } from "./shop";
import { storyCommand } from "./story";

export const commands: Command[] = [
  storyCommand,
  inviteCommand,
  dailyCommand,
  collectionCommand,
  cardCommand,
  deckCommand,
  battleCommand,
  profileCommand,
  shopCommand,
  sayCommand,
  dmCommand,
  adminCommand,
];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
