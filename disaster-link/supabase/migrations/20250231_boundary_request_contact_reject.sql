-- Migration: Add contact info and description to boundary requests; reject RPC.
-- Barangay: must provide contact email/phone before submitting.
-- Municipal: sees creator name, email, phone, date; can reject with reason.

-- =============================================================================
-- 1. Add contact and description columns to barangay_boundary_requests
-- =============================================================================

ALTER TABLE public.barangay_boundary_requests ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE public.barangay_boundary_requests ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE public.barangay_boundary_requests ADD COLUMN IF NOT EXISTS description TEXT;

-- =============================================================================
-- 2. Update submit_barangay_boundary_request to accept contact and description
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_barangay_boundary_request(
  p_municipality_id UUID,
  p_barangay_id UUID,
  p_barangay_name TEXT,
  p_boundary_geojson JSONB,
  p_contact_email TEXT DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF public.current_user_role() NOT IN ('lgu_responder', 'barangay_responder', 'municipal_responder') THEN RETURN NULL; END IF;
  IF p_barangay_name IS NULL OR TRIM(p_barangay_name) = '' THEN RETURN NULL; END IF;
  IF p_boundary_geojson IS NULL THEN RETURN NULL; END IF;
  IF p_contact_email IS NULL OR TRIM(p_contact_email) = '' THEN RETURN NULL; END IF;
  IF p_contact_phone IS NULL OR TRIM(p_contact_phone) = '' THEN RETURN NULL; END IF;

  INSERT INTO public.barangay_boundary_requests (
    requested_by, municipality_id, barangay_id, barangay_name, boundary_geojson,
    contact_email, contact_phone, description
  )
  VALUES (
    auth.uid(),
    p_municipality_id,
    NULLIF(p_barangay_id, '00000000-0000-0000-0000-000000000000'::uuid),
    TRIM(p_barangay_name),
    p_boundary_geojson,
    TRIM(p_contact_email),
    TRIM(p_contact_phone),
    NULLIF(TRIM(COALESCE(p_description, '')), '')
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 3. Reject RPC — municipal responder or admin can reject with reason
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reject_barangay_boundary_request(
  p_request_id UUID,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE v_req RECORD; v_can_reject BOOLEAN;
BEGIN
  IF public.current_user_role() IN ('admin', 'super_admin') THEN
    v_can_reject := TRUE;
  ELSIF public.current_user_role() = 'municipal_responder' THEN
    v_can_reject := (
      SELECT municipality_id = public.current_user_municipality_id()
      FROM public.barangay_boundary_requests
      WHERE id = p_request_id AND status = 'pending'
    );
  ELSE
    v_can_reject := FALSE;
  END IF;

  IF NOT v_can_reject THEN RETURN FALSE; END IF;

  SELECT * INTO v_req FROM public.barangay_boundary_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE public.barangay_boundary_requests
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = NULLIF(TRIM(COALESCE(p_rejection_reason, '')), '')
  WHERE id = p_request_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
