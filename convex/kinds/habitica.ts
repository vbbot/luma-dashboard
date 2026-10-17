import {
  type HabiticaShow,
  buildHabiticaCard,
  fetchHabitica,
  habiticaRequest,
  scoreDirection,
} from "../habiticaCards";
import { UUID, habiticaConnection, habiticaFailure } from "../providers/habitica";
import { IntegrationError, type RefreshResult, SettingsError, defineKind } from "./types";

// A Habitica card: dailies, To-Dos, habits or stats from the account linked
// on the dashboard's Connections page (providers/habitica.ts). Long-press
// scores a task; task reminders become phone notifications. Card logic:
// habiticaCards.ts.

const REFRESH_MS = 15 * 60_000;
const SHOWS: HabiticaShow[] = ["dailies", "todos", "habits", "stats"];

const LABELS: Record<HabiticaShow, string> = {
  dailies: "Habitica · Dailies",
  todos: "Habitica · To-Dos",
  habits: "Habitica · Habits",
  stats: "Habitica · Stats",
};

type HabiticaCardSettings = { show: HabiticaShow };

function show(value: unknown): HabiticaShow {
  if (!SHOWS.includes(value as HabiticaShow)) throw new SettingsError("Choose what to show");
  return value as HabiticaShow;
}

export const habitica = defineKind<HabiticaCardSettings>({
  kind: "habitica",
  connection: "habitica",
  editable: ["show"],
  allowActions: true,
  refreshMs: REFRESH_MS,

  parseSettings(value, previous) {
    const input = (value ?? {}) as Record<string, unknown>;
    return { show: show(input.show ?? previous?.show) };
  },

  label: ({ show }) => LABELS[show],

  // Explicit types: this file is part of what the generated API types are
  // built from, so letting them be inferred here loops.
  async refresh({ settings, connection, now }): Promise<RefreshResult> {
    const { userId, apiToken } = habiticaConnection(connection);
    try {
      const { user, tasks } = await fetchHabitica(userId, apiToken);
      const card = buildHabiticaCard(settings.show, tasks, user, now);
      return {
        content: card.content,
        expiresAt: card.expiresAt,
        nextRunAt: Math.min(now + REFRESH_MS, card.rebuildAt),
      };
    } catch (error) {
      throw habiticaFailure(error);
    }
  },

  async act({ connection, pageId, actionId, undo }): Promise<void> {
    const { userId, apiToken } = habiticaConnection(connection);
    const direction = scoreDirection(actionId, undo);
    if (direction === null || !UUID.test(pageId))
      throw new IntegrationError("Action not available");
    try {
      await habiticaRequest(
        userId,
        apiToken,
        "POST",
        `/tasks/${encodeURIComponent(pageId)}/score/${direction}`,
      );
    } catch (error) {
      throw habiticaFailure(error);
    }
  },
});
