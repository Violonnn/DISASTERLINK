/**
 * Geocode Service
 * ───────────────
 * Reusable functions for forward geocoding (place name → coordinates)
 * and reverse geocoding (coordinates → address) via Nominatim.
 */

/* ── Result type for a single search hit ── */

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
  placeType: string;
  boundingBox?: [number, number, number, number];
}

/* ── Search for a place by name; returns up to 5 matches ── */

export async function searchPlace(
  query: string,
  options?: { limit?: number; countryCodes?: string }
): Promise<GeocodeResult[]> {
  if (!query || typeof query !== 'string') return [];

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    q: trimmed,
    format: 'json',
    addressdetails: '1',
    limit: String(options?.limit ?? 5)
  });

  if (options?.countryCodes) {
    params.set('countrycodes', options.countryCodes);
  }

  const url = `https://nominatim.openstreetmap.org/search?${params}`;

  const res = await fetch(url, {
    headers: {
      'Accept-Language': 'en',
      'User-Agent': 'DisasterLink/1.0'
    }
  });

  if (!res.ok) throw new Error('Geocoding service unavailable');

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.map((item: Record<string, unknown>) => ({
    displayName: String(item.display_name ?? ''),
    lat: Number(item.lat),
    lon: Number(item.lon),
    placeType: String(item.type ?? item.class ?? ''),
    boundingBox: Array.isArray(item.boundingbox)
      ? (item.boundingbox.map(Number) as [number, number, number, number])
      : undefined
  }));
}

/* ── Convert coordinates to a readable address ── */

export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<string> {
  const url =
    `https://nominatim.openstreetmap.org/reverse` +
    `?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;

  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en' }
  });

  if (!res.ok) throw new Error('Geocoding service unavailable');

  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const a = data.address ?? {};
  const parts = [
    a.village ?? a.town ?? a.city_district ?? a.suburb ?? '',
    a.city ?? a.municipality ?? '',
    a.state ?? a.region ?? ''
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : data.display_name ?? '';
}
