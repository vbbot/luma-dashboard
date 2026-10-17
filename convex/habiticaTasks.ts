// Habitica tasks on the dashboard: what the browser sees and what it can
// send (kinds/habitica.ts `operations`). Pure, so the conversions can be
// tested. Habitica's website cannot set reminders, only its phone apps; these
// write the same `reminders` field the apps do.
//
// Times are wall-clock in the user's Habitica timezone (preferences.
// timezoneOffset, minutes behind UTC): a daily reminder keeps only its time of
// day, a To-Do reminder is a date and time.

import type { HabiticaTask, HabiticaUser } from "./habiticaCards";
import { SettingsError } from "./kinds/types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MAX_REMINDERS = 5;

export type TaskType = "daily" | "todo" | "habit";

export const WEEKDAYS = ["m", "t", "w", "th", "f", "s", "su"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

// A daily's schedule, as the dashboard edits it. Habitica stores it as
// frequency, everyX, repeat (weekdays), daysOfMonth / weeksOfMonth and
// startDate, and works out isDue / nextDue from them itself.
export type DailySchedule = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  everyX: number;
  // Weekly: the days it is due on.
  days: Weekday[];
  // Monthly: on the start date's day of the month, or on its weekday in the
  // same week of the month (e.g. the 3rd Saturday).
  monthlyBy: "dayOfMonth" | "dayOfWeek";
  startDate: string;
};

// What the dashboard shows.
export type DashboardTask = {
  id: string;
  type: TaskType;
  text: string;
  notes: string;
  completed: boolean;
  isDue: boolean;
  dueDate: string | null;
  reminders: { time: string; date?: string }[];
  up: boolean;
  down: boolean;
  // Dailies only.
  schedule?: DailySchedule;
};

// What the dashboard sends for a reminder: dailies a time, To-Dos a date and
// a time.
export type ReminderInput = { time: string; date?: string };

function pad(value: number) {
  return String(value).padStart(2, "0");
}

// Wall-clock in the user's timezone, as if UTC, and back.
function local(instant: number, user: HabiticaUser) {
  return instant - user.timezoneOffset * MINUTE;
}

function fromLocal(wall: number, user: HabiticaUser) {
  return wall + user.timezoneOffset * MINUTE;
}

function wallParts(instant: number, user: HabiticaUser) {
  const wall = new Date(local(instant, user));
  return {
    date: `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`,
    time: `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`,
  };
}

function parseTime(time: unknown) {
  const match = typeof time === "string" ? TIME.exec(time) : null;
  if (match === null) throw new SettingsError("Times look like 07:30");
  return (Number(match[1]) * 60 + Number(match[2])) * MINUTE;
}

function parseDate(date: unknown) {
  const match = typeof date === "string" ? DATE.exec(date) : null;
  const at = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  if (Number.isNaN(at) || new Date(at).getUTCDate() !== Number(match![3])) {
    throw new SettingsError("Dates look like 2026-10-17");
  }
  return at;
}

// Habitica's weekday keys by JavaScript getUTCDay() (0 = Sunday).
const WEEKDAY_BY_INDEX: Weekday[] = ["su", "m", "t", "w", "th", "f", "s"];

function scheduleOf(task: HabiticaTask, user: HabiticaUser): DailySchedule {
  const frequency = (["daily", "weekly", "monthly", "yearly"] as const).includes(
    task.frequency as DailySchedule["frequency"],
  )
    ? (task.frequency as DailySchedule["frequency"])
    : "weekly";
  const start = task.startDate ? Date.parse(task.startDate) : NaN;
  return {
    frequency,
    everyX: typeof task.everyX === "number" && task.everyX > 0 ? task.everyX : 1,
    days: WEEKDAYS.filter((day) => task.repeat?.[day] !== false),
    monthlyBy: (task.weeksOfMonth?.length ?? 0) > 0 ? "dayOfWeek" : "dayOfMonth",
    startDate: Number.isNaN(start) ? wallParts(Date.now(), user).date : wallParts(start, user).date,
  };
}

// The schedule fields for Habitica, from the dashboard's DailySchedule.
export function habiticaSchedule(input: unknown, user: HabiticaUser) {
  const schedule = (input ?? {}) as Partial<DailySchedule>;
  const frequency = schedule.frequency;
  if (
    frequency !== "daily" &&
    frequency !== "weekly" &&
    frequency !== "monthly" &&
    frequency !== "yearly"
  ) {
    throw new SettingsError("Choose how often it repeats");
  }
  const everyX = schedule.everyX;
  if (typeof everyX !== "number" || !Number.isInteger(everyX) || everyX < 1 || everyX > 9999) {
    throw new SettingsError("Repeat every 1 to 9999");
  }
  const startDay = parseDate(schedule.startDate);
  const start = new Date(startDay);
  const repeat = Object.fromEntries(WEEKDAYS.map((day) => [day, true])) as Record<Weekday, boolean>;
  let daysOfMonth: number[] = [];
  let weeksOfMonth: number[] = [];
  if (frequency === "weekly") {
    const days = Array.isArray(schedule.days) ? schedule.days : [];
    if (!days.some((day) => (WEEKDAYS as readonly string[]).includes(day))) {
      throw new SettingsError("Choose at least one day of the week");
    }
    for (const day of WEEKDAYS) repeat[day] = days.includes(day);
  } else if (frequency === "monthly") {
    if (schedule.monthlyBy === "dayOfWeek") {
      // The start date's weekday in the same week of the month.
      weeksOfMonth = [Math.floor((start.getUTCDate() - 1) / 7)];
      for (const day of WEEKDAYS) repeat[day] = day === WEEKDAY_BY_INDEX[start.getUTCDay()];
    } else {
      daysOfMonth = [start.getUTCDate()];
    }
  }
  return {
    frequency,
    everyX,
    repeat,
    daysOfMonth,
    weeksOfMonth,
    startDate: new Date(fromLocal(startDay, user)).toISOString(),
  };
}

