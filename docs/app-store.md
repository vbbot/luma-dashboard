# App Store

**Tools → + → App Store** lists every app from three sources, merged into one catalog:

| Source | What it provides |
|---|---|
| No Scrolling | Vandam's apps (`buses`, `passes`, `weather`, `zero`, `echo`, `reverb`), which every Luma version can install |
| [Bright Market](https://github.com/gi-os/brightmarket-index) | `index-v1.json`: package names, APK links with SHA-256, screenshots |
| [awesome-light](https://github.com/garado/awesome-light) | `content/apps/*/index.md`: descriptions, categories, screenshots |

`appStore:refresh` ([`convex/appStore.ts`](../convex/appStore.ts)) rebuilds the catalog when the
backend starts and every hour:

- **Duplicates.** Apps are matched by GitHub repo, then by package name, since Android can only
  hold one app per package. A merged app lists every source it came from.
- **Categories.** Both sources' categories map onto one list (`convex/storeSources.ts`).
- **Releases.** For apps whose source has no APK link, the latest GitHub release is looked up
  (cached by ETag). GitHub allows 60 lookups an hour without a token; set `GITHUB_TOKEN` (no
  scopes needed) to do them all in one refresh. Listing awesome-light's apps also uses GitHub's API;
  if it's refused, the previous list is reused, and on a brand-new install awesome-light's apps
  appear from the next successful refresh.
- **Package names.** For APKs with no listed package, the backend reads it from the APK's
  `AndroidManifest.xml` using HTTP range requests, without downloading the whole APK.

Apps with no APK in their latest release (or no release at all) are listed but can't be added.
Adding an App Store app beyond Vandam's needs a Luma build with App Store support; older builds
ignore those apps.
