import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DashboardTask, TaskType } from "../../convex/habiticaTasks";
import { navigate } from "../router";
import {
  Chip,
  ListRow,
  Loading,
  Page,
  Screen,
  Section,
  Switch,
  Tabs,
  TimeInput,
  errorMessage,
  normalTime,
} from "../ui";

// Connections: accounts linked once and shared by every card that uses them.
// Habitica's page manages its tasks like a simple to-do app: tabs, quick
// add, and an editor (name, notes, due date, reminders) that opens in place.

type Reminder = { time: string; date?: string };

const TASK_TABS: { value: TaskType; label: string }[] = [
  { value: "daily", label: "Dailies" },
  { value: "todo", label: "To-Dos" },
  { value: "habit", label: "Habits" },
];

const NOUN: Record<TaskType, string> = { daily: "daily", todo: "To-Do", habit: "habit" };

function useHabitica(accountNumber: string) {
  const connections = useQuery(api.connections.list, { accountNumber });
  return connections === undefined
    ? undefined
    : (connections?.find((connection) => connection.provider === "habitica") ?? null);
}

function ConnectHabitica({ accountNumber }: { accountNumber: string }) {
  const connect = useAction(api.connections.connect);
  const [userId, setUserId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect({ accountNumber, provider: "habitica", settings: { userId, apiToken } });
    } catch (caught) {
      setError(errorMessage(caught, "Unable to connect to Habitica."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <p className="hint">
        In Habitica, open Settings → Site Data (API) and copy your User ID and API Token. The token
        is stored encrypted on this server and never sent to your phone.
      </p>
      <input
        className="input"
        placeholder="User ID"
        aria-label="User ID"
        autoComplete="off"
        value={userId}
        onChange={(event) => setUserId(event.target.value)}
      />
      <input
        className="input"
        type="password"
        placeholder="API Token"
        aria-label="API Token"
        autoComplete="off"
        value={apiToken}
        onChange={(event) => setApiToken(event.target.value)}
      />
      <div className="actions">
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy || userId.trim() === "" || apiToken.trim() === ""}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
      {error !== null && <p className="form-error">{error}</p>}
    </form>
  );
}

export function ConnectionsScreen({ accountNumber }: { accountNumber: string }) {
  const habitica = useHabitica(accountNumber);
  return (
    <Screen title="Connections" backTo="/">
      <Page>
        <Section title="Habitica">
          {habitica === undefined ? (
            <Loading />
          ) : habitica === null ? (
            <ConnectHabitica accountNumber={accountNumber} />
          ) : (
            <ListRow
              title="Habitica"
              detail="Connected · tasks, reminders and lock screen cards"
              onClick={() => navigate("/connections/habitica")}
            />
          )}
        </Section>
        <p className="hint">
          A connection is shared by every card that uses it: add Habitica cards (Dailies, To-Dos,
          Habits, Stats) under Lock Screen → Add card.
        </p>
      </Page>
    </Screen>
  );
}

function taskDetail(task: DashboardTask) {
  const parts: string[] = [];
  if (task.type === "daily") {
    parts.push(task.completed ? "Done today" : task.isDue ? "Due today" : "Not due today");
  }
  if (task.type === "todo" && task.dueDate) parts.push(`Due ${task.dueDate}`);
  if (task.type === "habit")
    parts.push([task.up && "+", task.down && "−"].filter(Boolean).join(" "));
  if (task.reminders.length > 0) {
    parts.push(
      `Reminder ${task.reminders.map((r) => (r.date ? `${r.date} ${r.time}` : r.time)).join(", ")}`,
    );
  }
  return parts.join(" · ");
}

function ReminderChips({
  type,
  reminders,
  onChange,
}: {
  type: TaskType;
  reminders: Reminder[];
  onChange: (reminders: Reminder[]) => void;
}) {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const normal = normalTime(time);
    if (normal === null) return setError("Type a time like 0730 or 07:30");
    if (type === "todo" && date === "") return setError("Choose a date for the reminder");
    setError(null);
    onChange([...reminders, type === "todo" ? { date, time: normal } : { time: normal }]);
    setTime("");
  }

  return (
    <div className="field-stack">
      <span className="field-label">Reminders</span>
      {reminders.length > 0 && (
        <div className="chips">
          {reminders.map((reminder, index) => (
            <Chip key={index} onRemove={() => onChange(reminders.filter((_, i) => i !== index))}>
              {reminder.date ? `${reminder.date} ${reminder.time}` : reminder.time}
            </Chip>
          ))}
        </div>
      )}
      {reminders.length < 5 && (
        <div className="actions">
          {type === "todo" && (
            <input
              className="input input-auto"
              type="date"
              aria-label="Reminder date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
          <TimeInput value={time} onChange={setTime} onEnter={add} label="Reminder time" />
          <button className="btn" type="button" onClick={add} disabled={time === ""}>
            Add
          </button>
        </div>
      )}
      {error !== null && <p className="form-error">{error}</p>}
    </div>
  );
}

function TaskEditor({
  task,
  onSave,
  onCancel,
}: {
  task: DashboardTask;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(task.text);
  const [notes, setNotes] = useState(task.notes);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [reminders, setReminders] = useState<Reminder[]>(task.reminders);
  const [up, setUp] = useState(task.up);
  const [down, setDown] = useState(task.down);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await onSave({
        text,
        notes,
        ...(task.type === "todo" ? { dueDate } : {}),
        ...(task.type === "habit" ? { up, down } : { reminders }),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        className="input"
        aria-label="Name"
        maxLength={250}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <textarea
        className="input"
        aria-label="Notes"
        placeholder="Notes"
        maxLength={1000}
        rows={2}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      {task.type === "todo" && (
        <div className="field-row">
          <span className="field-label">Due</span>
          <input
            className="input"
            type="date"
            aria-label="Due date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
      )}
      {task.type === "habit" ? (
        <>
          <div className="field-row field-row-spread">
            <span className="field-label">Positive (+)</span>
            <Switch label="Positive" checked={up} onChange={setUp} />
          </div>
          <div className="field-row field-row-spread">
            <span className="field-label">Negative (−)</span>
            <Switch label="Negative" checked={down} onChange={setDown} />
          </div>
        </>
      ) : (
        <ReminderChips type={task.type} reminders={reminders} onChange={setReminders} />
      )}
      <div className="actions">
        <button className="btn btn-primary" onClick={save} disabled={busy || text.trim() === ""}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

export function HabiticaScreen({ accountNumber }: { accountNumber: string }) {
  const habitica = useHabitica(accountNumber);
  const operate = useAction(api.connections.operate);
  const disconnect = useMutation(api.connections.disconnect);
  const [type, setType] = useState<TaskType>("daily");
  const [tasks, setTasks] = useState<DashboardTask[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connectionId = habitica?.connectionId as Id<"connections"> | undefined;

  const call = useCallback(
    (operation: string, args: unknown = null) =>
      operate({ accountNumber, connectionId: connectionId!, operation, args }),
    [operate, accountNumber, connectionId],
  );

  const load = useCallback(async () => {
    if (connectionId === undefined) return;
    try {
      setTasks((await call("listTasks")) as DashboardTask[]);
    } catch (caught) {
      setError(errorMessage(caught, "Unable to load your Habitica tasks."));
    }
  }, [call, connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (habitica === undefined) {
    return (
      <Screen title="Habitica" backTo="/connections">
        <Loading />
      </Screen>
    );
  }
  if (habitica === null) {
    return (
      <Screen title="Habitica" backTo="/connections">
        <Page>
          <Section title="Connect Habitica">
            <ConnectHabitica accountNumber={accountNumber} />
          </Section>
        </Page>
      </Screen>
    );
  }

  async function quickAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await call("addTask", { type, text: newText });
      setNewText("");
      await load();
    } catch (caught) {
      setError(errorMessage(caught, "Unable to add the task."));
    }
  }

  async function save(task: DashboardTask, changes: Record<string, unknown>) {
    setError(null);
    try {
      await call("updateTask", { taskId: task.id, ...changes });
      setOpen(null);
      await load();
    } catch (caught) {
      setError(errorMessage(caught, "Unable to save the task."));
    }
  }

  const shown = tasks?.filter((task) => task.type === type) ?? [];

  return (
    <Screen title="Habitica" backTo="/connections">
      <Page>
        <Section title="Tasks">
          <Tabs
            value={type}
            options={TASK_TABS}
            onChange={(value) => {
              setType(value);
              setOpen(null);
            }}
          />
          <form className="field-row quick-add" onSubmit={quickAdd}>
            <input
              className="input"
              placeholder={`Add a ${NOUN[type]}…`}
              aria-label={`Add a ${NOUN[type]}`}
              maxLength={250}
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
            />
            <button className="btn" type="submit" disabled={newText.trim() === ""}>
              Add
            </button>
          </form>
          {error !== null && <p className="form-error">{error}</p>}
          {tasks === null ? (
            <Loading />
          ) : shown.length === 0 ? (
            <p className="hint">
              No {TASK_TABS.find((tab) => tab.value === type)!.label.toLowerCase()} yet.
            </p>
          ) : (
            shown.map((task) => (
              <ListRow
                key={task.id}
                title={task.text}
                detail={taskDetail(task)}
                open={open === task.id}
                onClick={() => setOpen(open === task.id ? null : task.id)}
              >
                <TaskEditor
                  task={task}
                  onSave={(changes) => save(task, changes)}
                  onCancel={() => setOpen(null)}
                />
              </ListRow>
            ))
          )}
          <p className="hint">
            Tap a task to edit it. Reminders are saved to Habitica, and Luma notifies you at those
            times while the task is still open. Add a Habitica card under Lock Screen to see tasks
            on the phone.
          </p>
        </Section>

        <Section title="Connection">
          {confirmDisconnect ? (
            <div className="actions">
              <span className="hint">
                This also removes its Habitica cards from the lock screen.
              </span>
              <button
                className="btn btn-small"
                onClick={async () => {
                  await disconnect({ accountNumber, connectionId: connectionId! });
                  navigate("/connections");
                }}
              >
                Disconnect
              </button>
              <button className="text-button" onClick={() => setConfirmDisconnect(false)}>
                Keep
              </button>
            </div>
          ) : (
            <div className="actions actions-spread">
              <span className="list-row-detail">Connected to Habitica</span>
              <button className="text-button" onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </button>
            </div>
          )}
        </Section>
      </Page>
    </Screen>
  );
}
