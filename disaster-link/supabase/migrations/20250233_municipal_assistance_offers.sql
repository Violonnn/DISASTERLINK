-- Migration: Allow municipal responders to provide assistance.
-- Municipal offers show as "Municipality of {name}" in the log, with optional image.

-- Add helping_municipality_id and image column; make helping_barangay_id nullable for municipal
ALTER TABLE public.barangay_assistance_offers ADD COLUMN IF NOT EXISTS helping_municipality_id UUID REFERENCES public.municipalities(id) ON DELETE CASCADE;
ALTER TABLE public.barangay_assistance_offers ADD COLUMN IF NOT EXISTS assistance_image_url TEXT;

-- Make helping_barangay_id nullable (municipal uses helping_municipality_id instead)
ALTER TABLE public.barangay_assistance_offers ALTER COLUMN helping_barangay_id DROP NOT NULL;

-- Replace constraint: either barangay or municipality helps; no self-assistance when barangay
ALTER TABLE public.barangay_assistance_offers DROP CONSTRAINT IF EXISTS no_self_assistance;
ALTER TABLE public.barangay_assistance_offers ADD CONSTRAINT no_self_assistance CHECK (
  (helping_barangay_id IS NULL OR helping_barangay_id != recipient_barangay_id)
  AND (helping_barangay_id IS NOT NULL OR helping_municipality_id IS NOT NULL)
);

-- RLS: allow municipal to insert with helping_municipality_id (their municipality)
DROP POLICY IF EXISTS "assistance_insert_lgu" ON public.barangay_assistance_offers;
CREATE POLICY "assistance_insert_lgu" ON public.barangay_assistance_offers FOR INSERT WITH CHECK (
  created_by = auth.uid()
  AND (
    (
      public.current_user_role() IN ('lgu_responder', 'barangay_responder')
      AND helping_barangay_id = public.current_user_barangay_id()
      AND helping_barangay_id != recipient_barangay_id
    )
    OR
    (
      public.current_user_role() = 'municipal_responder'
      AND helping_municipality_id = public.current_user_municipality_id()
      AND helping_barangay_id IS NULL
    )
  )
);

-- RLS: municipal can update (mark delivered) their municipality's assistance
DROP POLICY IF EXISTS "assistance_update_own" ON public.barangay_assistance_offers;
CREATE POLICY "assistance_update_own" ON public.barangay_assistance_offers FOR UPDATE USING (
  (public.current_user_role() IN ('lgu_responder', 'barangay_responder') AND helping_barangay_id = public.current_user_barangay_id())
  OR (public.current_user_role() = 'municipal_responder' AND helping_municipality_id = public.current_user_municipality_id())
);

-- Storage bucket for assistance photos (optional image when providing assistance)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('assistance-photos', 'assistance-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "assistance_photos_select" ON storage.objects;
CREATE POLICY "assistance_photos_select" ON storage.objects FOR SELECT USING (bucket_id = 'assistance-photos');

DROP POLICY IF EXISTS "assistance_photos_insert" ON storage.objects;
CREATE POLICY "assistance_photos_insert" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'assistance-photos' AND auth.role() = 'authenticated'
);
