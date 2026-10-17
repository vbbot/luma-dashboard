// Lock screen cards: what integrations show under the clock. The format and
// its limits are specified in docs/lockscreen-cards.md; keep the two in step.

export const CARD_SCHEMA = 1;
export const BLOCK_TYPES = ["text", "pair", "progress", "time"] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export type Block =
  | { type: "text"; text: string; role?: "primary" | "secondary" }
  | { type: "pair"; left: string; right: string }
  | { type: "progress"; value: number; max: number; label?: string }
  | { type: "time"; at: number; format: "clock" | "relative" | "countdown"; prefix?: string };

export type Action = { id: string; label: string; pendingText?: string; undo?: boolean };
export type OpenTarget = { tool: string } | { app: string };

export type Page = {
  id: string;
  validFrom?: number;
  validUntil?: number;
  blocks: Block[];
  primary?: Action;
  open?: OpenTarget;
};

export type Card = {
  id: string;
  schema: number;
  updatedAt: number;
  expiresAt: number;
  fallback: string;
  title?: string;
  size: "compact" | "regular";
  relevance?: "normal" | "high";
  relevantUntil?: number;
  paging?: { start?: string; resetOnWake?: boolean; total?: number };
  pages: Page[];
};

// What an integration produces; the server fills in the rest.
export type CardContent = Omit<Card, "id" | "schema" | "updatedAt" | "expiresAt">;

export const LIMITS = {
  line: 60,
  title: 30,
  pairLeft: 40,
  pairRight: 20,
  prefix: 20,
  pages: 20,
  blocks: 3,
  id: 64,
  progressMax: 1000,
};

export class CardError extends Error {}

