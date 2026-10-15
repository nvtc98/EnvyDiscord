import type { Ability } from "../engine/types";

// Ability shorthand: "<token> [amount]". The token carries both the timing and
// the effect kind, so timings never collide and draw's `count` field stays
// distinct from amount-bearing tokens. The table below is the single source of truth.

type Timing = Ability["timing"];

interface TokenSpec {
  timing: Timing;
  kind: string;
  /** Which field a single numeric amount is written to. Mutually exclusive with `args`. */
  amountField?: "amount" | "count" | "k" | "drop";
  /** Multi-arg form, e.g. ["count:int", "into:id"]. Mutually exclusive with `amountField`. */
  args?: ReadonlyArray<
    "count:int" | "into:id" | "amount:int" | "byTurn:int" | "percent:int"
  >;
}

const TOKENS: Record<string, TokenSpec> = {
  draw: { timing: "active", kind: "draw", amountField: "count" },
  energy: { timing: "active", kind: "energy", amountField: "amount" },
  buffLane: { timing: "active", kind: "buffLane", amountField: "amount" },
  stellaPush: { timing: "active", kind: "stellaPush" },
  astralDiscount: { timing: "active", kind: "astralDiscount" },
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
  cloneBoard: { timing: "active", kind: "cloneBoard" },
  cloneLane: { timing: "active", kind: "cloneLane" },
  cloneMirror: { timing: "active", kind: "cloneMirror" },
  nexusSum: { timing: "active", kind: "nexusSum" },
  gentlePush: { timing: "active", kind: "gentlePush", args: ["percent:int"] },
  watcherDig: { timing: "active", kind: "watcherDig" },
  moonlitSacrifice: { timing: "active", kind: "moonlitSacrifice" },
  titanShift: { timing: "active", kind: "titanShift" },
  apexSwap: { timing: "active", kind: "apexSwap" },
  berserkKill: { timing: "active", kind: "berserkKill" },
  summonHand: { timing: "active", kind: "summonHand" },
  summonDeck: { timing: "active", kind: "summonDeck" },
  vaporSummon: { timing: "active", kind: "vaporSummon" },
  chronosSummon: { timing: "active", kind: "chronosSummon" },
  evilHighest: { timing: "active", kind: "evilHighest" },
  joyfulBuff: { timing: "active", kind: "joyfulBuff" },
  goliathGain: { timing: "active", kind: "goliathGain" },
  frozenLock: { timing: "active", kind: "frozenLock" },
  gloomLane: { timing: "active", kind: "gloomLane" },
  sunkenPull: { timing: "active", kind: "sunkenPull" },
  killingDeck: { timing: "active", kind: "killingDeck" },
  numbDeck: { timing: "active", kind: "numbDeck" },
  sunlitScatter: { timing: "active", kind: "sunlitScatter" },
  flowerBuff: { timing: "endOfRound", kind: "flowerBuff" },
  dispersedSpread: { timing: "onDestroy", kind: "dispersedSpread" },
  ancientDiscount: { timing: "continuous", kind: "ancientDiscount" },
  vaingloryGate: { timing: "continuous", kind: "vaingloryGate" },
  guardianLane: { timing: "continuous", kind: "guardianLane" },
  wildShift: { timing: "endOfRound", kind: "wildShift" },
  glacialSpawn: {
    timing: "onDestroy",
    kind: "glacialSpawn",
    amountField: "drop",
  },
  teamBuffEndOfTurn: {
    timing: "endOfRound",
    kind: "teamBuffEndOfTurn",
    amountField: "amount",
  },
  earlyBuff: {
    timing: "onPlay",
    kind: "earlyBuff",
    args: ["amount:int", "byTurn:int"],
  },
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
    spec.args.forEach((argSpec, idx) => {
      const [field, kind] = argSpec.split(":") as [string, "int" | "id"];
      const raw = parts[idx + 1];
      if (kind === "id") {
        if (!raw)
          throw new Error(
            `cards.json: card "${cardName}" ability "${token}" needs a non-empty target id`,
          );
        effect[field] = raw;
        return;
      }
      const n = Number(raw);
      // count:int keeps its ORIGINAL stricter rule (positive integer); amount:int/byTurn:int
      // require only an integer. This preserves transformAt's existing error exactly.
      if (field === "count") {
        if (!Number.isInteger(n) || n <= 0)
          throw new Error(
            `cards.json: card "${cardName}" ability "${token}" needs a positive integer count, got "${raw}"`,
          );
      } else if (!Number.isInteger(n)) {
        throw new Error(
          `cards.json: card "${cardName}" ability "${token}" needs an integer ${field}`,
        );
      }
      effect[field] = n;
    });
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
