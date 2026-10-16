// Parses the App Store sources and merges them into one list with no
// duplicates. Pure functions; the fetching lives in appStore.ts.

import { BUILTIN_APPS } from "./catalog";

export const BRIGHT_MARKET_INDEX =
  "https://raw.githubusercontent.com/gi-os/brightmarket-index/main/index-v1.json";
export const AWESOME_LIGHT_REPO = "garado/awesome-light";

export const SOURCES = {
  noscrolling: { name: "No Scrolling", url: "https://dashboard.noscroll.ing" },
  brightmarket: { name: "Bright Market", url: "https://github.com/gi-os/brightmarket-index" },
  "awesome-light": { name: "awesome-light", url: "https://awesome-light.garado.dev" },
} as const;
export type SourceId = keyof typeof SOURCES;

// Repos that are listed but must not be installed through the App Store.
const EXCLUDED_REPOS = new Set(["vandamd/luma"]);

export type Release = { version: string; apkUrl: string; sha256?: string };

export type StoreApp = {
  appId: string;
  name: string;
  summary: string;
  category: string;
  sources: { id: SourceId; url: string }[];
  repo: string;
  author: string;
  authorUrl?: string;
  screenshots: string[];
  packageName?: string;
  latest?: Release;
  editorPick?: boolean;
};

// One category list for both taxonomies.
const CATEGORY_MAP: Record<string, string> = {
  utility: "Utilities",
  utilities: "Utilities",
  productivity: "Productivity",
  "music/audio": "Music & Audio",
  media: "Music & Audio",
  "reading & reference": "Reading",
  reading: "Reading",
  "health & wellness": "Health & Wellness",
  navigation: "Navigation",
  entertainment: "Games",
  games: "Games",
  keyboard: "Keyboards",
  photos: "Photos",
  "companion tools": "Companion Tools",
  communication: "Communication",
  launchers: "Launchers",
  hardware: "Hardware",
};

export function normalizeCategory(raw: string | undefined): string {
  const key = (raw ?? "").trim().toLowerCase();
  return CATEGORY_MAP[key] ?? (key ? key.replace(/\b\w/g, (c) => c.toUpperCase()) : "Utilities");
}

export function repoKey(url: string): string | null {
  const match = /github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(url) ?? /^([^/\s]+)\/([^/\s]+)$/.exec(url);
  if (!match) return null;
  return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
}

// ---------------------------------------------------------------------------
// Bright Market: https://github.com/gi-os/brightmarket-index
// ---------------------------------------------------------------------------

type BrightMarketApp = {
  name: string;
  pkg: string;
  repo: string;
  category?: string;
  summary?: string;
  deprecated?: boolean;
  screenshots?: { url: string }[];
  latest?: { apk?: string; version?: string; sha256?: string };
};

export function parseBrightMarket(index: unknown): BrightMarketApp[] {
  const apps = (index as { apps?: unknown }).apps;
  if (!Array.isArray(apps)) throw new Error("Bright Market index has no apps");
  return apps.filter(
    (app): app is BrightMarketApp =>
      typeof app?.pkg === "string" && typeof app?.repo === "string" && !app.deprecated,
  );
}

// ---------------------------------------------------------------------------
// awesome-light: content/apps/<dir>/index.md front matter
// ---------------------------------------------------------------------------

export type AwesomeLightApp = {
  dir: string;
  title: string;
  repo: string;
  author: string;
  authorUrl?: string;
  category?: string;
  description: string;
  images: string[];
  editorPick: boolean;
};

