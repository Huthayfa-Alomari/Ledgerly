-- Explicitly deny browser roles access to internal schema-version metadata.
-- Table privileges are already revoked; this policy documents the intended deny-by-default behavior.
DROP POLICY IF EXISTS schema_version_deny_browser ON public.schema_version;
CREATE POLICY schema_version_deny_browser
  ON public.schema_version
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
