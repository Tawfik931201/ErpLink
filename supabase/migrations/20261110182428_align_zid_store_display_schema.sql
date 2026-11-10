BEGIN;
-- Legacy installs did not record creation time. Leave historical rows NULL
-- rather than inventing a date; future connections receive their actual time.
ALTER TABLE public.merchant_tokens ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.merchant_tokens ALTER COLUMN created_at SET DEFAULT now();
NOTIFY pgrst, 'reload schema';
COMMIT;
