-- =============================================================================
-- Profile role transition to new role set (step 2)
-- =============================================================================
-- Run after 20260423_profile_roles_v2_transition.sql so enum values are committed.

-- Migrate existing profile roles to new canonical values.
UPDATE public.profiles
SET role = CASE role
  WHEN 'admin' THEN 'system_admin'::public.user_role
  WHEN 'super_admin' THEN 'system_admin'::public.user_role
  WHEN 'municipal_responder' THEN 'mdrrmo_admin'::public.user_role
  WHEN 'lgu_responder' THEN 'bdrrmo'::public.user_role
  WHEN 'barangay_responder' THEN 'bdrrmo'::public.user_role
  ELSE role
END
WHERE role IN ('admin', 'super_admin', 'municipal_responder', 'lgu_responder', 'barangay_responder');

-- Keep RLS behavior unchanged by mapping canonical roles to legacy policy values.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role AS $$
  SELECT
    CASE role
      WHEN 'system_admin'::public.user_role THEN 'admin'::public.user_role
      WHEN 'mdrrmo_admin'::public.user_role THEN 'municipal_responder'::public.user_role
      WHEN 'mdrrmo_staff'::public.user_role THEN 'municipal_responder'::public.user_role
      WHEN 'mayor'::public.user_role THEN 'municipal_responder'::public.user_role
      WHEN 'bdrrmo'::public.user_role THEN 'lgu_responder'::public.user_role
      ELSE role
    END
  FROM public.profiles
  WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;
