-- Migration: Fix barangay_status_updates INSERT RLS — allow barangay_responder and municipal_responder.
-- Resolves: "new row violates row-level security policy" when barangay responders update status.
-- Self-contained: adds roles if needed, creates helper functions, updates policy.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'municipal_responder';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'barangay_responder';

-- Ensure helper functions exist (idempotent; safe if 20250229 already ran)
CREATE OR REPLACE FUNCTION public.current_user_is_lgu_type()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT role IN ('lgu_responder', 'municipal_responder', 'barangay_responder')
     FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

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

-- Update policy to allow all LGU types
DROP POLICY IF EXISTS "barangay_status_insert_lgu" ON public.barangay_status_updates;

CREATE POLICY "barangay_status_insert_lgu" ON public.barangay_status_updates FOR INSERT WITH CHECK (
  public.current_user_is_lgu_type()
  AND public.current_user_can_access_barangay(barangay_id)
  AND updated_by = auth.uid()
);
