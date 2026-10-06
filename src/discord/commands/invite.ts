import { MessageFlags } from "discord.js";
import { GATE } from "../../story/prologue";
import { sanitizeDisplay } from "../../story/names";
import { slash, type Command } from "../command";
import { gateMessage, resolveDm } from "./story";

const CLOSED_DM =
  "❌ I couldn't reach that player — their DMs are closed, or we don't share a server.";

export const inviteCommand: Command = {
  // Anyone may invite someone to meet the stranger — this is NOT owner-gated.
  data: slash(
    "invite",
    "Invite another player to meet the stranger",
  ).addUserOption((o) =>
    o.setName("user").setDescription("Who to invite").setRequired(true),
  ),

  async execute(interaction, ctx) {
    const inviter = interaction.user;
    const reply = (content: string) =>
      interaction.reply({
        content,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });

    const target = interaction.options.getUser("user", true);
    if (target.bot) {
      await reply("You can't invite a bot.");
      return;
    }
    if (target.id === inviter.id) {
      await reply("You can start the story yourself with `/story`.");
      return;
    }

    const dm = await resolveDm(target);
    if (!dm) {
      ctx.log.game("story_invite", {
        inviterId: inviter.id,
        targetId: target.id,
        ok: false,
      });
      await reply(CLOSED_DM);
      return;
    }

    // Which gate the invitee sees only depends on whether they already have progress.
    // The gate buttons (story:gate:*) route to storyCommand.component, which re-derives
    // begin-vs-resume from the live player.story — so we don't duplicate the story flow here.
    const player = ctx.repo.get(target.id);
    const gate = player.story
      ? gateMessage(
          GATE.inviteResumeLine(sanitizeDisplay(inviter.displayName)),
          GATE.resumeYes,
          "story:gate:resume",
          GATE.resumeNo,
        )
      : gateMessage(
          GATE.readyLine,
          GATE.readyYes,
          "story:gate:begin",
          GATE.readyNo,
        );
    await dm.send(gate);

    ctx.log.game("story_invite", {
      inviterId: inviter.id,
      targetId: target.id,
      ok: true,
    });
    await reply(`📬 I've sent an invite to <@${target.id}>.`);
  },
};
