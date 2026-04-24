-- =============================================================================
-- DisasterLink — Production-Ready Supabase Schema
-- Municipality of Minglanilla, Cebu, Philippines
-- =============================================================================

-- Enable required extensions (Supabase usually has these)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE public.user_role AS ENUM (
  'resident',
  'lgu_responder',
  'admin',
  'super_admin'
);

CREATE TYPE public.report_status AS ENUM (
  'pending',
  'acknowledged',
  'resolved'
);

CREATE TYPE public.barangay_status_enum AS ENUM (
  'normal',
  'on_alert',
  'under_threat',
  'active_disaster'
);

-- =============================================================================
-- GEOGRAPHY (Municipality of Minglanilla)
-- =============================================================================

CREATE TABLE public.municipalities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  code          TEXT UNIQUE,
  region        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.barangays (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  UUID NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  code             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (municipality_id, code)
);

CREATE INDEX idx_barangays_municipality ON public.barangays(municipality_id);

-- =============================================================================
-- PROFILES (extends auth.users)
-- =============================================================================

CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role          public.user_role NOT NULL DEFAULT 'resident',
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  middle_name   TEXT,
  phone         TEXT,
  avatar_url    TEXT,
  proof_of_employment_url TEXT,
  barangay_id   UUID REFERENCES public.barangays(id) ON DELETE SET NULL,
  municipality_id UUID REFERENCES public.municipalities(id) ON DELETE SET NULL,
  email         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_barangay ON public.profiles(barangay_id);
CREATE INDEX idx_profiles_municipality ON public.profiles(municipality_id);

-- =============================================================================
-- REPORTS (citizen disaster/incident reports — category is free-form in title/description)
-- =============================================================================

CREATE TABLE public.reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  barangay_id      UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  status           public.report_status NOT NULL DEFAULT 'pending',
  title            TEXT,
  description      TEXT,
  gps_lat          DOUBLE PRECISION,
  gps_lng          DOUBLE PRECISION,
  photo_urls       JSONB DEFAULT '[]'::jsonb,
  video_urls       JSONB DEFAULT '[]'::jsonb,
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  resolved_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_barangay_status ON public.reports(barangay_id, status);
CREATE INDEX idx_reports_reporter ON public.reports(reporter_id);
CREATE INDEX idx_reports_created_at ON public.reports(created_at DESC);

CREATE TABLE public.report_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_notes_report ON public.report_notes(report_id);

-- =============================================================================
-- BARANGAY STATUS (Normal, On Alert, Under Threat, Active Disaster)
-- =============================================================================

CREATE TABLE public.barangay_status_updates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id  UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  updated_by   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status       public.barangay_status_enum NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_barangay_status_barangay_created ON public.barangay_status_updates(barangay_id, created_at DESC);

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================

CREATE TABLE public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_read ON public.notifications(user_id, read_at);
CREATE INDEX idx_notifications_created ON public.notifications(created_at DESC);

-- =============================================================================
-- UPDATED_AT TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  r public.user_role;
BEGIN
  BEGIN
    r := COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'resident');
  EXCEPTION WHEN OTHERS THEN
    r := 'resident';
  END;
  INSERT INTO public.profiles (id, role, first_name, last_name, middle_name, phone, email, proof_of_employment_url)
  VALUES (
    NEW.id,
    r,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'middle_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), ''),
    NEW.email,
    NULLIF(TRIM(NEW.raw_user_meta_data->>'proof_of_employment_url'), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- HELPER: Current user role (for RLS)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.current_user_barangay_id()
RETURNS UUID AS $$
  SELECT barangay_id FROM public.profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.current_user_municipality_id()
RETURNS UUID AS $$
  SELECT municipality_id FROM public.profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =============================================================================
-- SEED: Minglanilla (optional, run once)
-- =============================================================================

INSERT INTO public.municipalities (id, name, code, region) VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'Minglanilla', 'MING', 'Central Visayas')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

ALTER TABLE public.municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barangays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barangay_status_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ----------
-- municipalities: all authenticated + anon can read (for map/guest)
-- ----------
CREATE POLICY "municipalities_select_all" ON public.municipalities FOR SELECT USING (true);
CREATE POLICY "municipalities_modify_admin" ON public.municipalities FOR ALL USING (public.current_user_role() IN ('admin', 'super_admin'));

-- ----------
-- barangays: all can read
-- ----------
CREATE POLICY "barangays_select_all" ON public.barangays FOR SELECT USING (true);
CREATE POLICY "barangays_modify_admin" ON public.barangays FOR ALL USING (public.current_user_role() IN ('admin', 'super_admin'));

-- ----------
-- profiles: own profile full access; others limited by role
-- ----------
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_select_same_barangay_lgu" ON public.profiles FOR SELECT USING (
  public.current_user_role() = 'lgu_responder' AND barangay_id = public.current_user_barangay_id()
);
CREATE POLICY "profiles_select_admin" ON public.profiles FOR SELECT USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

