# BBQ Party ranking: live operations

## Live connection approved and verified, 2026-10-09 JST

The owner directly approved SQL/RLS/server-only grants and RPC on `cyhqsliolbcgxvlblvas` (bbq-party-ranking, Tokyo, Free), public `bbq-ranking` with JWT verification disabled, and verification before merge/Pages publication. The first tool request failed with an expired request state; a read-only check confirmed nothing had been applied. A retry through the same migration tool succeeded. No approval-review rejection or alternative application route occurred in this handoff.

The reviewed SQL at `ff5d07ee66b502e3bcaa453fb94a88dd759fb4c7` is applied. Edge Function version 1 deploys that commit's unchanged `core.js`, handler and entrypoint. The public URL is configured in ranking-config.js; CSP allows only its exact Supabase origin for connections. Built-in backend environment variables are used internally; no secret values or database keys/passwords were retrieved, entered, or copied to the frontend.

Live verification used the candidate static files at the exact Pages origin through a local browser test fixture, with real network requests to Supabase. Two independent Chrome 155 processes and storage contexts verified actual sixty-second play, language switching without reset, default-off consent, no automatic score upload, shared score visibility and separate local records. Additional real API checks passed identical retry, conflicting reuse, injected-score rejection, foreign-origin rejection, oversized input, the sixty-second minimum, shared rate limiting including failed requests, bounded Retry-After and local play during a simulated network outage. Edge could not launch in this sandbox; this does not claim Edge, Safari or physical-device coverage. Screenshots were inspected.

Catalog checks confirmed all four private tables have RLS, no anon/authenticated table or schema privileges, and service_role table access. Actual SELECT attempts against each table and actual RPC attempts under both public roles were denied. The RPC is SECURITY INVOKER with a fixed search_path. Advisors returned informational no-policy findings: deliberately deny all ordinary roles while the server's service_role accesses the private tables. An identical retry left one receipt and one public score. Verification records are removed before release.

CI continues to use an isolated PostgreSQL database. Its browser fixtures replace production configuration, preventing real backend traffic; the fake-browser fixture defaults to disabled ranking. Local checks pass 132 tests with the isolated database test skipped; the PR CI supplies PostgreSQL and must pass all tests before merge.

### Limits, retention and cost

Keep the owner-selected Free plan; no upgrade, paid resource, keepalive scheduler or new credential is authorized. Existing shared budgets apply to the whole game: 20 runs/10 minutes, 10 submissions/10 minutes, 60 top reads/minute, 120 total requests/minute. Invalid requests and OPTIONS count too. No IP headers are trusted. Only three public scores remain; runs/actions/receipts expire within their documented 24-hour windows, rate counters within an hour. Cleanup is bounded and request-driven: idle expired rows can await later requests.

