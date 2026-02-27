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

CREATE TYPE public.resource_request_status AS ENUM (
  'pending',
  'partially_fulfilled',
  'fulfilled',
  'rejected'
);

CREATE TYPE public.announcement_scope AS ENUM (
  'all',
  'barangay'
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
-- REPORTS (citizen disaster/incident reports)
-- =============================================================================

CREATE TABLE public.report_types (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE public.reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  barangay_id      UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  report_type_id  UUID NOT NULL REFERENCES public.report_types(id) ON DELETE RESTRICT,
  status           public.report_status NOT NULL DEFAULT 'pending',
  title            TEXT,
  description      TEXT,
  gps_lat          DOUBLE PRECISION,
  gps_lng          DOUBLE PRECISION,
  photo_urls       JSONB DEFAULT '[]'::jsonb,
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

CREATE TABLE public.report_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, reporter_id)
);

CREATE INDEX idx_report_flags_report ON public.report_flags(report_id);

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
-- ANNOUNCEMENTS (LGU/Admin to residents)
-- =============================================================================

CREATE TABLE public.announcements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  barangay_id  UUID REFERENCES public.barangays(id) ON DELETE CASCADE,
  scope        public.announcement_scope NOT NULL DEFAULT 'barangay',
  title        TEXT NOT NULL,
  body         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT announcements_scope_barangay CHECK (
    (scope = 'all' AND barangay_id IS NULL) OR (scope = 'barangay' AND barangay_id IS NOT NULL)
  )
);

CREATE INDEX idx_announcements_barangay_created ON public.announcements(barangay_id, created_at DESC);
CREATE INDEX idx_announcements_author ON public.announcements(author_id);

-- =============================================================================
-- OFFICIAL MAP MARKERS (evacuation centers, relief points, danger zones)
-- =============================================================================

CREATE TABLE public.marker_types (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE public.official_markers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id    UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  marker_type_id UUID NOT NULL REFERENCES public.marker_types(id) ON DELETE RESTRICT,
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  created_by     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  updated_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_official_markers_barangay_active ON public.official_markers(barangay_id, is_active);
CREATE INDEX idx_official_markers_type ON public.official_markers(marker_type_id);

-- =============================================================================
-- RESOURCES (inventory, requests, allocations)
-- =============================================================================

CREATE TABLE public.resource_types (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  unit TEXT NOT NULL
);

CREATE TABLE public.resources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type_id UUID NOT NULL REFERENCES public.resource_types(id) ON DELETE RESTRICT,
  name             TEXT NOT NULL,
  quantity         NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_override    TEXT,
  barangay_id      UUID REFERENCES public.barangays(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_resources_type ON public.resources(resource_type_id);
CREATE INDEX idx_resources_barangay ON public.resources(barangay_id);

CREATE TABLE public.resource_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id          UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  requested_by         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  resource_type_id     UUID NOT NULL REFERENCES public.resource_types(id) ON DELETE RESTRICT,
  quantity_requested   NUMERIC(12, 2) NOT NULL CHECK (quantity_requested > 0),
  quantity_fulfilled   NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (quantity_fulfilled >= 0),
  status               public.resource_request_status NOT NULL DEFAULT 'pending',
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at         TIMESTAMPTZ
);

CREATE INDEX idx_resource_requests_barangay ON public.resource_requests(barangay_id);
CREATE INDEX idx_resource_requests_status ON public.resource_requests(status);
CREATE INDEX idx_resource_requests_created ON public.resource_requests(created_at DESC);

CREATE TABLE public.resource_allocations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_request_id  UUID NOT NULL REFERENCES public.resource_requests(id) ON DELETE CASCADE,
  resource_id          UUID NOT NULL REFERENCES public.resources(id) ON DELETE RESTRICT,
  quantity             NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  allocated_by         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_resource_allocations_request ON public.resource_allocations(resource_request_id);
CREATE INDEX idx_resource_allocations_resource ON public.resource_allocations(resource_id);

-- =============================================================================
-- WEATHER & DISASTER ALERTS
-- =============================================================================

CREATE TABLE public.weather_advisories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL,
  external_id   TEXT,
  title         TEXT NOT NULL,
  body          TEXT,
  severity      TEXT,
  effective_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_weather_advisories_effective ON public.weather_advisories(effective_at DESC);

CREATE TABLE public.disaster_alerts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type           TEXT NOT NULL,
  title                TEXT NOT NULL,
  body                 TEXT,
  severity             TEXT,
  geojson              JSONB,
  target_barangay_ids   UUID[],
  created_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ
);

