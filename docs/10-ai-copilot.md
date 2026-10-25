# Ledgerly AI Copilot — implementation and rollout gates

## Current implementation

The existing React application now has an optional AI Copilot navigation module. It builds a minimized summary from the currently selected engagement and deterministic trial-balance checks. The browser sends that summary only after the user ticks the explicit external-processing consent box and clicks Analyze.

The Edge Function is supabase/functions/ledgerly-ai-assistant/index.ts. It:
- Fails closed unless LEDGERLY_AI_ENABLED=true.
- Requires a valid, confirmed Supabase user, an active app_user profile, and an active firm-scoped role.
- Reads provider credentials only from server environment variables.
- Reconstructs an allowlisted summary server-side; arbitrary browser fields and source documents are not forwarded.
- Calls the OpenAI Responses API with store=false, no tools, and bounded output.
- Does not write generated text to Supabase or LocalStorage.
- Returns a structured result that must be reviewed by a human.

## Environment configuration

Required Edge Function secrets:
- OPENAI_API_KEY: provider API credential; server-side only.
- LEDGERLY_AI_MODEL: an explicitly selected model supported by the Responses API.
- LEDGERLY_AI_ENABLED: leave unset or false by default. Do not enable until all rollout gates below are signed off.

Supabase supplies its own URL and API keys to the Edge Function. Do not put any provider secret in VITE_*, browser code, source control, or the Windows package.

Secrets can be set in Supabase Dashboard → Edge Functions → Secrets. See [Supabase Edge Function secrets documentation](https://supabase.com/docs/guides/functions/secrets). The provider request uses the [OpenAI Responses API](https://developers.openai.com/api/reference/overview) and its structured-output capability.

## What may leave the device

Only the user prompt and a minimized JSON summary:
- fiscal year and engagement type;
- aggregate counts for risks, workpapers, evidence links, and open findings;
- trial-balance aggregate totals/differences and up to 20 sanitized exception categories/titles/amounts with generated reference IDs.

The function does not accept evidence files or raw client names, contact details, tax identifiers, or ledger rows as part of the context schema. Users must not type identifiers or confidential material into the prompt. A user's own prompt is still user-provided text, so the UI requires consent and warns against sensitive details.

store=false requests that the Responses API not store the response. This is not a substitute for the firm's vendor-risk assessment, legal basis, confidentiality obligations, retention review, or checking the provider's current data terms.

## Mandatory rollout gates — keep AI disabled until complete

1. Decide which firm roles may use AI, and obtain the firm's documented approval for external processing.
2. Add durable per-user/per-firm rate limits, monthly spend caps, usage accounting, and an administrative kill switch. The current function has a feature gate but does not yet implement durable quotas; therefore do not set LEDGERLY_AI_ENABLED=true in production.
3. Test two-firm isolation and role authorization using authenticated integration tests against the live Supabase project.
4. Review the exact provider/model, data-processing terms, retention settings, and regional/legal requirements.
5. Add evaluation cases for Arabic/English outputs, unsupported claims, fabricated references, prompt injection, malformed input, timeouts, and provider errors.
6. Confirm every AI output remains a draft. No AI output may approve a workpaper, post a journal entry, close an engagement, create a finding, or issue an audit opinion.
7. Add visible AI usage/cost disclosures and a way for a firm administrator to disable the feature.

## Known limitations

- The feature is not live until the Edge Function is deployed and its secrets are configured.
- It requires an active Ledgerly firm profile and role; the current production project previously had no seeded firm/user records.
- The AI only receives a summary. It cannot substantiate claims from raw documents or evidence it has not received.
- The current interface shows output as text and does not automatically save it to a working paper.
- The function is gated off by default. Do not enable it until durable cost controls and security tests exist.

## Updated privacy and usage controls (2026-10-25)

- The Edge Function now sends only aggregate workspace counts, high-level balance-check status, and fixed issue-category labels to OpenAI. Account names, account codes, individual balances, and source-row references are excluded from the server-sanitized payload.
- The function enforces a database-backed limit of 10 requests per user per rolling hour via `ledgerly_consume_ai_rate_limit`. Apply migration `202610250001_ai_rate_limit.sql` to staging before enabling `LEDGERLY_AI_ENABLED`; if the quota check is unavailable, the function fails closed.
- Explicit in-product consent and the office privacy review remain required. These controls do not replace a legal/privacy review or the office's confidentiality obligations.
