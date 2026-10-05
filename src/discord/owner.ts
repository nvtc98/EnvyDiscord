import { Team, type Client } from 'discord.js';

/** True for the application's owner (or any member of the owning team). Used to guard commands that are only for them. */
export async function isOwner(client: Client<true>, userId: string): Promise<boolean> {
  const app = await client.application.fetch();
  const owner = app.owner;
  if (!owner) return false;
  return owner instanceof Team ? owner.members.has(userId) : owner.id === userId;
}
