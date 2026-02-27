/**
 * Barangay Profile Service
 * ───────────────────────
 * Manages barangay description and brochure photos. Barangay responders can add
 * their barangay's specialty/description and photos; all users see this when
 * clicking a barangay on the map (small brochure).
 */

import { supabase } from '$lib/supabase';

const BUCKET = 'barangay-brochure-photos';
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface BarangayProfile {
  description: string | null;
  brochurePhotoUrls: string[];
}

/**
 * Fetch barangay profile (description + brochure photo URLs).
 * Returns null if barangay not found or no profile set.
 */
export async function fetchBarangayProfile(
  barangayId: string
): Promise<BarangayProfile | null> {
  if (!barangayId?.trim()) return null;

  const { data, error } = await supabase
    .from('barangays')
    .select('description, brochure_photo_urls')
    .eq('id', barangayId)
    .single();

  if (error || !data) return null;

  const urls = Array.isArray(data.brochure_photo_urls)
    ? (data.brochure_photo_urls as string[]).filter(
        (u): u is string => typeof u === 'string' && u.trim().length > 0
      )
    : [];

  return {
    description: data.description?.trim() || null,
    brochurePhotoUrls: urls
  };
}

/**
 * Update barangay profile (description + brochure photo URLs).
 * Only barangay responders with access to the barangay can update.
 */
export async function updateBarangayProfile(
  barangayId: string,
  description: string,
  brochurePhotoUrls: string[]
): Promise<{ success: boolean; error: string | null }> {
  if (!barangayId?.trim()) {
    return { success: false, error: 'Barangay ID is required.' };
  }

  const { data, error } = await supabase.rpc('update_barangay_profile', {
    p_barangay_id: barangayId,
    p_description: description.trim(),
    p_brochure_photo_urls: brochurePhotoUrls.filter((u) => u?.trim())
  });

  if (error) return { success: false, error: error.message };
  if (data !== true) return { success: false, error: 'Update denied. Check your access.' };
  return { success: true, error: null };
}

/**
 * Upload a brochure photo to storage.
 * Returns the public URL or null on failure.
 */
export async function uploadBrochurePhoto(file: File): Promise<string | null> {
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
 * Validate brochure photo file before upload.
 */
export function validateBrochurePhoto(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Only JPG, PNG, or WebP images are allowed.';
  }
  if (file.size > MAX_SIZE) {
    return 'File must be under 5 MB.';
  }
  return null;
}
