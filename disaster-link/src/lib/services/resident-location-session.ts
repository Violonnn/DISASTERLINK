/**
 * Resident Location Session Service
 * ─────────────────────────────────
 * Stores the resident's last known location in sessionStorage so that
 * it can be reused across resident pages for the current browser tab.
 *
 * The data is cleared explicitly on logout so that a new login starts
 * with a fresh location state.
 */

export interface StoredResidentLocation {
  latitude: number;
  longitude: number;
  locationText: string;
  detectedBarangayName: string;
  savedAt: number;
}

const STORAGE_KEY = 'disasterlink_resident_location_v1';

/**
 * Persist the resident's current location for the rest of the tab session.
 */
export function saveResidentLocation(location: StoredResidentLocation): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(location));
  } catch {
    // If storage is unavailable (e.g. in private mode), fail silently.
  }
}

/**
 * Load the resident's previously saved location, or null if none.
 */
export function loadResidentLocation(): StoredResidentLocation | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredResidentLocation>;
    if (
      typeof parsed.latitude !== 'number' ||
      typeof parsed.longitude !== 'number' ||
      typeof parsed.locationText !== 'string'
    ) {
      return null;
    }
    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      locationText: parsed.locationText,
      detectedBarangayName: parsed.detectedBarangayName ?? 'Not Detected',
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now()
    };
  } catch {
    return null;
  }
}

/**
 * Clear any stored resident location. Call this on logout.
 */
export function clearResidentLocation(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors on clear as well.
  }
}

