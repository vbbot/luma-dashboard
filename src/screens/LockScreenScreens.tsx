import { useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { navigate } from "../router";
import { CopyIcon, Loading, MenuLink, PlusCircleIcon, Screen } from "../ui";

type Units = "celsius" | "fahrenheit";
type Place = { name: string; detail: string; latitude: number; longitude: number };

const UNITS: { value: Units; label: string }[] = [
  { value: "celsius", label: "Celsius" },
  { value: "fahrenheit", label: "Fahrenheit" },
];

function webhookUrl(token: string) {
  return `${window.location.origin}/hooks/${token}`;
}

function glanceSummary(glance: { text: string; expiresAt: number } | null) {
  return glance !== null && glance.expiresAt > Date.now() ? glance.text : "Nothing to show";
}

// Everything Luma shows on the lock screen: the message above the clock and
// up to two integration lines below it.
export function LockScreenScreen({ accountNumber }: { accountNumber: string }) {
  const integrations = useQuery(api.integrations.list, { accountNumber });

  return (
    <Screen
      title="Lock Screen"
      backTo="/"
      action={{ label: "Add integration", icon: <PlusCircleIcon />, to: "/lockscreen/add" }}
    >
      <div className="store-detail">
        <a className="store-app" href="#/message">
          <span className="store-app-name">Message</span>
          <span className="store-app-sources">Above the clock, until it expires</span>
        </a>
        {integrations == null ? (
          <Loading />
        ) : (
          <>
            {integrations.map((integration) => (
              <a
                key={integration.integrationId}
                className="store-app"
                href={`#/lockscreen/i/${integration.integrationId}`}
              >
                <span className="store-app-name">{integration.label}</span>
                <span className="store-app-sources">{glanceSummary(integration.glance)}</span>
              </a>
            ))}
            <p className="muted store-summary">
              {integrations.length === 0
                ? "Add weather or a webhook with + to show a line under the clock."
                : "Luma shows the first two integrations that have something to show, in this order, under the clock."}
            </p>
          </>
        )}
      </div>
    </Screen>
  );
}

export function AddIntegrationScreen() {
  return (
    <Screen title="Add" backTo="/lockscreen" centered>
      <nav className="menu">
        <MenuLink to="/lockscreen/add/weather">Weather</MenuLink>
        <MenuLink to="/lockscreen/add/webhook">Webhook</MenuLink>
      </nav>
    </Screen>
  );
}

export function AddWeatherScreen({ accountNumber }: { accountNumber: string }) {
  const searchPlaces = useAction(api.integrations.searchPlaces);
  const addWeather = useMutation(api.integrations.addWeather);
  const [search, setSearch] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [units, setUnits] = useState<Units>("celsius");
  const [error, setError] = useState<string | null>(null);

  async function find(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setPlaces(await searchPlaces({ accountNumber, query: search }));
    } catch {
      setError("Unable to search for places.");
    }
  }

  async function add(place: Place) {
    setError(null);
    try {
      await addWeather({
        accountNumber,
        label: `Weather · ${place.name}`.slice(0, 40),
        latitude: place.latitude,
        longitude: place.longitude,
        units,
      });
      navigate("/lockscreen");
    } catch (caught) {
      setError(
        caught instanceof Error && /at most/.test(caught.message)
          ? "This account already has the maximum number of integrations."
          : "Unable to add the weather.",
      );
    }
  }

  return (
    <Screen title="Weather" backTo="/lockscreen/add" centered>
      <div className="form">
        <form className="form" onSubmit={find}>
          <input
            className="field"
            placeholder="Town or city"
            aria-label="Town or city"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
          />
          <select
            className="field"
            aria-label="Units"
            value={units}
            onChange={(event) => setUnits(event.target.value as Units)}
          >
            {UNITS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button className="button" type="submit" disabled={search.trim().length < 2}>
            Search
          </button>
        </form>
        {places !== null && places.length === 0 && (
          <p className="muted centered-text">No places found.</p>
        )}
        {places?.map((place) => (
          <button
            key={`${place.latitude},${place.longitude}`}
            className="button button-secondary"
            onClick={() => add(place)}
          >
            {place.name}
            {place.detail !== "" && `, ${place.detail}`}
          </button>
        ))}
        {error !== null && <p className="error">{error}</p>}
        <p className="muted">
          Shows e.g. “12° Cloudy · 15°/8°”, updated every 30 minutes. Weather data by{" "}
          <a href="https://open-meteo.com" target="_blank" rel="noreferrer">
            Open-Meteo
          </a>
          .
        </p>
      </div>
    </Screen>
  );
}

export function AddWebhookScreen({ accountNumber }: { accountNumber: string }) {
  const addWebhook = useAction(api.integrations.addWebhook);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const integrationId = await addWebhook({ accountNumber, label });
      navigate(`/lockscreen/i/${integrationId}`);
    } catch (caught) {
      setError(
        caught instanceof Error && /at most/.test(caught.message)
          ? "This account already has the maximum number of integrations."
          : "Unable to add the webhook.",
      );
    }
  }

  return (
    <Screen title="Webhook" backTo="/lockscreen/add" centered>
      <form className="form" onSubmit={submit}>
        <p className="muted">
          A secret address that anything can send a line of text to, such as a Home Assistant
          automation, an iOS Shortcut or a script.
        </p>
        <input
          className="field"
          placeholder="Name, e.g. Home"
          aria-label="Name"
          maxLength={40}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          autoFocus
        />
        <button className="button" type="submit" disabled={label.trim() === ""}>
          Create
        </button>
        {error !== null && <p className="error">{error}</p>}
      </form>
    </Screen>
  );
}