CREATE INDEX idx_disaster_alerts_created ON public.disaster_alerts(created_at DESC);

-- =============================================================================
-- ADMIN INVITES (time-limited DRRMO signup)
-- =============================================================================

CREATE TABLE public.admin_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  created_by  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  used_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_invites_code ON public.admin_invites(code);
CREATE INDEX idx_admin_invites_expires ON public.admin_invites(expires_at);

-- =============================================================================
-- NOTIFICATIONS & PUSH
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

CREATE TABLE public.push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh_key TEXT NOT NULL,
  auth_key   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions(user_id);

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
CREATE TRIGGER set_announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_official_markers_updated_at
  BEFORE UPDATE ON public.official_markers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_resources_updated_at
  BEFORE UPDATE ON public.resources
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
-- SEED: Minglanilla + report/marker/resource types (optional, run once)
-- =============================================================================

INSERT INTO public.municipalities (id, name, code, region) VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'Minglanilla', 'MING', 'Central Visayas')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.report_types (name, slug, sort_order) VALUES
  ('Flooding', 'flooding', 1),
  ('Landslide', 'landslide', 2),
  ('Fire', 'fire', 3),
  ('Medical Emergency', 'medical_emergency', 4),
  ('Infrastructure Damage', 'infrastructure_damage', 5),
  ('Others', 'others', 6)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.marker_types (name, slug, sort_order) VALUES
  ('Evacuation Center', 'evacuation_center', 1),
  ('Relief Distribution Point', 'relief_distribution', 2),
  ('Danger Zone', 'danger_zone', 3),
  ('Emergency Facility', 'emergency_facility', 4),
  ('Water/Food/Welfare Point', 'welfare_point', 5)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.resource_types (name, slug, unit) VALUES
  ('Relief Goods', 'relief_goods', 'boxes'),
  ('Personnel', 'personnel', 'persons'),
  ('Vehicles', 'vehicles', 'units'),
  ('Medical Supplies', 'medical_supplies', 'kits')
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

ALTER TABLE public.municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barangays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barangay_status_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marker_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weather_advisories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disaster_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

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
-- report_types: read all
-- ----------
CREATE POLICY "report_types_select_all" ON public.report_types FOR SELECT USING (true);
CREATE POLICY "report_types_modify_admin" ON public.report_types FOR ALL USING (public.current_user_role() IN ('admin', 'super_admin'));

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
-- report_flags: resident insert own; read by LGU/admin
-- ----------
CREATE POLICY "report_flags_select_lgu_admin" ON public.report_flags FOR SELECT USING (
  public.current_user_role() IN ('lgu_responder', 'admin', 'super_admin')
  OR reporter_id = auth.uid()
);
CREATE POLICY "report_flags_insert_resident" ON public.report_flags FOR INSERT WITH CHECK (
  public.current_user_role() = 'resident' AND reporter_id = auth.uid()
);

