-- =============================================================================
-- LGU Access Links (DB source of truth)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.lgu_access_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lgu_access_links_updated_at
  ON public.lgu_access_links(updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lgu_access_links_municipality_name_ci
  ON public.lgu_access_links (lower(municipality_name));

CREATE OR REPLACE FUNCTION public.set_lgu_access_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_lgu_access_links_updated_at ON public.lgu_access_links;
CREATE TRIGGER set_lgu_access_links_updated_at
  BEFORE UPDATE ON public.lgu_access_links
  FOR EACH ROW EXECUTE FUNCTION public.set_lgu_access_links_updated_at();

ALTER TABLE public.lgu_access_links ENABLE ROW LEVEL SECURITY;