function fail(path: string, problem: string): never {
  throw new CardError(`${path}: ${problem}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Single-line text: whitespace collapsed, no control characters.
function line(value: unknown, path: string, max: number, { optional = false, empty = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string") fail(path, "must be a string");
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length > max) fail(path, `must be at most ${max} characters`);
  if (cleaned === "" && !empty) fail(path, "must not be empty");
  return cleaned;
}

function number(value: unknown, path: string, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be a number");
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  options: readonly T[],
  fallback?: T,
) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!options.includes(value as T)) fail(path, `must be one of ${options.join(", ")}`);
  return value as T;
}

function id(value: unknown, path: string) {
  const text = line(value, path, LIMITS.id);
  return text!;
}

function block(value: unknown, path: string): Block {
  if (!isRecord(value)) fail(path, "must be an object");
  switch (value.type) {
    case "text":
      return {
        type: "text",
        text: line(value.text, `${path}.text`, LIMITS.line)!,
        role: oneOf(value.role, `${path}.role`, ["primary", "secondary"] as const, "primary"),
      };
    case "pair":
      return {
        type: "pair",
        left: line(value.left, `${path}.left`, LIMITS.pairLeft)!,
        right: line(value.right ?? "", `${path}.right`, LIMITS.pairRight, { empty: true })!,
      };
    case "progress": {
      const max = number(value.max, `${path}.max`)!;
      const current = number(value.value, `${path}.value`)!;
      if (max <= 0 || max > LIMITS.progressMax)
        fail(`${path}.max`, `must be 1-${LIMITS.progressMax}`);
      if (current < 0 || current > max) fail(`${path}.value`, "must be between 0 and max");
      return {
        type: "progress",
        value: current,
        max,
        label: line(value.label, `${path}.label`, LIMITS.pairLeft, { optional: true }),
      };
    }
    case "time":
      return {
        type: "time",
        at: number(value.at, `${path}.at`)!,
        format: oneOf(value.format, `${path}.format`, ["clock", "relative", "countdown"] as const),
        prefix: line(value.prefix, `${path}.prefix`, LIMITS.prefix, { optional: true }),
      };
    default:
      return fail(`${path}.type`, `must be one of ${BLOCK_TYPES.join(", ")}`);
  }
}

function openTarget(value: unknown, path: string): OpenTarget | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(path, "must be an object");
  if (typeof value.tool === "string") return { tool: id(value.tool, `${path}.tool`) };
  if (typeof value.app === "string") {
    const app = id(value.app, `${path}.app`);
    if (!/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(app))
      fail(`${path}.app`, "must be a package name");
    return { app };
  }
  return fail(path, "must have tool or app");
}

function action(value: unknown, path: string): Action | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(path, "must be an object");
  return {
    id: id(value.id, `${path}.id`),
    label: line(value.label, `${path}.label`, LIMITS.title)!,
    pendingText: line(value.pendingText, `${path}.pendingText`, LIMITS.line, { optional: true }),
    undo: value.undo === undefined ? undefined : value.undo === true,
  };
}

function page(value: unknown, path: string, allowActions: boolean): Page {
  if (!isRecord(value)) fail(path, "must be an object");
  if (
    !Array.isArray(value.blocks) ||
    value.blocks.length === 0 ||
    value.blocks.length > LIMITS.blocks
  ) {
    fail(`${path}.blocks`, `must have 1-${LIMITS.blocks} blocks`);
  }
  if (value.primary !== undefined && !allowActions) fail(`${path}.primary`, "is not allowed here");
  const validFrom = number(value.validFrom, `${path}.validFrom`, { optional: true });
  const validUntil = number(value.validUntil, `${path}.validUntil`, { optional: true });
  if (validFrom !== undefined && validUntil !== undefined && validUntil <= validFrom) {
    fail(`${path}.validUntil`, "must be after validFrom");
  }
  return {
    id: id(value.id, `${path}.id`),
    validFrom,
    validUntil,
    blocks: value.blocks.map((item, index) => block(item, `${path}.blocks[${index}]`)),
    primary: action(value.primary, `${path}.primary`),
    open: openTarget(value.open, `${path}.open`),
  };
}

// Checks content from an integration or a webhook and returns a clean copy
// with only known fields. Throws CardError with a readable path on failure.
export function validateContent(
  value: unknown,
  { allowActions }: { allowActions: boolean },
): CardContent {
  if (!isRecord(value)) fail("card", "must be an object");
  if (
    !Array.isArray(value.pages) ||
    value.pages.length === 0 ||
    value.pages.length > LIMITS.pages
  ) {
    fail("pages", `must have 1-${LIMITS.pages} pages`);
  }
  const pages = value.pages.map((item, index) => page(item, `pages[${index}]`, allowActions));
  if (new Set(pages.map((item) => item.id)).size !== pages.length)
    fail("pages", "ids must be unique");

  let paging: CardContent["paging"];
  if (value.paging !== undefined) {
    if (!isRecord(value.paging)) fail("paging", "must be an object");
    const start =
      value.paging.start === undefined ? undefined : id(value.paging.start, "paging.start");
    if (start !== undefined && !pages.some((item) => item.id === start))
      fail("paging.start", "must be a page id");
    const total = number(value.paging.total, "paging.total", { optional: true });
    if (total !== undefined && (!Number.isInteger(total) || total < pages.length)) {
      fail("paging.total", "must be a whole number of at least the number of pages");
    }
    paging = {
      start,
      resetOnWake:
        value.paging.resetOnWake === undefined ? undefined : value.paging.resetOnWake === true,
      total,
    };
  }

  return {
    fallback: line(value.fallback, "fallback", LIMITS.line)!,
    title: line(value.title, "title", LIMITS.title, { optional: true }),
    size: oneOf(
      value.size,
      "size",
      ["compact", "regular"] as const,
      pages.length > 1 ? "regular" : "compact",
    ),
    relevance:
      value.relevance === undefined
        ? undefined
        : oneOf(value.relevance, "relevance", ["normal", "high"] as const),
    relevantUntil: number(value.relevantUntil, "relevantUntil", { optional: true }),
    paging,
    pages,
  };
}

// A one-line card, e.g. weather or a plain webhook message.
export function textContent(text: string, extra: Partial<CardContent> = {}): CardContent {
  return {
    fallback: text,
    size: "compact",
    pages: [{ id: "main", blocks: [{ type: "text", text }] }],
    ...extra,
  };
}

// For clients that understand less than this card uses: an older schema, or
// a block type they do not draw. They get the fallback as a one-line card.
export function forClient(card: Card, protocol: number, blocks: string[]): Card {
  const supported = new Set(blocks);
  const usable =
    card.schema <= protocol &&
    card.pages.every((item) => item.blocks.every((entry) => supported.has(entry.type)));
  if (usable) return card;
  return { ...card, ...textContent(card.fallback), title: undefined, paging: undefined };
}
