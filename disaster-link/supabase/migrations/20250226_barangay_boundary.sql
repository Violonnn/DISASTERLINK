-- Migration: LGU maps own area → admin approves (barangay_boundary_requests)
-- Run this if your schema was created before this workflow.

ALTER TABLE public.barangays ADD COLUMN IF NOT EXISTS boundary_geojson JSONB;
ALTER TABLE public.barangays ADD COLUMN IF NOT EXISTS boundary_approved_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.barangay_boundary_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  municipality_id  UUID NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  barangay_id      UUID REFERENCES public.barangays(id) ON DELETE SET NULL,
  barangay_name    TEXT NOT NULL,
  boundary_geojson JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barangay_boundary_requests_status ON public.barangay_boundary_requests(status);
CREATE INDEX IF NOT EXISTS idx_barangay_boundary_requests_requested_by ON public.barangay_boundary_requests(requested_by);

ALTER TABLE public.barangay_boundary_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "barangay_boundary_requests_select_own" ON public.barangay_boundary_requests;
CREATE POLICY "barangay_boundary_requests_select_own" ON public.barangay_boundary_requests FOR SELECT USING (requested_by = auth.uid());

DROP POLICY IF EXISTS "barangay_boundary_requests_select_admin" ON public.barangay_boundary_requests;
CREATE POLICY "barangay_boundary_requests_select_admin" ON public.barangay_boundary_requests FOR SELECT USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

DROP POLICY IF EXISTS "barangay_boundary_requests_update_admin" ON public.barangay_boundary_requests;
CREATE POLICY "barangay_boundary_requests_update_admin" ON public.barangay_boundary_requests FOR UPDATE USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

CREATE OR REPLACE FUNCTION public.save_barangay_boundary(p_barangay_id UUID, p_boundary_geojson JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  IF public.current_user_role() <> 'lgu_responder' THEN RETURN FALSE; END IF;
  IF public.current_user_barangay_id() IS DISTINCT FROM p_barangay_id THEN RETURN FALSE; END IF;
  UPDATE public.barangays SET boundary_geojson = p_boundary_geojson WHERE id = p_barangay_id;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.submit_barangay_boundary_request(
  p_municipality_id UUID, p_barangay_id UUID, p_barangay_name TEXT, p_boundary_geojson JSONB
)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF public.current_user_role() <> 'lgu_responder' THEN RETURN NULL; END IF;
  IF p_barangay_name IS NULL OR TRIM(p_barangay_name) = '' THEN RETURN NULL; END IF;
  IF p_boundary_geojson IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.barangay_boundary_requests (requested_by, municipality_id, barangay_id, barangay_name, boundary_geojson)
  VALUES (auth.uid(), p_municipality_id, NULLIF(p_barangay_id, '00000000-0000-0000-0000-000000000000'::uuid), TRIM(p_barangay_name), p_boundary_geojson)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.approve_barangay_boundary_request(p_request_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_req RECORD; v_barangay_id UUID;
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'super_admin') THEN RETURN FALSE; END IF;
  SELECT * INTO v_req FROM public.barangay_boundary_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_req.barangay_id IS NOT NULL THEN
    UPDATE public.barangays SET boundary_geojson = v_req.boundary_geojson, boundary_approved_at = now() WHERE id = v_req.barangay_id;
    v_barangay_id := v_req.barangay_id;
  ELSE
    INSERT INTO public.barangays (municipality_id, name, boundary_geojson, boundary_approved_at)
    VALUES (v_req.municipality_id, v_req.barangay_name, v_req.boundary_geojson, now()) RETURNING id INTO v_barangay_id;
  END IF;
  UPDATE public.profiles SET barangay_id = v_barangay_id, municipality_id = v_req.municipality_id WHERE id = v_req.requested_by;
  UPDATE public.barangay_boundary_requests SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_request_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- REALTIME: Status updates sync instantly across all users (no refresh needed)
-- Run these if tables are not yet in the publication (may error if already added):
-- =============================================================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE barangay_status_updates;
-- ALTER PUBLICATION supabase_realtime ADD TABLE barangays;
