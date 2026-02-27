-- Migration: Split LGU responder into municipal_responder and barangay_responder roles.
-- Municipal: municipality-level access. Barangay: barangay-level access (existing behavior).
-- Keeps lgu_responder for backward compatibility with existing users.

-- =============================================================================
-- 1. Add new roles to user_role enum
-- =============================================================================
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'municipal_responder';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'barangay_responder';

-- =============================================================================
-- 2. Helper: whether user can access a given barangay (for RLS)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.current_user_can_access_barangay(p_barangay_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_role public.user_role;
  v_user_barangay UUID;
  v_user_municipality UUID;
BEGIN
  SELECT role, barangay_id, municipality_id INTO v_role, v_user_barangay, v_user_municipality
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL THEN RETURN FALSE; END IF;
  IF p_barangay_id IS NULL THEN RETURN FALSE; END IF;

  IF v_role IN ('admin', 'super_admin') THEN RETURN TRUE; END IF;

  IF v_role IN ('lgu_responder', 'barangay_responder') THEN
    RETURN v_user_barangay = p_barangay_id;
  END IF;

  IF v_role = 'municipal_responder' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.barangays b
      WHERE b.id = p_barangay_id AND b.municipality_id = v_user_municipality
    );
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================================
-- 3. Helper: true if user is any LGU responder type
-- =============================================================================
CREATE OR REPLACE FUNCTION public.current_user_is_lgu_type()
RETURNS BOOLEAN AS $$
  SELECT role IN ('lgu_responder', 'municipal_responder', 'barangay_responder')
  FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =============================================================================
-- 4. RPC: Check if phone is already registered (for signup validation)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_phone_taken(check_phone TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE phone IS NOT NULL AND TRIM(phone) = TRIM(check_phone)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =============================================================================
-- 5. RPC: Check login eligibility (proof pending for LGU signups)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_login_eligibility(check_email TEXT)
RETURNS TABLE (is_proof_pending BOOLEAN) AS $$
  SELECT COALESCE(
    (SELECT proof_of_employment_url IS NOT NULL AND email_confirmed_at IS NULL
     FROM auth.users u
     JOIN public.profiles p ON p.id = u.id
     WHERE u.email = check_email
     AND p.role IN ('lgu_responder', 'municipal_responder', 'barangay_responder')),
    false
  ) AS is_proof_pending;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =============================================================================
-- 6. Update handle_new_user: support municipal_responder, barangay_responder,
--    set municipality_id/barangay_id from metadata, create membership for barangay
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  r public.user_role;
  v_municipality_id UUID;
  v_barangay_id UUID;
BEGIN
  BEGIN
    r := COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'resident');
  EXCEPTION WHEN OTHERS THEN
    r := 'resident';
  END;

  v_municipality_id := NULL;
  v_barangay_id := NULL;

  IF r IN ('municipal_responder', 'barangay_responder') THEN
    BEGIN
      v_municipality_id := (NEW.raw_user_meta_data->>'municipality_id')::UUID;
      v_barangay_id := NULLIF(TRIM(NEW.raw_user_meta_data->>'barangay_id'), '')::UUID;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  INSERT INTO public.profiles (
    id, role, first_name, last_name, middle_name, phone, email,
    proof_of_employment_url, municipality_id, barangay_id
  )
  VALUES (
    NEW.id,
    r,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'middle_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'contact_phone'), ''),
    NEW.email,
    NULLIF(TRIM(NEW.raw_user_meta_data->>'proof_of_employment_url'), ''),
    v_municipality_id,
    v_barangay_id
  );

  IF r = 'barangay_responder' AND v_barangay_id IS NOT NULL THEN
    INSERT INTO public.lgu_barangay_memberships (profile_id, barangay_id, is_creator)
    VALUES (NEW.id, v_barangay_id, false);
  END IF;

  IF r IN ('lgu_responder', 'municipal_responder', 'barangay_responder') THEN
    UPDATE auth.users SET email_confirmed_at = now() WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 7. Update RLS policies: use current_user_can_access_barangay where applicable
--    (Policies that only checked lgu_responder + barangay_id need to allow
--     municipal_responder and barangay_responder too. We add new policies
--     for the new roles; existing lgu_responder policies stay for backward compat.)
-- =============================================================================

