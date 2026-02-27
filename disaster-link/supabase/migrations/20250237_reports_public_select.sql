-- Migration: Allow all users (including guests) to view hazard reports on the map.
-- Reports are visible across all roles; upvote/comment gating is enforced in the app.

CREATE POLICY "reports_select_public" ON public.reports FOR SELECT
  USING (true);
