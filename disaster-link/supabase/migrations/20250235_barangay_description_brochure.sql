-- Migration: Barangay description and brochure photos (small profile for map popup).
-- Barangay responders can add specialty/description and photos; shown when any user clicks the barangay.

-- 1. Add description and brochure_photo_urls to barangays
ALTER TABLE public.barangays ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.barangays ADD COLUMN IF NOT EXISTS brochure_photo_urls TEXT[] DEFAULT '{}';

-- 2. RPC to update only profile fields (description, brochure_photo_urls) - enforces security
CREATE OR REPLACE FUNCTION public.update_barangay_profile(
  p_barangay_id UUID,
  p_description TEXT,
  p_brochure_photo_urls TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_can_access_barangay(p_barangay_id) THEN
    RETURN FALSE;
  END IF;

  UPDATE public.barangays
  SET
    description = NULLIF(TRIM(COALESCE(p_description, '')), ''),
    brochure_photo_urls = COALESCE(p_brochure_photo_urls, '{}')
  WHERE id = p_barangay_id;

  RETURN FOUND;
END;
$$;

-- 3. Storage bucket for barangay brochure photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('barangay-brochure-photos', 'barangay-brochure-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "barangay_brochure_photos_select" ON storage.objects;
CREATE POLICY "barangay_brochure_photos_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'barangay-brochure-photos');

DROP POLICY IF EXISTS "barangay_brochure_photos_insert" ON storage.objects;
CREATE POLICY "barangay_brochure_photos_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'barangay-brochure-photos' AND auth.role() = 'authenticated');
