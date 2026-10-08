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

## Concrete recommendation for morning approval — not authorised

Recommended minimal shape: keep the existing GitHub Pages site, use **one Supabase Edge Function with the three routes above**, and perform score acceptance, idempotent receipts and rate-counter updates atomically in Postgres. Do not add Realtime, a queue, a separate cache, login or another service. Request-time expiry cleanup can use the same function/database transaction; no additional scheduler is proposed.

A new, dedicated project is recommended to isolate BBQ from the existing learning application. A possible project name is `bbq-party-ranking`, **not an owner-approved name**. The target organisation/name, actual Free project-slot eligibility, project region and final project ref have not been confirmed. Listing one active and one inactive existing project is not proof that a new Free slot is available.

As checked on 2026-10-08, the [official Supabase pricing page](https://supabase.com/pricing) lists Free at **$0/month**, a **limit of two active projects**, and pausing **after one week of inactivity**. This describes published plan terms, not an assurance of eligibility, capacity, continuous availability or an approved subscription. Do not create a paid project, upgrade a plan, resume an unrelated project or generate keepalive traffic to avoid pausing. The game must remain playable locally when the service is paused/unavailable. Actual organisation entitlements and provider-log retention remain to be checked before deployment.

### Proposed limits (all values require approval)

All time comparisons and rate buckets use server time. All endpoints, including GET, OPTIONS, unknown-route requests and rejected/failed POST attempts, consume a shared admission budget **before payload parsing**: proposed **120 requests/minute per temporary network hash** and **600 requests/minute globally**, with atomic database counters. A valid retry also consumes the budget; it cannot bypass throttling. Route-specific budgets apply in addition:

| Endpoint | Proposed additional limit | Input/output bound |
| --- | --- | --- |
| GET /top | 60/minute per hash; 300/minute globally | UTF-8 request target at most 256 bytes; no body; only version/mode query fields; response at most 1 KiB containing at most three name/score rows |
| POST /runs | 20/10 minutes per hash; 120/minute globally | JSON body at most 256 UTF-8 bytes, pinned version/mode/seed fields only; response at most 1 KiB |
| POST /scores | 10/10 minutes per hash; 120/minute globally | JSON body at most 32 KiB; at most 512 actions, a 12-code-point NFC name and one run ID; response at most 1 KiB |

These are app-level proposals, not provider defaults or a claim that external traffic cannot exhaust quotas. The origin allowlist does not protect against direct non-browser callers. Check Content-Length when present **and** count actual streamed bytes, stopping at the limit before decoding JSON; reject compressed request bodies. Count invalid JSON, unsupported method/version and oversized attempts against the admission budget. Rate rejection is 429 with a bounded Retry-After; malformed/oversized input is 400/413. Error bodies are generic and at most 1 KiB, with no SQL, request transcript or secret material. If counters/storage cannot be used safely, fail online operations closed with 503, without interrupting local play.

A run expires **15 minutes after issue**. First submission must arrive no earlier than **60 server seconds after issue** and before that expiry; pause does not extend expiry. An unsuccessful/unaccepted submission can be retried only within this remaining run window. Tell players when a long pause makes online submission unavailable, while preserving local results.

For a successfully accepted submission, keep an immutable request digest and receipt for **24 hours after acceptance**. An identical retry during that receipt window returns the original acknowledgement even after the run's first-submission window closes; check the receipt first, then enforce expiry for requests not previously accepted. Conflicting reuse of the ID is rejected. After receipt expiry, never accept that old ID as a fresh submission; return an expired/non-retryable result and do not silently generate a replacement ID. Do not auto-submit or retry on a timer.

### Proposed retention (not decided by the user)

- **Public top-three score records:** retain only while the record remains in the current top three for its pinned version/mode; delete a displaced record atomically with acceptance of its replacement. No permanent history or backup/export feature is proposed.
- **Runs, accepted receipts and action logs:** retain at most **24 hours** (runs/logs from issue or collection; receipts from acceptance). The 15-minute run validity is separate from this cleanup retention. Publicly displaced names/scores may therefore remain in a private receipt for its remaining 24-hour retry window; disclose that before publication.
- **Rate-counter network hashes:** retain at most **one hour**, including their counter rows; rotate the hashing period and expire old rows so the scheme cannot become a long-lived network identifier. Do not put raw IPs in application tables or log request bodies.
- **Provider infrastructure/operational logs:** separate from those application TTLs. Their actual retention, possible network metadata, access and deletion controls are **unconfirmed**; verify the selected project's settings and disclose them before enabling public submissions.

Expiry is enforced on reads/acceptance even before physical cleanup. Bounded cleanup in the same Edge Function/database path must remove expired rows; neither stale receipts nor old hashes may be used after their TTL. No deletion schedule has been deployed. Cleanup behaviour and the absence of historical public records must be tested before release.

### Execution approval remains separate

Morning design approval, or yesterday's planning approval, is **not a substitute** for the required, specific approval **at execution time** for generating/configuring persistent credentials or materially changing access/security. Before each such operation, identify the exact project/ref, credential role and destination (without exposing secret values), or exact schema/RLS/grant/public-function change, and obtain the required individual approval. A project/budget decision also does not authorise a paid upgrade.

This appendix is a recommendation for review, not a user decision. No live DB operation, service creation, credential generation/configuration or security-access change is performed by saving this document. The Japanese/English implementation remains unmerged in draft PR #3.


Implementation update: PR #3 now contains the proposed private SQL/API and consent UI with no live endpoint. See [RANKING-OPERATIONS.md](RANKING-OPERATIONS.md) for exact pending approvals, request-driven cleanup limitations and isolated CI scope. This code addition does not approve or apply the proposal.
