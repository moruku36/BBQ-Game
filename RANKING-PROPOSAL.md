# Shared ranking — proposal only, not deployed

GitHub Pages stays static. Add one API and Postgres, with Supabase as a candidate pending target approval. Read-only discovery found the active, unrelated jev-learning-quest project and one inactive project; neither is BBQ-specific. No project, table, RLS, function or key has been created or changed.

One combined approval should identify the exact existing/new project and budget, isolated BBQ tables/API, anonymous public endpoint, RLS/grants, backend-only credential setup and temporary anti-abuse metadata retention. Do not use or resume unrelated existing services without this approval.

GET /top returns only three public names/scores for pinned version=2 and mode=standard. Label them Top 3 scores: a nickname is not proof of a unique person without accounts. Scores sort descending, then server timestamp/id ascending. Do not pretend local data is global.

POST /runs issues a random run ID bound to seed/version/mode and time. If unavailable, play continues locally and clearly says the run cannot be submitted online. At results, disclose that name/score will be public and require a Publish score click; never automatically upload local records.

POST /scores takes the run ID, 12-code-point NFC nickname and bounded action log. The server replays pinned core.js to compute points instead of trusting client score. Reject control/bidi/format characters, oversized payloads, unsupported mode/version/seed, invalid slots/ingredients, non-monotonic or out-of-round timestamps, >512 actions, incomplete rounds, submissions before 60 server seconds and expired runs. A transaction accepts one score per run ID. Identical retries return the original success; conflicting reuse fails. Keep the immutable request for explicit retry after a lost response.

Enable RLS on any exposed tables; grant no direct anon/authenticated writes or table reads. Only the approved API backend identity accesses narrow fixed operations. Secrets/service_role never belong in GitHub or Pages. CORS allows the Pages origin but is not authentication. Use distributed atomic throttling and TTL cleanup (proposed 20 starts/10 minutes per temporary salted network hash; no raw IP in game tables). Service operational logs may still contain network data and need disclosure. Automated clients can fabricate plausible play, so do not claim cheat-proof.

Keep local and online boards distinct. Online loading/empty/error/retry states are translated into both languages. Database failure never stops gameplay. Switching language never changes run IDs, pending payloads, or consent state; starting a new game creates a fresh run.

Required backend tests: server replay boundaries, forged scores/actions, invalid Unicode, mode/version mismatch, timestamp bounds, expiry, request size, duplicate/conflicting/concurrent submissions, throttling, outage/lost-response retry, no submission without consent, and two independent browsers seeing the same top three. Verify anonymous direct database access is denied.

No backend has been selected or implemented in this language-only draft. No merge/publication until backend approval and end-to-end verification for the requested shared ranking are complete.

Current backend documentation read through Supabase search_docs:
- https://supabase.com/docs/guides/functions/function-configuration (verify_jwt=false makes the function public)
- https://supabase.com/docs/guides/functions/recursive-functions (inbound calls are not protected by recursive-call throttling)

Local shell blocker: exec-server rejected request (-32603): helper_unknown_error: setup refresh had errors.
