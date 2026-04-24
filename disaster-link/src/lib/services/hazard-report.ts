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
const BASE_REPORT_SELECT = `
  id,
  reporter_id,
  barangay_id,
  status,
  title,
  description,
  gps_lat,
  gps_lng,
  photo_urls,
  video_urls,
  created_at,
  updated_at
`;

export interface HazardReport {
  id: string;
  reporterId: string;
  publisherName: string;
  publisherAvatarUrl: string | null;
  barangayId: string;
  barangayName: string;
  municipalityName: string;
  profileImageUrl: string | null;
  status: string;
  title: string | null;
  description: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  photoUrls: string[];
  videoUrls: string[];
  createdAt: string;
  updatedAt?: string;
  /** Optional: count of comments (report_notes) for display in contributions/feed */
  commentCount?: number;
  /** Optional: upvote count when available */
  upvoteCount?: number;
}

export interface ReportNote {
  id: string;
  reportId: string;
  authorId: string;
  authorName: string;
  body: string;
  photoUrls: string[];
   parentNoteId?: string | null;
  createdAt: string;
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
      status,
      title,
      description,
      gps_lat,
      gps_lng,
      photo_urls,
      video_urls,
      created_at,
      updated_at,
      report_notes ( count ),
      report_upvotes ( count ),
      profiles!reporter_id ( first_name, last_name, avatar_url ),
      barangays ( name, brochure_photo_urls, municipalities ( name ) )
    `
    )
    .eq('barangay_id', barangayId)
    .not('gps_lat', 'is', null)
    .not('gps_lng', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .from('reports')
      .select(BASE_REPORT_SELECT)
      .eq('barangay_id', barangayId)
      .not('gps_lat', 'is', null)
      .not('gps_lng', 'is', null)
      .order('created_at', { ascending: false });
    if (fallback.error) return [];
    return (fallback.data ?? []).map((row) => mapBasicReportRow(row as Record<string, unknown>));
  }

  return (data ?? []).map((row) => {
    const rawBarangay = row.barangays as unknown;
    const barangay = Array.isArray(rawBarangay) ? null : (rawBarangay as { name: string; brochure_photo_urls?: string[] } | null);
    const rawMun = barangay && typeof barangay === 'object' && 'municipalities' in barangay ? (barangay as { municipalities?: unknown }).municipalities : null;
    const municipality = Array.isArray(rawMun) ? null : (rawMun as { name: string } | null);
    const notesAgg = (row as { report_notes?: { count?: number }[] }).report_notes ?? [];
    const upvotesAgg = (row as { report_upvotes?: { count?: number }[] }).report_upvotes ?? [];
    const commentCount = notesAgg[0]?.count ?? 0;
    const upvoteCount = upvotesAgg[0]?.count ?? 0;
    return {
      id: row.id,
      reporterId: row.reporter_id,
      publisherName: formatPublisherName(row.profiles as { first_name?: string; last_name?: string } | null),
      publisherAvatarUrl: (row.profiles as { avatar_url?: string } | null)?.avatar_url ?? null,
      barangayId: row.barangay_id,
      barangayName: barangay?.name ?? 'Unknown',
      municipalityName: (municipality && typeof municipality === 'object' && 'name' in municipality ? municipality.name : null) ?? '',
      profileImageUrl: firstBrochureUrl(barangay?.brochure_photo_urls) ?? null,
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
      createdAt: row.created_at,
      updatedAt: (row as { updated_at?: string }).updated_at,
      commentCount,
      upvoteCount
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
      status,
      title,
      description,
      gps_lat,
      gps_lng,
      photo_urls,
      video_urls,
      created_at,
      updated_at,
      profiles!reporter_id ( first_name, last_name, avatar_url ),
      barangays ( name, brochure_photo_urls, municipalities ( name ) ),
      report_notes ( count ),
      report_upvotes ( count )
    `
    )
    .not('gps_lat', 'is', null)
    .not('gps_lng', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .from('reports')
      .select(BASE_REPORT_SELECT)
      .not('gps_lat', 'is', null)
      .not('gps_lng', 'is', null)
      .order('created_at', { ascending: false });
    if (fallback.error) return [];
    return (fallback.data ?? []).map((row) => mapBasicReportRow(row as Record<string, unknown>));
  }

  return (data ?? []).map((row) => {
    const rawBarangay = row.barangays as unknown;
    const barangay = Array.isArray(rawBarangay) ? null : (rawBarangay as { name: string; brochure_photo_urls?: string[] } | null);
    const rawMun = barangay && typeof barangay === 'object' && 'municipalities' in barangay ? (barangay as { municipalities?: unknown }).municipalities : null;
    const municipality = Array.isArray(rawMun) ? null : (rawMun as { name: string } | null);
    const notesAgg = (row as { report_notes?: { count?: number }[] }).report_notes ?? [];
    const upvotesAgg = (row as { report_upvotes?: { count?: number }[] }).report_upvotes ?? [];
    const commentCount = notesAgg[0]?.count ?? 0;
    const upvoteCount = upvotesAgg[0]?.count ?? 0;
    return {
      id: row.id,
      reporterId: row.reporter_id,
      publisherName: formatPublisherName(row.profiles as { first_name?: string; last_name?: string } | null),
      publisherAvatarUrl: (row.profiles as { avatar_url?: string } | null)?.avatar_url ?? null,
      barangayId: row.barangay_id,
      barangayName: barangay?.name ?? 'Unknown',
      municipalityName: (municipality && typeof municipality === 'object' && 'name' in municipality ? municipality.name : null) ?? '',
      profileImageUrl: firstBrochureUrl(barangay?.brochure_photo_urls) ?? null,
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
      createdAt: row.created_at,
      updatedAt: (row as { updated_at?: string }).updated_at,
      commentCount,
      upvoteCount
    };
  });
}

