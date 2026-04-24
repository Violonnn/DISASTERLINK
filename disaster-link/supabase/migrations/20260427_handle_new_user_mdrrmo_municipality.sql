-- =============================================================================
-- Fix new-user profile: copy municipality_id for MDRRMO / mayor / BDRRMO roles
-- =============================================================================
-- Invite municipal signup sends role mdrrmo_admin|mdrrmo_staff and municipality_id
-- in auth metadata. The previous handle_new_user only copied municipality_id for
-- municipal_responder and barangay_responder, leaving MDRRMO accounts with NULL
-- municipality_id and breaking /lgu/[slug]/login eligibility checks.

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
  ELSIF r IN ('mdrrmo_admin', 'mdrrmo_staff', 'mayor', 'bdrrmo') THEN
    BEGIN
      v_municipality_id := (NEW.raw_user_meta_data->>'municipality_id')::UUID;
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
