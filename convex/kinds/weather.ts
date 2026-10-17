import { internal } from "../_generated/api";
import { textContent } from "../cards";
import {
  type Conditions,
  cacheKey,
  forecastUrl,
  formatConditions,
  parseForecast,
  type Units,
} from "../weather";
import { IntegrationError, type RefreshResult, SettingsError, defineKind } from "./types";

// Weather for a place from Open-Meteo (no key), e.g. "12° Cloudy · 15°/8°".

const REFRESH_MS = 30 * 60_000;
// Long enough to ride out a few failed refreshes, short enough that old
// weather does not linger.
const CARD_TTL_MS = 3 * 60 * 60_000;

type WeatherSettings = {
  place: string;
  latitude: number;
  longitude: number;
  units: Units;
};

function units(value: unknown): Units {
  if (value !== "celsius" && value !== "fahrenheit")
    throw new SettingsError("Choose Celsius or Fahrenheit");
  return value;
}

export const weather = defineKind<WeatherSettings>({
  kind: "weather",
  editable: ["units"],
  allowActions: false,
  refreshMs: REFRESH_MS,

  parseSettings(value, previous) {
    const input = (value ?? {}) as Record<string, unknown>;
    if (previous) return { ...previous, units: units(input.units ?? previous.units) };
    const { place, latitude, longitude } = input;
    if (typeof place !== "string" || place.trim() === "" || place.length > 30) {
      throw new SettingsError("Choose a place");
    }
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      throw new SettingsError("Invalid location");
    }
    return { place: place.trim(), latitude, longitude, units: units(input.units) };
  },

  label: ({ place }) => `Weather · ${place}`,

  // Explicit types: this file is part of what the generated API types are
  // built from, so letting them be inferred here loops.
  async refresh({ ctx, settings, now }): Promise<RefreshResult> {
    const key = cacheKey(settings.latitude, settings.longitude, settings.units);
    let conditions: Conditions | null = await ctx.runQuery(internal.weatherCache.get, { key, now });
    if (conditions === null) {
      const response = await fetch(
        forecastUrl(settings.latitude, settings.longitude, settings.units),
      );
      if (!response.ok) throw new IntegrationError(`Open-Meteo: HTTP ${response.status}`);
      conditions = parseForecast(await response.json());
      await ctx.runMutation(internal.weatherCache.put, { key, ...conditions });
    }
    return {
      content: textContent(formatConditions(conditions)),
      expiresAt: now + CARD_TTL_MS,
      nextRunAt: now + REFRESH_MS,
    };
  },
});
