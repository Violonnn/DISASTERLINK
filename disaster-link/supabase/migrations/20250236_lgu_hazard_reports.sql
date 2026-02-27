-- Migration: LGU hazard reports — allow LGU responders to create hazard/disaster reports
-- Reports appear as markers on the map within their barangay.
-- Extends reports table with video support and RLS for LGU insert.

-- =============================================================================
-- 1. Add video_urls column to reports (photos stay in photo_urls)
-- =============================================================================
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS video_urls JSONB DEFAULT '[]'::jsonb;

-- =============================================================================
-- 2. RLS: Allow barangay-level LGU responders to insert hazard reports
-- (Must have assigned barangay; can only report for that barangay)
-- =============================================================================
CREATE POLICY "reports_insert_lgu" ON public.reports FOR INSERT WITH CHECK (
  public.current_user_role() IN ('lgu_responder', 'barangay_responder')
  AND public.current_user_barangay_id() IS NOT NULL
  AND reporter_id = auth.uid()
  AND barangay_id = public.current_user_barangay_id()
);

-- =============================================================================
-- 3. Storage bucket for hazard report media (photos + videos)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hazard-report-media',
  'hazard-report-media',
  true,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "hazard_report_media_select" ON storage.objects;
CREATE POLICY "hazard_report_media_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'hazard-report-media');

DROP POLICY IF EXISTS "hazard_report_media_insert" ON storage.objects;
CREATE POLICY "hazard_report_media_insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'hazard-report-media'
    AND (auth.role() = 'authenticated')
  );

-- =============================================================================
-- 4. Realtime: Enable reports table for live marker updates (run in Supabase Dashboard if needed)
-- =============================================================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE reports;
