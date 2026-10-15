import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

// Called by the Luma launcher (LumaUpdateManager) to check for self-updates.
// Only the "luma" key is read today. Leave it unset unless your Luma build
// is signed with the same key as the vandamd/luma GitHub releases, otherwise
// the update prompt will offer an APK that cannot be installed over yours.
export const getReleaseVersions = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("releaseVersions").collect();
    return Object.fromEntries(rows.map((row) => [row.appId, row.versionName]));
  },
});

// Admin-only: `npx convex run managedApps:setReleaseVersion '{"appId":"luma","versionName":"2.0.18"}'`
export const setReleaseVersion = internalMutation({
  args: { appId: v.string(), versionName: v.union(v.string(), v.null()) },
  handler: async (ctx, { appId, versionName }) => {
    const existing = await ctx.db
      .query("releaseVersions")
      .withIndex("by_appId", (q) => q.eq("appId", appId))
      .unique();
    if (versionName === null) {
      if (existing !== null) {
        await ctx.db.delete(existing._id);
      }
      return;
    }
    if (existing === null) {
      await ctx.db.insert("releaseVersions", { appId, versionName });
    } else {
      await ctx.db.patch(existing._id, { versionName });
    }
  },
});
