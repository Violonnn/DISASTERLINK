-- Migration: Let residents (and any authenticated user) see comments on all reports.
-- Reports are already public (reports_select_public); report_notes SELECT was still
-- limited to own reports / LGU barangay / admin, so comments did not show for residents
-- on other users' reports.

CREATE POLICY "report_notes_select_authenticated" ON public.report_notes
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_notes.report_id)
  );
