export type SupabaseBrowserConfig = {
  url: string;
  anonKey: string;
};

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

export type SupabaseConfigResult =
  | { configured: true; config: SupabaseBrowserConfig }
  | { configured: false; reason: 'missing-config' | 'invalid-url' | 'unsafe-key' };

/**
 * Reads browser-safe Supabase configuration only.
 * Never place service_role or sb_secret credentials in VITE_* variables.
 */
export function readSupabaseBrowserConfig(env: ViteEnv): SupabaseConfigResult {
  const rawUrl = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!rawUrl || !anonKey) {
    return { configured: false, reason: 'missing-config' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { configured: false, reason: 'invalid-url' };
  }

  const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
  if (
    !['https:', ...(isLocalhost ? ['http:'] : [])].includes(parsedUrl.protocol) ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== '' ||
    parsedUrl.search !== '' ||
    parsedUrl.hash !== ''
  ) {
    return { configured: false, reason: 'invalid-url' };
  }

  const keyLower = anonKey.toLowerCase();
  if (keyLower.startsWith('sb_secret_') || keyLower.includes('service_role')) {
    return { configured: false, reason: 'unsafe-key' };
  }

  // Support current publishable keys and legacy anon JWTs; reject obvious secret JWTs.
  if (keyLower.startsWith('sb_publishable_')) {
    return { configured: true, config: { url: parsedUrl.origin, anonKey } };
  }

  try {
    const parts = anonKey.split('.');
    if (parts.length !== 3) return { configured: false, reason: 'unsafe-key' };
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
    if (payload.role !== 'anon') return { configured: false, reason: 'unsafe-key' };
  } catch {
    return { configured: false, reason: 'unsafe-key' };
  }

  return { configured: true, config: { url: parsedUrl.origin, anonKey } };
}
