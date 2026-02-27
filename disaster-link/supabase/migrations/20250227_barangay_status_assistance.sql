-- Migration: New status options + photo/description + assistance offers
-- Status: Normal, In need of resources, In need of manpower, Active disaster
-- Barangays in "need" status can post pics+description; others can offer assistance

-- =============================================================================
-- 1. New status enum (replace old) — only if old enum exists
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'barangay_status_enum')
     AND EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'barangay_status_enum' AND e.enumlabel = 'on_alert') THEN
    CREATE TYPE public.barangay_status_enum_v2 AS ENUM (
      'normal', 'in_need_of_resources', 'in_need_of_manpower', 'active_disaster'
    );
    ALTER TABLE public.barangay_status_updates ADD COLUMN IF NOT EXISTS status_v2 public.barangay_status_enum_v2;
    UPDATE public.barangay_status_updates
    SET status_v2 = CASE
      WHEN status::text = 'normal' THEN 'normal'::public.barangay_status_enum_v2
      WHEN status::text = 'active_disaster' THEN 'active_disaster'::public.barangay_status_enum_v2
      WHEN status::text IN ('on_alert', 'under_threat') THEN 'in_need_of_resources'::public.barangay_status_enum_v2
      ELSE 'normal'::public.barangay_status_enum_v2
    END
    WHERE status_v2 IS NULL;
    ALTER TABLE public.barangay_status_updates DROP COLUMN IF EXISTS status;
    ALTER TABLE public.barangay_status_updates RENAME COLUMN status_v2 TO status;
    ALTER TABLE public.barangay_status_updates ALTER COLUMN status SET NOT NULL;
    DROP TYPE public.barangay_status_enum CASCADE;
    ALTER TYPE public.barangay_status_enum_v2 RENAME TO barangay_status_enum;
  END IF;
END;
$$;

-- =============================================================================
-- 2. Add photo_urls and description to status updates (for "need" statuses)
-- =============================================================================

ALTER TABLE public.barangay_status_updates ADD COLUMN IF NOT EXISTS photo_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.barangay_status_updates ADD COLUMN IF NOT EXISTS description TEXT;

-- =============================================================================
-- 3. Assistance offers (Barangay B helps Barangay A)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.barangay_assistance_offers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helping_barangay_id  UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  recipient_barangay_id UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  status_update_id     UUID REFERENCES public.barangay_status_updates(id) ON DELETE SET NULL,
  description         TEXT NOT NULL,
  expected_arrival_at  TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  created_by          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_assistance CHECK (helping_barangay_id != recipient_barangay_id)
);

CREATE INDEX IF NOT EXISTS idx_assistance_recipient ON public.barangay_assistance_offers(recipient_barangay_id);
CREATE INDEX IF NOT EXISTS idx_assistance_helping ON public.barangay_assistance_offers(helping_barangay_id);
CREATE INDEX IF NOT EXISTS idx_assistance_created ON public.barangay_assistance_offers(created_at DESC);

ALTER TABLE public.barangay_assistance_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assistance_select_all" ON public.barangay_assistance_offers FOR SELECT USING (true);
CREATE POLICY "assistance_insert_lgu" ON public.barangay_assistance_offers FOR INSERT WITH CHECK (
  public.current_user_role() = 'lgu_responder'
  AND helping_barangay_id = public.current_user_barangay_id()
  AND created_by = auth.uid()
  AND helping_barangay_id != recipient_barangay_id
);
CREATE POLICY "assistance_update_own" ON public.barangay_assistance_offers FOR UPDATE USING (
  public.current_user_role() = 'lgu_responder'
  AND helping_barangay_id = public.current_user_barangay_id()
);
CREATE POLICY "assistance_insert_admin" ON public.barangay_assistance_offers FOR INSERT WITH CHECK (
  public.current_user_role() IN ('admin', 'super_admin') AND created_by = auth.uid()
);

CREATE OR REPLACE FUNCTION public.set_assistance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_barangay_assistance_offers_updated_at ON public.barangay_assistance_offers;
CREATE TRIGGER set_barangay_assistance_offers_updated_at
  BEFORE UPDATE ON public.barangay_assistance_offers
  FOR EACH ROW EXECUTE FUNCTION public.set_assistance_updated_at();

-- =============================================================================
-- 4. Storage bucket for barangay status photos (optional; create via Dashboard if fails)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'barangay-status-photos',
  'barangay-status-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "barangay_status_photos_select" ON storage.objects;
CREATE POLICY "barangay_status_photos_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'barangay-status-photos');

DROP POLICY IF EXISTS "barangay_status_photos_insert" ON storage.objects;
CREATE POLICY "barangay_status_photos_insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'barangay-status-photos'
    AND (auth.role() = 'authenticated')
  );

-- =============================================================================
-- 5. Realtime for assistance (enable in Supabase Dashboard if needed)
-- =============================================================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE barangay_assistance_offers;
