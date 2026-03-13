-- Migration: Add report_upvotes table and allow residents to comment on reports.
-- This enables per-user upvotes (1 per user per report) and resident comments.

-- Create report_upvotes table for per-user upvotes on hazard reports
CREATE TABLE IF NOT EXISTS public.report_upvotes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure one upvote per user per report at the database level
CREATE UNIQUE INDEX IF NOT EXISTS report_upvotes_report_user_key
  ON public.report_upvotes(report_id, user_id);

ALTER TABLE public.report_upvotes ENABLE ROW LEVEL SECURITY;

-- RLS: residents can insert/select/delete their own upvotes; admins can manage all
DROP POLICY IF EXISTS "report_upvotes_select_own" ON public.report_upvotes;
CREATE POLICY "report_upvotes_select_own" ON public.report_upvotes FOR SELECT USING (
  user_id = auth.uid()
  OR public.current_user_role() IN ('admin', 'super_admin')
);

DROP POLICY IF EXISTS "report_upvotes_insert_resident_own" ON public.report_upvotes;
CREATE POLICY "report_upvotes_insert_resident_own" ON public.report_upvotes FOR INSERT WITH CHECK (
  public.current_user_role() = 'resident' AND user_id = auth.uid()
);

DROP POLICY IF EXISTS "report_upvotes_delete_resident_own" ON public.report_upvotes;
CREATE POLICY "report_upvotes_delete_resident_own" ON public.report_upvotes FOR DELETE USING (
  public.current_user_role() = 'resident' AND user_id = auth.uid()
);

DROP POLICY IF EXISTS "report_upvotes_modify_admin" ON public.report_upvotes;
CREATE POLICY "report_upvotes_modify_admin" ON public.report_upvotes FOR ALL USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

-- Allow residents to insert comments (report_notes) on any report they can see.
-- Existing LGU/admin policies remain; we only add a resident insert policy.
DROP POLICY IF EXISTS "report_notes_insert_resident" ON public.report_notes;
CREATE POLICY "report_notes_insert_resident" ON public.report_notes FOR INSERT WITH CHECK (
  public.current_user_role() = 'resident' AND author_id = auth.uid()
);

-- Optional photo attachments for comments
ALTER TABLE public.report_notes
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] DEFAULT '{}'::TEXT[];

-- Optional parent note for simple reply threading
ALTER TABLE public.report_notes
  ADD COLUMN IF NOT EXISTS parent_note_id UUID REFERENCES public.report_notes(id) ON DELETE CASCADE;