-- ----------
-- reports: resident = own + barangay; LGU = barangay; admin = all. Insert = resident. Update = LGU/admin (ack/resolve)
-- ----------
CREATE POLICY "reports_select_own" ON public.reports FOR SELECT USING (reporter_id = auth.uid());
CREATE POLICY "reports_select_barangay_lgu" ON public.reports FOR SELECT USING (
  public.current_user_role() = 'lgu_responder' AND barangay_id = public.current_user_barangay_id()
);
CREATE POLICY "reports_select_admin" ON public.reports FOR SELECT USING (
  public.current_user_role() IN ('admin', 'super_admin')
);
CREATE POLICY "reports_select_verified_any" ON public.reports FOR SELECT USING (
  status IN ('acknowledged', 'resolved')
);
CREATE POLICY "reports_insert_resident" ON public.reports FOR INSERT WITH CHECK (
  public.current_user_role() = 'resident' AND reporter_id = auth.uid()
);
CREATE POLICY "reports_update_lgu_barangay" ON public.reports FOR UPDATE USING (
  public.current_user_role() = 'lgu_responder' AND barangay_id = public.current_user_barangay_id()
);
CREATE POLICY "reports_update_admin" ON public.reports FOR UPDATE USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

-- ----------
-- report_notes: LGU for own barangay reports, admin all
-- ----------
CREATE POLICY "report_notes_select_report_access" ON public.report_notes FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = report_notes.report_id
    AND (
      r.reporter_id = auth.uid()
      OR (public.current_user_role() = 'lgu_responder' AND r.barangay_id = public.current_user_barangay_id())
      OR public.current_user_role() IN ('admin', 'super_admin')
    )
  )
);
CREATE POLICY "report_notes_insert_lgu" ON public.report_notes FOR INSERT WITH CHECK (
  public.current_user_role() = 'lgu_responder' AND author_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_id AND r.barangay_id = public.current_user_barangay_id())
);
CREATE POLICY "report_notes_insert_admin" ON public.report_notes FOR INSERT WITH CHECK (
  public.current_user_role() IN ('admin', 'super_admin') AND author_id = auth.uid()
);

-- ----------
-- barangay_status_updates: read all (for map); write LGU own barangay, admin all
-- ----------
CREATE POLICY "barangay_status_select_all" ON public.barangay_status_updates FOR SELECT USING (true);
CREATE POLICY "barangay_status_insert_lgu" ON public.barangay_status_updates FOR INSERT WITH CHECK (
  public.current_user_role() = 'lgu_responder' AND barangay_id = public.current_user_barangay_id() AND updated_by = auth.uid()
);
CREATE POLICY "report_notes_insert_admin" ON public.report_notes FOR INSERT WITH CHECK (
  public.current_user_role() IN ('admin', 'super_admin') AND author_id = auth.uid()
);

-- ----------
-- notifications: own only
-- ----------
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "notifications_insert_system" ON public.notifications FOR INSERT WITH CHECK (true);

-- =============================================================================
-- STORAGE (create in Dashboard or via API)
-- =============================================================================
-- For LGU signup proof of employment, create a bucket named 'proof-of-employment'.
-- In Supabase Dashboard: Storage -> New bucket -> Name: proof-of-employment.
-- Add policy to allow uploads (e.g. allow anon INSERT for signup, or use a server endpoint with service role).

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
