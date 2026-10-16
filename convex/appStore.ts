import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { release, storeApp } from "./schema";
import { resolveApkPackage } from "./apk";
import {
  AWESOME_LIGHT_REPO,
  BRIGHT_MARKET_INDEX,
  type Release,
  type StoreApp,
  dedupeByPackage,
  mergeSources,
  parseAwesomeLight,
  parseBrightMarket,
  pickApkAsset,
  sortApps,
} from "./storeSources";

// Rebuilds the App Store from No Scrolling (Vandam's apps), Bright Market and
// awesome-light. Runs on a schedule (crons.ts) and when the backend starts.
// GitHub's API allows 60 requests an hour without a token; set GITHUB_TOKEN
// on the deployment to refresh every release in one run.

// Convex exposes deployment environment variables on process.env.
declare const process: { env: Record<string, string | undefined> };

type CachedRelease = Pick<Doc<"storeReleases">, "repo" | "etag" | "release">;
type CachedPackage = Pick<Doc<"storePackages">, "apkUrl" | "packageName" | "error">;

function githubHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "luma-dashboard",
    ...extra,
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

async function fetchAwesomeLight() {
  const tree = await fetch(
    `https://api.github.com/repos/${AWESOME_LIGHT_REPO}/git/trees/main?recursive=1`,
    { headers: githubHeaders() },
  );
  if (!tree.ok) throw new Error(`awesome-light tree: HTTP ${tree.status}`);
  const paths = ((await tree.json()) as { tree: { path: string }[] }).tree.map((item) => item.path);
  const dirs = paths
    .map((path) => /^content\/apps\/([^/]+)\/index\.md$/.exec(path)?.[1])
    .filter((dir): dir is string => dir !== undefined);
  const apps = await mapLimit(dirs, 8, async (dir) => {
    const response = await fetch(
      `https://raw.githubusercontent.com/${AWESOME_LIGHT_REPO}/main/content/apps/${encodeURIComponent(dir)}/index.md`,
    );
    return response.ok ? parseAwesomeLight(dir, await response.text()) : null;
  });
  return apps.filter((app) => app !== null);
}

export const refresh = internalAction({
  args: {},
  handler: async (ctx) => {
    const errors: string[] = [];

    let merged: StoreApp[];
    try {
      const index = await fetch(BRIGHT_MARKET_INDEX);
      if (!index.ok) throw new Error(`Bright Market: HTTP ${index.status}`);
      merged = mergeSources(parseBrightMarket(await index.json()), await fetchAwesomeLight());
    } catch (error) {
      // Keep the current catalog rather than replacing it with a partial one.
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.appStore.recordError, { error: message });
      return;
    }

    // Latest release for apps whose source does not provide one.
    const needRelease = merged.filter((app) => !app.latest);
    const cachedReleases: CachedRelease[] = await ctx.runQuery(internal.appStore.cachedReleases, {
      repos: needRelease.map((app) => app.repo.toLowerCase()),
    });
    const releaseCache = new Map(cachedReleases.map((row) => [row.repo, row]));
    const releaseUpdates: CachedRelease[] = [];
    let rateLimited = false;
    for (const app of needRelease) {
      const repo = app.repo.toLowerCase();
      const cached = releaseCache.get(repo);
      if (!rateLimited) {
        const response = await fetch(`https://api.github.com/repos/${app.repo}/releases/latest`, {
          headers: githubHeaders(cached?.etag ? { "If-None-Match": cached.etag } : {}),
        });
        if (response.status === 200) {
          const body = (await response.json()) as {
            tag_name?: string;
            assets?: { name: string; browser_download_url: string }[];
          };
          const asset = pickApkAsset(body.assets ?? []);
          const next: Release | undefined =
            asset && body.tag_name
              ? { version: body.tag_name.replace(/^v/i, ""), apkUrl: asset.browser_download_url }
              : undefined;
          releaseUpdates.push({ repo, etag: response.headers.get("etag") ?? undefined, release: next });
          app.latest = next;
          continue;
        }
        if (response.status === 404) {
          releaseUpdates.push({ repo, etag: undefined, release: undefined });
          continue;
        }
        if (response.status === 403 || response.status === 429) {
          rateLimited = true;
          errors.push("GitHub rate limit reached; some releases are from the previous refresh");
        } else if (response.status !== 304) {
          errors.push(`${app.repo}: HTTP ${response.status}`);
        }
      }
      app.latest = cached?.release;
    }

    // Package names for APKs whose source does not list one.
    const needPackage = merged.filter((app) => !app.packageName && app.latest);
    const cachedPackages: CachedPackage[] = await ctx.runQuery(internal.appStore.cachedPackages, {
      apkUrls: needPackage.map((app) => app.latest!.apkUrl),
    });
    const packageCache = new Map(cachedPackages.map((row) => [row.apkUrl, row]));
    const packageUpdates: CachedPackage[] = [];
    await mapLimit(needPackage, 4, async (app) => {
      const apkUrl = app.latest!.apkUrl;
      const cached = packageCache.get(apkUrl);
      if (cached) {
        app.packageName = cached.packageName;
        return;
      }
      try {
        app.packageName = await resolveApkPackage(apkUrl);
        packageUpdates.push({ apkUrl, packageName: app.packageName, error: undefined });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        packageUpdates.push({ apkUrl, packageName: undefined, error: message });
        errors.push(`${app.repo}: ${message}`);
      }
    });

    const apps = sortApps(dedupeByPackage(merged));
    await ctx.runMutation(internal.appStore.save, { apps, releaseUpdates, packageUpdates, errors });
    return { apps: apps.length, errors };
  },
});

