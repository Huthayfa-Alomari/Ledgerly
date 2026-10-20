DROP POLICY IF EXISTS ledgerly_invitation_deny_browser_access ON public.firm_invitation;
CREATE POLICY ledgerly_invitation_deny_browser_access
ON public.firm_invitation
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