export function toDashboardTask(task: HabiticaTask, user: HabiticaUser): DashboardTask {
  return {
    ...(task.type === "daily" ? { schedule: scheduleOf(task, user) } : {}),
    id: task.id,
    type: task.type as TaskType,
    text: task.text,
    notes: task.notes ?? "",
    completed: task.completed === true,
    isDue: task.isDue === true,
    dueDate: task.date ? wallParts(Date.parse(task.date), user).date : null,
    reminders: (task.reminders ?? [])
      .map((reminder) => Date.parse(reminder.time))
      .filter((at) => !Number.isNaN(at))
      .map((at) => {
        const parts = wallParts(at, user);
        return task.type === "todo" ? parts : { time: parts.time };
      }),
    up: task.up !== false,
    down: task.down === true,
  };
}

// The dashboard's task list: dailies, open To-Dos and habits, in Habitica's
// order.
export function dashboardTasks(tasks: HabiticaTask[], user: HabiticaUser): DashboardTask[] {
  return tasks
    .filter(
      (task) =>
        task.type === "daily" || task.type === "habit" || (task.type === "todo" && !task.completed),
    )
    .map((task) => toDashboardTask(task, user));
}

// Reminders in Habitica's format. `newId` gives each one a UUID (Habitica
// requires them).
export function habiticaReminders(
  type: TaskType,
  input: unknown,
  user: HabiticaUser,
  now: number,
  newId: () => string,
) {
  if (type === "habit") throw new SettingsError("Habits cannot have reminders");
  if (!Array.isArray(input) || input.length > MAX_REMINDERS) {
    throw new SettingsError(`Up to ${MAX_REMINDERS} reminders`);
  }
  const startDate = new Date(now).toISOString();
  return input.map((reminder: ReminderInput) => {
    const timeOfDay = parseTime(reminder?.time);
    // Dailies: today at that time (Habitica keeps the time of day).
    const day =
      type === "daily" ? Math.floor(local(now, user) / DAY) * DAY : parseDate(reminder?.date);
    return {
      id: newId(),
      startDate,
      time: new Date(fromLocal(day + timeOfDay, user)).toISOString(),
    };
  });
}

// The body for POST /tasks/user.
export function newTaskBody(input: unknown, user: HabiticaUser, now: number, newId: () => string) {
  const body = (input ?? {}) as Record<string, unknown>;
  const type = body.type;
  if (type !== "daily" && type !== "todo" && type !== "habit") {
    throw new SettingsError("Choose a daily, a To-Do or a habit");
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text === "" || text.length > 250)
    throw new SettingsError("The task needs a name (up to 250 characters)");
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > 1000) throw new SettingsError("Notes can be up to 1000 characters");

  const task: Record<string, unknown> = { type, text };
  if (notes !== "") task.notes = notes;
  if (type === "todo" && typeof body.dueDate === "string" && body.dueDate !== "") {
    task.date = new Date(fromLocal(parseDate(body.dueDate), user)).toISOString();
  }
  if (type === "habit") {
    task.up = body.up !== false;
    task.down = body.down === true;
    if (!task.up && !task.down) throw new SettingsError("A habit needs + or − (or both)");
  } else if (body.reminders !== undefined) {
    task.reminders = habiticaReminders(type, body.reminders, user, now, newId);
  }
  if (type === "daily" && body.schedule !== undefined)
    Object.assign(task, habiticaSchedule(body.schedule, user));
  return task;
}

// The body for PUT /tasks/:id from the dashboard's task editor: only the
// fields sent. An empty dueDate clears the To-Do's due date. Reminders are
// handled separately (habiticaReminders), since they need ids.
export function taskChanges(type: TaskType, input: unknown, user: HabiticaUser) {
  const body = (input ?? {}) as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  if (body.text !== undefined) {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text === "" || text.length > 250)
      throw new SettingsError("The task needs a name (up to 250 characters)");
    changes.text = text;
  }
  if (body.notes !== undefined) {
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (notes.length > 1000) throw new SettingsError("Notes can be up to 1000 characters");
    changes.notes = notes;
  }
  if (body.dueDate !== undefined && type === "todo") {
    changes.date =
      body.dueDate === "" || body.dueDate === null
        ? null
        : new Date(fromLocal(parseDate(body.dueDate), user)).toISOString();
  }
  if (type === "daily" && body.schedule !== undefined) {
    Object.assign(changes, habiticaSchedule(body.schedule, user));
  }
  if (type === "habit" && (body.up !== undefined || body.down !== undefined)) {
    const up = body.up !== false;
    const down = body.down === true;
    if (!up && !down) throw new SettingsError("A habit needs + or − (or both)");
    Object.assign(changes, { up, down });
  }
  return changes;
}
