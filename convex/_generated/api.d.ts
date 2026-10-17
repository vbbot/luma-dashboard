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
import type * as catalog from "../catalog.js";
import type * as crons from "../crons.js";
import type * as glances from "../glances.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as lockscreenMessages from "../lockscreenMessages.js";
import type * as managedApps from "../managedApps.js";
import type * as storeSources from "../storeSources.js";
import type * as weather from "../weather.js";

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
  catalog: typeof catalog;
  crons: typeof crons;
  glances: typeof glances;
  http: typeof http;
  integrations: typeof integrations;
  lockscreenMessages: typeof lockscreenMessages;
  managedApps: typeof managedApps;
  storeSources: typeof storeSources;
  weather: typeof weather;
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
