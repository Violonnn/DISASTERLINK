-- Reports no longer use a report_types taxonomy; category is expressed in title/description/media.

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_report_type_id_fkey;

ALTER TABLE public.reports DROP COLUMN IF EXISTS report_type_id;

DROP TABLE IF EXISTS public.report_types;
