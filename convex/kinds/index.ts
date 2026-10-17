import { habitica } from "./habitica";
import type { IntegrationKind, Kind } from "./types";
import { weather } from "./weather";
import { webhook } from "./webhook";

// Every integration kind. See types.ts for what a kind provides.
export const KINDS: Record<Kind, IntegrationKind> = {
  weather: weather as unknown as IntegrationKind,
  webhook: webhook as unknown as IntegrationKind,
  habitica: habitica as unknown as IntegrationKind,
};

export function kindOf(kind: string): IntegrationKind | null {
  return (KINDS as Record<string, IntegrationKind>)[kind] ?? null;
}
