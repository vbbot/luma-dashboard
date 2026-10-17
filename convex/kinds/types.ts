import type { ActionCtx } from "../_generated/server";
import type { CardContent } from "../cards";

// What every lock screen integration provides. The shared machinery in
// integrations.ts stores the settings (encrypting secret fields), schedules
// refreshes with backoff, validates and stores cards (including their
// notifications), runs lock screen actions and routes provider webhooks; a
// kind only describes its own behaviour. Kinds are registered in index.ts.
//
// Adding an integration: write a kind file, add it to index.ts and to the
// `kind` union in schema.ts, and add its settings to the dashboard.

export type Kind = "weather" | "webhook" | "habitica";

export type Settings = Record<string, unknown>;

// A message for the person setting it up, e.g. "Habitica rejected the token".
export class SettingsError extends Error {}

// A refresh or action that failed. `permanent` (e.g. rejected credentials)
// waits much longer before retrying.
export class IntegrationError extends Error {
  readonly permanent: boolean;

  constructor(message: string, { permanent = false }: { permanent?: boolean } = {}) {
    super(message);
    this.permanent = permanent;
  }
}

export type RunInput<S extends Settings> = {
  ctx: ActionCtx;
  // Secret fields already decrypted.
  settings: S;
  now: number;
  // For kinds with `connection`: that connection's settings, decrypted.
  connection?: Settings;
};

export type RefreshResult = {
  // null clears the card.
  content: CardContent | null;
  expiresAt: number;
  // When to refresh next; null waits for an inbound webhook or a change.
  nextRunAt: number | null;
};

export type InboundResult =
  | { kind: "card"; content: CardContent | null; expiresAt: number }
  // Something changed at the provider: refresh soon.
  | { kind: "refresh" };

export interface IntegrationKind<S extends Settings = Settings> {
  kind: Kind;

  // Checks settings from the dashboard and returns a clean copy. `previous`
  // is set when an existing integration is changed (see `editable`). Throws
  // SettingsError for the person setting it up.
  parseSettings(value: unknown, previous?: S): S;

  // Fields stored encrypted, and never sent back to the browser or phone.
  secret?: (keyof S & string)[];

  // Fields that may be changed after adding, e.g. weather units.
  editable?: (keyof S & string)[];

  // A provider whose connection this kind's cards use (providers/), e.g.
  // Habitica: added by picking a connection instead of entering credentials.
  connection?: "habitica";

  // The name on the dashboard and, unless the card sets a title, the lock
  // screen header.
  label(settings: S): string;

  // Whether cards may carry long-press actions (see `act`).
  allowActions: boolean;

  // Whether the integration gets a secret /hooks/<kind>/<token> address.
  inbound?: {
    // Runs in a mutation, so no network. Throw CardError for a 400.
    handle(input: { payload: unknown; minutes: number; now: number }): InboundResult;
    // Requests closer together than this are refused (or, for "refresh",
    // share one refresh).
    minIntervalMs: number;
  };

  // When an integration is added, before it is stored: check credentials,
  // register with the provider. May return changed settings (e.g. a webhook
  // id to remember). hookUrl is its public inbound address, if it has one and
  // the dashboard is on HTTPS.
  onAdd?(input: RunInput<S> & { hookUrl: string | null }): Promise<S | void>;

  // Builds the card. Throw IntegrationError to record a failure.
  refresh?(input: RunInput<S>): Promise<RefreshResult>;

  // A long-press on the lock screen (lockscreen:act). The card is refreshed
  // afterwards.
  act?(input: RunInput<S> & { pageId: string; actionId: string; undo: boolean }): Promise<void>;

  // After the integration is removed: unregister from the provider.
  onRemove?(input: RunInput<S>): Promise<void>;

  // How often to refresh when the card does not say (and the base for
  // backoff after failures).
  refreshMs?: number;

  // Things the dashboard can do with the provider beyond settings, e.g.
  // listing or adding Habitica tasks. Called by integrations:operate with
  // the integration's own settings; the card is refreshed after any that is
  // not readOnly. `args` comes from the browser: validate it (throw
  // SettingsError for a message the person sees).
  operations?: Record<string, Operation<S>>;
}

export type Operation<S extends Settings> = {
  readOnly?: boolean;
  run(input: RunInput<S> & { args: unknown }): Promise<unknown>;
};

export function defineKind<S extends Settings>(kind: IntegrationKind<S>): IntegrationKind<S> {
  return kind;
}
