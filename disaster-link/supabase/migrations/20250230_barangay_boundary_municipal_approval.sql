-- Migration: Barangay boundary requests — barangay_responder can submit, municipal_responder can approve.
-- Fixes "Map my barangay" submission failed for barangay_responder role.
-- Municipal responders approve requests in their municipality; admin/super_admin retain full access.
-- Runs after 20250229 (municipal_responder, barangay_responder roles must exist).

CREATE INDEX IF NOT EXISTS idx_barangay_boundary_requests_municipality_status ON public.barangay_boundary_requests(municipality_id, status);

-- =============================================================================
-- 1. Allow all LGU types (lgu_responder, barangay_responder, municipal_responder) to submit boundary requests
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_barangay_boundary_request(
  p_municipality_id UUID, p_barangay_id UUID, p_barangay_name TEXT, p_boundary_geojson JSONB
)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF public.current_user_role() NOT IN ('lgu_responder', 'barangay_responder', 'municipal_responder') THEN RETURN NULL; END IF;
  IF p_barangay_name IS NULL OR TRIM(p_barangay_name) = '' THEN RETURN NULL; END IF;
  IF p_boundary_geojson IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.barangay_boundary_requests (requested_by, municipality_id, barangay_id, barangay_name, boundary_geojson)
  VALUES (auth.uid(), p_municipality_id, NULLIF(p_barangay_id, '00000000-0000-0000-0000-000000000000'::uuid), TRIM(p_barangay_name), p_boundary_geojson)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 2. Allow lgu_responder and barangay_responder to save boundary (assigned barangay only)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_barangay_boundary(p_barangay_id UUID, p_boundary_geojson JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  IF public.current_user_role() NOT IN ('lgu_responder', 'barangay_responder') THEN RETURN FALSE; END IF;
  IF public.current_user_barangay_id() IS DISTINCT FROM p_barangay_id THEN RETURN FALSE; END IF;
  UPDATE public.barangays SET boundary_geojson = p_boundary_geojson WHERE id = p_barangay_id;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 3. Allow municipal_responder to approve requests in their municipality; admin/super_admin retain full access
-- =============================================================================

CREATE OR REPLACE FUNCTION public.approve_barangay_boundary_request(p_request_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_req RECORD; v_barangay_id UUID; v_can_approve BOOLEAN;
BEGIN
  /* Admin and super_admin can approve any request */
  IF public.current_user_role() IN ('admin', 'super_admin') THEN
    v_can_approve := TRUE;
  /* Municipal responder can approve only requests in their municipality */
  ELSIF public.current_user_role() = 'municipal_responder' THEN
    v_can_approve := (
      SELECT municipality_id = public.current_user_municipality_id()
      FROM public.barangay_boundary_requests
      WHERE id = p_request_id AND status = 'pending'
    );
  ELSE
    v_can_approve := FALSE;
  END IF;

  IF NOT v_can_approve THEN RETURN FALSE; END IF;

  SELECT * INTO v_req FROM public.barangay_boundary_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_req.barangay_id IS NOT NULL THEN
    UPDATE public.barangays SET boundary_geojson = v_req.boundary_geojson, boundary_approved_at = now() WHERE id = v_req.barangay_id;
    v_barangay_id := v_req.barangay_id;
  ELSE
    INSERT INTO public.barangays (municipality_id, name, boundary_geojson, boundary_approved_at)
    VALUES (v_req.municipality_id, v_req.barangay_name, v_req.boundary_geojson, now()) RETURNING id INTO v_barangay_id;
  END IF;

  /* Assign requester to barangay and set municipality */
  UPDATE public.profiles SET barangay_id = v_barangay_id, municipality_id = v_req.municipality_id WHERE id = v_req.requested_by;

  /* Add requester as creator in lgu_barangay_memberships (so isCreator works correctly) */
  INSERT INTO public.lgu_barangay_memberships (profile_id, barangay_id, is_creator)
  VALUES (v_req.requested_by, v_barangay_id, true);

  UPDATE public.barangay_boundary_requests SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_request_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 4. RLS: Municipal responder can SELECT boundary requests in their municipality
-- =============================================================================

DROP POLICY IF EXISTS "barangay_boundary_requests_select_municipal" ON public.barangay_boundary_requests;
CREATE POLICY "barangay_boundary_requests_select_municipal" ON public.barangay_boundary_requests FOR SELECT USING (
  public.current_user_role() = 'municipal_responder'
  AND municipality_id = public.current_user_municipality_id()
);

-- =============================================================================
-- 5. RLS: Municipal responder can UPDATE (approve) via RPC; explicit policy for consistency
-- =============================================================================

DROP POLICY IF EXISTS "barangay_boundary_requests_update_municipal" ON public.barangay_boundary_requests;
CREATE POLICY "barangay_boundary_requests_update_municipal" ON public.barangay_boundary_requests FOR UPDATE USING (
  public.current_user_role() = 'municipal_responder'
  AND municipality_id = public.current_user_municipality_id()
  AND status = 'pending'
);
