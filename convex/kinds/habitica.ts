import {
  HabiticaError,
  type HabiticaShow,
  buildHabiticaCard,
  fetchHabitica,
  habiticaRequest,
  scoreDirection,
} from "../habiticaCards";
import { IntegrationError, SettingsError, defineKind } from "./types";

// Habitica dailies, To-Dos, habits or stats; long-press scores a task, and
// task reminders become phone notifications. Card logic: habiticaCards.ts.
//
// Habitica's own webhook (taskActivity, registered on add) calls
// /hooks/habitica/<token> when something changes there.

const REFRESH_MS = 15 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOWS: HabiticaShow[] = ["dailies", "todos", "habits", "stats"];

const LABELS: Record<HabiticaShow, string> = {
  dailies: "Habitica · Dailies",
  todos: "Habitica · To-Dos",
  habits: "Habitica · Habits",
  stats: "Habitica · Stats",
};

type HabiticaSettings = {
  userId: string;
  apiToken: string;
  show: HabiticaShow;
  webhookId?: string;
};

function show(value: unknown): HabiticaShow {
  if (!SHOWS.includes(value as HabiticaShow)) throw new SettingsError("Choose what to show");
  return value as HabiticaShow;
}

// Rejected credentials will not start working by retrying soon.
function failure(error: unknown) {
  if (error instanceof HabiticaError) {
    return new IntegrationError(error.message, { permanent: error.status === 401 });
  }
  return error;
}

export const habitica = defineKind<HabiticaSettings>({
  kind: "habitica",
  secret: ["apiToken"],
  editable: ["show"],
  allowActions: true,
  refreshMs: REFRESH_MS,

  parseSettings(value, previous) {
    const input = (value ?? {}) as Record<string, unknown>;
    if (previous) return { ...previous, show: show(input.show ?? previous.show) };
    const userId = typeof input.userId === "string" ? input.userId.trim() : "";
    const apiToken = typeof input.apiToken === "string" ? input.apiToken.trim() : "";
    if (!UUID.test(userId) || !UUID.test(apiToken)) {
      throw new SettingsError(
        "The User ID and API Token are both in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      );
    }
    return { userId, apiToken, show: show(input.show) };
  },

  label: ({ show }) => LABELS[show],

  inbound: {
    minIntervalMs: 5_000,
    // The body is not authenticated; the token says which integration it is.
    handle: () => ({ kind: "refresh" }),
  },

  async onAdd({ settings, hookUrl }) {
    // Check the credentials before storing anything.
    try {
      await fetchHabitica(settings.userId, settings.apiToken);
    } catch (error) {
      if (error instanceof HabiticaError && error.status === 401) {
        throw new SettingsError("Habitica rejected the User ID or API Token");
      }
      throw error;
    }
    if (hookUrl === null) return settings;
    try {
      const webhook = await habiticaRequest<{ id: string }>(
        settings.userId,
        settings.apiToken,
        "POST",
        "/user/webhook",
        {
          url: hookUrl,
          label: "Luma lock screen",
          type: "taskActivity",
          options: { created: true, updated: true, deleted: true, scored: true },
        },
      );
      return { ...settings, webhookId: webhook.id };
    } catch (error) {
      // Scheduled refreshes still keep the card current.
      console.warn("Could not register the Habitica webhook", String(error));
      return settings;
    }
  },

  async refresh({ settings, now }) {
    try {
      const { user, tasks } = await fetchHabitica(settings.userId, settings.apiToken);
      const card = buildHabiticaCard(settings.show, tasks, user, now);
      return {
        content: card.content,
        expiresAt: card.expiresAt,
        nextRunAt: Math.min(now + REFRESH_MS, card.rebuildAt),
      };
    } catch (error) {
      throw failure(error);
    }
  },

  async act({ settings, pageId, actionId, undo }) {
    const direction = scoreDirection(actionId, undo);
    if (direction === null || !UUID.test(pageId))
      throw new IntegrationError("Action not available");
    try {
      await habiticaRequest(
        settings.userId,
        settings.apiToken,
        "POST",
        `/tasks/${encodeURIComponent(pageId)}/score/${direction}`,
      );
    } catch (error) {
      throw failure(error);
    }
  },

  async onRemove({ settings }) {
    if (settings.webhookId === undefined) return;
    try {
      await habiticaRequest(
        settings.userId,
        settings.apiToken,
        "DELETE",
        `/user/webhook/${encodeURIComponent(settings.webhookId)}`,
      );
    } catch (error) {
      console.warn("Could not remove the Habitica webhook", String(error));
    }
  },
});
