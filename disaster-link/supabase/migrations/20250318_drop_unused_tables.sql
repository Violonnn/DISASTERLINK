-- Migration: Drop tables currently unused by the application for a clearer ERD.
-- Dropped: report_flags, announcements, marker_types, official_markers,
--         resource_types, resources, resource_requests, resource_allocations,
--         weather_advisories, disaster_alerts, admin_invites, push_subscriptions.

-- Drop function that references admin_invites
DROP FUNCTION IF EXISTS public.claim_admin_invite(TEXT);

-- Drop tables in dependency order (child tables first)
DROP TABLE IF EXISTS public.resource_allocations;
DROP TABLE IF EXISTS public.resource_requests;
DROP TABLE IF EXISTS public.resources;
DROP TABLE IF EXISTS public.resource_types;
DROP TABLE IF EXISTS public.official_markers;
DROP TABLE IF EXISTS public.marker_types;
DROP TABLE IF EXISTS public.report_flags;
DROP TABLE IF EXISTS public.announcements;
DROP TABLE IF EXISTS public.weather_advisories;
DROP TABLE IF EXISTS public.disaster_alerts;
DROP TABLE IF EXISTS public.admin_invites;
DROP TABLE IF EXISTS public.push_subscriptions;

-- Drop enums that were only used by dropped tables
DROP TYPE IF EXISTS public.resource_request_status;
DROP TYPE IF EXISTS public.announcement_scope;
