/**
 * Barangay Boundary Service
 * ────────────────────────
 * Workflow: LGU maps their own barangay area → submits for approval → admin confirms.
 * LGUs can draw a boundary without being pre-assigned; admin approves and assigns them.
 */

import { supabase } from '$lib/supabase';

/* ── Barangay info for LGU responder (after admin approval or join) ── */
export interface BarangayInfo {
  id: string;
  name: string;
  municipalityName: string;
  hasBoundary: boolean;
  isApproved: boolean;
  isCreator: boolean;
}

/* ── Pending boundary request (awaiting admin/municipal approval) ── */
export interface PendingBoundaryRequest {
  id: string;
  municipalityId: string;
  municipalityName: string;
  barangayId: string | null;
  barangayName: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

/* ── Boundary request for municipal approval list ── */
export interface BoundaryRequestForMunicipal {
  id: string;
  barangayName: string;
  municipalityName: string;
  requesterName: string;
  contactEmail: string;
  contactPhone: string;
  createdAt: string;
  boundaryGeojson: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}

/* ── Municipality for dropdown ── */
export interface Municipality {
  id: string;
  name: string;
}

/* ── Barangay for dropdown (existing barangays in municipality) ── */
export interface BarangayOption {
  id: string;
  name: string;
  hasBoundary: boolean;
}

/**
 * Fetch municipalities for the boundary request dropdown.
 */
export async function fetchMunicipalities(): Promise<Municipality[]> {
  const { data, error } = await supabase
    .from('municipalities')
    .select('id, name')
    .order('name');

  if (error) return [];
  return data ?? [];
}

/**
 * Fetch barangays in a municipality (for selecting existing or creating new).
 */
export async function fetchBarangaysByMunicipality(municipalityId: string): Promise<BarangayOption[]> {
  const { data, error } = await supabase
    .from('barangays')
    .select('id, name, boundary_geojson')
    .eq('municipality_id', municipalityId)
    .order('name');

  if (error) return [];

  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    hasBoundary: !!b.boundary_geojson
  }));
}

/**
 * Fetch the barangay assigned to the LGU (from profile + membership for isCreator).
 */
export async function fetchBarangayForResponder(userId: string): Promise<BarangayInfo | null> {
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('barangay_id')
    .eq('id', userId)
    .single();

  if (profileErr || !profile?.barangay_id) return null;

  const [barangayRes, membershipRes] = await Promise.all([
    supabase
      .from('barangays')
      .select(`id, name, boundary_geojson, boundary_approved_at, created_by, municipalities ( name )`)
      .eq('id', profile.barangay_id)
      .single(),
    supabase
      .from('lgu_barangay_memberships')
      .select('is_creator')
      .eq('profile_id', userId)
      .eq('barangay_id', profile.barangay_id)
      .is('left_at', null)
      .maybeSingle()
  ]);

  const { data: barangay, error } = barangayRes;
  if (error || !barangay) return null;

  const isCreator =
    barangay.created_by != null
      ? barangay.created_by === userId
      : (membershipRes.data?.is_creator ?? true);

  return {
    id: barangay.id,
    name: barangay.name,
    municipalityName: (barangay.municipalities as { name: string } | null)?.name ?? '',
    hasBoundary: !!barangay.boundary_geojson,
    isApproved: !!barangay.boundary_approved_at,
    isCreator
  };
}

/**
 * Fetch the LGU's pending boundary request (if any).
 */
