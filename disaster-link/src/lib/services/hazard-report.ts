/**
 * Hazard Report Service
 * ─────────────────────
 * LGU responders can create hazard/disaster reports with location, title,
 * description, and photos/videos captured on-site. Reports appear as map markers.
 */

import { supabase } from '$lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

const BUCKET = 'hazard-report-media';
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];
const PHOTO_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const VIDEO_MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export interface ReportType {
  id: string;
  name: string;
  slug: string;
}

export interface HazardReport {
  id: string;
  reporterId: string;
  publisherName: string;
  publisherAvatarUrl: string | null;
  barangayId: string;
  barangayName: string;
  municipalityName: string;
  profileImageUrl: string | null;
  reportTypeId: string;
  reportTypeName: string;
  status: string;
  title: string | null;
  description: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  photoUrls: string[];
  videoUrls: string[];
  createdAt: string;
}

/**
 * Fetch all report types (flooding, landslide, fire, etc.) for the type selector.
 */
export async function fetchReportTypes(): Promise<ReportType[]> {
  const { data, error } = await supabase
    .from('report_types')
    .select('id, name, slug')
    .order('sort_order', { ascending: true });
  if (error) return [];
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, slug: r.slug }));
}

function formatPublisherName(p: { first_name?: string; last_name?: string } | null): string {
  if (!p) return 'Unknown';
  const fn = (p.first_name ?? '').trim();
  const ln = (p.last_name ?? '').trim();
  if (fn && ln) return `${fn} ${ln}`;
  return fn || ln || 'Unknown';
}

function firstBrochureUrl(urls: unknown): string | null {
  if (!Array.isArray(urls) || urls.length === 0) return null;
  const first = urls[0];
  return typeof first === 'string' && first.trim().length > 0 ? first : null;
}

function reportTypeName(reportTypes: unknown): string {
  const v = reportTypes as unknown;
  if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object' && v[0] !== null && 'name' in v[0]) {
    return String((v[0] as { name: unknown }).name) || 'Unknown';
  }
  if (v && typeof v === 'object' && 'name' in v) {
    return String((v as { name: unknown }).name) || 'Unknown';
  }
  return 'Unknown';
}

/**
 * Fetch hazard reports for a barangay (with GPS coords) to display as map markers.
 */
