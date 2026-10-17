import type { ActionCtx } from "../_generated/server";
import type { Operation, Settings } from "../kinds/types";

// An account linked once (e.g. Habitica) and shared by every lock screen
// card that uses it. connections.ts stores it (secret fields encrypted),
// routes the provider's webhooks to it and runs its dashboard operations;
// kinds that need it say `connection: "<provider>"` and receive its settings.

export type ProviderName = "habitica";

export type ConnectInput<S extends Settings> = {
  ctx: ActionCtx;
  // Secret fields decrypted.
  settings: S;
  now: number;
  // Its public inbound address, if the dashboard is on HTTPS.
  hookUrl: string | null;
};

export interface Provider<S extends Settings = Settings> {
  provider: ProviderName;
  name: string;

  // Checks settings from the dashboard. Throws SettingsError.
  parseSettings(value: unknown): S;
  secret?: (keyof S & string)[];

  // Before storing: check credentials, register webhooks. May return changed
  // settings (e.g. the webhook id to remember).
  onConnect?(input: ConnectInput<S>): Promise<S | void>;
  // After disconnecting: unregister.
  onDisconnect?(input: Omit<ConnectInput<S>, "hookUrl">): Promise<void>;

  // Whether it gets a /hooks/<provider>/<token> address; a request there
  // refreshes every card using the connection.
  inbound?: { minIntervalMs: number };

  // What the dashboard can do with it (e.g. list or add Habitica tasks).
  // Cards using the connection are refreshed after any that is not readOnly.
  operations?: Record<string, Operation<S>>;
}

export function defineProvider<S extends Settings>(provider: Provider<S>): Provider<S> {
  return provider;
}