export async function fetchPendingBoundaryRequest(userId: string): Promise<PendingBoundaryRequest | null> {
  const { data, error } = await supabase
    .from('barangay_boundary_requests')
    .select(`
      id,
      municipality_id,
      barangay_id,
      barangay_name,
      status,
      created_at,
      municipalities ( name )
    `)
    .eq('requested_by', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  if (!data) return null;

  return {
    id: data.id,
    municipalityId: data.municipality_id,
    municipalityName: (data.municipalities as { name: string } | null)?.name ?? '',
    barangayId: data.barangay_id,
    barangayName: data.barangay_name,
    status: data.status as 'pending' | 'approved' | 'rejected',
    createdAt: data.created_at
  };
}

/**
 * Fetch pending boundary requests for municipal responder (requests in their municipality).
 * Includes creator name (Last, First), contact email/phone, date, and boundary geojson for locate.
 */
export async function fetchPendingBoundaryRequestsForMunicipal(): Promise<BoundaryRequestForMunicipal[]> {
  const { data, error } = await supabase
    .from('barangay_boundary_requests')
    .select(`
      id,
      barangay_name,
      created_at,
      contact_email,
      contact_phone,
      boundary_geojson,
      municipalities ( name ),
      profiles!requested_by ( first_name, last_name, email, phone )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) return [];

  return (data ?? []).map((r) => {
    const profile = r.profiles as { first_name?: string; last_name?: string; email?: string; phone?: string } | null;
    const lastName = profile?.last_name?.trim() ?? '';
    const firstName = profile?.first_name?.trim() ?? '';
    const requesterName = [lastName, firstName].filter(Boolean).join(', ') || 'Unknown';
    const contactEmail = r.contact_email?.trim() || profile?.email?.trim() || '—';
    const contactPhone = r.contact_phone?.trim() || profile?.phone?.trim() || '—';
    return {
      id: r.id,
      barangayName: r.barangay_name,
      municipalityName: (r.municipalities as { name: string } | null)?.name ?? '',
      requesterName,
      contactEmail,
      contactPhone,
      createdAt: r.created_at,
      boundaryGeojson: (r.boundary_geojson as GeoJSON.Polygon | GeoJSON.MultiPolygon) ?? null
    };
  });
}

/**
 * Approve a boundary request. Municipal responder (for their municipality) or admin/super_admin.
 */
export async function approveBoundaryRequest(requestId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('approve_barangay_boundary_request', {
    p_request_id: requestId
  });

  if (error) return { success: false, error: error.message };
  if (data !== true) return { success: false, error: 'Unable to approve. You may not have permission or the request was already processed.' };

  return { success: true };
}

/**
 * Reject a boundary request with reason. Municipal responder or admin/super_admin.
 */
export async function rejectBoundaryRequest(
  requestId: string,
  rejectionReason?: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('reject_barangay_boundary_request', {
    p_request_id: requestId,
    p_rejection_reason: rejectionReason ?? ''
  });

  if (error) return { success: false, error: error.message };
  if (data !== true) return { success: false, error: 'Unable to reject. You may not have permission or the request was already processed.' };

  return { success: true };
}

/**
 * Submit a boundary request. Requires contact email and phone. Municipal/admin approves later.
 */
export async function submitBoundaryRequest(
  municipalityId: string,
  barangayId: string | null,
  barangayName: string,
  boundaryGeojson: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  contactEmail: string,
  contactPhone: string,
  description?: string
): Promise<{ success: boolean; requestId?: string; error?: string }> {
  const { data, error } = await supabase.rpc('submit_barangay_boundary_request', {
    p_municipality_id: municipalityId,
    p_barangay_id: barangayId ?? '00000000-0000-0000-0000-000000000000',
    p_barangay_name: barangayName.trim(),
    p_boundary_geojson: boundaryGeojson,
    p_contact_email: contactEmail.trim(),
    p_contact_phone: contactPhone.trim(),
    p_description: description?.trim() ?? null
  });

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'Submission failed. Contact email and phone are required.' };

  return { success: true, requestId: data as string };
}

/**
 * Save the drawn boundary. Creators: creates a request (admin approval required). Joiners: denied.
 */
export async function saveBarangayBoundary(
  barangayId: string,
  geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon
): Promise<{ success: boolean; isRequest?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('save_barangay_boundary', {
    p_barangay_id: barangayId,
    p_boundary_geojson: geojson
  });

  if (error) return { success: false, error: error.message };
  if (data !== true) return { success: false, error: 'Only the barangay creator can request boundary updates. Admin approval required.' };

  return { success: true, isRequest: true };
}

/* ── Joinable barangay (approved, has boundary, for LGU without barangay) ── */
export interface JoinableBarangay {
  id: string;
  name: string;
  municipalityName: string;
}

/**
 * Fetch barangays an LGU can join (approved, with boundary, excluding own).
 */
export async function fetchJoinableBarangays(): Promise<JoinableBarangay[]> {
  const { data, error } = await supabase
    .from('barangays')
    .select('id, name, boundary_geojson, boundary_approved_at, municipalities ( name )')
    .not('boundary_approved_at', 'is', null)
    .not('boundary_geojson', 'is', null)
    .order('name');

  if (error) return [];

  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    municipalityName: (b.municipalities as { name: string } | null)?.name ?? ''
  }));
}

/**
 * Join an existing barangay. Call when LGU has no current barangay.
 */
export async function joinBarangay(barangayId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('join_barangay', { p_barangay_id: barangayId });

  if (error) return { success: false, error: error.message };
  if (data !== true) return { success: false, error: 'Could not join. You may already be in a barangay or it is not available.' };

  return { success: true };
}

/**
 * Leave current barangay with optional reason.
 */
export async function leaveBarangay(reason?: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('leave_barangay', { p_reason: reason ?? '' });

  if (error) return { success: false, error: error.message };
  if (data !== true) return { success: false, error: 'Could not leave. You may not be in a barangay.' };

  return { success: true };
}

/* ── Change request (creator update/delete, pending admin) ── */
export interface BarangayChangeRequest {
  id: string;
  barangayId: string;
  barangayName: string;
  requestType: 'update_boundary' | 'delete_barangay';
  status: string;
  createdAt: string;
}

/**
 * Fetch pending change requests for the current LGU.
 */
export async function fetchPendingChangeRequests(userId: string): Promise<BarangayChangeRequest[]> {
  const { data, error } = await supabase
    .from('barangay_change_requests')
    .select('id, barangay_id, request_type, status, created_at, barangays ( name )')
    .eq('requested_by', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) return [];

  return (data ?? []).map((r) => ({
    id: r.id,
    barangayId: r.barangay_id,
    barangayName: (r.barangays as { name: string } | null)?.name ?? '',
    requestType: r.request_type as 'update_boundary' | 'delete_barangay',
    status: r.status,
    createdAt: r.created_at
  }));
}

/**
 * Creator requests barangay delete. Admin approves via SQL.
 */
export async function requestBarangayDelete(
  barangayId: string,
  reason?: string
): Promise<{ success: boolean; requestId?: string; error?: string }> {
  const { data, error } = await supabase.rpc('request_barangay_delete', {
    p_barangay_id: barangayId,
    p_reason: reason ?? ''
  });

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'Only the barangay creator can request deletion. Admin approval required.' };

  return { success: true, requestId: data as string };
}