-- profiles: municipal/barangay responders in same municipality/barangay
DROP POLICY IF EXISTS "profiles_select_same_barangay_lgu" ON public.profiles;
CREATE POLICY "profiles_select_same_barangay_lgu" ON public.profiles FOR SELECT USING (
  (public.current_user_role() IN ('lgu_responder', 'barangay_responder') AND barangay_id = public.current_user_barangay_id())
  OR (public.current_user_role() = 'municipal_responder' AND municipality_id = public.current_user_municipality_id())
);

-- reports: LGU types can select by barangay access
DROP POLICY IF EXISTS "reports_select_barangay_lgu" ON public.reports;
CREATE POLICY "reports_select_barangay_lgu" ON public.reports FOR SELECT USING (
  public.current_user_is_lgu_type() AND public.current_user_can_access_barangay(barangay_id)
);

DROP POLICY IF EXISTS "reports_update_lgu_barangay" ON public.reports;
CREATE POLICY "reports_update_lgu_barangay" ON public.reports FOR UPDATE USING (
  public.current_user_is_lgu_type() AND public.current_user_can_access_barangay(barangay_id)
);

-- report_notes
DROP POLICY IF EXISTS "report_notes_insert_lgu" ON public.report_notes;
CREATE POLICY "report_notes_insert_lgu" ON public.report_notes FOR INSERT WITH CHECK (
  public.current_user_is_lgu_type() AND author_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_id AND public.current_user_can_access_barangay(r.barangay_id))
);

-- report_flags
DROP POLICY IF EXISTS "report_flags_select_lgu_admin" ON public.report_flags;
CREATE POLICY "report_flags_select_lgu_admin" ON public.report_flags FOR SELECT USING (
  public.current_user_role() IN ('lgu_responder', 'municipal_responder', 'barangay_responder', 'admin', 'super_admin')
  OR reporter_id = auth.uid()
);

-- barangay_status_updates
DROP POLICY IF EXISTS "barangay_status_insert_lgu" ON public.barangay_status_updates;
CREATE POLICY "barangay_status_insert_lgu" ON public.barangay_status_updates FOR INSERT WITH CHECK (
  public.current_user_is_lgu_type() AND public.current_user_can_access_barangay(barangay_id) AND updated_by = auth.uid()
);

-- barangay_assistance_offers
DROP POLICY IF EXISTS "assistance_insert_lgu" ON public.barangay_assistance_offers;
CREATE POLICY "assistance_insert_lgu" ON public.barangay_assistance_offers FOR INSERT WITH CHECK (
  public.current_user_is_lgu_type()
  AND helping_barangay_id = COALESCE(public.current_user_barangay_id(), (SELECT id FROM public.barangays WHERE municipality_id = public.current_user_municipality_id() LIMIT 1))
  AND created_by = auth.uid()
  AND helping_barangay_id != recipient_barangay_id
);

-- assistance_insert_lgu: only barangay-level LGUs can create (helping_barangay_id required)
DROP POLICY IF EXISTS "assistance_insert_lgu" ON public.barangay_assistance_offers;
CREATE POLICY "assistance_insert_lgu" ON public.barangay_assistance_offers FOR INSERT WITH CHECK (
  public.current_user_role() IN ('lgu_responder', 'barangay_responder')
  AND helping_barangay_id = public.current_user_barangay_id()
  AND created_by = auth.uid()
  AND helping_barangay_id != recipient_barangay_id
);

DROP POLICY IF EXISTS "assistance_update_own" ON public.barangay_assistance_offers;
CREATE POLICY "assistance_update_own" ON public.barangay_assistance_offers FOR UPDATE USING (
  (public.current_user_role() IN ('lgu_responder', 'barangay_responder') AND helping_barangay_id = public.current_user_barangay_id())
);

-- announcements
DROP POLICY IF EXISTS "announcements_insert_lgu" ON public.announcements;
CREATE POLICY "announcements_insert_lgu" ON public.announcements FOR INSERT WITH CHECK (
  (public.current_user_role() IN ('lgu_responder', 'barangay_responder') AND author_id = auth.uid() AND scope = 'barangay' AND barangay_id = public.current_user_barangay_id())
  OR (public.current_user_role() = 'municipal_responder' AND author_id = auth.uid() AND scope = 'all' AND barangay_id IS NULL)
);

-- official_markers
DROP POLICY IF EXISTS "official_markers_insert_lgu" ON public.official_markers;
CREATE POLICY "official_markers_insert_lgu" ON public.official_markers FOR INSERT WITH CHECK (
  public.current_user_is_lgu_type() AND public.current_user_can_access_barangay(barangay_id) AND created_by = auth.uid()
);

