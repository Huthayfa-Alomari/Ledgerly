-- Restrict internal schema-version metadata to trusted database roles.
-- This table is not application data and must not be exposed to browser clients.
REVOKE ALL PRIVILEGES ON TABLE public.schema_version FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.schema_version TO postgres, service_role;
