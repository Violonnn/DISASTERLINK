/**
 * Weather Service
 * ───────────────
 * Fetches current weather by coordinates using the free Open-Meteo API (no API key).
 * Used when a resident clicks a barangay on the map to view weather for that area.
 * All functions are reusable and validate inputs.
 */

/* Default center for Minglanilla/Cebu area when barangay has no boundary geometry */
const DEFAULT_CEBU_LAT = 10.2452;
const DEFAULT_CEBU_LNG = 123.7962;

/* Open-Meteo base URL; no authentication required */
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

/* Valid latitude/longitude bounds to avoid invalid API calls */
const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

/**
 * Result shape returned by Open-Meteo current weather.
 * We only request and use the fields below.
 */
export interface WeatherCurrent {
  temperature_2m: number;
  relative_humidity_2m: number;
  weather_code: number;
  wind_speed_10m: number;
  precipitation: number;
}

/**
 * Normalized weather data for the UI.
 * All values are validated and safe to display.
 */
export interface WeatherResult {
  temperatureCelsius: number;
  relativeHumidityPercent: number;
  weatherCode: number;
  weatherLabel: string;
  windSpeedKmh: number;
  precipitationMm: number;
  fetchedAt: string;
}

/**
 * WMO weather codes (0–99) mapped to short display labels.
 * Covers the subset returned by Open-Meteo for readability.
 */
const WMO_LABELS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail'
};

/**
 * Returns a human-readable label for a WMO weather code.
 * Unknown codes get a generic description.
 */
function weatherCodeToLabel(code: number): string {
  if (code in WMO_LABELS) return WMO_LABELS[code];
  if (code >= 1 && code <= 3) return 'Cloudy';
  if (code >= 50 && code <= 69) return 'Rain';
  if (code >= 70 && code <= 79) return 'Snow';
  if (code >= 80 && code <= 99) return 'Showers or storm';
  return 'Unknown';
}

/**
 * Validates latitude and longitude are within valid ranges.
 * Used before calling the API to avoid invalid requests.
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    !Number.isNaN(lat) &&
    lat >= LAT_MIN &&
    lat <= LAT_MAX &&
    typeof lng === 'number' &&
    !Number.isNaN(lng) &&
    lng >= LNG_MIN &&
    lng <= LNG_MAX
  );
}

/**
 * Computes the centroid (center point) of a GeoJSON polygon or multi-polygon.
 * Used to get a single lat/lng for a barangay boundary for the weather API.
 */
function centroidOfGeometry(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): { lat: number; lng: number } | null {
  const coords =
    geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates.flat()
        : null;
  if (!coords?.length) return null;

  let sumLat = 0;
  let sumLng = 0;
  let count = 0;
  for (const ring of coords) {
    for (const pt of ring) {
      const lng = pt[0];
      const lat = pt[1];
      if (typeof lng === 'number' && typeof lat === 'number' && !Number.isNaN(lng) && !Number.isNaN(lat)) {
        sumLng += lng;
        sumLat += lat;
        count += 1;
      }
    }
  }
  if (count === 0) return null;
  return { lat: sumLat / count, lng: sumLng / count };
}

/**
 * Barangay type with optional boundary for centroid computation.
 * Matches the shape used by the map (BarangayWithStatus).
 */
export interface BarangayForWeather {
  id: string;
  name: string;
  municipalityName?: string;
  boundaryGeojson?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}

/**
 * Returns the best available lat/lng for a barangay:
 * centroid of its boundary if present, otherwise default Cebu (Minglanilla) coordinates.
 * Safe to call from any context; always returns valid numbers.
 */
export function getBarangayCenter(barangay: BarangayForWeather): { lat: number; lng: number } {
  const geo = barangay.boundaryGeojson;
  if (geo && (geo.type === 'Polygon' || geo.type === 'MultiPolygon')) {
    const center = centroidOfGeometry(geo);
    if (center && isValidCoordinate(center.lat, center.lng)) {
      return center;
    }
  }
  return { lat: DEFAULT_CEBU_LAT, lng: DEFAULT_CEBU_LNG };
}

/**
 * Fetches current weather for the given coordinates from Open-Meteo.
 * Validates coordinates; returns a normalized result or an error message.
 * Reusable from dashboard, feed, or any other component.
 */
export async function fetchWeatherByCoordinates(
  lat: number,
  lng: number
): Promise<{ data: WeatherResult | null; error: string | null }> {
  if (!isValidCoordinate(lat, lng)) {
    return { data: null, error: 'Invalid coordinates for weather.' };
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation',
    timezone: 'auto'
  });
  const url = `${OPEN_METEO_BASE}?${params.toString()}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      return { data: null, error: `Weather service returned ${res.status}.` };
    }
    const json = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
        precipitation?: number;
      };
    };
    const cur = json.current;
    if (!cur || typeof cur.temperature_2m !== 'number') {
      return { data: null, error: 'Invalid weather response.' };
    }

    const temperatureCelsius = Number(cur.temperature_2m);
    const relativeHumidityPercent = typeof cur.relative_humidity_2m === 'number' ? cur.relative_humidity_2m : 0;
    const weatherCode = typeof cur.weather_code === 'number' ? cur.weather_code : 0;
    const windSpeedKmh = typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m : 0;
    const precipitationMm = typeof cur.precipitation === 'number' ? cur.precipitation : 0;

    const data: WeatherResult = {
      temperatureCelsius,
      relativeHumidityPercent,
      weatherCode,
      weatherLabel: weatherCodeToLabel(weatherCode),
      windSpeedKmh,
      precipitationMm,
      fetchedAt: new Date().toISOString()
    };
    return { data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch weather.';
    return { data: null, error: message };
  }
}

/**
 * Fetches current weather for a barangay using its boundary center or default coordinates.
 * Single entry point for "weather for this barangay" from the map.
 */
export async function fetchWeatherForBarangay(
  barangay: BarangayForWeather
): Promise<{ data: WeatherResult | null; error: string | null }> {
  const { lat, lng } = getBarangayCenter(barangay);
  return fetchWeatherByCoordinates(lat, lng);
}