DROP POLICY IF EXISTS "official_markers_update_lgu" ON public.official_markers;
CREATE POLICY "official_markers_update_lgu" ON public.official_markers FOR UPDATE USING (
  public.current_user_is_lgu_type() AND public.current_user_can_access_barangay(barangay_id)
);

-- resources
DROP POLICY IF EXISTS "resources_select_lgu" ON public.resources;
CREATE POLICY "resources_select_lgu" ON public.resources FOR SELECT USING (
  (public.current_user_role() IN ('lgu_responder', 'barangay_responder') AND (barangay_id = public.current_user_barangay_id() OR barangay_id IS NULL))
  OR (public.current_user_role() = 'municipal_responder' AND (barangay_id IN (SELECT id FROM public.barangays WHERE municipality_id = public.current_user_municipality_id()) OR barangay_id IS NULL))
);

-- resource_requests
DROP POLICY IF EXISTS "resource_requests_select_lgu" ON public.resource_requests;
CREATE POLICY "resource_requests_select_lgu" ON public.resource_requests FOR SELECT USING (
  public.current_user_is_lgu_type() AND public.current_user_can_access_barangay(barangay_id)
);

DROP POLICY IF EXISTS "resource_requests_insert_lgu" ON public.resource_requests;
CREATE POLICY "resource_requests_insert_lgu" ON public.resource_requests FOR INSERT WITH CHECK (
  public.current_user_is_lgu_type() AND public.current_user_can_access_barangay(barangay_id) AND requested_by = auth.uid()
);

-- resource_allocations
DROP POLICY IF EXISTS "resource_allocations_select_lgu" ON public.resource_allocations;
CREATE POLICY "resource_allocations_select_lgu" ON public.resource_allocations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.resource_requests rr
    WHERE rr.id = resource_allocations.resource_request_id
    AND public.current_user_can_access_barangay(rr.barangay_id)
  ) AND public.current_user_is_lgu_type()
);

-- lgu_barangay_memberships
DROP POLICY IF EXISTS "lgu_memberships_insert_lgu" ON public.lgu_barangay_memberships;
CREATE POLICY "lgu_memberships_insert_lgu" ON public.lgu_barangay_memberships FOR INSERT WITH CHECK (
  public.current_user_role() IN ('lgu_responder', 'municipal_responder', 'barangay_responder') AND profile_id = auth.uid()
);

-- =============================================================================
-- 8. Update RPCs from 20250228 to allow municipal_responder and barangay_responder
-- =============================================================================
CREATE OR REPLACE FUNCTION public.join_barangay(p_barangay_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_barangay RECORD;
BEGIN
  IF public.current_user_role() NOT IN ('lgu_responder', 'municipal_responder', 'barangay_responder') THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM public.lgu_barangay_memberships WHERE profile_id = auth.uid() AND left_at IS NULL) THEN RETURN FALSE; END IF;
  SELECT id, municipality_id INTO v_barangay FROM public.barangays
  WHERE id = p_barangay_id AND boundary_approved_at IS NOT NULL AND boundary_geojson IS NOT NULL;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  UPDATE public.profiles SET barangay_id = p_barangay_id, municipality_id = v_barangay.municipality_id WHERE id = auth.uid();
  INSERT INTO public.lgu_barangay_memberships (profile_id, barangay_id, is_creator) VALUES (auth.uid(), p_barangay_id, false);
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.leave_barangay(p_reason TEXT)
RETURNS BOOLEAN AS $$
DECLARE v_membership RECORD;
BEGIN
  IF public.current_user_role() NOT IN ('lgu_responder', 'municipal_responder', 'barangay_responder') THEN RETURN FALSE; END IF;
  SELECT * INTO v_membership FROM public.lgu_barangay_memberships WHERE profile_id = auth.uid() AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  UPDATE public.lgu_barangay_memberships SET left_at = now(), leave_reason = NULLIF(TRIM(p_reason), '') WHERE id = v_membership.id;
  UPDATE public.profiles SET barangay_id = NULL, municipality_id = NULL WHERE id = auth.uid();
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- (The existing trigger notifies profiles with barangay_id = recipient. Municipal don't have barangay_id. We could notify by municipality. For now leave as is - municipal can see assistance offers in dashboard via barangay_status.)
-- Actually the notification goes to profiles where barangay_id = recipient_barangay_id. Municipal don't have barangay_id. So they won't get those. We could extend the trigger. Leave for later.
