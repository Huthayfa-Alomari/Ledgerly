-- Ensure internal schema-version metadata is protected by RLS before grants and
-- explicit deny policies are layered on in subsequent migrations.
ALTER TABLE public.schema_version ENABLE ROW LEVEL SECURITY;
