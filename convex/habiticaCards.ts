// Habitica (https://habitica.com) lock screen cards. The API calls and the
// pure task -> card logic live here; integrations.ts stores credentials,
// schedules refreshes and runs actions.
//
// Time handling follows Habitica's own day: it starts at the user's
// preferences.dayStart hour in their timezone (preferences.timezoneOffset,
// minutes behind UTC like JavaScript's getTimezoneOffset). Dailies carry
// isDue for the current Habitica day.

import type { Block, CardContent, CardNotification, Page } from "./cards";

declare const process: { env: Record<string, string | undefined> };

export type HabiticaShow = "dailies" | "todos" | "habits" | "stats";

// Overridable only by whoever runs the deployment (for tests against a fake
// server); never from user input.
function apiBase() {
  return process.env.HABITICA_API_URL ?? "https://habitica.com/api/v3";
}

export type HabiticaReminder = { id: string; time: string };

export type HabiticaTask = {
  id: string;
  type: "habit" | "daily" | "todo" | "reward";
  text: string;
  notes?: string;
  completed?: boolean;
  isDue?: boolean;
  date?: string | null;
  // Dailies: the next dates it is due (ISO), from Habitica.
  nextDue?: string[];
  up?: boolean;
  down?: boolean;
  counterUp?: number;
  reminders?: HabiticaReminder[];
  checklist?: { completed: boolean }[];
};

export type HabiticaUser = {
  dayStart: number;
  timezoneOffset: number;
  stats: {
    hp: number;
    maxHealth: number;
    lvl: number;
    gp: number;
    exp: number;
    toNextLevel: number;
  };
};

export class HabiticaError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function habiticaRequest<T>(
  userId: string,
  apiToken: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      "x-api-user": userId,
      "x-api-key": apiToken,
      // Habitica asks third-party tools to identify themselves this way.
      "x-client": `${userId}-LumaDashboard`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: T;
    message?: string;
  } | null;
  if (!response.ok || json?.success === false) {
    const reason =
      response.status === 401
        ? "Habitica rejected the User ID or API Token"
        : response.status === 429
          ? "Habitica rate limit reached"
          : (json?.message ?? `HTTP ${response.status}`);
    throw new HabiticaError(`Habitica: ${reason}`, response.status);
  }
  return json?.data as T;
}

export async function fetchHabitica(userId: string, apiToken: string) {
  // allSettled: if one request fails, the other still finishes before we throw.
  const [userResult, tasksResult] = await Promise.allSettled([
    habiticaRequest<{
      preferences?: { dayStart?: number; timezoneOffset?: number };
      stats?: Partial<HabiticaUser["stats"]>;
    }>(
      userId,
      apiToken,
      "GET",
      "/user?userFields=preferences.dayStart,preferences.timezoneOffset,stats",
    ),
    habiticaRequest<HabiticaTask[]>(userId, apiToken, "GET", "/tasks/user"),
  ]);
  if (userResult.status === "rejected") throw userResult.reason;
  if (tasksResult.status === "rejected") throw tasksResult.reason;
  const user = userResult.value;
  const tasks = tasksResult.value;
  const stats = user.stats ?? {};
  return {
    user: {
      dayStart: user.preferences?.dayStart ?? 0,
      timezoneOffset: user.preferences?.timezoneOffset ?? 0,
      stats: {
        hp: stats.hp ?? 0,
        maxHealth: stats.maxHealth ?? 50,
        lvl: stats.lvl ?? 1,
        gp: stats.gp ?? 0,
        exp: stats.exp ?? 0,
        toNextLevel: stats.toNextLevel ?? 0,
      },
    } satisfies HabiticaUser,
    tasks: tasks.filter((task) => typeof task.id === "string" && typeof task.text === "string"),
  };
}

// --- Time -------------------------------------------------------------------

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Wall-clock time in the user's timezone, as if it were UTC.
function local(now: number, user: HabiticaUser) {
  return now - user.timezoneOffset * MINUTE;
}

function fromLocal(localTime: number, user: HabiticaUser) {
  return localTime + user.timezoneOffset * MINUTE;
}

// When the current Habitica day ends (the next dayStart), as an instant.
export function nextDayStart(now: number, user: HabiticaUser) {
  const wall = local(now, user);
  let start = Math.floor(wall / DAY) * DAY + user.dayStart * 60 * MINUTE;
  if (start <= wall) start += DAY;
  return fromLocal(start, user);
}

