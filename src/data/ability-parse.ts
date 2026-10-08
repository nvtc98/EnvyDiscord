import type { Ability } from "../engine/types";

// Ability shorthand: "<token> [amount]". The token carries both the timing and
// the effect kind, so timings never collide and draw's `count` field stays
// distinct from amount-bearing tokens. The table below is the single source of truth.

type Timing = Ability["timing"];

interface TokenSpec {
  timing: Timing;
  kind: string;
  /** Which field a single numeric amount is written to. Mutually exclusive with `args`. */
  amountField?: "amount" | "count" | "k";
  /** Multi-arg form, e.g. ["count:int", "into:id"]. Mutually exclusive with `amountField`. */
  args?: ReadonlyArray<"count:int" | "into:id">;
}

const TOKENS: Record<string, TokenSpec> = {
  draw: { timing: "active", kind: "draw", amountField: "count" },
  energy: { timing: "active", kind: "energy", amountField: "amount" },
  buffLane: { timing: "active", kind: "buffLane", amountField: "amount" },
  destroyedPower: { timing: "active", kind: "destroyedPower" },
  pushLane: { timing: "active", kind: "pushLane" },
  destroyLane: { timing: "active", kind: "destroyLane" },
  shuffleRedraw: { timing: "active", kind: "shuffleRedraw" },
  buffRowAll: { timing: "active", kind: "buffRowAll", amountField: "amount" },
  pushImmune: { timing: "continuous", kind: "pushImmune" },
  laneDouble: { timing: "continuous", kind: "laneDouble" },
  phasing: { timing: "continuous", kind: "phasing" },
  wicked: { timing: "continuous", kind: "wicked" },
  reflecting: { timing: "continuous", kind: "reflecting" },
  costReduction: {
    timing: "continuous",
    kind: "costReduction",
    amountField: "amount",
  },
  anchor: { timing: "continuous", kind: "anchor" },
  drainStartOfTurn: {
    timing: "continuous",
    kind: "drainStartOfTurn",
    amountField: "amount",
  },
  transformAt: {
    timing: "continuous",
    kind: "transformAt",
    args: ["count:int", "into:id"],
  },
  balanceCoefficient: {
    timing: "continuous",
    kind: "balanceCoefficient",
    amountField: "k",
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

  if (spec.args) {
    // Multi-arg form, e.g. transformAt <count> <into> — exactly args.length + 1 parts.
    if (parts.length !== spec.args.length + 1)
      throw new Error(
        `cards.json: card "${cardName}" ability "${token}" requires ${spec.args.length} arguments`,
      );
    const count = Number(parts[1]);
    if (!Number.isInteger(count) || count <= 0)
      throw new Error(
        `cards.json: card "${cardName}" ability "${token}" needs a positive integer count, got "${parts[1]}"`,
      );
    const into = parts[2];
    if (!into)
      throw new Error(
        `cards.json: card "${cardName}" ability "${token}" needs a non-empty target id`,
      );
    effect.count = count;
    effect.into = into;
  } else if (spec.amountField) {
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