-- ----------
-- barangay_status_updates: read all (for map); write LGU own barangay, admin all
-- ----------
CREATE POLICY "barangay_status_select_all" ON public.barangay_status_updates FOR SELECT USING (true);
CREATE POLICY "barangay_status_insert_lgu" ON public.barangay_status_updates FOR INSERT WITH CHECK (
  public.current_user_role() = 'lgu_responder' AND barangay_id = public.current_user_barangay_id() AND updated_by = auth.uid()
);
CREATE POLICY "barangay_status_insert_admin" ON public.barangay_status_updates FOR INSERT WITH CHECK (
  public.current_user_role() IN ('admin', 'super_admin') AND updated_by = auth.uid()
);

-- ----------
-- announcements: read by target (all or same barangay); write LGU barangay, admin all
-- ----------
CREATE POLICY "announcements_select_all_scope" ON public.announcements FOR SELECT USING (
  scope = 'all' OR barangay_id = public.current_user_barangay_id() OR public.current_user_role() IN ('admin', 'super_admin')
);
CREATE POLICY "announcements_select_anon" ON public.announcements FOR SELECT USING (scope = 'all');
CREATE POLICY "announcements_insert_lgu" ON public.announcements FOR INSERT WITH CHECK (
  public.current_user_role() = 'lgu_responder' AND author_id = auth.uid() AND scope = 'barangay' AND barangay_id = public.current_user_barangay_id()
);
CREATE POLICY "announcements_insert_admin" ON public.announcements FOR INSERT WITH CHECK (
  public.current_user_role() IN ('admin', 'super_admin') AND author_id = auth.uid()
);
CREATE POLICY "announcements_update_admin" ON public.announcements FOR UPDATE USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

-- ----------
-- marker_types: read all
-- ----------
CREATE POLICY "marker_types_select_all" ON public.marker_types FOR SELECT USING (true);
CREATE POLICY "marker_types_modify_admin" ON public.marker_types FOR ALL USING (public.current_user_role() IN ('admin', 'super_admin'));

-- ----------
-- official_markers: read all (guests + map); write LGU own barangay, admin all
-- ----------
CREATE POLICY "official_markers_select_all" ON public.official_markers FOR SELECT USING (is_active = true OR public.current_user_role() IN ('admin', 'super_admin', 'lgu_responder'));
CREATE POLICY "official_markers_insert_lgu" ON public.official_markers FOR INSERT WITH CHECK (
  public.current_user_role() = 'lgu_responder' AND barangay_id = public.current_user_barangay_id() AND created_by = auth.uid()
);
CREATE POLICY "official_markers_insert_admin" ON public.official_markers FOR INSERT WITH CHECK (
  public.current_user_role() IN ('admin', 'super_admin') AND created_by = auth.uid()
);
CREATE POLICY "official_markers_update_lgu" ON public.official_markers FOR UPDATE USING (
  public.current_user_role() = 'lgu_responder' AND barangay_id = public.current_user_barangay_id()
);
CREATE POLICY "official_markers_update_admin" ON public.official_markers FOR UPDATE USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

-- ----------
-- resource_types: read all
-- ----------
CREATE POLICY "resource_types_select_all" ON public.resource_types FOR SELECT USING (true);
CREATE POLICY "resource_types_modify_admin" ON public.resource_types FOR ALL USING (public.current_user_role() IN ('admin', 'super_admin'));

-- ----------
-- resources: read LGU (barangay + central), admin all; write admin
-- ----------
CREATE POLICY "resources_select_lgu" ON public.resources FOR SELECT USING (
  public.current_user_role() = 'lgu_responder' AND (barangay_id = public.current_user_barangay_id() OR barangay_id IS NULL)
);
CREATE POLICY "resources_select_admin" ON public.resources FOR SELECT USING (
  public.current_user_role() IN ('admin', 'super_admin')
);
CREATE POLICY "resources_all_admin" ON public.resources FOR ALL USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