export async function fetchHazardReportsForBarangay(
  barangayId: string
): Promise<HazardReport[]> {
  const { data, error } = await supabase
    .from('reports')
    .select(
      `
      id,
      reporter_id,
      barangay_id,
      report_type_id,
      status,
      title,
      description,
      gps_lat,
      gps_lng,
      photo_urls,
      video_urls,
      created_at,
      report_types ( name ),
      profiles!reporter_id ( first_name, last_name, avatar_url ),
      barangays ( name, brochure_photo_urls, municipalities ( name ) )
    `
    )
    .eq('barangay_id', barangayId)
    .not('gps_lat', 'is', null)
    .not('gps_lng', 'is', null)
    .order('created_at', { ascending: false });

  if (error) return [];

  return (data ?? []).map((row) => {
    const rawBarangay = row.barangays as unknown;
    const barangay = Array.isArray(rawBarangay) ? null : (rawBarangay as { name: string; brochure_photo_urls?: string[] } | null);
    const rawMun = barangay && typeof barangay === 'object' && 'municipalities' in barangay ? (barangay as { municipalities?: unknown }).municipalities : null;
    const municipality = Array.isArray(rawMun) ? null : (rawMun as { name: string } | null);
    return {
      id: row.id,
      reporterId: row.reporter_id,
      publisherName: formatPublisherName(row.profiles as { first_name?: string; last_name?: string } | null),
      publisherAvatarUrl: (row.profiles as { avatar_url?: string } | null)?.avatar_url ?? null,
      barangayId: row.barangay_id,
      barangayName: barangay?.name ?? 'Unknown',
      municipalityName: (municipality && typeof municipality === 'object' && 'name' in municipality ? municipality.name : null) ?? '',
      profileImageUrl: firstBrochureUrl(barangay?.brochure_photo_urls) ?? null,
      reportTypeId: row.report_type_id,
      reportTypeName: reportTypeName(row.report_types),
      status: row.status,
      title: row.title ?? null,
      description: row.description ?? null,
      gpsLat: row.gps_lat,
      gpsLng: row.gps_lng,
      photoUrls: Array.isArray(row.photo_urls)
        ? (row.photo_urls as string[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
        : [],
      videoUrls: Array.isArray(row.video_urls)
        ? (row.video_urls as string[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
        : [],
      createdAt: row.created_at
    };
  });
}

/**
 * Fetch all hazard reports with GPS coords — visible to all roles on the map.
 */
export async function fetchAllHazardReports(): Promise<HazardReport[]> {
  const { data, error } = await supabase
    .from('reports')
    .select(
      `
      id,
      reporter_id,
      barangay_id,
      report_type_id,
      status,
      title,
      description,
      gps_lat,
      gps_lng,
      photo_urls,
      video_urls,
      created_at,
      report_types ( name ),
      profiles!reporter_id ( first_name, last_name, avatar_url ),
      barangays ( name, brochure_photo_urls, municipalities ( name ) )
    `
    )
    .not('gps_lat', 'is', null)
    .not('gps_lng', 'is', null)
    .order('created_at', { ascending: false });

  if (error) return [];

  return (data ?? []).map((row) => {
    const rawBarangay = row.barangays as unknown;
    const barangay = Array.isArray(rawBarangay) ? null : (rawBarangay as { name: string; brochure_photo_urls?: string[] } | null);
    const rawMun = barangay && typeof barangay === 'object' && 'municipalities' in barangay ? (barangay as { municipalities?: unknown }).municipalities : null;
    const municipality = Array.isArray(rawMun) ? null : (rawMun as { name: string } | null);
    return {
      id: row.id,
      reporterId: row.reporter_id,
      publisherName: formatPublisherName(row.profiles as { first_name?: string; last_name?: string } | null),
      publisherAvatarUrl: (row.profiles as { avatar_url?: string } | null)?.avatar_url ?? null,
      barangayId: row.barangay_id,
      barangayName: barangay?.name ?? 'Unknown',
      municipalityName: (municipality && typeof municipality === 'object' && 'name' in municipality ? municipality.name : null) ?? '',
      profileImageUrl: firstBrochureUrl(barangay?.brochure_photo_urls) ?? null,
      reportTypeId: row.report_type_id,
      reportTypeName: reportTypeName(row.report_types),
      status: row.status,
      title: row.title ?? null,
      description: row.description ?? null,
      gpsLat: row.gps_lat,
      gpsLng: row.gps_lng,
      photoUrls: Array.isArray(row.photo_urls)
        ? (row.photo_urls as string[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
        : [],
      videoUrls: Array.isArray(row.video_urls)
        ? (row.video_urls as string[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
        : [],
      createdAt: row.created_at
    };
  });
}

/**
 * Fetch hazard reports for multiple barangays (e.g. for municipal view).
 */
export async function fetchHazardReportsForBarangays(
  barangayIds: string[]
): Promise<HazardReport[]> {
  if (barangayIds.length === 0) return [];
  const { data, error } = await supabase
    .from('reports')
    .select(
      `
      id,
      reporter_id,
      barangay_id,
      report_type_id,
      status,
      title,
      description,
      gps_lat,
      gps_lng,
      photo_urls,
      video_urls,
      created_at,
      report_types ( name ),
      profiles!reporter_id ( first_name, last_name, avatar_url ),
      barangays ( name, brochure_photo_urls, municipalities ( name ) )
    `
    )
    .in('barangay_id', barangayIds)
    .not('gps_lat', 'is', null)
    .not('gps_lng', 'is', null)
    .order('created_at', { ascending: false });

  if (error) return [];

  return (data ?? []).map((row) => {
    const rawBarangay = row.barangays as unknown;
    const barangay = Array.isArray(rawBarangay) ? null : (rawBarangay as { name: string; brochure_photo_urls?: string[] } | null);
    const rawMun = barangay && typeof barangay === 'object' && 'municipalities' in barangay ? (barangay as { municipalities?: unknown }).municipalities : null;
    const municipality = Array.isArray(rawMun) ? null : (rawMun as { name: string } | null);
    return {
      id: row.id,
      reporterId: row.reporter_id,
      publisherName: formatPublisherName(row.profiles as { first_name?: string; last_name?: string } | null),
      publisherAvatarUrl: (row.profiles as { avatar_url?: string } | null)?.avatar_url ?? null,
      barangayId: row.barangay_id,
      barangayName: barangay?.name ?? 'Unknown',
      municipalityName: (municipality && typeof municipality === 'object' && 'name' in municipality ? municipality.name : null) ?? '',
      profileImageUrl: firstBrochureUrl(barangay?.brochure_photo_urls) ?? null,
      reportTypeId: row.report_type_id,
      reportTypeName: reportTypeName(row.report_types),
      status: row.status,
      title: row.title ?? null,
      description: row.description ?? null,
      gpsLat: row.gps_lat,
      gpsLng: row.gps_lng,
      photoUrls: Array.isArray(row.photo_urls)
        ? (row.photo_urls as string[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
        : [],
      videoUrls: Array.isArray(row.video_urls)
        ? (row.video_urls as string[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
        : [],
      createdAt: row.created_at
    };
  });
}

/**
 * Create a new hazard report. Requires current GPS location.
 */
export async function createHazardReport(params: {
  barangayId: string;
  reporterId: string;
  reportTypeId: string;
  title: string;
  description: string;
  gpsLat: number;
  gpsLng: number;
  photoUrls: string[];
  videoUrls: string[];
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('reports')
    .insert({
      reporter_id: params.reporterId,
      barangay_id: params.barangayId,
      report_type_id: params.reportTypeId,
      title: params.title.trim(),
      description: params.description.trim() || null,
      gps_lat: params.gpsLat,
      gps_lng: params.gpsLng,
      photo_urls: params.photoUrls,
      video_urls: params.videoUrls
    })
    .select('id')
    .single();

  if (error) return { id: null, error: error.message };
  return { id: data?.id ?? null, error: null };
}

/**
 * Upload a photo to hazard-report-media bucket. Returns public URL or null.
 */
export async function uploadReportPhoto(file: File): Promise<string | null> {
  if (!PHOTO_TYPES.includes(file.type) || file.size > PHOTO_MAX_SIZE) return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `photos/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (error) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload a video to hazard-report-media bucket. Returns public URL or null.
 */
export async function uploadReportVideo(file: File): Promise<string | null> {
  if (!VIDEO_TYPES.includes(file.type) || file.size > VIDEO_MAX_SIZE) return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'mp4';
  const path = `videos/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (error) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Validate photo file for report upload.
 */
export function validateReportPhoto(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type))
    return 'Only JPG, PNG, or WebP images are allowed.';
  if (file.size > PHOTO_MAX_SIZE) return 'Photo must be under 5 MB.';
  return null;
}

/**
 * Validate video file for report upload.
 */
export function validateReportVideo(file: File): string | null {
  if (!VIDEO_TYPES.includes(file.type))
    return 'Only MP4 or WebM videos are allowed.';
  if (file.size > VIDEO_MAX_SIZE) return 'Video must be under 50 MB.';
  return null;
}

/**
 * Subscribe to realtime changes on reports table (for live marker updates).
 */
export function subscribeReportsRealtime(onUpdate: () => void): RealtimeChannel {
  const channel = supabase
    .channel('hazard-reports-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reports' },
      () => onUpdate()
    )
    .subscribe();
  return channel;
}