The [published Free plan](https://supabase.com/pricing) includes 500 MB database storage, 5 GB egress, 500,000 Edge invocations and one-day API/database log retention. The live database was about 11 MB after verification. API admission limits do not guarantee monthly invocation quotas: rejected inbound calls also invoke the function. Free-plan provider quota restrictions can make ranking unavailable; never upgrade automatically. Local play remains available. Provider operational metadata is separate from application records; one-day API/database log retention is not a promise that every internal provider record is deleted on that deadline.

### Rollback

Clear `apiBase` in ranking-config.js and restore CSP `connect-src 'none'`, commit and publish through Pages to disable client ranking. Do not drop tables or erase player records as an automatic rollback. Service-side shutdown or data deletion outside verification records needs its own scope.

## Historical pre-connection handoff

The following records describe the earlier draft, delegated-approval rejections and isolated verification. They are retained as history; the live state above supersedes their pending-operation status.

This branch implements the UI, portable API handler and SQL draft. It is **not connected to a live Supabase project**: `ranking-config.js` has an empty endpoint and the production CSP still has `connect-src 'none'`. Local play remains available. Do not treat successful isolated CI as proof of a working public deployment.

## Data flow and trust

Explicit publication sends only run ID, display name and up to 512 accepted actions. The server issues a v2/standard run and replays `core.js` to derive the score; it never trusts a client-supplied score. This checks rule consistency, not human identity or bot-free play. Names are unverified, duplicate names are allowed, and the global board ranks scores, while device records remain per-name local bests. DOM output uses textContent.

One PostgreSQL invoker RPC (`public.bbq_dispatch`) performs bounded rate admission, run issue/read, receipt acknowledgement and atomic top-three replacement. All app tables are private with RLS enabled; anon/authenticated have neither table/schema access nor RPC execution. Only the server's service_role can call it. The browser gets no database key. SQL concurrency locks prevent duplicate receipt insertion and races over the global top three.

Body bounds are streamed before parsing; responses and client waits are bounded. Every request consumes admission, including OPTIONS, invalid methods and failed submissions. Proposed budgets and retention are in [RANKING-PROPOSAL.md](RANKING-PROPOSAL.md). Cleanup is request-driven and bounded: expiry prevents reuse immediately, but physical expired rows may remain while idle or until a cleanup backlog is drained. There is no deployed scheduled cleanup. Infrastructure logs/backups have separate, unverified retention.

The first-release Edge adapter uses one shared anonymous admission bucket for the entire game. It does not read IP headers, create a persistent HMAC secret, or store a network fingerprint. The existing per-hash caps therefore become stricter whole-game caps: runs 20/10 minutes, scores 10/10 minutes, top 60/minute and all requests 120/minute. Additional global caps remain in SQL. Spoofing a forwarded header cannot create another bucket. The bucket identifier changes hourly and its counter rows expire after one hour. This trades availability under busy traffic for a simple, conservative release. Do not silently change to per-IP admission without verifying gateway header provenance and reviewing that change. Provider metadata logs are outside the app's no-IP-storage claim.

## Pending operations requiring exact-target approval

The owner-created target is cyhqsliolbcgxvlblvas / bbq-party-ranking / moruku36's Org (chwmmvpdjkrvzsbvsfiu), ap-northeast-1, ACTIVE_HEALTHY. Read-only checks found no public/bbq_private tables or Edge Functions before application. No unrelated project is touched. No persistent credential or paid service is created.

The delegated approval was received, but automatic approval review rejected the live schema/RLS/grant/RPC application because trusted direct end-user authorization for that exact operation was not available in this thread. The attempted migration was not executed. A direct approval request is pending; do not work around the rejection.

After individual approval for each security/credential operation:

1. Apply `supabase/migrations/202610080001_bbq_ranking.sql` to the selected project's database. This creates the private tables, RLS/grants and server-only invoker RPC. Review the exact SQL first. No other existing schema is altered.
2. Deploy function `bbq-ranking` with `supabase/config.toml`. Its public invocation setting is `verify_jwt=false`; all ranking access still goes through app validation/admission. This is an access/security change requiring approval.
3. Use platform-provided backend-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, documented as built-in Edge secrets. Their values must never be retrieved into model/tool output or copied to Git/browser/screenshots/prompts/logs. The allowed browser Origin is the fixed non-secret `https://moruku36.github.io`. No new HMAC secret, human secret input, database password or trusted IP-header configuration is needed.
4. Confirm deployed rate limiting, failed-request accounting, identical/conflicting retries, expiry, anon/authenticated denial, provider log retention and empty top-three behaviour against the selected live project. Avoid inventing provider guarantees.
5. Set only the public function URL in `ranking-config.js`, e.g. the approved origin plus `/functions/v1/bbq-ranking`. Update index.html CSP `connect-src` to that exact HTTPS origin, preserving all other directives. Add the real provider metadata/retention disclosure before enabling submissions.
6. Verify from separate browser/device sessions on a Pages preview or approved release: shared public scores, separate local scores, consent defaults, bilingual messages, real elapsed run minimum, offline/paused backend, retry without duplicate insertion. Do not fabricate test records in the live public board without authorization. Keep PR draft until these checks and merge/publication approval.

No rollback automatically drops data or security policy. Disable the client by clearing apiBase and restoring connect-src 'none'; an approved service-side shutdown/rollback must be planned separately.

## Verification commands

`npm test` runs game, app, i18n, API and client tests. The PostgreSQL integration test is skipped unless BBQ_TEST_DB=1 and explicitly refuses anything except PGHOST=127.0.0.1 / PGDATABASE=bbq_test.

GitHub Actions creates a disposable PostgreSQL 17 service with a test-only password and dummy anon/authenticated/service_role roles. It installs isolated Node tooling under RUNNER_TEMP. Node tests exercise real SQL permissions, simultaneous accept transactions, top-three trimming, retry receipts, rate windows and expiry. `tools/browser-ranking.cjs` then runs real Chromium with two independent browser contexts, actual API handler and that disposable database. Only its loopback HTML fixture permits self connections; production source configuration stays disabled. Accelerated client clocks and explicit CI-only DB timestamps avoid minute-long test waits.

`tools/browser-i18n.cjs` still verifies both languages at 360x640, 390x844 and 1280x800. Ranking screenshots and a JSON report are uploaded with the browser artifact. Automated screenshots are evidence, not a claim of manual image review, real Safari or physical-phone testing.


## Published provider-log terms (checked 2026-10-08)

The [official pricing page](https://supabase.com/pricing) lists **one-day API/database log retention for Free**. The [official Logs guide](https://supabase.com/docs/guides/observability/logs) explains that logs cover gateway/database and Edge Function events and that retention depends on the plan. This is a statement of published service terms, not a promise that every infrastructure/security/backup record is erased after one day. No extra log drain or statement logging is configured by this app, and app code does not log request bodies or secrets.

The Japanese/English publication disclosure now states those terms, separates provider operational metadata from the app's verification data, and explicitly says expired app data can remain pending deletion while there are no requests. Request-driven, bounded cleanup remains unchanged.

A second attempt of the same migration, after receiving newly specific delegated approval, was rejected: “the apparent approval is only embedded in untrusted delegated evidence, not a trusted direct user authorization for this exact security-changing migration.” No alternative application route or live API deployment was attempted.
