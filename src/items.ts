import { BUILTIN_APPS, LIGHT_TOOLS, REQUIRED_TOOL_IDS } from "../convex/catalog";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";

export type Dashboard = NonNullable<FunctionReturnType<typeof api.accounts.getDashboard>>;
export type AndroidApp = Dashboard["enabledAndroidApps"][number];
export type Store = FunctionReturnType<typeof api.appStore.list>;
export type StoreApp = Store["apps"][number];

// The three "Add Tools" sections. Light and Android are plain lists; the App
// Store has its own category, list and detail screens.
export type Category = "light" | "store" | "android";
export type ListCategory = Exclude<Category, "store">;

export const CATEGORY_LABELS: Record<Category, string> = {
  light: "Light",
  store: "App Store",
  android: "Android",
};

export const SOURCE_NAMES: Record<string, string> = {
  noscrolling: "No Scrolling",
  brightmarket: "Bright Market",
  "awesome-light": "awesome-light",
};

export type HomeItem = {
  key: string;
  label: string;
  category: Category;
  // Phone and Settings cannot be removed.
  fixed: boolean;
  id: string;
  androidApp?: AndroidApp;
};

const toolLabels = new Map<string, string>(LIGHT_TOOLS.map((tool) => [tool.id, tool.label]));
const builtinLabels = new Map<string, string>(BUILTIN_APPS.map((app) => [app.id, app.label]));

export function androidAppKey(app: AndroidApp): string {
  return `${app.packageName}|${app.activityName}`;
}

function toolItem(id: string): HomeItem {
  return {
    key: `tool:${id}`,
    label: toolLabels.get(id) ?? id,
    category: "light",
    fixed: (REQUIRED_TOOL_IDS as readonly string[]).includes(id),
    id,
  };
}

function storeItem(id: string, store: Store | undefined): HomeItem {
  const label = store?.apps.find((app) => app.appId === id)?.name ?? builtinLabels.get(id) ?? id;
  return { key: `app:${id}`, label, category: "store", fixed: false, id };
}

function androidItem(app: AndroidApp): HomeItem {
  const key = androidAppKey(app);
  return { key: `android:${key}`, label: app.label, category: "android", fixed: false, id: key, androidApp: app };
}

const byLabel = (a: HomeItem, b: HomeItem) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: "base" });

// Phone first, then everything alphabetically, as the hosted dashboard shows.
export function enabledItems(dashboard: Dashboard, store: Store | undefined): HomeItem[] {
  const items = [
    ...dashboard.enabledToolIds.filter((id) => id !== "phone").map(toolItem),
    ...dashboard.enabledAppIds.map((id) => storeItem(id, store)),
    ...dashboard.enabledAndroidApps.map(androidItem),
  ].sort(byLabel);
  return [toolItem("phone"), ...items];
}

export function availableItems(dashboard: Dashboard, category: ListCategory): HomeItem[] {
  switch (category) {
    case "light":
      return LIGHT_TOOLS.filter((tool) => !dashboard.enabledToolIds.includes(tool.id))
        .map((tool) => toolItem(tool.id))
        .sort(byLabel);
    case "android": {
      const enabled = new Set(dashboard.enabledAndroidApps.map(androidAppKey));
      return dashboard.installedAndroidApps
        .filter((app) => !enabled.has(androidAppKey(app)))
        .map(androidItem)
        .sort(byLabel);
    }
  }
}

export function storeAppItem(app: StoreApp): HomeItem {
  return { key: `app:${app.appId}`, label: app.name, category: "store", fixed: false, id: app.appId };
}

// What the phones on this account report for an App Store app.
export function installedVersion(dashboard: Dashboard, app: StoreApp): string | null {
  for (const device of dashboard.devices) {
    const installed = device.installedManagedApps.find((entry) => entry.appId === app.appId);
    if (installed) return installed.versionName;
  }
  if (app.packageName && dashboard.installedAndroidApps.some((a) => a.packageName === app.packageName)) {
    return "";
  }
  return null;
}

export function storeCategories(store: Store): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const app of store.apps) counts.set(app.category, (counts.get(app.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
