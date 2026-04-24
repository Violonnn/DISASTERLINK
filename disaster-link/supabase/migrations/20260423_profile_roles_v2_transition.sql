-- =============================================================================
-- Profile role transition to new role set
-- =============================================================================
-- Step 1 only: add new enum values.
-- NOTE:
-- PostgreSQL requires new enum values to be committed before they can be used
-- in UPDATE/CASE/function definitions. Data migration is in the next migration.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'system_admin';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'mdrrmo_admin';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'mayor';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'mdrrmo_staff';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'bdrrmo';
