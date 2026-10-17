import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DailySchedule, DashboardTask, TaskType, Weekday } from "../../convex/habiticaTasks";
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

const DAY_LABELS: { day: Weekday; short: string; name: string }[] = [
  { day: "m", short: "M", name: "Mon" },
  { day: "t", short: "T", name: "Tue" },
  { day: "w", short: "W", name: "Wed" },
  { day: "th", short: "T", name: "Thu" },
  { day: "f", short: "F", name: "Fri" },
  { day: "s", short: "S", name: "Sat" },
  { day: "su", short: "S", name: "Sun" },
];

const UNIT: Record<DailySchedule["frequency"], string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

function ordinal(value: number) {
  const suffix = value === 1 ? "st" : value === 2 ? "nd" : value === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

function startParts(startDate: string) {
  const [year, month, day] = startDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return {
    day,
    week: Math.ceil(day / 7),
    weekday: date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }),
    dayMonth: date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
  };
}

// "Weekdays", "Every 2 weeks on Mon, Thu", "Monthly on the 3rd Saturday".
export function scheduleText(schedule: DailySchedule) {
  const every =
    schedule.everyX > 1 ? `Every ${schedule.everyX} ${UNIT[schedule.frequency]}s` : null;
  const start = startParts(schedule.startDate);
  switch (schedule.frequency) {
    case "daily":
      return every ?? "Every day";
    case "weekly": {
      const days = DAY_LABELS.filter((entry) => schedule.days.includes(entry.day));
      const named =
        days.length === 7
          ? "every day"
          : days.map((entry) => entry.day).join() === "m,t,w,th,f"
            ? "weekdays"
            : days.map((entry) => entry.day).join() === "s,su"
              ? "weekends"
              : days.map((entry) => entry.name).join(", ");
      return every ? `${every} on ${named}` : named.charAt(0).toUpperCase() + named.slice(1);
    }
    case "monthly": {
      const on =
        schedule.monthlyBy === "dayOfWeek"
          ? `the ${ordinal(start.week)} ${start.weekday}`
          : `day ${start.day}`;
      return `${every ?? "Monthly"} on ${on}`;
    }
    case "yearly":
      return `${every ?? "Yearly"} on ${start.dayMonth}`;
  }
}

function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: DailySchedule;
  onChange: (schedule: DailySchedule) => void;
}) {
  const start = startParts(schedule.startDate);
  const set = (changes: Partial<DailySchedule>) => onChange({ ...schedule, ...changes });
  return (
    <div className="field-stack">
      <span className="field-label">Repeats</span>
      <div className="actions">
        <select
          className="input input-auto"
          aria-label="Repeats"
          value={schedule.frequency}
          onChange={(event) => set({ frequency: event.target.value as DailySchedule["frequency"] })}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        <span className="hint">every</span>
        <input
          className="input input-number"
          inputMode="numeric"
          aria-label="Every"
          value={schedule.everyX}
          onChange={(event) => {
            const value = Number(event.target.value.replace(/\D/g, "").slice(0, 4));
            set({ everyX: value });
          }}
        />
        <span className="hint">
          {UNIT[schedule.frequency]}
          {schedule.everyX === 1 ? "" : "s"}
        </span>
      </div>
      {schedule.frequency === "weekly" && (
        <div className="day-picker" role="group" aria-label="Days of the week">
          {DAY_LABELS.map((entry) => {
            const on = schedule.days.includes(entry.day);
            return (
              <button
                key={entry.day}
                type="button"
                className={on ? "day day-on" : "day"}
                aria-pressed={on}
                aria-label={entry.name}
                title={entry.name}
                onClick={() =>
                  set({
                    days: on
                      ? schedule.days.filter((day) => day !== entry.day)
                      : DAY_LABELS.map((item) => item.day).filter(
                          (day) => day === entry.day || schedule.days.includes(day),
                        ),
                  })
                }
              >
                {entry.short}
              </button>
            );
          })}
        </div>
      )}
      {schedule.frequency === "monthly" && (
        <select
          className="input"
          aria-label="Repeats on"
          value={schedule.monthlyBy}
          onChange={(event) => set({ monthlyBy: event.target.value as DailySchedule["monthlyBy"] })}
        >
          <option value="dayOfMonth">On day {start.day} of the month</option>
          <option value="dayOfWeek">
            On the {ordinal(start.week)} {start.weekday} of the month
          </option>
        </select>
      )}
      {schedule.frequency === "monthly" &&
        schedule.monthlyBy === "dayOfWeek" &&
        start.week === 5 && (
          <p className="hint">
            Not every month has a 5th {start.weekday}; Habitica skips those months.
          </p>
        )}
      <div className="field-row">
        <span className="field-label">Starts</span>
        <input
          className="input"
          type="date"
          aria-label="Start date"
          value={schedule.startDate}
          onChange={(event) => event.target.value && set({ startDate: event.target.value })}
        />
      </div>
    </div>
  );
}

function taskDetail(task: DashboardTask) {
  const parts: string[] = [];
  if (task.type === "daily") {
    parts.push(task.completed ? "Done today" : task.isDue ? "Due today" : "Not due today");
    if (task.schedule) parts.push(scheduleText(task.schedule));
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
  const [schedule, setSchedule] = useState<DailySchedule | undefined>(task.schedule);
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
        ...(task.type === "daily" && schedule ? { schedule } : {}),
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
      {task.type === "daily" && schedule && (
        <ScheduleEditor schedule={schedule} onChange={setSchedule} />
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
