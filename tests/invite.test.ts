import { describe, expect, it } from "vitest";
import { inviteCommand } from "../src/discord/commands/invite";
import { GATE } from "../src/story/prologue";
import {
  dmChannel,
  lastPayload,
  makeCtx,
  slashInteraction,
} from "./discord-helpers";

/** A /invite call where `target` is the user option and `dm` is the TARGET's DM channel. */
function inviteCall(
  inviterId: string,
  targetId: string | null,
  dm: ReturnType<typeof dmChannel> | null = dmChannel(),
) {
  const call = slashInteraction(inviterId, { user: targetId }, inviterId, {
    dm,
  });
  return call;
}

describe("/invite", () => {
  it("DMs a new player the ready-gate and tells the inviter it reached out", async () => {
    const ctx = makeCtx();
    const dm = dmChannel();
    const call = inviteCall("inviter", "target", dm);
    await inviteCommand.execute(call as never, ctx);

    expect(dm.sent).toHaveLength(1);
    expect(dm.sent[0].content).toBe(GATE.readyLine);
    const begin = dm.sent[0].components[0].toJSON().components[0];
    expect(begin.custom_id).toBe("story:gate:begin");

    expect(lastPayload(call.reply).content).toContain("<@target>");
    expect(lastPayload(call.reply).allowedMentions).toEqual({ parse: [] });
    const log = ctx.log.entries.find((e) => e.type === "story_invite");
    expect(log?.data).toMatchObject({
      inviterId: "inviter",
      targetId: "target",
      ok: true,
    });
  });

  it("shows the invite-resume gate naming the sanitized inviter for a player with progress", async () => {
    const ctx = makeCtx();
    const target = ctx.repo.get("target");
    target.story = {
      node: "greeting",
      name: null,
      isEye: null,
      knowsTribe: null,
      nameAttempts: [],
      pendingName: null,
      notice: null,
      pack: null,
      starterClaimed: false,
      liveMessageId: null,
    };
    await ctx.repo.save(target);

    const dm = dmChannel();
    const call = inviteCall("inviter", "target", dm);
    await inviteCommand.execute(call as never, ctx);

    expect(dm.sent[0].content).toBe(GATE.inviteResumeLine("User inviter"));
    const resume = dm.sent[0].components[0].toJSON().components[0];
    expect(resume.custom_id).toBe("story:gate:resume");
  });

  it("reports back to the inviter when the target's DMs are closed", async () => {
    const ctx = makeCtx();
    const call = inviteCall("inviter", "target", null);
    await inviteCommand.execute(call as never, ctx);

    expect(lastPayload(call.reply).content).toMatch(/closed|don't share/);
    const log = ctx.log.entries.find((e) => e.type === "story_invite");
    expect(log?.data).toMatchObject({ ok: false });
  });

  it("rejects inviting yourself and suggests /story", async () => {
    const ctx = makeCtx();
    const dm = dmChannel();
    const call = inviteCall("inviter", "inviter", dm);
    await inviteCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/\/story/);
    expect(dm.sent).toHaveLength(0);
  });

  it("rejects inviting a bot", async () => {
    const ctx = makeCtx();
    const dm = dmChannel();
    const call = inviteCall("inviter", "target", dm);
    // Force the resolved user to look like a bot.
    const original = call.options.getUser;
    call.options.getUser = ((name: string, required?: boolean) => {
      const user = original(name, required);
      if (user) (user as { bot: boolean }).bot = true;
      return user;
    }) as typeof call.options.getUser;
    await inviteCommand.execute(call as never, ctx);
    expect(lastPayload(call.reply).content).toMatch(/automaton/);
    expect(dm.sent).toHaveLength(0);
  });
});
