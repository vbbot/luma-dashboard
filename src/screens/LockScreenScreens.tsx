import { useEffect, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Card } from "../../convex/cards";
import { DeckPreview, isShowing } from "../CardPreview";
import { navigate } from "../router";
import { ListRow, Loading, Page, Screen, Section, Switch, errorMessage } from "../ui";

// Lock Screen: what the phone shows, laid out like it. A live preview, the
// message above the clock, and the cards under it in order. Each card's few
// settings open in place; "Add" offers everything available, including
// cards for connected accounts (Connections).

type Units = "celsius" | "fahrenheit";
type HabiticaShow = "dailies" | "todos" | "habits" | "stats";
type Place = { name: string; detail: string; latitude: number; longitude: number };

const HABITICA_VIEWS: { value: HabiticaShow; label: string }[] = [
  { value: "dailies", label: "Dailies" },
  { value: "todos", label: "To-Dos" },
  { value: "habits", label: "Habits" },
  { value: "stats", label: "Stats" },
];

const DURATIONS = [
  { minutes: 60, label: "1 hour" },
  { minutes: 60 * 24, label: "1 day" },
  { minutes: 60 * 24 * 7, label: "1 week" },
];

const MAX_CARDS = 5;

function webhookUrl(token: string) {
  return `${window.location.origin}/hooks/${token}`;
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function PhonePreview({ message, cards }: { message: string | null; cards: Card[] }) {
  const clock = useClock();
  return (
    <div className="phone" aria-label="Lock screen preview">
      {message !== null && <p className="phone-message">{message}</p>}
      <p className="phone-clock">{clock}</p>
      <DeckPreview cards={cards} />
    </div>
  );
}

function MessageSection({ accountNumber }: { accountNumber: string }) {
  const current = useQuery(api.lockscreenMessages.getCurrentForDevice, { accountNumber });
  const send = useMutation(api.lockscreenMessages.send);
  const clear = useMutation(api.lockscreenMessages.clear);
  const [text, setText] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(DURATIONS[1].minutes);
  const [error, setError] = useState<string | null>(null);
  const active = current != null && current.expiresAt > Date.now() ? current : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await send({ accountNumber, text, durationMinutes });
      setText("");
    } catch {
      setError("Unable to send the message.");
    }
  }

  return (
    <Section title="Message above the clock">
      {active !== null ? (
        <div className="actions actions-spread">
          <span className="list-row-detail">
            Showing until {new Date(active.expiresAt).toLocaleString()}
          </span>
          <button className="text-button" onClick={() => clear({ accountNumber })}>
            Remove
          </button>
        </div>
      ) : (
        <form className="panel" onSubmit={submit}>
          <textarea
            className="input"
            placeholder="e.g. If found, please call 07700 900000"
            maxLength={280}
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="actions">
            <select
              className="input input-auto"
              aria-label="Show for"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
            >
              {DURATIONS.map((duration) => (
                <option key={duration.minutes} value={duration.minutes}>
                  For {duration.label}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" type="submit" disabled={text.trim() === ""}>
              Show
            </button>
          </div>
          {error !== null && <p className="form-error">{error}</p>}
        </form>
      )}
    </Section>
  );
}

function useIntegrations(accountNumber: string) {
  return useQuery(api.integrations.list, { accountNumber });
}

type Integration = NonNullable<ReturnType<typeof useIntegrations>>[number];

function cardDetail(integration: Integration) {
  if (integration.lastError) return `Last update failed: ${integration.lastError}`;
  return isShowing(integration.card) ? integration.card.fallback : "Nothing to show right now";
}

function CardSettings({
  accountNumber,
  integration,
  isFirst,
  isLast,
}: {
  accountNumber: string;
  integration: Integration;
  isFirst: boolean;
  isLast: boolean;
}) {
  const update = useMutation(api.integrations.update);
  const move = useMutation(api.integrations.move);
  const remove = useMutation(api.integrations.remove);
  const rotateToken = useAction(api.integrations.rotateToken);
  const [error, setError] = useState<string | null>(null);
  const id = integration.integrationId as Id<"integrations">;
  const settings = integration.settings as Record<string, unknown>;

  async function run(task: () => Promise<unknown>, failure: string) {
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(errorMessage(caught, failure));
    }
  }

  return (
    <>
      {integration.kind === "weather" && (
        <div className="field-row">
          <span className="field-label">Units</span>
          <select
            className="input"
            value={settings.units as Units}
            onChange={(event) =>
              run(
                () =>
                  update({
                    accountNumber,
                    integrationId: id,
                    settings: { units: event.target.value },
                  }),
                "Unable to change the units.",
              )
            }
          >
            <option value="celsius">Celsius</option>
            <option value="fahrenheit">Fahrenheit</option>
          </select>
        </div>
      )}

      {integration.kind === "habitica" && (
        <>
          <div className="field-row">
            <span className="field-label">Shows</span>
            <select
              className="input"
              value={settings.show as HabiticaShow}
              onChange={(event) =>
                run(
                  () =>
                    update({
                      accountNumber,
                      integrationId: id,
                      settings: { show: event.target.value },
                    }),
                  "Unable to change what it shows.",
                )
              }
            >
              {HABITICA_VIEWS.map((view) => (
                <option key={view.value} value={view.value}>
                  {view.label}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">
            Long-press a task on the lock screen to complete it, and again to undo.{" "}
            <button className="text-button" onClick={() => navigate("/connections/habitica")}>
              Manage tasks and reminders
            </button>
          </p>
        </>
      )}

      {integration.kind === "webhook" && integration.webhookToken !== undefined && (
        <>
          <div className="field-row">
            <input
              className="input input-mono"
              readOnly
              aria-label="Webhook address"
              value={webhookUrl(integration.webhookToken)}
              onFocus={(event) => event.target.select()}
            />
            <button
              className="btn"
              onClick={() => navigator.clipboard.writeText(webhookUrl(integration.webhookToken!))}
            >
              Copy
            </button>
          </div>
          <p className="hint">
            POST text to show it for an hour, or JSON such as{" "}
            <code>{'{"text": "…", "minutes": 120}'}</code> or{" "}
            <code>{'{"title": "…", "lines": ["…", "…"]}'}</code>. DELETE clears it. Keep the address
            private: anyone with it can change what this card shows.
          </p>
          <pre className="code-block">{`curl -d "Bins out tonight" ${webhookUrl(integration.webhookToken)}`}</pre>
        </>
      )}

      <div className="actions actions-spread">
        <div className="actions">
          <button
            className="btn btn-small"
            disabled={isFirst}
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
            className="btn btn-small"
            disabled={isLast}
            onClick={() =>
              run(
                () => move({ accountNumber, integrationId: id, direction: "down" }),
                "Unable to move.",
              )
            }
          >
            Move down
          </button>
          {integration.kind === "webhook" && (
            <button
              className="btn btn-small"
              onClick={() =>
                run(
                  () => rotateToken({ accountNumber, integrationId: id }),
                  "Unable to change the address.",
                )
              }
            >
              New address
            </button>
          )}
        </div>
        <button
          className="text-button"
          onClick={() =>
            run(() => remove({ accountNumber, integrationId: id }), "Unable to remove the card.")
          }
        >
          Remove card
        </button>
      </div>
      {error !== null && <p className="form-error">{error}</p>}
    </>
  );
}

function AddCard({ accountNumber, onDone }: { accountNumber: string; onDone: () => void }) {
  const add = useAction(api.integrations.add);
  const searchPlaces = useAction(api.integrations.searchPlaces);
  const connections = useQuery(api.connections.list, { accountNumber });
  const [choice, setChoice] = useState<"weather" | "webhook" | null>(null);
  const [search, setSearch] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [units, setUnits] = useState<Units>("celsius");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const habitica = connections?.find((connection) => connection.provider === "habitica");

  async function run(task: () => Promise<unknown>, failure: string) {
    setError(null);
    try {
      await task();
      onDone();
    } catch (caught) {
      setError(errorMessage(caught, failure));
    }
  }

  const choiceButton = (value: "weather" | "webhook", label: string) => (
    <button
      className={choice === value ? "btn btn-small btn-primary" : "btn btn-small"}
      onClick={() => setChoice(choice === value ? null : value)}
    >
      {label}
    </button>
  );

  return (
    <div className="panel add-card">
      <div className="add-group">
        <span className="add-group-label">Card</span>
        {choiceButton("weather", "Weather")}
        {choiceButton("webhook", "Webhook")}
      </div>
      {habitica && (
        <div className="add-group">
          <span className="add-group-label">Habitica</span>
          {HABITICA_VIEWS.map((view) => (
            <button
              key={view.value}
              className="btn btn-small"
              onClick={() =>
                run(
                  () =>
                    add({
                      accountNumber,
                      kind: "habitica",
                      settings: { show: view.value },
                      connectionId: habitica.connectionId as Id<"connections">,
                    }),
                  "Unable to add the card.",
                )
              }
            >
              {view.label}
            </button>
          ))}
        </div>
      )}
      {connections !== undefined && !habitica && (
        <p className="hint">
          Habitica cards appear here once you{" "}
          <button className="text-button" onClick={() => navigate("/connections")}>
            connect Habitica
          </button>
          .
        </p>
      )}

      {choice === "weather" && (
        <>
          <form
            className="field-row"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);
              try {
                setPlaces(await searchPlaces({ accountNumber, query: search }));
              } catch {
                setError("Unable to search for places.");
              }
            }}
          >
            <input
              className="input"
              placeholder="Town or city"
              aria-label="Town or city"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoFocus
            />
            <select
              className="input input-auto"
              aria-label="Units"
              value={units}
              onChange={(event) => setUnits(event.target.value as Units)}
            >
              <option value="celsius">°C</option>
              <option value="fahrenheit">°F</option>
            </select>
            <button className="btn" type="submit" disabled={search.trim().length < 2}>
              Search
            </button>
          </form>
          {places !== null && places.length === 0 && <p className="hint">No places found.</p>}
          {places?.map((place) => (
            <ListRow
              key={`${place.latitude},${place.longitude}`}
              title={place.name}
              detail={place.detail}
              onClick={() =>
                run(
                  () =>
                    add({
                      accountNumber,
                      kind: "weather",
                      settings: {
                        place: place.name.slice(0, 30),
                        latitude: place.latitude,
                        longitude: place.longitude,
                        units,
                      },
                    }),
                  "Unable to add the weather.",
                )
              }
            />
          ))}
          <p className="hint">Updated every 30 minutes. Weather data by Open-Meteo.</p>
        </>
      )}

      {choice === "webhook" && (
        <>
          <form
            className="field-row"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () => add({ accountNumber, kind: "webhook", settings: { name } }),
                "Unable to add the webhook.",
              );
            }}
          >
            <input
              className="input"
              placeholder="Name, e.g. Home"
              aria-label="Name"
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            <button className="btn" type="submit" disabled={name.trim() === ""}>
              Create
            </button>
          </form>
          <p className="hint">
            A secret address that Home Assistant, a Shortcut or a script can send lines to.
          </p>
        </>
      )}
      {error !== null && <p className="form-error">{error}</p>}
    </div>
  );
}

