/**
 * Barangay Status Service
 * ──────────────────────
 * Fetches barangay boundaries with current disaster status for the map layer.
 * Supports realtime sync. Status options:
 * Normal | In need of resources | In need of manpower | Active disaster.
 * For "need" statuses, barangays can post photos and description; others can offer assistance.
 */

import { supabase } from '$lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type L from 'leaflet';

/* ── Status enum matches database ── */
export type BarangayStatusEnum =
  | 'normal'
  | 'in_need_of_resources'
  | 'in_need_of_manpower'
  | 'active_disaster';

/* ── Need statuses require description and optionally photos ── */
export const NEED_STATUSES: BarangayStatusEnum[] = [
  'in_need_of_resources',
  'in_need_of_manpower',
  'active_disaster'
];

/* Legacy statuses from old schema (on_alert, under_threat) - treat as need statuses for assistance */
const LEGACY_NEED_STATUSES = ['on_alert', 'under_threat'];

export function isNeedStatus(status: string): boolean {
  return (
    NEED_STATUSES.includes(status as BarangayStatusEnum) ||
    LEGACY_NEED_STATUSES.includes(status)
  );
}

/* ── One barangay with boundary and its latest status ── */
export interface BarangayWithStatus {
  id: string;
  name: string;
  municipalityName: string;
  boundaryGeojson: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  status: BarangayStatusEnum;
  statusUpdatedAt: string | null;
  statusNotes: string | null;
  statusDescription: string | null;
  statusPhotoUrls: string[];
  statusUpdateId: string | null;
  /** Barangay brochure: description and photos shown when user clicks the barangay */
  description: string | null;
  brochurePhotoUrls: string[];
}

/* ── Color mapping for map layer ── */
export const BARANGAY_STATUS_COLORS: Record<BarangayStatusEnum, string> = {
  normal: '#22c55e',
  in_need_of_resources: '#eab308',
  in_need_of_manpower: '#f97316',
  active_disaster: '#ef4444'
};

/* ── Human-readable labels ── */
export const BARANGAY_STATUS_LABELS: Record<BarangayStatusEnum, string> = {
  normal: 'Normal',
  in_need_of_resources: 'In need of resources',
  in_need_of_manpower: 'In need of manpower',
  active_disaster: 'Active disaster'
};

const BUCKET = 'barangay-status-photos';
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Upload a photo to barangay-status-photos bucket.
 * Returns the public URL or null on failure.
 */
export async function uploadStatusPhoto(file: File): Promise<string | null> {
  if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_SIZE) return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (error) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Validate photo file for status update.
 */
export function validateStatusPhoto(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type))
    return 'Only JPG, PNG, or WebP images are allowed.';
  if (file.size > MAX_SIZE) return 'File must be under 5 MB.';
  return null;
}

/**
 * Fetch all approved barangays with boundaries and their latest status.
 */
export async function fetchBarangaysWithStatus(): Promise<BarangayWithStatus[]> {
  const { data: barangays, error: brgyErr } = await supabase
    .from('barangays')
    .select(
      `
      id,
      name,
      boundary_geojson,
      boundary_approved_at,
      description,
      brochure_photo_urls,
      municipalities ( name )
    `
    )
    .not('boundary_approved_at', 'is', null);

  if (brgyErr) return [];

  if (!barangays?.length) return [];

  const barangayIds = barangays.map((b) => b.id);

  const toBrochureUrls = (v: unknown): string[] =>
    Array.isArray(v) ? (v as string[]).filter((u): u is string => typeof u === 'string' && u.trim().length > 0) : [];

  const { data: latestStatuses, error: statusErr } = await supabase
    .from('barangay_status_updates')
    .select('id, barangay_id, status, notes, description, photo_urls, created_at')
    .in('barangay_id', barangayIds)
    .order('created_at', { ascending: false });

  if (statusErr)
    return barangays.map((b) => ({
      id: b.id,
      name: b.name,
      municipalityName: (b.municipalities as { name: string } | null)?.name ?? '',
      boundaryGeojson:
        (b.boundary_geojson as GeoJSON.Polygon | GeoJSON.MultiPolygon) ?? null,
      status: 'normal' as BarangayStatusEnum,
      statusUpdatedAt: null,
      statusNotes: null,
      statusDescription: null,
      statusPhotoUrls: [],
      statusUpdateId: null,
      description: b.description?.trim() || null,
      brochurePhotoUrls: toBrochureUrls(b.brochure_photo_urls)
    }));

  const latestByBarangay = new Map<
    string,
    {
      status: BarangayStatusEnum;
      notes: string | null;
      description: string | null;
      photoUrls: string[];
      created_at: string;
      id: string;
    }
  >();
  for (const s of latestStatuses ?? []) {
    if (!latestByBarangay.has(s.barangay_id)) {
      const urls = Array.isArray(s.photo_urls) ? s.photo_urls : [];
      latestByBarangay.set(s.barangay_id, {
        status: s.status as BarangayStatusEnum,
        notes: s.notes,
        description: s.description ?? null,
        photoUrls: urls.filter((u): u is string => typeof u === 'string'),
        created_at: s.created_at,
        id: s.id
      });
    }
  }

  return barangays.map((b) => {
    const info = latestByBarangay.get(b.id);
    return {
      id: b.id,
      name: b.name,
      municipalityName: (b.municipalities as { name: string } | null)?.name ?? '',
      boundaryGeojson:
        (b.boundary_geojson as GeoJSON.Polygon | GeoJSON.MultiPolygon) ?? null,
      status: info?.status ?? 'normal',
      statusUpdatedAt: info?.created_at ?? null,
      statusNotes: info?.notes ?? null,
      statusDescription: info?.description ?? null,
      statusPhotoUrls: info?.photoUrls ?? [],
      statusUpdateId: info?.id ?? null,
      description: b.description?.trim() || null,
      brochurePhotoUrls: toBrochureUrls(b.brochure_photo_urls)
    };
  });
}

