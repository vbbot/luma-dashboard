import { useState } from "react";
import {
  installedVersion,
  SOURCE_NAMES,
  storeAppItem,
  storeCategories,
  type Dashboard,
  type Store,
  type StoreApp,
} from "../items";
import { useHomeItemActions } from "../useHomeItems";
import { Loading, Screen } from "../ui";

export const ALL_CATEGORY = "All";

export function storeCategoryPath(category: string): string {
  return `/store/c/${encodeURIComponent(category)}`;
}

export function storeAppPath(appId: string): string {
  return `/store/app/${encodeURIComponent(appId)}`;
}

function sourceList(app: StoreApp): string {
  return app.sources.map((source) => SOURCE_NAMES[source.id] ?? source.id).join(" · ");
}

export function StoreCategoriesScreen({ store }: { store: Store | undefined }) {
  return (
    <Screen title="App Store" backTo="/tools/add">
      {store === undefined ? (
        <Loading />
      ) : store.apps.length === 0 ? (
        <p className="muted centered-text">
          The App Store is still loading its catalog. It refreshes every few hours; check back
          shortly.
        </p>
      ) : (
        <div className="item-list">
          {[{ name: ALL_CATEGORY, count: store.apps.length }, ...storeCategories(store)].map(
            (category) => (
              <a key={category.name} className="store-row" href={`#${storeCategoryPath(category.name)}`}>
                <span>{category.name}</span>
                <span className="store-count">{category.count}</span>
              </a>
            ),
          )}
        </div>
      )}
    </Screen>
  );
}

export function StoreCategoryScreen({
  store,
  dashboard,
  category,
}: {
  store: Store | undefined;
  dashboard: Dashboard;
  category: string;
}) {
  const apps =
    store?.apps.filter((app) => category === ALL_CATEGORY || app.category === category) ?? [];
  return (
    <Screen title={category} backTo="/store">
      {store === undefined ? (
        <Loading />
      ) : apps.length === 0 ? (
        <p className="muted centered-text">No apps in this category.</p>
      ) : (
        <div className="item-list">
          {apps.map((app) => (
            <a
              key={app.appId}
              className={app.installable ? "store-app" : "store-app store-app-unavailable"}
              href={`#${storeAppPath(app.appId)}`}
            >
              <span className="store-app-name">{app.name}</span>
              <span className="store-app-sources">
                {dashboard.enabledAppIds.includes(app.appId) ? "Added · " : ""}
                {sourceList(app)}
                {app.installable ? "" : " · no APK yet"}
              </span>
            </a>
          ))}
        </div>
      )}
    </Screen>
  );
}

export function StoreAppScreen({
  store,
  dashboard,
  accountNumber,
  appId,
  backTo,
}: {
  store: Store | undefined;
  dashboard: Dashboard;
  accountNumber: string;
  appId: string;
  backTo: string;
}) {
  const app = store?.apps.find((entry) => entry.appId === appId);
  const { add, remove } = useHomeItemActions(accountNumber, dashboard);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (store === undefined) {
    return (
      <Screen title="App Store" backTo={backTo} centered>
        <Loading />
      </Screen>
    );
  }
  if (app === undefined) {
    return (
      <Screen title="App Store" backTo={backTo} centered>
        <p className="muted centered-text">This app is no longer in the App Store.</p>
      </Screen>
    );
  }

  const added = dashboard.enabledAppIds.includes(app.appId);
  const installed = installedVersion(dashboard, app);

  async function toggle() {
    if (app === undefined) return;
    setPending(true);
    setError(null);
    try {
      await (added ? remove(storeAppItem(app)) : add(storeAppItem(app)));
    } catch {
      setError(`Unable to ${added ? "remove" : "add"} ${app.name}.`);
    } finally {
      setPending(false);
    }
  }

  return (
    <Screen title={app.name} backTo={backTo}>
      <div className="store-detail">
        {app.screenshots.length > 0 && (
          <div className="store-shots">
            {app.screenshots.map((url) => (
              <img key={url} src={url} alt="" loading="lazy" />
            ))}
          </div>
        )}
        <p className="store-meta">
          Author:{" "}
          {app.authorUrl ? (
            <a href={app.authorUrl} target="_blank" rel="noreferrer">
              {app.author}
            </a>
          ) : (
            app.author
          )}
          <br />
          <a href={`https://github.com/${app.repo}`} target="_blank" rel="noreferrer">
            https://github.com/{app.repo}
          </a>
        </p>
        <p className="store-meta">
          Category: {app.category}
          <br />
          Sources:{" "}
          {app.sources.map((source, index) => (
            <span key={source.id}>
              {index > 0 && ", "}
              <a href={source.url} target="_blank" rel="noreferrer">
                {SOURCE_NAMES[source.id] ?? source.id}
              </a>
            </span>
          ))}
        </p>
        <p className="store-meta">
          Installed: {installed === null ? "Not installed" : installed || "Yes"}
          <br />
          Latest: {app.latestVersion ?? "Unknown"}
        </p>
        {app.summary && <p className="store-summary">{app.summary}</p>}
        {app.installable ? (
          <button className="button store-button" onClick={toggle} disabled={pending}>
            {added ? "Remove" : "Add"}
          </button>
        ) : (
          <button className="button store-button" disabled>
            No APK available
          </button>
        )}
        {error !== null && <p className="error">{error}</p>}
      </div>
    </Screen>
  );
}
