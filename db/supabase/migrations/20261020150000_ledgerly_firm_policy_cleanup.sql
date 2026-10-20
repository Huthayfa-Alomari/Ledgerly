-- Remove the pre-Ledgerly legacy policy on public.firm.
-- It allowed any active app_user row to read firm identity without checking role_assignment.
-- Keep ledgerly_firm_read as the sole authenticated read policy.
DROP POLICY IF EXISTS brp_firm_read ON public.firm;