/**
 * Subscribe to realtime changes on barangay_status_updates and barangays.
 */
export function subscribeBarangayStatusRealtime(
  onUpdate: () => void
): RealtimeChannel | null {
  const channel = supabase
    .channel('barangay-status-sync')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'barangay_status_updates'
      },
      () => onUpdate()
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'barangays'
      },
      () => onUpdate()
    )
    .subscribe();

  return channel;
}

/**
 * Insert a new status update. For need statuses, description is required; photo_urls optional.
 */
export async function updateBarangayStatus(
  barangayId: string,
  status: BarangayStatusEnum,
  userId: string,
  options?: {
    notes?: string | null;
    description?: string | null;
    photoUrls?: string[];
  }
): Promise<{ error: string | null }> {
  const description = options?.description ?? null;
  const notes = options?.notes ?? null;
  const photoUrls = options?.photoUrls ?? [];

  /* Need statuses require a short description explaining why */
  if (isNeedStatus(status) && (!description || description.trim().length < 5)) {
    return { error: 'Please provide a short description (at least 5 characters).' };
  }

  const payload: Record<string, unknown> = {
    barangay_id: barangayId,
    status,
    notes: notes || null,
    description: isNeedStatus(status) ? (description?.trim() ?? null) : null,
    photo_urls: isNeedStatus(status) && photoUrls.length > 0 ? photoUrls : [],
    updated_by: userId
  };

  const { error } = await supabase.from('barangay_status_updates').insert(payload);

  return { error: error?.message ?? null };
}

/**
 * Create a Leaflet GeoJSON layer from barangays with status.
 */
export function createBarangayStatusLayer(
  leafletLib: typeof L,
  barangays: BarangayWithStatus[],
  onPopupContent?: (b: BarangayWithStatus) => string
): L.GeoJSON | null {
  const features: GeoJSON.Feature[] = barangays
    .filter((b) => b.boundaryGeojson != null)
    .map((b) => ({
      type: 'Feature' as const,
      properties: {
        id: b.id,
        name: b.name,
        municipality: b.municipalityName,
        status: b.status,
        statusLabel: BARANGAY_STATUS_LABELS[b.status],
        statusUpdatedAt: b.statusUpdatedAt,
        statusNotes: b.statusNotes,
        statusDescription: b.statusDescription,
        statusPhotoUrls: b.statusPhotoUrls,
        statusUpdateId: b.statusUpdateId,
        description: b.description,
        brochurePhotoUrls: b.brochurePhotoUrls
      },
      geometry: b.boundaryGeojson
    }));

  if (features.length === 0) return null;

  const featureCollection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features
  };

  return leafletLib.geoJSON(featureCollection, {
    style: (feature) => {
      const status = (feature?.properties?.status ?? 'normal') as BarangayStatusEnum;
      const color = BARANGAY_STATUS_COLORS[status];
      return {
        fillColor: color,
        fillOpacity: 0.45,
        color,
        weight: 2,
        opacity: 0.9
      };
    },

    onEachFeature: (feature, layer) => {
      const p = feature.properties ?? {};
      const html =
        onPopupContent && p.id
          ? onPopupContent(
              barangays.find((b) => b.id === p.id) ?? ({
                id: p.id,
                name: p.name,
                municipalityName: p.municipality,
                boundaryGeojson: null,
                status: (p.status as BarangayStatusEnum) ?? 'normal',
                statusUpdatedAt: p.statusUpdatedAt,
                statusNotes: p.statusNotes,
                statusDescription: p.statusDescription,
                statusPhotoUrls: Array.isArray(p.statusPhotoUrls) ? p.statusPhotoUrls : [],
                statusUpdateId: p.statusUpdateId,
                description: p.description ?? null,
                brochurePhotoUrls: Array.isArray(p.brochurePhotoUrls) ? p.brochurePhotoUrls : []
              } as BarangayWithStatus)
            )
          : `<div style="font-size:13px;line-height:1.5;min-width:180px">` +
            `<strong>${p.name ?? 'Barangay'}</strong><br/>` +
            `<span style="color:#666">${p.municipality ?? ''}</span><br/>` +
            `<span style="color:${BARANGAY_STATUS_COLORS[(p.status as BarangayStatusEnum) ?? 'normal'] ?? '#666'};font-weight:600">${p.statusLabel ?? 'Normal'}</span>` +
            (p.statusDescription
              ? `<br/><span style="color:#666;font-size:11px">${p.statusDescription}</span>`
              : '') +
            `</div>`;

      layer.bindPopup(html);
    }
  });
}
