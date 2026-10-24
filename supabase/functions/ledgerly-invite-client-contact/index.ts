import { createClient } from "npm:@supabase/supabase-js@2";

const allowedHeaders = "authorization, apikey, content-type, x-client-info";

function allowedOrigins(): string[] {
  return (Deno.env.get("LEDGERLY_CLIENT_PORTAL_ALLOWED_ORIGINS") ?? "")
    .split(",").map(value => value.trim()).filter(Boolean);
}

function corsHeaders(origin: string | null) {
  const allowed = origin && allowedOrigins().includes(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": allowedHeaders,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req.headers.get("Origin")) });
}

function validEmail(value: string) {
  return value.length >= 5 && value.length <= 254 &&
    /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const origins = allowedOrigins();
  if (!origin || !origins.includes(origin)) return json(req, 403, { error: "This origin is not allowed for the client portal." });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed." });

  // Both the deployment flag and origin/redirect allowlists are required. Nothing is enabled by default.
  if (Deno.env.get("LEDGERLY_CLIENT_PORTAL_ENABLED") !== "true") {
    return json(req, 503, { error: "Client portal invitations are disabled by the server administrator." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const redirectTo = Deno.env.get("LEDGERLY_CLIENT_PORTAL_REDIRECT_URL")?.trim() ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !redirectTo) {
    return json(req, 503, { error: "Client portal authentication is not configured on the server." });
  }

  let redirectUrl: URL;
  try { redirectUrl = new URL(redirectTo); } catch {
    return json(req, 503, { error: "The client portal redirect URL is invalid." });
  }
  if (redirectUrl.protocol !== "https:" || !origins.includes(redirectUrl.origin) || redirectUrl.searchParams.get("portal") !== "client") {
    return json(req, 503, { error: "The redirect URL must be an allowlisted HTTPS origin with portal=client." });
  }

  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(req, 401, { error: "Authentication is required." });

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  const inviter = authData.user;
  if (authError || !inviter || inviter.aud !== "authenticated") {
    return json(req, 401, { error: "The staff session is invalid or expired." });
  }
  if (!inviter.email_confirmed_at) {
    return json(req, 403, { error: "Confirm the staff email before inviting a client contact." });
  }

  let body: { engagement_id?: unknown; email?: unknown; display_name?: unknown };
  try { body = await req.json(); } catch {
    return json(req, 400, { error: "A JSON request body is required." });
  }
  const engagementId = typeof body.engagement_id === "string" ? body.engagement_id.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (!engagementId || engagementId.length > 128) return json(req, 400, { error: "Select a valid engagement." });
  if (!validEmail(email)) return json(req, 400, { error: "Enter a valid email address." });
  if (displayName.length < 2 || displayName.length > 120) return json(req, 400, { error: "Contact name must contain 2–120 characters." });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await admin.from("app_user")
    .select("id,firm_id,status,email,deleted_at")
    .eq("id", inviter.id).maybeSingle();
  if (profileError || !profile || profile.status !== "active" || profile.deleted_at) {
    return json(req, 403, { error: "The staff account is not an active Ledgerly office member." });
  }

  const { data: engagement, error: engagementError } = await admin.from("engagement")
    .select("id,firm_id,client_id,deleted_at")
    .eq("id", engagementId).eq("firm_id", profile.firm_id).is("deleted_at", null).maybeSingle();
  if (engagementError || !engagement || engagement.deleted_at) {
    return json(req, 404, { error: "The engagement was not found in the staff member's firm." });
  }

  const { data: roles, error: rolesError } = await admin.from("role_assignment")
    .select("role,scope_type,scope_id,deleted_at")
    .eq("user_id", inviter.id).eq("firm_id", profile.firm_id).is("deleted_at", null);
  if (rolesError) return json(req, 500, { error: "Unable to verify office authorization." });

  const authorized = (roles ?? []).some(role =>
    (role.scope_type === "firm" && ["firm_admin", "managing_partner"].includes(role.role)) ||
    (role.scope_type === "engagement" && role.scope_id === engagementId && ["engagement_partner", "manager"].includes(role.role))
  );
  if (!authorized) return json(req, 403, { error: "Your role does not permit inviting a client contact for this engagement." });

  const { data: internalUser, error: internalUserError } = await admin.from("app_user")
    .select("id").ilike("email", email).is("deleted_at", null).limit(1);
  if (internalUserError) return json(req, 500, { error: "Unable to validate the recipient account." });
  if (internalUser?.length) return json(req, 409, { error: "This email is linked to an internal Ledgerly account. Use a separate client-contact account." });

  const { data: existingMember, error: memberLookupError } = await admin.from("client_portal_member")
    .select("id,status")
    .eq("firm_id", profile.firm_id)
    .eq("engagement_id", engagementId)
    .ilike("email", email)
    .in("status", ["invited", "active"])
    .is("deleted_at", null)
    .limit(1);
  if (memberLookupError) return json(req, 500, { error: "Unable to check existing portal membership." });
  if (existingMember?.length) return json(req, 409, { error: "An invitation or active membership already exists for this contact and engagement." });

  const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: displayName },
    redirectTo,
  });
  if (inviteError || !invitation.user) {
    return json(req, 409, { error: inviteError?.message || "The invitation could not be sent. The email may already have an account." });
  }

  const { data: member, error: provisionError } = await admin.rpc("ledgerly_add_client_portal_member", {
    p_inviter_id: inviter.id,
    p_target_user_id: invitation.user.id,
    p_engagement_id: engagementId,
    p_email: email,
    p_display_name: displayName,
  });

  if (provisionError) {
    // Do not leave an Auth user behind if the scoped membership transaction is rejected.
    await admin.auth.admin.deleteUser(invitation.user.id);
    if (provisionError.code === "23505") return json(req, 409, { error: "An invitation or membership already exists for this engagement." });
    if (provisionError.code === "42501") return json(req, 403, { error: "The server rejected this invitation due to insufficient office permissions." });
    if (provisionError.code === "22023") return json(req, 400, { error: provisionError.message });
    return json(req, 500, { error: "Unable to provision the scoped client portal membership." });
  }

  return json(req, 201, {
    member,
    message: "Invitation sent. The contact gains access only after verifying the invited email and accepting the portal invitation.",
  });
});
