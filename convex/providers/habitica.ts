import { HabiticaError, fetchHabitica, habiticaRequest } from "../habiticaCards";
import {
  type TaskType,
  dashboardTasks,
  habiticaReminders,
  newTaskBody,
  taskChanges,
  toDashboardTask,
} from "../habiticaTasks";
import { IntegrationError, SettingsError, type Settings } from "../kinds/types";
import { defineProvider } from "./types";

// A linked Habitica account: credentials, Habitica's own webhook
// (taskActivity, so changes made there arrive at once) and the dashboard's
// task management. Cards that show it: kinds/habitica.ts.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HabiticaConnection = {
  userId: string;
  apiToken: string;
  webhookId?: string;
};

export function habiticaConnection(settings: Settings | undefined): HabiticaConnection {
  const connection = settings as HabiticaConnection | undefined;
  if (!connection?.userId || !connection.apiToken)
    throw new IntegrationError("Habitica is not connected");
  return connection;
}

// Rejected credentials will not start working by retrying soon.
export function habiticaFailure(error: unknown) {
  if (error instanceof HabiticaError) {
    return new IntegrationError(error.message, { permanent: error.status === 401 });
  }
  return error;
}

async function withHabitica<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw habiticaFailure(error);
  }
}

export const habitica = defineProvider<HabiticaConnection>({
  provider: "habitica",
  name: "Habitica",
  secret: ["apiToken"],
  inbound: { minIntervalMs: 5_000 },

  parseSettings(value) {
    const input = (value ?? {}) as Record<string, unknown>;
    const userId = typeof input.userId === "string" ? input.userId.trim() : "";
    const apiToken = typeof input.apiToken === "string" ? input.apiToken.trim() : "";
    if (!UUID.test(userId) || !UUID.test(apiToken)) {
      throw new SettingsError(
        "The User ID and API Token are both in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      );
    }
    return { userId, apiToken };
  },

  async onConnect({ settings, hookUrl }) {
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
      // Scheduled refreshes still keep the cards current.
      console.warn("Could not register the Habitica webhook", String(error));
      return settings;
    }
  },

  async onDisconnect({ settings }) {
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

  // The dashboard's Habitica page (habiticaTasks.ts).
  operations: {
    listTasks: {
      readOnly: true,
      run: ({ settings }) =>
        withHabitica(async () => {
          const { user, tasks } = await fetchHabitica(settings.userId, settings.apiToken);
          return dashboardTasks(tasks, user);
        }),
    },

    // args: { type, text, notes?, dueDate?, reminders?, up?, down? }
    addTask: {
      run: ({ settings, now, args }) =>
        withHabitica(async () => {
          const { user } = await fetchHabitica(settings.userId, settings.apiToken);
          const created = await habiticaRequest<Parameters<typeof toDashboardTask>[0]>(
            settings.userId,
            settings.apiToken,
            "POST",
            "/tasks/user",
            newTaskBody(args, user, now, () => crypto.randomUUID()),
          );
          return toDashboardTask(created, user);
        }),
    },

    // args: { taskId, text?, notes?, dueDate?, reminders?, up?, down? }
    updateTask: {
      run: ({ settings, now, args }) =>
        withHabitica(async () => {
          const taskId = (args as { taskId?: unknown } | null)?.taskId;
          if (typeof taskId !== "string" || !UUID.test(taskId))
            throw new SettingsError("Unknown task");
          const { user, tasks } = await fetchHabitica(settings.userId, settings.apiToken);
          const task = tasks.find((entry) => entry.id === taskId);
          if (task === undefined) throw new SettingsError("That task no longer exists");
          const changes = taskChanges(task.type as TaskType, args, user);
          const input = args as { reminders?: unknown };
          if (input.reminders !== undefined) {
            changes.reminders = habiticaReminders(
              task.type as TaskType,
              input.reminders,
              user,
              now,
              () => crypto.randomUUID(),
            );
          }
          const updated = await habiticaRequest<Parameters<typeof toDashboardTask>[0]>(
            settings.userId,
            settings.apiToken,
            "PUT",
            `/tasks/${encodeURIComponent(taskId)}`,
            changes,
          );
          return toDashboardTask(updated, user);
        }),
    },
  },
});
