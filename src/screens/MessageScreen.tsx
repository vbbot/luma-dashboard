import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Loading, Screen } from "../ui";

const DURATIONS = [
  { minutes: 60, label: "1 hour" },
  { minutes: 60 * 24, label: "1 day" },
  { minutes: 60 * 24 * 7, label: "1 week" },
];

// Shows a message on the phone's lock screen, e.g. contact details in case
// the phone is lost.
export function MessageScreen({ accountNumber }: { accountNumber: string }) {
  const current = useQuery(api.lockscreenMessages.getCurrentForDevice, { accountNumber });
  const send = useMutation(api.lockscreenMessages.send);
  const clear = useMutation(api.lockscreenMessages.clear);
  const [text, setText] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(DURATIONS[1].minutes);
  const [error, setError] = useState<string | null>(null);
  // Re-read on every render; the query result itself never changes on expiry.
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
    <Screen title="Message" backTo="/lockscreen" centered>
      {current === undefined ? (
        <Loading />
      ) : (
        <div className="form">
          {active !== null && (
            <>
              <p className="message-preview">{active.text}</p>
              <p className="muted">
                Showing until {new Date(active.expiresAt).toLocaleString()}
              </p>
              <button className="button button-secondary" onClick={() => clear({ accountNumber })}>
                Remove message
              </button>
            </>
          )}
          <form className="form" onSubmit={submit}>
            <textarea
              className="field field-textarea"
              placeholder="Message to show on the lock screen"
              maxLength={280}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <select
              className="field"
              aria-label="Show for"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
            >
              {DURATIONS.map((duration) => (
                <option key={duration.minutes} value={duration.minutes}>
                  Show for {duration.label}
                </option>
              ))}
            </select>
            <button className="button" type="submit" disabled={text.trim() === ""}>
              Send
            </button>
            {error !== null && <p className="error">{error}</p>}
          </form>
        </div>
      )}
    </Screen>
  );
}
