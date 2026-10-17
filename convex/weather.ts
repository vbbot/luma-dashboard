// Open-Meteo (https://open-meteo.com): free, no API key. Only the formatting
// and parsing live here; integrations.ts does the fetching and scheduling.

export type Units = "celsius" | "fahrenheit";

export type Conditions = {
  temperature: number;
  weatherCode: number;
  high: number;
  low: number;
};

// Shared by every integration within about a kilometre, per unit.
export function cacheKey(latitude: number, longitude: number, units: Units) {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)},${units}`;
}

export function forecastUrl(latitude: number, longitude: number, units: Units) {
  const params = new URLSearchParams({
    // Rounded like the cache key: about a kilometre, which is plenty for
    // weather and shares less of the user's location.
    latitude: latitude.toFixed(2),
    longitude: longitude.toFixed(2),
    current: "temperature_2m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min",
    forecast_days: "1",
    timezone: "auto",
    temperature_unit: units,
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function parseForecast(body: unknown): Conditions {
  const data = body as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  };
  const conditions = {
    temperature: data.current?.temperature_2m,
    weatherCode: data.current?.weather_code,
    high: data.daily?.temperature_2m_max?.[0],
    low: data.daily?.temperature_2m_min?.[0],
  };
  if (Object.values(conditions).some((value) => typeof value !== "number")) {
    throw new Error("Unexpected forecast response");
  }
  return conditions as Conditions;
}

// WMO weather interpretation codes, as used by Open-Meteo.
function describe(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code === 61 || code === 80) return "Light rain";
  if (code === 63 || code === 81) return "Rain";
  if (code === 65 || code === 82) return "Heavy rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code === 71 || code === 85) return "Light snow";
  if (code === 73 || code === 77) return "Snow";
  if (code === 75 || code === 86) return "Heavy snow";
  if (code >= 95) return "Thunderstorm";
  return "Unknown";
}

// e.g. "12° Cloudy · 15°/8°"
export function formatConditions({ temperature, weatherCode, high, low }: Conditions) {
  const degrees = (value: number) => `${Math.round(value)}°`;
  return `${degrees(temperature)} ${describe(weatherCode)} · ${degrees(high)}/${degrees(low)}`;
}

export type Place = { name: string; detail: string; latitude: number; longitude: number };

export function geocodingUrl(query: string) {
  const params = new URLSearchParams({ name: query, count: "5", language: "en", format: "json" });
  return `https://geocoding-api.open-meteo.com/v1/search?${params}`;
}

export function parsePlaces(body: unknown): Place[] {
  const results =
    (
      body as {
        results?: {
          name: string;
          latitude: number;
          longitude: number;
          admin1?: string;
          country?: string;
        }[];
      }
    ).results ?? [];
  return results.map((result) => ({
    name: result.name,
    detail: [result.admin1, result.country].filter(Boolean).join(", "),
    latitude: result.latitude,
    longitude: result.longitude,
  }));
}
