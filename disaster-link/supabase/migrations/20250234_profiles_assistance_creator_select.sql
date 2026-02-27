-- Allow barangay responders to read municipal responder profiles in same municipality
-- (needed for assistance log to show creator name e.g. "Jwymeth Jave (Municipal)")
DROP POLICY IF EXISTS "profiles_select_same_barangay_lgu" ON public.profiles;
CREATE POLICY "profiles_select_same_barangay_lgu" ON public.profiles FOR SELECT USING (
  (public.current_user_role() IN ('lgu_responder', 'barangay_responder')
    AND (
      barangay_id = public.current_user_barangay_id()
      OR (barangay_id IS NULL AND municipality_id = public.current_user_municipality_id())
    ))
  OR (public.current_user_role() = 'municipal_responder' AND municipality_id = public.current_user_municipality_id())
);