-- ----------
-- resource_requests: LGU insert/select own barangay; admin all
-- ----------
CREATE POLICY "resource_requests_select_lgu" ON public.resource_requests FOR SELECT USING (
  public.current_user_role() = 'lgu_responder' AND barangay_id = public.current_user_barangay_id()
);
CREATE POLICY "resource_requests_select_admin" ON public.resource_requests FOR SELECT USING (
  public.current_user_role() IN ('admin', 'super_admin')
);
CREATE POLICY "resource_requests_insert_lgu" ON public.resource_requests FOR INSERT WITH CHECK (
  public.current_user_role() = 'lgu_responder' AND barangay_id = public.current_user_barangay_id() AND requested_by = auth.uid()
);
CREATE POLICY "resource_requests_update_admin" ON public.resource_requests FOR UPDATE USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

-- ----------
-- resource_allocations: read with request access; insert/update admin
-- ----------
CREATE POLICY "resource_allocations_select_lgu" ON public.resource_allocations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.resource_requests rr
    WHERE rr.id = resource_allocations.resource_request_id
    AND rr.barangay_id = public.current_user_barangay_id()
  ) AND public.current_user_role() = 'lgu_responder'
);
CREATE POLICY "resource_allocations_select_admin" ON public.resource_allocations FOR SELECT USING (
  public.current_user_role() IN ('admin', 'super_admin')
);
CREATE POLICY "resource_allocations_insert_admin" ON public.resource_allocations FOR INSERT WITH CHECK (
  public.current_user_role() IN ('admin', 'super_admin') AND allocated_by = auth.uid()
);

-- ----------
-- weather_advisories: read all; write admin
-- ----------
CREATE POLICY "weather_advisories_select_all" ON public.weather_advisories FOR SELECT USING (true);
CREATE POLICY "weather_advisories_all_admin" ON public.weather_advisories FOR ALL USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

-- ----------
-- disaster_alerts: read all; write admin
-- ----------
CREATE POLICY "disaster_alerts_select_all" ON public.disaster_alerts FOR SELECT USING (true);
CREATE POLICY "disaster_alerts_all_admin" ON public.disaster_alerts FOR ALL USING (
  public.current_user_role() IN ('admin', 'super_admin')
);

-- ----------
-- admin_invites: super_admin create/read; claim via function
-- ----------
CREATE POLICY "admin_invites_select_super" ON public.admin_invites FOR SELECT USING (
  public.current_user_role() = 'super_admin' OR used_by = auth.uid()
);
CREATE POLICY "admin_invites_insert_super" ON public.admin_invites FOR INSERT WITH CHECK (
  public.current_user_role() = 'super_admin' AND created_by = auth.uid()
);
CREATE POLICY "admin_invites_update_super" ON public.admin_invites FOR UPDATE USING (
  public.current_user_role() = 'super_admin'
);

-- Claim an invite (call after signup to assign admin role). Returns true if code valid and claimed.
CREATE OR REPLACE FUNCTION public.claim_admin_invite(invite_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  inv RECORD;
BEGIN
  SELECT id, used_at, expires_at INTO inv
  FROM public.admin_invites
  WHERE code = invite_code AND used_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  UPDATE public.admin_invites SET used_at = now(), used_by = auth.uid() WHERE id = inv.id;
  UPDATE public.profiles SET role = 'admin' WHERE id = auth.uid();
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------
-- notifications: own only
-- ----------
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "notifications_insert_system" ON public.notifications FOR INSERT WITH CHECK (true);
-- Restrict insert in app to system/backend; or add policy for LGU/admin to create for users in their scope

-- ----------
-- push_subscriptions: own only
-- ----------
CREATE POLICY "push_subscriptions_own" ON public.push_subscriptions FOR ALL USING (user_id = auth.uid());

-- =============================================================================
-- STORAGE (create in Dashboard or via API)
-- =============================================================================
-- For LGU signup proof of employment, create a bucket named 'proof-of-employment'.
-- In Supabase Dashboard: Storage -> New bucket -> Name: proof-of-employment.
-- Add policy to allow uploads (e.g. allow anon INSERT for signup, or use a server endpoint with service role).

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
