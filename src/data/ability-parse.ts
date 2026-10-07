import type { Ability } from "../engine/types";

// Ability shorthand: "<token> [amount]". The token carries both the timing and
// the effect kind, so the two heal timings (active vs end-of-round) and draw's
// `count` field never collide. The table below is the single source of truth.

type Timing = Ability["timing"];

interface TokenSpec {
  timing: Timing;
  kind: string;
  /** Which field the amount is written to; absent means the token takes no amount. */
  amountField?: "amount" | "count";
}

const TOKENS: Record<string, TokenSpec> = {
  draw: { timing: "active", kind: "draw", amountField: "count" },
  energy: { timing: "active", kind: "energy", amountField: "amount" },
  buffLane: { timing: "active", kind: "buffLane", amountField: "amount" },
  destroyedPower: { timing: "active", kind: "destroyedPower" },
  shield: { timing: "active", kind: "shield" },
  pushLane: { timing: "active", kind: "pushLane" },
  destroyLane: { timing: "active", kind: "destroyLane" },
  laneDouble: { timing: "continuous", kind: "laneDouble" },
  anchor: { timing: "continuous", kind: "anchor" },
  drainStartOfTurn: {
    timing: "continuous",
    kind: "drainStartOfTurn",
    amountField: "amount",
  },
  oceanReturn: {
    timing: "endOfRound",
    kind: "oceanReturn",
    amountField: "amount",
  },
  rebirth: { timing: "onDestroy", kind: "rebirth", amountField: "amount" },
};

/** Parses an ability shorthand into an Ability, throwing a clear Error naming the card on any problem. */
export function parseAbility(shorthand: string, cardName: string): Ability {
  const parts = shorthand.trim().split(/\s+/);
  const token = parts[0];
  const spec = TOKENS[token];
  if (!spec)
    throw new Error(
      `cards.json: card "${cardName}" has unknown ability token "${token}"`,
    );

  const effect: Record<string, unknown> = { kind: spec.kind };

  if (spec.amountField) {
    if (parts.length !== 2)
      throw new Error(
        `cards.json: card "${cardName}" ability "${token}" requires exactly one integer amount`,
      );
    const n = Number(parts[1]);
    if (!Number.isInteger(n))
      throw new Error(
        `cards.json: card "${cardName}" ability "${token}" has a non-integer amount "${parts[1]}"`,
      );
    effect[spec.amountField] = n;
  } else if (parts.length !== 1) {
    throw new Error(
      `cards.json: card "${cardName}" ability "${token}" takes no amount but got "${parts[1]}"`,
    );
  }

  return { timing: spec.timing, effect } as Ability;
}
