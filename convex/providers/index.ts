import { habitica } from "./habitica";
import type { Provider, ProviderName } from "./types";

// Every provider. See types.ts for what a provider offers.
export const PROVIDERS: Record<ProviderName, Provider> = {
  habitica: habitica as unknown as Provider,
};