export const cachedReleases = internalQuery({
  args: { repos: v.array(v.string()) },
  handler: async (ctx, { repos }) => {
    const rows = await Promise.all(
      repos.map((repo) =>
        ctx.db
          .query("storeReleases")
          .withIndex("by_repo", (q) => q.eq("repo", repo))
          .unique(),
      ),
    );
    return rows.flatMap((row) => (row ? [{ repo: row.repo, etag: row.etag, release: row.release }] : []));
  },
});

export const cachedPackages = internalQuery({
  args: { apkUrls: v.array(v.string()) },
  handler: async (ctx, { apkUrls }) => {
    const rows = await Promise.all(
      apkUrls.map((apkUrl) =>
        ctx.db
          .query("storePackages")
          .withIndex("by_apkUrl", (q) => q.eq("apkUrl", apkUrl))
          .unique(),
      ),
    );
    return rows.flatMap((row) =>
      row ? [{ apkUrl: row.apkUrl, packageName: row.packageName, error: row.error }] : [],
    );
  },
});

export const save = internalMutation({
  args: {
    apps: v.array(storeApp),
    releaseUpdates: v.array(
      v.object({ repo: v.string(), etag: v.optional(v.string()), release: v.optional(release) }),
    ),
    packageUpdates: v.array(
      v.object({
        apkUrl: v.string(),
        packageName: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
    errors: v.array(v.string()),
  },
  handler: async (ctx, { apps, releaseUpdates, packageUpdates, errors }) => {
    const now = Date.now();
    for (const row of await ctx.db.query("storeApps").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const app of apps) {
      await ctx.db.insert("storeApps", app);
    }

    for (const update of releaseUpdates) {
      const existing = await ctx.db
        .query("storeReleases")
        .withIndex("by_repo", (q) => q.eq("repo", update.repo))
        .unique();
      if (existing) {
        await ctx.db.replace(existing._id, { ...update, checkedAt: now });
      } else {
        await ctx.db.insert("storeReleases", { ...update, checkedAt: now });
      }
    }
    for (const update of packageUpdates) {
      const existing = await ctx.db
        .query("storePackages")
        .withIndex("by_apkUrl", (q) => q.eq("apkUrl", update.apkUrl))
        .unique();
      if (existing) {
        await ctx.db.replace(existing._id, { ...update, checkedAt: now });
      } else {
        await ctx.db.insert("storePackages", { ...update, checkedAt: now });
      }
    }

    await writeStatus(ctx, { refreshedAt: now, appCount: apps.length, errors });
  },
});

export const recordError = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    const status = await ctx.db.query("storeStatus").first();
    await writeStatus(ctx, {
      refreshedAt: status?.refreshedAt ?? 0,
      appCount: status?.appCount ?? 0,
      errors: [`Refresh failed: ${error}`],
    });
  },
});

async function writeStatus(
  ctx: { db: import("./_generated/server").DatabaseWriter },
  status: { refreshedAt: number; appCount: number; errors: string[] },
) {
  const existing = await ctx.db.query("storeStatus").first();
  if (existing) {
    await ctx.db.replace(existing._id, status);
  } else {
    await ctx.db.insert("storeStatus", status);
  }
}

// ---------------------------------------------------------------------------
// Read by the web dashboard.
// ---------------------------------------------------------------------------

function toListing(app: Doc<"storeApps">) {
  return {
    appId: app.appId,
    name: app.name,
    summary: app.summary,
    category: app.category,
    sources: app.sources,
    repo: app.repo,
    author: app.author,
    authorUrl: app.authorUrl,
    screenshots: app.screenshots,
    packageName: app.packageName,
    latestVersion: app.latest?.version,
    installable: app.packageName !== undefined && app.latest !== undefined,
    editorPick: app.editorPick ?? false,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const apps = await ctx.db.query("storeApps").collect();
    const status = await ctx.db.query("storeStatus").first();
    return {
      apps: apps.map(toListing),
      refreshedAt: status?.refreshedAt ?? null,
    };
  },
});
