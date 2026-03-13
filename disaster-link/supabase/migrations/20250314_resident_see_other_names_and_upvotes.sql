-- Migration: Let residents (and other authenticated users) see other users' display names
-- and see all report upvotes so counts and comments display correctly in the dashboard/feed.
--
-- 1. Profiles: allow any authenticated user to SELECT profiles so that report publisher
--    and comment author names (first_name, last_name, avatar_url) resolve in joins.
-- 2. report_upvotes: allow any authenticated user to SELECT all upvote rows so that
--    per-report upvote counts are correct when fetched via reports → report_upvotes (count).

-- Profiles: allow authenticated users to read profile rows (for display names in reports/notes)
CREATE POLICY "profiles_select_authenticated_display" ON public.profiles
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- report_upvotes: allow authenticated users to read all upvote rows (for correct counts)
CREATE POLICY "report_upvotes_select_authenticated" ON public.report_upvotes
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
