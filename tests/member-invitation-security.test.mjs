import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../db/supabase/migrations/20261020104000_ledgerly_secure_member_invitations.sql', import.meta.url), 'utf8');
const alignment = readFileSync(new URL('../db/supabase/migrations/20261020104500_ledgerly_invitation_schema_alignment.sql', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/ledgerly-invite-member/index.ts', import.meta.url), 'utf8');
const denyPolicy = readFileSync(new URL('../db/supabase/migrations/20261020105000_ledgerly_invitation_explicit_deny_policy.sql', import.meta.url), 'utf8');

test('invitation table is isolated from browser roles and RPC is service-role only', () => {
  assert.match(migration, /ALTER TABLE public\.firm_invitation ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.firm_invitation FROM authenticated/);
  assert.match(migration, /GRANT ALL ON TABLE public\.firm_invitation TO service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.ledgerly_add_firm_invited_member\([^)]+\) FROM authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.ledgerly_add_firm_invited_member\([^)]+\) TO service_role/);
  assert.match(alignment, /ADD COLUMN IF NOT EXISTS row_version/);
  assert.match(alignment, /SET status = 'expired'/);
  assert.match(alignment, /expires_at < now_iso/);
  assert.match(denyPolicy, /TO anon, authenticated/);
  assert.match(denyPolicy, /USING \(false\)/);
  assert.match(denyPolicy, /WITH CHECK \(false\)/);
});

test('invite endpoint validates the caller and limits invite roles', () => {
  assert.match(edge, /auth\.getUser\(token\)/);
  assert.match(edge, /firm_admin.*managing_partner/);
  assert.match(edge, /allowedRoles/);
  assert.match(edge, /ledgerly_add_firm_invited_member/);
  assert.match(edge, /deleteUser\(invitation\.user\.id\)/);
  assert.match(edge, /LEDGERLY_INVITE_REDIRECT_URL/);
  assert.match(edge, /LEDGERLY_INVITATIONS_ENABLED/);
  assert.match(edge, /role-specific RLS policies are validated/);
  assert.match(edge, /redirectTo/);
  assert.doesNotMatch(edge, /sb_secret_|SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']/);
  const panel = readFileSync(new URL('../src/CloudAuthPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /ledgerly-invite-member/);
  assert.match(panel, /إرسال دعوة عضو/);
});
