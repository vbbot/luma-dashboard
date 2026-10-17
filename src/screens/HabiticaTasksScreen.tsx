import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DashboardTask, TaskType } from "../../convex/habiticaTasks";
import { Loading, Screen } from "../ui";

// Habitica tasks for one integration: browse dailies, To-Dos and habits, add
// new ones, and set reminder times (Habitica's website cannot; these become
// phone notifications through Luma). Runs the kind's operations
// (convex/kinds/habitica.ts) through integrations:operate.

type Reminder = { time: string; date?: string };

const TYPES: { value: TaskType; label: string }[] = [
  { value: "daily", label: "Dailies" },
  { value: "todo", label: "To-Dos" },
  { value: "habit", label: "Habits" },
];

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function summary(task: DashboardTask) {
  const parts: string[] = [];
  if (task.type === "daily")
    parts.push(task.completed ? "Done today" : task.isDue ? "Due today" : "Not due today");
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

function ReminderEditor({
  type,
  reminders,
  onChange,
}: {
  type: TaskType;
  reminders: Reminder[];
  onChange: (reminders: Reminder[]) => void;
}) {
  return (
    <div className="form">
      {reminders.map((reminder, index) => (
        <div className="field-group" key={index}>
          {type === "todo" && (
            <input
              className="field field-small"
              type="date"
              aria-label="Reminder date"
              value={reminder.date ?? ""}
              onChange={(event) =>
                onChange(
                  reminders.map((r, i) => (i === index ? { ...r, date: event.target.value } : r)),
                )
              }
            />
          )}
          <input
            className="field field-small"
            type="time"
            aria-label="Reminder time"
            value={reminder.time}
            onChange={(event) =>
              onChange(
                reminders.map((r, i) => (i === index ? { ...r, time: event.target.value } : r)),
              )
            }
          />
          <button
            className="field-button"
            type="button"
            aria-label="Remove reminder"
            onClick={() => onChange(reminders.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </div>
      ))}
      {reminders.length < 5 && (
        <button
          className="button button-secondary"
          type="button"
          onClick={() =>
            onChange([
              ...reminders,
              type === "todo" ? { date: today(), time: "09:00" } : { time: "09:00" },
            ])
          }
        >
          Add reminder
        </button>
      )}
    </div>
  );
}

function AddTask({
  type,
  onAdd,
}: {
  type: TaskType;
  onAdd: (args: Record<string, unknown>) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [up, setUp] = useState(true);
  const [down, setDown] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onAdd({
        type,
        text,
        notes,
        ...(type === "todo" ? { dueDate } : {}),
        ...(type === "habit" ? { up, down } : { reminders }),
      });
      setText("");
      setNotes("");
      setDueDate("");
      setReminders([]);
    } catch {
      // The screen shows the error; keep what was typed.
    } finally {
      setBusy(false);
    }
  }

  const noun = type === "daily" ? "daily" : type === "todo" ? "To-Do" : "habit";
  return (
    <form className="form" onSubmit={submit}>
      <input
        className="field field-small"
        placeholder={`New ${noun}`}
        aria-label={`New ${noun}`}
        maxLength={250}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <input
        className="field field-small"
        placeholder="Notes (optional)"
        aria-label="Notes"
        maxLength={1000}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      {type === "todo" && (
        <input
          className="field field-small"
          type="date"
          aria-label="Due date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
      )}
      {type === "habit" ? (
        <div className="button-row">
          <button
            className={up ? "button" : "button button-secondary"}
            type="button"
            onClick={() => setUp(!up)}
          >
            + Positive
          </button>
          <button
            className={down ? "button" : "button button-secondary"}
            type="button"
            onClick={() => setDown(!down)}
          >
            − Negative
          </button>
        </div>
      ) : (
        <ReminderEditor type={type} reminders={reminders} onChange={setReminders} />
      )}
      <button className="button" type="submit" disabled={busy || text.trim() === ""}>
        {busy ? "Adding…" : `Add ${noun}`}
      </button>
    </form>
  );
}

export function HabiticaTasksScreen({
  accountNumber,
  integrationId,
}: {
  accountNumber: string;
  integrationId: string;
}) {
  const operate = useAction(api.integrations.operate);
  const id = integrationId as Id<"integrations">;
  const [type, setType] = useState<TaskType>("daily");
  const [tasks, setTasks] = useState<DashboardTask[] | null>(null);
  const [editing, setEditing] = useState<{ taskId: string; reminders: Reminder[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const call = useCallback(
    (operation: string, args: unknown = null) =>
      operate({ accountNumber, integrationId: id, operation, args }),
    [operate, accountNumber, id],
  );

  // The server error text after "Uncaught Error: ", which is meant for people.
  const message = (caught: unknown, fallback: string) => {
    const text = caught instanceof Error ? caught.message : "";
    return /Uncaught Error: ([^\n]+)/.exec(text)?.[1] ?? fallback;
  };

  const load = useCallback(async () => {
    try {
      setTasks((await call("listTasks")) as DashboardTask[]);
    } catch (caught) {
      setError(message(caught, "Unable to load your Habitica tasks."));
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTask(args: Record<string, unknown>) {
    setError(null);
    setNotice(null);
    try {
      await call("addTask", args);
      setNotice("Added to Habitica.");
      setAdding(false);
      await load();
    } catch (caught) {
      setError(message(caught, "Unable to add the task."));
      throw caught;
    }
  }

  async function saveReminders() {
    if (editing === null) return;
    setError(null);
    setNotice(null);
    try {
      await call("setReminders", editing);
      setEditing(null);
      setNotice("Reminders saved to Habitica.");
      await load();
    } catch (caught) {
      setError(message(caught, "Unable to save the reminders."));
    }
  }

  const shown = tasks?.filter((task) => task.type === type) ?? [];

  return (
    <Screen title="Tasks" backTo={`/lockscreen/i/${integrationId}`}>
      <div className="form habitica-tasks">
        <select
          className="field"
          aria-label="Show"
          value={type}
          onChange={(event) => {
            setType(event.target.value as TaskType);
            setEditing(null);
            setAdding(false);
          }}
        >
          {TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {adding ? (
          <AddTask key={type} type={type} onAdd={addTask} />
        ) : (
          <button className="button button-secondary" onClick={() => setAdding(true)}>
            Add {type === "daily" ? "a daily" : type === "todo" ? "a To-Do" : "a habit"}
          </button>
        )}

        {notice !== null && <p className="muted">{notice}</p>}
        {error !== null && <p className="error">{error}</p>}

        {tasks === null ? (
          <Loading />
        ) : shown.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          shown.map((task) => (
            <div key={task.id} className="habitica-task">
              <button
                className="habitica-task-row"
                disabled={task.type === "habit"}
                onClick={() =>
                  setEditing(
                    editing?.taskId === task.id
                      ? null
                      : { taskId: task.id, reminders: task.reminders },
                  )
                }
              >
                <span className="habitica-task-name">{task.text}</span>
                <span className="muted">{summary(task)}</span>
              </button>
              {editing?.taskId === task.id && (
                <div className="form">
                  <ReminderEditor
                    type={task.type}
                    reminders={editing.reminders}
                    onChange={(reminders) => setEditing({ taskId: task.id, reminders })}
                  />
                  <button className="button" onClick={saveReminders}>
                    Save reminders
                  </button>
                </div>
              )}
            </div>
          ))
        )}
        <p className="muted">
          Tap a daily or To-Do to set its reminders. They are saved to Habitica, and Luma notifies
          you at those times while the task is still open.
        </p>
      </div>
    </Screen>
  );
}
