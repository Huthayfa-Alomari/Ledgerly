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
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: "Server authentication is not configured." });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, { error: "Authentication required." });

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: authError } = await authClient.auth.getUser(token);
  if (authError || !userResult.user || userResult.user.aud !== "authenticated") {
    return json(401, { error: "The session is invalid or expired. Sign in again." });
  }

  let payload: { firm_name?: unknown; display_name?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "A JSON request body is required." });
  }

  const firmName = typeof payload.firm_name === "string" ? payload.firm_name.trim() : "";
  const displayName = typeof payload.display_name === "string" ? payload.display_name.trim() : "";
  if (firmName.length < 2 || firmName.length > 160 || displayName.length < 2 || displayName.length > 120) {
    return json(400, { error: "Firm name must be 2–160 characters and display name 2–120 characters." });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await adminClient.rpc("ledgerly_bootstrap_first_firm", {
    p_user_id: userResult.user.id,
    p_firm_name: firmName,
    p_display_name: displayName,
  });

  if (error) {
    if (error.code === "23505" || error.message?.includes("Initial firm already exists")) {
      return json(409, { error: "The first firm already exists. New accounts must be invited by a firm administrator." });
    }
    if (error.code === "42501") return json(403, { error: "This account cannot initialize the firm." });
    if (error.code === "22023") return json(400, { error: error.message });
    return json(500, { error: "Firm initialization failed. Contact support with the request time." });
  }

  return json(201, { result: data, message: "Firm initialized successfully." });
});