export function IntegrationScreen({
  accountNumber,
  integrationId,
}: {
  accountNumber: string;
  integrationId: string;
}) {
  const integrations = useQuery(api.integrations.list, { accountNumber });
  const remove = useMutation(api.integrations.remove);
  const move = useMutation(api.integrations.move);
  const setWeatherUnits = useMutation(api.integrations.setWeatherUnits);
  const rotateWebhook = useAction(api.integrations.rotateWebhook);
  const [error, setError] = useState<string | null>(null);

  if (integrations == null) {
    return (
      <Screen backTo="/lockscreen" centered>
        <Loading />
      </Screen>
    );
  }
  const index = integrations.findIndex((row) => row.integrationId === integrationId);
  const integration = integrations[index];
  if (integration === undefined) {
    return (
      <Screen backTo="/lockscreen" centered>
        <p className="muted">This integration was removed.</p>
      </Screen>
    );
  }
  const id = integration.integrationId as Id<"integrations">;
  const glance =
    integration.glance !== null && integration.glance.expiresAt > Date.now()
      ? integration.glance
      : null;

  async function run(task: () => Promise<unknown>, failure: string) {
    setError(null);
    try {
      await task();
    } catch {
      setError(failure);
    }
  }

  return (
    <Screen title={integration.label} backTo="/lockscreen" centered>
      <div className="form">
        <p className="message-preview">{glance?.text ?? "Nothing to show"}</p>
        {glance !== null && (
          <p className="muted">Showing until {new Date(glance.expiresAt).toLocaleString()}</p>
        )}
        {integration.lastError !== undefined && (
          <p className="muted">Last update failed: {integration.lastError}</p>
        )}

        {integration.kind === "weather" && (
          <select
            className="field"
            aria-label="Units"
            value={integration.units}
            onChange={(event) =>
              run(
                () =>
                  setWeatherUnits({
                    accountNumber,
                    integrationId: id,
                    units: event.target.value as Units,
                  }),
                "Unable to change the units.",
              )
            }
          >
            {UNITS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        {integration.kind === "webhook" && integration.webhookToken !== undefined && (
          <>
            <div className="field-group">
              <span className="field field-static field-url">
                {webhookUrl(integration.webhookToken)}
              </span>
              <button
                className="field-button"
                aria-label="Copy webhook address"
                onClick={() => navigator.clipboard.writeText(webhookUrl(integration.webhookToken!))}
              >
                <CopyIcon />
              </button>
            </div>
            <p className="muted">
              POST up to 60 characters of text to show them for an hour, or JSON such as{" "}
              <code>{'{"text": "Bins out tonight", "minutes": 120}'}</code> (up to a week). DELETE
              clears the line. Anyone with the address can change the line, so keep it private.
            </p>
            <pre className="code-block">{`curl -d "Bins out tonight" ${webhookUrl(integration.webhookToken)}`}</pre>
            <button
              className="button button-secondary"
              onClick={() =>
                run(
                  () => rotateWebhook({ accountNumber, integrationId: id }),
                  "Unable to change the address.",
                )
              }
            >
              Change address
            </button>
          </>
        )}

        <div className="button-row">
          <button
            className="button button-secondary"
            disabled={index === 0}
            onClick={() =>
              run(
                () => move({ accountNumber, integrationId: id, direction: "up" }),
                "Unable to move.",
              )
            }
          >
            Move up
          </button>
          <button
            className="button button-secondary"
            disabled={index === integrations.length - 1}
            onClick={() =>
              run(
                () => move({ accountNumber, integrationId: id, direction: "down" }),
                "Unable to move.",
              )
            }
          >
            Move down
          </button>
        </div>
        <button
          className="button button-secondary"
          onClick={() =>
            run(async () => {
              await remove({ accountNumber, integrationId: id });
              navigate("/lockscreen");
            }, "Unable to remove the integration.")
          }
        >
          Remove
        </button>
        {error !== null && <p className="error">{error}</p>}
      </div>
    </Screen>
  );
}
