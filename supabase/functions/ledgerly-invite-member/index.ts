import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(500, { error: "Server authentication is not configured." });

  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, { error: "Authentication required." });

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  const inviter = authData.user;
  if (authError || !inviter || inviter.aud !== "authenticated") return json(401, { error: "The session is invalid or expired. Sign in again." });

  let body: { email?: unknown; display_name?: unknown; role?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: "A JSON request body is required." }); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  const allowedRoles = ["engagement_partner", "manager", "senior", "staff", "reviewer", "eqcr"];
  const role = typeof body.role === "string" ? body.role : "";
  if (!/^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(email) || email.length > 254) return json(400, { error: "Enter a valid email address." });
  if (displayName.length < 2 || displayName.length > 120) return json(400, { error: "Display name must be 2–120 characters." });
  if (!allowedRoles.includes(role)) return json(400, { error: "The selected role cannot be invited." });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: inviterProfile, error: profileError } = await admin
    .from("app_user").select("firm_id,status").eq("id", inviter.id).is("deleted_at", null).maybeSingle();
  if (profileError || !inviterProfile || inviterProfile.status !== "active") return json(403, { error: "Your account is not linked to an active Ledgerly firm." });

  const { data: roles, error: rolesError } = await admin
    .from("role_assignment").select("role")
    .eq("firm_id", inviterProfile.firm_id).eq("user_id", inviter.id).eq("scope_type", "firm")
    .is("deleted_at", null).in("role", ["firm_admin", "managing_partner"]).limit(1);
  if (rolesError || !roles?.length) return json(403, { error: "Only firm administrators or managing partners may invite members." });

  const { data: existing, error: existingError } = await admin
    .from("app_user").select("id").ilike("email", email).is("deleted_at", null).limit(1);
  if (existingError) return json(500, { error: "Could not verify the invitee account." });
  if (existing?.length) return json(409, { error: "This email is already linked to a Ledgerly user." });

  const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: displayName },
  });
  if (inviteError || !invitation.user) {
    return json(409, { error: inviteError?.message || "The invitation could not be sent. The email may already have an account." });
  }

  const { data: record, error: recordError } = await admin.rpc("ledgerly_add_firm_invited_member", {
    p_inviter_id: inviter.id,
    p_target_user_id: invitation.user.id,
    p_firm_id: inviterProfile.firm_id,
    p_email: email,
    p_display_name: displayName,
    p_role: role,
  });

  if (recordError) {
    // Roll back the just-created pending auth account if membership provisioning fails.
    await admin.auth.admin.deleteUser(invitation.user.id);
    if (recordError.code === "23505") return json(409, { error: recordError.message });
    if (recordError.code === "42501") return json(403, { error: "You are not authorized to invite members to this firm." });
    if (recordError.code === "22023") return json(400, { error: recordError.message });
    return json(500, { error: "Invitation provisioning failed. The pending auth account was rolled back." });
  }

  return json(201, { invitation: record?.[0] ?? null, message: "Invitation email sent." });
});
