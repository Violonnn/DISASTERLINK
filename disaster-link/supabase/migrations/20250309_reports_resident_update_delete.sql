-- Migration: Allow residents to update and delete their own reports (for Contributions edit/delete).
-- Run this migration so contribution edit/delete work for residents.

DROP POLICY IF EXISTS "reports_update_resident_own" ON public.reports;
-- Resident can update only their own report (reporter_id = auth.uid()).
CREATE POLICY "reports_update_resident_own" ON public.reports FOR UPDATE
  USING (public.current_user_role() = 'resident' AND reporter_id = auth.uid());

DROP POLICY IF EXISTS "reports_delete_resident_own" ON public.reports;
-- Resident can delete only their own report.
CREATE POLICY "reports_delete_resident_own" ON public.reports FOR DELETE
  USING (public.current_user_role() = 'resident' AND reporter_id = auth.uid());
