/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as apk from "../apk.js";
import type * as appStore from "../appStore.js";
import type * as captcha from "../captcha.js";
import type * as cards from "../cards.js";
import type * as catalog from "../catalog.js";
import type * as connections from "../connections.js";
import type * as crons from "../crons.js";
import type * as glances from "../glances.js";
import type * as habiticaCards from "../habiticaCards.js";
import type * as habiticaTasks from "../habiticaTasks.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as kinds_habitica from "../kinds/habitica.js";
import type * as kinds_index from "../kinds/index.js";
import type * as kinds_types from "../kinds/types.js";
import type * as kinds_weather from "../kinds/weather.js";
import type * as kinds_webhook from "../kinds/webhook.js";
import type * as lockscreen from "../lockscreen.js";
import type * as lockscreenMessages from "../lockscreenMessages.js";
import type * as managedApps from "../managedApps.js";
import type * as providers_habitica from "../providers/habitica.js";
import type * as providers_index from "../providers/index.js";
import type * as providers_types from "../providers/types.js";
import type * as secrets from "../secrets.js";
import type * as storeSources from "../storeSources.js";
import type * as weather from "../weather.js";
import type * as weatherCache from "../weatherCache.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  apk: typeof apk;
  appStore: typeof appStore;
  captcha: typeof captcha;
  cards: typeof cards;
  catalog: typeof catalog;
  connections: typeof connections;
  crons: typeof crons;
  glances: typeof glances;
  habiticaCards: typeof habiticaCards;
  habiticaTasks: typeof habiticaTasks;
  http: typeof http;
  integrations: typeof integrations;
  "kinds/habitica": typeof kinds_habitica;
  "kinds/index": typeof kinds_index;
  "kinds/types": typeof kinds_types;
  "kinds/weather": typeof kinds_weather;
  "kinds/webhook": typeof kinds_webhook;
  lockscreen: typeof lockscreen;
  lockscreenMessages: typeof lockscreenMessages;
  managedApps: typeof managedApps;
  "providers/habitica": typeof providers_habitica;
  "providers/index": typeof providers_index;
  "providers/types": typeof providers_types;
  secrets: typeof secrets;
  storeSources: typeof storeSources;
  weather: typeof weather;
  weatherCache: typeof weatherCache;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