export function LockScreenScreen({ accountNumber }: { accountNumber: string }) {
  const integrations = useIntegrations(accountNumber);
  const message = useQuery(api.lockscreenMessages.getCurrentForDevice, { accountNumber });
  const setNotify = useMutation(api.integrations.setNotify);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const activeMessage = message != null && message.expiresAt > Date.now() ? message.text : null;

  return (
    <Screen title="Lock Screen" backTo="/">
      <Page>
        <PhonePreview
          message={activeMessage}
          cards={(integrations ?? []).flatMap((integration) =>
            integration.card ? [integration.card as Card] : [],
          )}
        />

        <MessageSection accountNumber={accountNumber} />

        <Section
          title="Cards under the clock"
          action={
            (integrations?.length ?? 0) < MAX_CARDS && (
              <button className="text-button" onClick={() => setAdding(!adding)}>
                {adding ? "Close" : "Add card"}
              </button>
            )
          }
        >
          {adding && <AddCard accountNumber={accountNumber} onDone={() => setAdding(false)} />}
          {integrations == null ? (
            <Loading />
          ) : integrations.length === 0 ? (
            <p className="hint">No cards yet. Add weather, a webhook or Habitica.</p>
          ) : (
            integrations.map((integration, index) => (
              <ListRow
                key={integration.integrationId}
                title={integration.label}
                detail={cardDetail(integration)}
                open={open === integration.integrationId}
                onClick={() =>
                  setOpen(open === integration.integrationId ? null : integration.integrationId)
                }
                trailing={
                  (integration.kind === "habitica" || integration.kind === "webhook") && (
                    <span className="switch-label">
                      Notify
                      <Switch
                        label="Phone notifications"
                        checked={integration.notify}
                        onChange={(notify) =>
                          setNotify({
                            accountNumber,
                            integrationId: integration.integrationId as Id<"integrations">,
                            notify,
                          })
                        }
                      />
                    </span>
                  )
                }
              >
                <CardSettings
                  accountNumber={accountNumber}
                  integration={integration}
                  isFirst={index === 0}
                  isLast={index === integrations.length - 1}
                />
              </ListRow>
            ))
          )}
          <p className="hint">
            Luma shows one card at a time, in this order: the arrows step through a card and on to
            the next, and tapping its name skips ahead. The switch turns phone notifications, such
            as Habitica reminders, on or off for that card.
          </p>
        </Section>
      </Page>
    </Screen>
  );
}
