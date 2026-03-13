-- App-level "verified for Contributions" flag for residents.
-- New residents get false; they can log in (Supabase email confirmed at signup)
-- but see the in-app notification until they complete the verify flow.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contributions_verified boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.contributions_verified IS 'For residents: true after they complete the in-app email verification flow (unlocks Contributions).';