/**
 * Fetch all hazard reports for a single barangay (for resident "Local Reports").
 * Includes reports with or without GPS so every report in the barangay is shown.
 */
export async function fetchReportsByBarangayId(barangayId: string): Promise<HazardReport[]> {
  if (!barangayId) return [];
  const { data, error } = await supabase
    .from('reports')
    .select(
      `
      id,
      reporter_id,
      barangay_id,
      status,
      title,
      description,
      gps_lat,
      gps_lng,
      photo_urls,
      video_urls,
      created_at,
      updated_at,
      profiles!reporter_id ( first_name, last_name, avatar_url ),
      barangays ( name, brochure_photo_urls, municipalities ( name ) ),
      report_notes ( count ),
      report_upvotes ( count )
    `
    )
    .eq('barangay_id', barangayId)
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .from('reports')
      .select(BASE_REPORT_SELECT)
      .eq('barangay_id', barangayId)
      .order('created_at', { ascending: false });
    if (fallback.error) return [];
    return (fallback.data ?? []).map((row) => mapBasicReportRow(row as Record<string, unknown>));
  }

  return (data ?? []).map((row) => mapReportRowToHazardReport(row));
}

function mapReportRowToHazardReport(row: Record<string, unknown>): HazardReport {
  const rawBarangay = row.barangays as unknown;
  const barangay = Array.isArray(rawBarangay) ? null : (rawBarangay as { name: string; brochure_photo_urls?: string[] } | null);
  const rawMun = barangay && typeof barangay === 'object' && 'municipalities' in barangay ? (barangay as { municipalities?: unknown }).municipalities : null;
  const municipality = Array.isArray(rawMun) ? null : (rawMun as { name: string } | null);
  const notesAgg = (row as { report_notes?: { count?: number }[] }).report_notes ?? [];
  const upvotesAgg = (row as { report_upvotes?: { count?: number }[] }).report_upvotes ?? [];
  const commentCount = notesAgg[0]?.count ?? 0;
  const upvoteCount = upvotesAgg[0]?.count ?? 0;
  return {
    id: row.id as string,
    reporterId: row.reporter_id as string,
    publisherName: formatPublisherName(row.profiles as { first_name?: string; last_name?: string } | null),
    publisherAvatarUrl: (row.profiles as { avatar_url?: string } | null)?.avatar_url ?? null,
    barangayId: row.barangay_id as string,
    barangayName: barangay?.name ?? 'Unknown',
    municipalityName: (municipality && typeof municipality === 'object' && 'name' in municipality ? municipality.name : null) ?? '',
    profileImageUrl: firstBrochureUrl(barangay?.brochure_photo_urls) ?? null,
    status: row.status as string,
    title: (row.title as string) ?? null,
    description: (row.description as string) ?? null,
    gpsLat: row.gps_lat as number | null,
    gpsLng: row.gps_lng as number | null,
    photoUrls: Array.isArray(row.photo_urls)
      ? (row.photo_urls as string[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [],
    videoUrls: Array.isArray(row.video_urls)
      ? (row.video_urls as string[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string | undefined,
    commentCount,
    upvoteCount
  };
}

function mapBasicReportRow(row: Record<string, unknown>): HazardReport {
  return {
    id: row.id as string,
    reporterId: (row.reporter_id as string) ?? '',
    publisherName: 'Unknown',
    publisherAvatarUrl: null,
    barangayId: (row.barangay_id as string) ?? '',
    barangayName: 'Unknown',
    municipalityName: '',
    profileImageUrl: null,
    status: (row.status as string) ?? 'pending',
    title: (row.title as string) ?? null,
    description: (row.description as string) ?? null,
    gpsLat: (row.gps_lat as number | null) ?? null,
    gpsLng: (row.gps_lng as number | null) ?? null,
    photoUrls: Array.isArray(row.photo_urls)
      ? (row.photo_urls as string[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [],
    videoUrls: Array.isArray(row.video_urls)
      ? (row.video_urls as string[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [],
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: row.updated_at as string | undefined,
    commentCount: 0,
    upvoteCount: 0
  };
}

/**
 * Fetch hazard reports for multiple barangays (e.g. for municipal view).
 * Only includes reports with GPS (for map markers).
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
      status,
      title,
      description,
      gps_lat,
      gps_lng,
      photo_urls,
      video_urls,
      created_at,
      updated_at,
      profiles!reporter_id ( first_name, last_name, avatar_url ),
      barangays ( name, brochure_photo_urls, municipalities ( name ) ),
      report_notes ( count ),
      report_upvotes ( count )
    `
    )
    .in('barangay_id', barangayIds)
    .not('gps_lat', 'is', null)
    .not('gps_lng', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .from('reports')
      .select(BASE_REPORT_SELECT)
      .in('barangay_id', barangayIds)
      .not('gps_lat', 'is', null)
      .not('gps_lng', 'is', null)
      .order('created_at', { ascending: false });
    if (fallback.error) return [];
    return (fallback.data ?? []).map((row) => mapBasicReportRow(row as Record<string, unknown>));
  }

  return (data ?? []).map((row) => mapReportRowToHazardReport(row as Record<string, unknown>));
}

/**
 * Fetch all reports for the resident newsfeed — no GPS filter so every report appears.
 * Ordered newest-first. Limit defaults to 20 posts per load.
 */
export async function fetchFeedPosts(limit = 20): Promise<HazardReport[]> {
  const { data, error } = await supabase
    .from('reports')
    .select(
      `
      id,
      reporter_id,
      barangay_id,
      status,
      title,
      description,
      gps_lat,
      gps_lng,
      photo_urls,
      video_urls,
      created_at,
      updated_at,
      profiles!reporter_id ( first_name, last_name, avatar_url ),
      barangays ( name, brochure_photo_urls, municipalities ( name ) ),
      report_notes ( count ),
      report_upvotes ( count )
    `
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    const fallback = await supabase
      .from('reports')
      .select(BASE_REPORT_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (fallback.error) return [];
    return (fallback.data ?? []).map((row) => mapBasicReportRow(row as Record<string, unknown>));
  }

  return (data ?? []).map((row) => {
    const rawBarangay = row.barangays as unknown;
    const barangay = Array.isArray(rawBarangay) ? null : (rawBarangay as { name: string; brochure_photo_urls?: string[] } | null);
    const rawMun = barangay && typeof barangay === 'object' && 'municipalities' in barangay ? (barangay as { municipalities?: unknown }).municipalities : null;
    const municipality = Array.isArray(rawMun) ? null : (rawMun as { name: string } | null);
    const notesAgg = (row as { report_notes?: { count?: number }[] }).report_notes ?? [];
    const upvotesAgg = (row as { report_upvotes?: { count?: number }[] }).report_upvotes ?? [];
    const commentCount = notesAgg[0]?.count ?? 0;
    const upvoteCount = upvotesAgg[0]?.count ?? 0;
    return {
      id: row.id,
      reporterId: row.reporter_id,
      publisherName: formatPublisherName(row.profiles as { first_name?: string; last_name?: string } | null),
      publisherAvatarUrl: (row.profiles as { avatar_url?: string } | null)?.avatar_url ?? null,
      barangayId: row.barangay_id,
      barangayName: barangay?.name ?? 'Unknown',
      municipalityName: (municipality && typeof municipality === 'object' && 'name' in municipality ? municipality.name : null) ?? '',
      profileImageUrl: firstBrochureUrl(barangay?.brochure_photo_urls) ?? null,
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
      createdAt: row.created_at,
      updatedAt: (row as { updated_at?: string }).updated_at,
      commentCount,
      upvoteCount
    };
  });
}

/**
 * Fetch hazard reports by reporter (for resident "Your Contributions").
 */
export async function fetchReportsByReporter(reporterId: string): Promise<HazardReport[]> {
  const { data, error } = await supabase
    .from('reports')
    .select(
      `
      id,
      reporter_id,
      barangay_id,
      status,
      title,
      description,
      gps_lat,
      gps_lng,
      photo_urls,
      video_urls,
      created_at,
      updated_at,
      profiles!reporter_id ( first_name, last_name, avatar_url ),
      barangays ( name, brochure_photo_urls, municipalities ( name ) ),
      report_notes ( count ),
      report_upvotes ( count )
    `
    )
    .eq('reporter_id', reporterId)
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .from('reports')
      .select(BASE_REPORT_SELECT)
      .eq('reporter_id', reporterId)
      .order('created_at', { ascending: false });
    if (fallback.error) return [];
    return (fallback.data ?? []).map((row) => mapBasicReportRow(row as Record<string, unknown>));
  }

  return (data ?? []).map((row) => {
    const rawBarangay = row.barangays as unknown;
    const barangay = Array.isArray(rawBarangay) ? null : (rawBarangay as { name: string; brochure_photo_urls?: string[] } | null);
    const rawMun = barangay && typeof barangay === 'object' && 'municipalities' in barangay ? (barangay as { municipalities?: unknown }).municipalities : null;
    const municipality = Array.isArray(rawMun) ? null : (rawMun as { name: string } | null);
    const notesAgg = (row as { report_notes?: { count?: number }[] }).report_notes ?? [];
    const upvotesAgg = (row as { report_upvotes?: { count?: number }[] }).report_upvotes ?? [];
    const commentCount = notesAgg[0]?.count ?? 0;
    const upvoteCount = upvotesAgg[0]?.count ?? 0;
    return {
      id: row.id,
      reporterId: row.reporter_id,
      publisherName: formatPublisherName(row.profiles as { first_name?: string; last_name?: string } | null),
      publisherAvatarUrl: (row.profiles as { avatar_url?: string } | null)?.avatar_url ?? null,
      barangayId: row.barangay_id,
      barangayName: barangay?.name ?? 'Unknown',
      municipalityName: (municipality && typeof municipality === 'object' && 'name' in municipality ? municipality.name : null) ?? '',
      profileImageUrl: firstBrochureUrl(barangay?.brochure_photo_urls) ?? null,
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
      createdAt: row.created_at,
      updatedAt: (row as { updated_at?: string }).updated_at,
      commentCount,
      upvoteCount
    };
  });
}

/**
 * Fetch all comments (report_notes) for a given report.
 */
export async function fetchReportNotes(reportId: string): Promise<ReportNote[]> {
  const { data, error } = await supabase
    .from('report_notes')
    .select(
      `
      id,
      report_id,
      author_id,
      body,
      photo_urls,
      created_at,
      parent_note_id,
      profiles!author_id ( first_name, last_name )
    `
    )
    .eq('report_id', reportId)
    .order('created_at', { ascending: true });

  if (error) return [];

  return (data ?? []).map((row) => {
    const profile = (row as { profiles?: { first_name?: string; last_name?: string } | null }).profiles ?? null;
    const first = (profile?.first_name ?? '').trim();
    const last = (profile?.last_name ?? '').trim();
    const authorName = [first, last].filter(Boolean).join(' ') || 'Unknown';
    const rawPhotoUrls = (row as { photo_urls?: unknown }).photo_urls;
    const photoUrls = Array.isArray(rawPhotoUrls)
      ? (rawPhotoUrls as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [];
    return {
      id: row.id,
      reportId: row.report_id,
      authorId: row.author_id,
      authorName,
      body: row.body,
      photoUrls,
      parentNoteId: (row as { parent_note_id?: string | null }).parent_note_id ?? null,
      createdAt: row.created_at
    };
  });
}

/**
 * Create a new comment (report_note) for a report on behalf of the current user.
 */
export async function createReportNote(
  reportId: string,
  body: string,
  options: { photoUrls?: string[]; parentNoteId?: string | null } = {}
): Promise<{ error: string | null }> {
  const trimmed = body.trim();
  if (trimmed.length < 2) {
    return { error: 'Comment must be at least 2 characters long.' };
  }

  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user) {
    return { error: 'You must be signed in to comment.' };
  }

  const { photoUrls = [], parentNoteId = null } = options;

  const { error } = await supabase
    .from('report_notes')
    .insert({
      report_id: reportId,
      author_id: user.id,
      body: trimmed,
      photo_urls: photoUrls,
      parent_note_id: parentNoteId
    });

  return { error: error?.message ?? null };
}

/**
 * Toggle an upvote for the current user on the given report.
 * If an upvote exists it is removed; otherwise it is created.
 * Returns the new "hasUpvoted" state.
 */
export async function toggleReportUpvote(reportId: string): Promise<{ hasUpvoted: boolean; error: string | null }> {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user) {
    return { hasUpvoted: false, error: 'You must be signed in to upvote.' };
  }

  const { data: existing, error: selectError } = await supabase
    .from('report_upvotes')
    .select('id')
    .eq('report_id', reportId)
    .eq('user_id', user.id)
    .limit(1);

  if (selectError) {
    return { hasUpvoted: false, error: selectError.message };
  }

  const alreadyUpvoted = (existing ?? []).length > 0;

  if (alreadyUpvoted) {
    const { error: deleteError } = await supabase
      .from('report_upvotes')
      .delete()
      .eq('report_id', reportId)
      .eq('user_id', user.id);
    if (deleteError) {
      return { hasUpvoted: true, error: deleteError.message };
    }
    return { hasUpvoted: false, error: null };
  }

  const { error: insertError } = await supabase
    .from('report_upvotes')
    .insert({
      report_id: reportId,
      user_id: user.id
    });

  return { hasUpvoted: !insertError, error: insertError?.message ?? null };
}

/**
 * Update a hazard report (title, description, media). Only the reporter can update.
 */
export async function updateHazardReport(
  reportId: string,
  reporterId: string,
  params: { title?: string; description?: string; photoUrls?: string[]; videoUrls?: string[] }
): Promise<{ error: string | null }> {
  const updates: Record<string, unknown> = {};
  if (params.title !== undefined) updates.title = params.title.trim();
  if (params.description !== undefined) updates.description = params.description?.trim() ?? null;
  if (params.photoUrls !== undefined) updates.photo_urls = params.photoUrls;
  if (params.videoUrls !== undefined) updates.video_urls = params.videoUrls;
  if (Object.keys(updates).length === 0) return { error: null };

  const { error } = await supabase
    .from('reports')
    .update(updates)
    .eq('id', reportId)
    .eq('reporter_id', reporterId);

  return { error: error?.message ?? null };
}

/**
 * Delete a hazard report. Only the reporter can delete.
 */
export async function deleteHazardReport(reportId: string, reporterId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('reports')
    .delete()
    .eq('id', reportId)
    .eq('reporter_id', reporterId);
  return { error: error?.message ?? null };
}

/**
 * Create a new hazard report. Requires current GPS location.
 */
export async function createHazardReport(params: {
  barangayId: string;
  reporterId: string;
  title: string;
  description: string;
  gpsLat: number;
  gpsLng: number;
  photoUrls: string[];
  videoUrls: string[];
}): Promise<{ id: string | null; error: string | null }> {
  if ((params.description?.trim() ?? '').length < 5) {
    return { id: null, error: 'Please describe the situation (at least 5 characters).' };
  }
  if ((params.photoUrls?.length ?? 0) + (params.videoUrls?.length ?? 0) < 1) {
    return { id: null, error: 'Please attach at least one photo or video before submitting.' };
  }
  const { data, error } = await supabase
    .from('reports')
    .insert({
      reporter_id: params.reporterId,
      barangay_id: params.barangayId,
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
/**
 * Subscribe to live changes on `public.reports`. Requires the table in publication `supabase_realtime`
 * and a SELECT policy that allows the current role to see relevant rows (e.g. `reports_select_public`).
 * Uses a unique channel id per subscription so multiple map instances or tabs do not clash.
 */
export function subscribeReportsRealtime(onUpdate: () => void): RealtimeChannel {
  const channelId = `hazard-reports-${crypto.randomUUID()}`;
  const channel = supabase
    .channel(channelId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reports' },
      () => onUpdate()
    )
    .subscribe();
  return channel;
}
