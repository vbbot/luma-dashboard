// Mirrors the IDs hard-coded in the Luma launcher:
//   app/src/main/java/com/vandam/luma/data/Tool.kt
//   app/src/main/java/com/vandam/luma/data/ManagedApp.kt
// The launcher silently drops any ID it does not recognise.

export const LIGHT_TOOLS = [
  { id: "phone", label: "Phone" },
  { id: "settings", label: "Settings" },
  { id: "album", label: "Album" },
  { id: "alarm", label: "Alarm" },
  { id: "calculator", label: "Calculator" },
  { id: "directions", label: "Directions" },
  { id: "directory", label: "Directory" },
  { id: "camera", label: "Camera" },
  { id: "notes", label: "Notes" },
  { id: "calendar", label: "Calendar" },
  { id: "timer", label: "Timer" },
  { id: "music", label: "Music" },
  { id: "podcasts", label: "Podcasts" },
  { id: "hotspot", label: "Hotspot" },
] as const;

// Phone and Settings are always on; the launcher re-adds them if missing.
export const REQUIRED_TOOL_IDS = ["phone", "settings"] as const;

export const DEFAULT_TOOL_IDS = ["phone", "settings"];

export const MANAGED_APPS = [
  { id: "buses", label: "Buses" },
  { id: "passes", label: "Passes" },
  { id: "weather", label: "Weather" },
  { id: "zero", label: "Zero" },
  { id: "echo", label: "Echo" },
  { id: "reverb", label: "Reverb" },
] as const;

export const ACCOUNT_NUMBER_PATTERN = /^\d{16}$/;

const toolIds = new Set<string>(LIGHT_TOOLS.map((tool) => tool.id));
const managedAppIds = new Set<string>(MANAGED_APPS.map((app) => app.id));

export function isToolId(id: string): boolean {
  return toolIds.has(id);
}

export function isManagedAppId(id: string): boolean {
  return managedAppIds.has(id);
}
