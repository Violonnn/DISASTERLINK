/**
 * Barangay Assistance Service
 * ─────────────────────────
 * When a barangay is in need (resources, manpower, active disaster), barangays or
 * municipalities can offer assistance. This service handles creating offers,
 * marking as delivered, and fetching the assistance log for a recipient barangay.
 */

import { supabase } from '$lib/supabase';

const ASSISTANCE_BUCKET = 'assistance-photos';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export interface AssistanceOffer {
  id: string;
  helpingBarangayId: string | null;
  helpingBarangayName: string | null;
  helpingMunicipalityId: string | null;
  helpingMunicipalityName: string | null;
  recipientBarangayId: string;
  recipientBarangayName: string;
  statusUpdateId: string | null;
  description: string;
  assistanceImageUrl: string | null;
  expectedArrivalAt: string | null;
  deliveredAt: string | null;
  createdBy: string;
  creatorName: string;
  createdAt: string;
}

/**
 * Fetch assistance offers where the given barangay is the recipient (for assistance log).
 */
export async function fetchAssistanceLogForBarangay(
  recipientBarangayId: string
): Promise<AssistanceOffer[]> {
  const { data, error } = await supabase
    .from('barangay_assistance_offers')
    .select(
      `
      id,
      helping_barangay_id,
      helping_municipality_id,
      assistance_image_url,
      recipient_barangay_id,
      status_update_id,
      description,
      expected_arrival_at,
      delivered_at,
      created_by,
      created_at,
      barangays!helping_barangay_id ( name ),
      municipalities!helping_municipality_id ( name ),
      profiles!created_by ( first_name, last_name )
    `
    )
    .eq('recipient_barangay_id', recipientBarangayId)
    .order('created_at', { ascending: false });

  if (error) return [];

  return (data ?? []).map((row) => {
    const isMunicipal = !!row.helping_municipality_id;
    return {
      id: row.id,
      helpingBarangayId: row.helping_barangay_id,
      helpingBarangayName: isMunicipal
        ? null
        : ((row.barangays as unknown as { name: string } | null)?.name ?? 'Unknown'),
      helpingMunicipalityId: row.helping_municipality_id,
      helpingMunicipalityName: isMunicipal
        ? (row.municipalities as unknown as { name: string } | null)?.name ?? 'Unknown'
        : null,
      recipientBarangayId: row.recipient_barangay_id,
      recipientBarangayName: '',
      statusUpdateId: row.status_update_id,
      description: row.description,
      assistanceImageUrl: row.assistance_image_url ?? null,
      expectedArrivalAt: row.expected_arrival_at,
      deliveredAt: row.delivered_at,
      createdBy: row.created_by,
      creatorName: formatCreatorName(
        row.profiles as { first_name?: string; last_name?: string } | null
      ),
      createdAt: row.created_at
    };
  });
}

function formatCreatorName(
  p: { first_name?: string; last_name?: string } | null
): string {
  if (!p) return 'Unknown';
  const fn = p.first_name?.trim() ?? '';
  const ln = p.last_name?.trim() ?? '';
  if (fn && ln) return `${fn} ${ln}`;
  return fn || ln || 'Unknown';
}

/**
 * Upload assistance photo to storage. Returns public URL or null.
 */
export async function uploadAssistancePhoto(file: File): Promise<string | null> {
  if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_SIZE) return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(ASSISTANCE_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (error) return null;
  const { data } = supabase.storage.from(ASSISTANCE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Validate assistance photo file.
 */
export function validateAssistancePhoto(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type))
    return 'Only JPG, PNG, or WebP images are allowed.';
  if (file.size > MAX_SIZE) return 'File must be under 5 MB.';
  return null;
}

/**
 * Create an assistance offer from the current user's barangay or municipality to a recipient barangay.
 */
export async function createAssistanceOffer(
  recipientBarangayId: string,
  description: string,
  userId: string,
  options?: {
    statusUpdateId?: string | null;
    expectedArrivalAt?: string | null;
    imageUrl?: string | null;
  }
): Promise<{ id: string | null; error: string | null }> {
  if (!description || description.trim().length < 3) {
    return { id: null, error: 'Please describe the assistance (at least 3 characters).' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('barangay_id, municipality_id, role')
    .eq('id', userId)
    .single();

  const isMunicipal = profile?.role === 'municipal_responder' && !!profile?.municipality_id;
  const helpingBarangayId = profile?.barangay_id ?? null;
  const helpingMunicipalityId = profile?.municipality_id ?? null;

  if (isMunicipal && helpingMunicipalityId) {
    // Municipal responder: use municipality
  } else if (helpingBarangayId) {
    if (helpingBarangayId === recipientBarangayId) {
      return { id: null, error: 'You cannot offer assistance to your own barangay.' };
    }
  } else {
    return { id: null, error: 'Your barangay or municipality is not assigned. Contact admin.' };
  }

  const payload = {
    helping_barangay_id: isMunicipal ? null : helpingBarangayId,
    helping_municipality_id: isMunicipal ? helpingMunicipalityId : null,
    recipient_barangay_id: recipientBarangayId,
    status_update_id: options?.statusUpdateId ?? null,
    description: description.trim(),
    assistance_image_url: options?.imageUrl ?? null,
    expected_arrival_at: options?.expectedArrivalAt ?? null,
    created_by: userId
  };

  const { data, error } = await supabase
    .from('barangay_assistance_offers')
    .insert(payload)
    .select('id')
    .single();

  if (error) return { id: null, error: error.message };
  return { id: data?.id ?? null, error: null };
}

/**
 * Mark an assistance offer as delivered.
 */
export async function markAssistanceDelivered(
  offerId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('barangay_assistance_offers')
    .update({ delivered_at: new Date().toISOString() })
    .eq('id', offerId);

  return { error: error?.message ?? null };
}

/**
 * Subscribe to realtime changes on assistance offers for a recipient barangay.
 */
export function subscribeAssistanceRealtime(
  recipientBarangayId: string,
  onUpdate: () => void
): ReturnType<typeof supabase.channel> {
  const channel = supabase
    .channel(`assistance-${recipientBarangayId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'barangay_assistance_offers',
        filter: `recipient_barangay_id=eq.${recipientBarangayId}`
      },
      () => onUpdate()
    )
    .subscribe();

  return channel;
}
