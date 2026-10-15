import { LIGHT_TOOLS, MANAGED_APPS, REQUIRED_TOOL_IDS } from "../convex/catalog";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";

export type Dashboard = NonNullable<FunctionReturnType<typeof api.accounts.getDashboard>>;
export type AndroidApp = Dashboard["enabledAndroidApps"][number];

// The three "Add Tools" categories, matching the hosted dashboard.
export type Category = "light" | "noscroll" | "android";

export const CATEGORY_LABELS: Record<Category, string> = {
  light: "Light",
  noscroll: "No Scrolling",
  android: "Android",
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
const appLabels = new Map<string, string>(MANAGED_APPS.map((app) => [app.id, app.label]));

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

function appItem(id: string): HomeItem {
  return { key: `app:${id}`, label: appLabels.get(id) ?? id, category: "noscroll", fixed: false, id };
}

function androidItem(app: AndroidApp): HomeItem {
  const key = androidAppKey(app);
  return { key: `android:${key}`, label: app.label, category: "android", fixed: false, id: key, androidApp: app };
}

const byLabel = (a: HomeItem, b: HomeItem) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: "base" });

// Phone first, then everything alphabetically, as the hosted dashboard shows.
export function enabledItems(dashboard: Dashboard): HomeItem[] {
  const items = [
    ...dashboard.enabledToolIds.filter((id) => id !== "phone").map(toolItem),
    ...dashboard.enabledAppIds.map(appItem),
    ...dashboard.enabledAndroidApps.map(androidItem),
  ].sort(byLabel);
  return [toolItem("phone"), ...items];
}

export function availableItems(dashboard: Dashboard, category: Category): HomeItem[] {
  switch (category) {
    case "light":
      return LIGHT_TOOLS.filter((tool) => !dashboard.enabledToolIds.includes(tool.id))
        .map((tool) => toolItem(tool.id))
        .sort(byLabel);
    case "noscroll":
      return MANAGED_APPS.filter((app) => !dashboard.enabledAppIds.includes(app.id))
        .map((app) => appItem(app.id))
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