export function parseAwesomeLight(dir: string, markdown: string): AwesomeLightApp | null {
  const frontMatter = /^---\s*\n([\s\S]*?)\n---/.exec(markdown)?.[1];
  if (!frontMatter) return null;
  const fields: Record<string, string> = {};
  const images: string[] = [];
  let inImages = false;
  for (const line of frontMatter.split("\n")) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && inImages) {
      images.push(unquote(item[1]));
      continue;
    }
    const field = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (field) {
      inImages = field[1] === "images";
      fields[field[1]] = unquote(field[2]);
    }
  }
  if (!fields.title || !fields.repo) return null;
  return {
    dir,
    title: fields.title,
    repo: fields.repo,
    author: fields.author ?? "",
    authorUrl: fields.author_url || undefined,
    category: fields.category,
    description: fields.description ?? "",
    images,
    editorPick: fields.editor_pick === "true",
  };
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function awesomeImageUrl(dir: string, image: string): string {
  return `https://raw.githubusercontent.com/${AWESOME_LIGHT_REPO}/main/content/apps/${encodeURIComponent(dir)}/${encodeURIComponent(image)}`;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export function mergeSources(
  brightMarket: BrightMarketApp[],
  awesomeLight: AwesomeLightApp[],
): StoreApp[] {
  const byRepo = new Map<string, StoreApp>();
  const key = (repo: string) => repo.toLowerCase();

  for (const app of BUILTIN_APPS) {
    byRepo.set(key(app.repo), {
      appId: app.id,
      name: app.label,
      summary: "",
      category: "Utilities",
      sources: [{ id: "noscrolling", url: SOURCES.noscrolling.url }],
      repo: app.repo,
      author: app.repo.split("/")[0],
      authorUrl: `https://github.com/${app.repo.split("/")[0]}`,
      screenshots: [],
      packageName: app.packageName,
    });
  }

  for (const app of brightMarket) {
    const repo = repoKey(app.repo);
    if (!repo) continue;
    const existing = byRepo.get(key(repo));
    const release: Release | undefined =
      app.latest?.apk && app.latest.version
        ? { version: app.latest.version, apkUrl: app.latest.apk, sha256: app.latest.sha256 }
        : undefined;
    const screenshots = (app.screenshots ?? []).map((shot) => shot.url).filter(Boolean);
    const source = { id: "brightmarket" as const, url: `https://github.com/${repo}` };
    if (existing) {
      existing.sources.push(source);
      existing.summary ||= app.summary ?? "";
      existing.category = normalizeCategory(app.category);
      existing.packageName ??= app.pkg;
      existing.latest ??= release;
      if (existing.screenshots.length === 0) existing.screenshots = screenshots;
    } else {
      byRepo.set(key(repo), {
        appId: repo.toLowerCase(),
        name: app.name,
        summary: app.summary ?? "",
        category: normalizeCategory(app.category),
        sources: [source],
        repo,
        author: repo.split("/")[0],
        authorUrl: `https://github.com/${repo.split("/")[0]}`,
        screenshots,
        packageName: app.pkg,
        latest: release,
      });
    }
  }

  for (const app of awesomeLight) {
    const repo = repoKey(app.repo);
    if (!repo) continue;
    const screenshots = app.images.map((image) => awesomeImageUrl(app.dir, image));
    const source = {
      id: "awesome-light" as const,
      url: `${SOURCES["awesome-light"].url}/apps/${app.dir.toLowerCase()}/`,
    };
    const existing = byRepo.get(key(repo));
    if (existing) {
      existing.sources.push(source);
      // awesome-light's categories are the more specific taxonomy.
      existing.category = normalizeCategory(app.category);
      existing.summary ||= app.description;
      existing.author = app.author || existing.author;
      existing.authorUrl = app.authorUrl ?? existing.authorUrl;
      if (existing.screenshots.length === 0) existing.screenshots = screenshots;
      existing.editorPick ||= app.editorPick;
    } else {
      byRepo.set(key(repo), {
        appId: repo.toLowerCase(),
        name: app.title,
        summary: app.description,
        category: normalizeCategory(app.category),
        sources: [source],
        repo,
        author: app.author || repo.split("/")[0],
        authorUrl: app.authorUrl,
        screenshots,
        editorPick: app.editorPick || undefined,
      });
    }
  }

  return [...byRepo.values()].filter((app) => !EXCLUDED_REPOS.has(app.repo.toLowerCase()));
}

// Different repos can ship the same package (e.g. a repo that moved). Keep one
// entry per package, preferring the one listed by more sources.
export function dedupeByPackage(apps: StoreApp[]): StoreApp[] {
  const byPackage = new Map<string, StoreApp>();
  const result: StoreApp[] = [];
  for (const app of apps) {
    if (!app.packageName) {
      result.push(app);
      continue;
    }
    const existing = byPackage.get(app.packageName);
    if (!existing) {
      byPackage.set(app.packageName, app);
      result.push(app);
      continue;
    }
    const [keep, drop] = existing.sources.length >= app.sources.length ? [existing, app] : [app, existing];
    for (const source of drop.sources) {
      if (!keep.sources.some((s) => s.id === source.id)) keep.sources.push(source);
    }
    keep.latest ??= drop.latest;
    if (keep.screenshots.length === 0) keep.screenshots = drop.screenshots;
    if (keep !== existing) {
      result[result.indexOf(existing)] = keep;
      byPackage.set(app.packageName, keep);
    }
  }
  return result;
}

// Picks the APK to install from a GitHub release's assets.
export function pickApkAsset<T extends { name: string }>(assets: T[]): T | undefined {
  const apks = assets.filter((asset) => /\.apk$/i.test(asset.name));
  const preferred = apks.filter((asset) => !/(arm32|armeabi|x86|debug|unsigned)/i.test(asset.name));
  return preferred[0] ?? apks[0];
}

export function sortApps(apps: StoreApp[]): StoreApp[] {
  return [...apps].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
