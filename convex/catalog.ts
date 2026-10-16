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

// Vandam's apps, which every Luma version knows by these IDs. They are also
// the "No Scrolling" source of the App Store.
export const BUILTIN_APPS = [
  { id: "buses", label: "Buses", packageName: "com.vandam.buses", repo: "vandamd/buses" },
  { id: "passes", label: "Passes", packageName: "com.vandamd.passes", repo: "vandamd/passes" },
  { id: "weather", label: "Weather", packageName: "com.vandam.weather", repo: "vandamd/weather" },
  { id: "zero", label: "Zero", packageName: "com.vandam.zero", repo: "vandamd/zero" },
  { id: "echo", label: "Echo", packageName: "com.vandam.echo", repo: "vandamd/echo" },
  { id: "reverb", label: "Reverb", packageName: "com.vandam.reverb", repo: "vandamd/reverb" },
] as const;

export const ACCOUNT_NUMBER_PATTERN = /^\d{16}$/;

const toolIds = new Set<string>(LIGHT_TOOLS.map((tool) => tool.id));
const builtinAppIds = new Set<string>(BUILTIN_APPS.map((app) => app.id));

export function isToolId(id: string): boolean {
  return toolIds.has(id);
}

export function isBuiltinAppId(id: string): boolean {
  return builtinAppIds.has(id);
}
