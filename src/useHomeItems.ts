import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { androidAppKey, type Dashboard, type HomeItem } from "./items";

export function useHomeItemActions(accountNumber: string, dashboard: Dashboard) {
  const setEnabledTools = useMutation(api.accounts.setEnabledTools);
  const setEnabledApps = useMutation(api.accounts.setEnabledApps);
  const setEnabledAndroidApps = useMutation(api.accounts.setEnabledAndroidApps);

  async function add(item: HomeItem) {
    switch (item.category) {
      case "light":
        return setEnabledTools({ accountNumber, toolIds: [...dashboard.enabledToolIds, item.id] });
      case "store":
        return setEnabledApps({ accountNumber, appIds: [...dashboard.enabledAppIds, item.id] });
      case "android":
        return setEnabledAndroidApps({
          accountNumber,
          apps: [...dashboard.enabledAndroidApps, item.androidApp!],
        });
    }
  }

  async function remove(item: HomeItem) {
    switch (item.category) {
      case "light":
        return setEnabledTools({
          accountNumber,
          toolIds: dashboard.enabledToolIds.filter((id) => id !== item.id),
        });
      case "store":
        return setEnabledApps({
          accountNumber,
          appIds: dashboard.enabledAppIds.filter((id) => id !== item.id),
        });
      case "android":
        return setEnabledAndroidApps({
          accountNumber,
          apps: dashboard.enabledAndroidApps.filter((app) => androidAppKey(app) !== item.id),
        });
    }
  }

  return { add, remove };
}