// Today's occurrence of a daily's reminder: Habitica keeps the time of day of
// the stored instant, in the user's timezone.
function reminderToday(reminder: HabiticaReminder, now: number, user: HabiticaUser) {
  const at = Date.parse(reminder.time);
  if (Number.isNaN(at)) return null;
  const timeOfDay = ((local(at, user) % DAY) + DAY) % DAY;
  return fromLocal(Math.floor(local(now, user) / DAY) * DAY + timeOfDay, user);
}

function localDay(instant: number, user: HabiticaUser) {
  return Math.floor(local(instant, user) / DAY);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dueText(date: string, now: number, user: HabiticaUser) {
  const due = Date.parse(date);
  if (Number.isNaN(due)) return null;
  const days = localDay(due, user) - localDay(now, user);
  if (days < 0) return "Overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  const wall = new Date(local(due, user));
  return `Due ${WEEKDAYS[wall.getUTCDay()]} ${wall.getUTCDate()} ${MONTHS[wall.getUTCMonth()]}`;
}

// --- Notifications ----------------------------------------------------------

const NOTIFY_HORIZON = 48 * 60 * MINUTE;
// A reminder stays listed this long after its time, so a phone checking at
// fire time (checkFirst) still finds it while the task is open.
const NOTIFY_GRACE = 10 * MINUTE;

// Reminders for the phone to schedule (Luma fires them itself, offline too).
// Dailies: today's occurrences of tasks still due and not done, and
// tomorrow's for dailies due tomorrow, so an early reminder still fires if
// the phone sleeps through the day reset. To-Dos: their dated reminders.
// Only open tasks get reminders, so with checkFirst the phone notifies only if
// the task is still open when the time comes.
export function reminderNotifications(
  tasks: HabiticaTask[],
  user: HabiticaUser,
  now: number,
): CardNotification[] {
  const today = localDay(now, user);
  const notifications: CardNotification[] = [];
  for (const task of tasks) {
    if (task.completed || !task.reminders?.length) continue;
    if (task.type === "daily") {
      const dueDays = new Set<number>();
      if (task.isDue) dueDays.add(today);
      for (const date of task.nextDue ?? []) {
        const at = Date.parse(date);
        if (!Number.isNaN(at) && localDay(at, user) === today + 1) dueDays.add(today + 1);
      }
      for (const [index, reminder] of task.reminders.entries()) {
        const todayAt = reminderToday(reminder, now, user);
        if (todayAt === null) continue;
        for (const day of dueDays) {
          const at = todayAt + (day - today) * DAY;
          if (at > now - NOTIFY_GRACE && at <= now + NOTIFY_HORIZON) {
            notifications.push({
              // Card ids are at most 64 characters: task, day and position.
              id: `${task.id}:${day}:${index}`,
              at,
              title: title(task.text),
              text: "Habitica daily",
              pageId: task.id,
              until: nextDayStart(at, user),
              checkFirst: true,
            });
          }
        }
      }
    } else if (task.type === "todo") {
      for (const [index, reminder] of task.reminders.entries()) {
        const at = Date.parse(reminder.time);
        if (Number.isNaN(at) || at <= now - NOTIFY_GRACE || at > now + NOTIFY_HORIZON) continue;
        notifications.push({
          id: `${task.id}:${index}`,
          at,
          title: title(task.text),
          text: "Habitica to-do",
          pageId: task.id,
          checkFirst: true,
        });
      }
    }
  }
  return notifications.sort((a, b) => a.at - b.at).slice(0, 20);
}

// --- Cards ------------------------------------------------------------------

// How long a reminder keeps its task at the front and the card at the top.
const REMINDER_WINDOW = 60 * MINUTE;
const MAX_PAGES = 20;

export type HabiticaCard = {
  content: CardContent;
  expiresAt: number;
  // When the card should be rebuilt because time moved on (a reminder
  // starting or ending), even if nothing changed on Habitica.
  rebuildAt: number;
};

const complete = { id: "complete", label: "Complete", pendingText: "✓ Done", undo: true };

function checklistBlock(task: HabiticaTask): Block | null {
  const items = task.checklist ?? [];
  if (items.length === 0) return null;
  return {
    type: "progress",
    value: items.filter((item) => item.completed).length,
    max: Math.min(items.length, 1000),
    label: "Checklist",
  };
}

function notesBlock(task: HabiticaTask): Block | null {
  const firstLine = (task.notes ?? "").split("\n").find((line) => line.trim() !== "");
  return firstLine ? { type: "text", text: firstLine.slice(0, 60), role: "secondary" } : null;
}

function title(text: string) {
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function dailiesCard(tasks: HabiticaTask[], user: HabiticaUser, now: number): HabiticaCard {
  const dayEnd = nextDayStart(now, user);
  const due = tasks.filter((task) => task.type === "daily" && task.isDue);
  const left = due.filter((task) => !task.completed);
  if (left.length === 0) {
    const text = due.length === 0 ? "No dailies today" : "All dailies done ✓";
    return {
      content: {
        fallback: text,
        size: "compact",
        pages: [{ id: "done", blocks: [{ type: "text", text }] }],
      },
      expiresAt: dayEnd,
      rebuildAt: dayEnd,
    };
  }

  let rebuildAt = dayEnd;
  let start: string | undefined;
  let relevantUntil: number | undefined;
  const pages: Page[] = left.slice(0, MAX_PAGES).map((task) => {
    const reminders = (task.reminders ?? [])
      .map((reminder) => reminderToday(reminder, now, user))
      .filter((at): at is number => at !== null)
      .sort((a, b) => a - b);
    for (const at of reminders) {
      if (at > now) rebuildAt = Math.min(rebuildAt, at);
      if (at + REMINDER_WINDOW > now) rebuildAt = Math.min(rebuildAt, at + REMINDER_WINDOW);
      // The task whose reminder went off most recently comes first.
      if (
        at <= now &&
        now < at + REMINDER_WINDOW &&
        (relevantUntil === undefined || at + REMINDER_WINDOW > relevantUntil)
      ) {
        start = task.id;
        relevantUntil = at + REMINDER_WINDOW;
      }
    }
    const upcoming = reminders.find((at) => at > now - REMINDER_WINDOW);
    const second: Block | null =
      upcoming !== undefined
        ? { type: "time", at: upcoming, format: "clock", prefix: "Reminder" }
        : (checklistBlock(task) ?? notesBlock(task));
    return {
      id: task.id,
      blocks: second
        ? [{ type: "text", text: title(task.text) }, second]
        : [{ type: "text", text: title(task.text) }],
      primary: complete,
    };
  });

  return {
    content: {
      title: "Dailies",
      fallback: `${left.length} ${left.length === 1 ? "daily" : "dailies"} left`,
      size: "regular",
      relevance: relevantUntil !== undefined ? "high" : undefined,
      relevantUntil,
      paging: { start, resetOnWake: true, total: left.length },
      pages,
    },
    expiresAt: dayEnd,
    rebuildAt,
  };
}

function todosCard(tasks: HabiticaTask[], user: HabiticaUser, now: number): HabiticaCard {
  const today = localDay(now, user);
  const rank = (task: HabiticaTask) => {
    const due = task.date ? Date.parse(task.date) : NaN;
    if (Number.isNaN(due)) return 2;
    return localDay(due, user) <= today ? 0 : 1;
  };
  // Overdue and due today first, then dated, then the rest; Habitica's own
  // order within each group.
  const open = tasks
    .filter((task) => task.type === "todo" && !task.completed)
    .map((task, index) => ({ task, index }))
    .sort((a, b) => rank(a.task) - rank(b.task) || a.index - b.index)
    .map(({ task }) => task);
  const dayEnd = nextDayStart(now, user);
  if (open.length === 0) {
    return {
      content: {
        fallback: "No to-dos",
        size: "compact",
        pages: [{ id: "none", blocks: [{ type: "text", text: "No to-dos" }] }],
      },
      expiresAt: dayEnd,
      rebuildAt: dayEnd,
    };
  }
  const urgent = open.filter((task) => rank(task) === 0).length;
  return {
    content: {
      title: "To-Dos",
      fallback:
        urgent > 0
          ? `${urgent} to-do${urgent === 1 ? "" : "s"} due`
          : `${open.length} to-do${open.length === 1 ? "" : "s"}`,
      size: "regular",
      paging: { resetOnWake: true, total: open.length },
      pages: open.slice(0, MAX_PAGES).map((task) => {
        const due = task.date ? dueText(task.date, now, user) : null;
        const second: Block | null = due
          ? { type: "text", text: due, role: "secondary" }
          : (checklistBlock(task) ?? notesBlock(task));
        return {
          id: task.id,
          blocks: second
            ? [{ type: "text", text: title(task.text) }, second]
            : [{ type: "text", text: title(task.text) }],
          primary: complete,
        };
      }),
    },
    // "Due today" becomes "Overdue" at midnight, not at Habitica's day start.
    expiresAt: dayEnd,
    rebuildAt: Math.min(dayEnd, fromLocal((today + 1) * DAY, user)),
  };
}

function habitsCard(tasks: HabiticaTask[], user: HabiticaUser, now: number): HabiticaCard {
  const habits = tasks.filter((task) => task.type === "habit" && task.up !== false);
  const dayEnd = nextDayStart(now, user);
  if (habits.length === 0) {
    return {
      content: {
        fallback: "No habits",
        size: "compact",
        pages: [{ id: "none", blocks: [{ type: "text", text: "No habits" }] }],
      },
      expiresAt: dayEnd,
      rebuildAt: dayEnd,
    };
  }
  return {
    content: {
      title: "Habits",
      fallback: `${habits.length} habit${habits.length === 1 ? "" : "s"}`,
      size: "regular",
      paging: { resetOnWake: false, total: habits.length },
      pages: habits.slice(0, MAX_PAGES).map((task) => ({
        id: task.id,
        blocks: [
          { type: "text", text: title(task.text) },
          { type: "text", text: `+${task.counterUp ?? 0} today`, role: "secondary" },
        ],
        // Scoring a habit down is a separate (negative) habit, not an undo.
        primary: { id: "plus", label: "+1", pendingText: "+1" },
      })),
    },
    expiresAt: dayEnd,
    rebuildAt: dayEnd,
  };
}

function statsCard(user: HabiticaUser, now: number): HabiticaCard {
  const { hp, maxHealth, lvl, gp } = user.stats;
  const text = `HP ${Math.ceil(hp)}/${maxHealth} · Lv ${lvl} · ${Math.floor(gp)} gold`;
  const low = hp < maxHealth * 0.3;
  return {
    content: {
      fallback: text,
      size: "compact",
      // Low health is worth seeing first.
      relevance: low ? "high" : undefined,
      relevantUntil: low ? nextDayStart(now, user) : undefined,
      pages: [{ id: "stats", blocks: [{ type: "text", text }] }],
    },
    expiresAt: nextDayStart(now, user),
    rebuildAt: nextDayStart(now, user),
  };
}

export function buildHabiticaCard(
  show: HabiticaShow,
  tasks: HabiticaTask[],
  user: HabiticaUser,
  now: number,
): HabiticaCard {
  const card = buildCard(show, tasks, user, now);
  // Tapping a reminder opens its task, if today's card has it (tomorrow's
  // reminders may be for tasks not on it yet).
  const pageIds = new Set(card.content.pages.map((page) => page.id));
  const wanted = show === "dailies" ? "Habitica daily" : show === "todos" ? "Habitica to-do" : null;
  if (wanted !== null) {
    const notifications = reminderNotifications(tasks, user, now)
      .filter((item) => item.text === wanted)
      .map((item) =>
        item.pageId && pageIds.has(item.pageId) ? item : { ...item, pageId: undefined },
      );
    if (notifications.length > 0) card.content.notifications = notifications;
  }
  return card;
}

function buildCard(
  show: HabiticaShow,
  tasks: HabiticaTask[],
  user: HabiticaUser,
  now: number,
): HabiticaCard {
  switch (show) {
    case "dailies":
      return dailiesCard(tasks, user, now);
    case "todos":
      return todosCard(tasks, user, now);
    case "habits":
      return habitsCard(tasks, user, now);
    case "stats":
      return statsCard(user, now);
  }
}

// What a lock screen action does on Habitica: score up, or down to undo.
export function scoreDirection(actionId: string, undo: boolean): "up" | "down" | null {
  if (actionId === "complete") return undo ? "down" : "up";
  if (actionId === "plus" && !undo) return "up";
  return null;
}
