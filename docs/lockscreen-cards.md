# Lock screen cards

How integrations describe what Luma shows under the lock screen clock. Integrations say *what* to
show using a small, fixed set of blocks; Luma alone decides *how* it looks, so every integration
renders in the same Light style and new integrations need no Luma change.

The message above the clock is separate and unchanged (`lockscreenMessages:getCurrentForDevice`).

## Rules

1. **Meaning, not layout.** No markup, colours, positions, images or custom gestures.
2. **Closed, growing set of blocks.** A new block type is added to Luma once and is then available
   to every integration.
3. **Graceful degradation.** Every card has a `fallback` line. Luma skips blocks it does not know;
   if a page has nothing it can draw, it shows the fallback. Old clients never break on new content.
4. **Luma owns gestures.** Integrations declare a primary action and an open target; Luma maps them
   to long-press and tap the same way everywhere.
5. **One model for every source.** Server integrations and (future) phone-side providers produce
   the same cards.

## Card

```ts
type Card = {
  id: string;              // integration id; stable
  schema: 1;
  updatedAt: number;       // epoch ms
  expiresAt: number;       // Luma hides the card after this
  fallback: string;        // one line, 1-60 chars. Shown by old clients and when a card does not fit
  title?: string;          // 1-30 chars. Header of a paged card, with the position ("Dailies 2/5")
  size: "compact" | "regular";   // preferred height: 1 or 2 rows
  relevance?: "normal" | "high"; // "high" moves the card ahead of the others until relevantUntil
  relevantUntil?: number;
  paging?: {
    start?: string;        // page id to open on; default the first page
    resetOnWake?: boolean; // default true: every wake starts at `start`
    total?: number;        // real count when the pages are capped ("2/37")
  };
  pages: Page[];           // 1-20. One page = no arrows
};

type Page = {
  id: string;              // stable across updates, so Luma keeps its place
  validFrom?: number;      // epoch ms: hidden before / after. Lets a card carry a timeline that
  validUntil?: number;     // Luma steps through on time, offline
  blocks: Block[];         // 1-3; Luma draws as many as the card's rows allow
  primary?: Action;        // long-press
  open?: OpenTarget;       // tap
};

type Block =
  | { type: "text"; text: string; role?: "primary" | "secondary" }   // 1-60 chars
  | { type: "pair"; left: string; right: string }                     // left 1-40, right 0-20 chars
  | { type: "progress"; value: number; max: number; label?: string }  // 0 <= value <= max <= 1000
  | { type: "time"; at: number; format: "clock" | "relative" | "countdown"; prefix?: string };

type Action = { id: string; label: string; pendingText?: string; undo?: boolean };

type OpenTarget = { tool: string } | { app: string };   // Luma tool id, or an Android package
```

`time` blocks are formatted on the phone and refreshed every minute while the lock screen is
showing: `clock` → `14:30` (in the phone's time format), `relative` → `in 5 min` / `5 min ago`,
`countdown` → `5 min` / `Now`; durations over an hour read `1 h 20 min`. Use them for anything that changes with the clock, instead of
rewriting the card every minute.

## Layout

Luma shows **one integration at a time** under the clock: the Light Phone III (1080×1240 at
480 dpi) has room for the message or date, the clock and one card. The cards that have something
to show form a deck, in the dashboard's order with `high` relevance cards first, skipping expired
cards and cards with no page valid now. Each wake starts on the first card of the deck.

- The message or date, the clock and the card are centred together between the status bar and the
  home button, so the clock moves up to make room; without a card it stays in the middle.
- A header shows the card's `title` (the integration's name when the card sets none), the page
  position for paged cards (`Dailies · 1/3`) and one dot per integration (`● ○`).
- Luma measures the space left and draws the card as large as fits: every block (a `regular` page
  draws its first two blocks, a `compact` page its first), then the header and first block, then
  the one-line `fallback`, then nothing. Nothing ever overlaps the home button.
- Arrows are hidden whenever the lock screen is not interactive.

## Gestures

| Gesture | Effect |
|---|---|
| Tap `‹` / `›` | Previous / next page; past either end, the previous / next integration (its last / first page), wrapping round. With a light haptic |
| Tap the header | Skip to the next integration's first page |
| Tap the card | Opens `open`, if set, and dismisses the lock screen. On a one-line fallback, skips to the next integration instead |
| Long-press the card | Runs `primary`: the page shows `pendingText` (with "Long-press to undo" when `undo`) for 4 seconds, even if an update removes the page meanwhile, then the next page. Long-press again in that time to undo. Redraws wait while a finger is down, so updates never cancel a press |

## Transport

`lockscreen:getForDevice({ accountNumber, protocol, blocks })` returns `Card[]` in order. `protocol`
is the highest card schema the client understands and `blocks` the block types it draws. For a
client that understands less, the server rewrites cards to their fallback (one `text` page).

`lockscreen:act({ accountNumber, cardId, pageId, actionId, undo, requestId })` runs an action.
The action must be the page's `primary` (an undo may follow the page disappearing); `requestId` is
random per press, so a retried request never runs twice. The integration does the work and writes
a new card, which reaches the phone through the subscription.

## Validation

The server validates every card before storing it: the limits above, no control characters, unique
page ids, `0 <= value <= max`. A card that fails is not stored and the integration records the
error, which the dashboard shows. Luma validates again and drops anything it cannot draw.

## Webhooks

`POST /hooks/<token>` accepts any of:

```jsonc
"plain text"                                          // one line for an hour
{ "text": "Bins out tonight", "minutes": 120 }        // one line
{ "title": "Windows open", "lines": ["Kitchen", "Bedroom"], "minutes": 30 }   // one page per line
{ "card": { /* Card without id/schema/updatedAt/expiresAt */ }, "minutes": 30 }
```

Webhook cards may set `open` but not `primary`: an action would need the server to call back to an
address the sender chose.
