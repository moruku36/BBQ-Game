# BBQ Party ranking: implementation and pending live operations

This branch implements the UI, portable API handler and SQL draft. It is **not connected to a live Supabase project**: `ranking-config.js` has an empty endpoint and the production CSP still has `connect-src 'none'`. Local play remains available. Do not treat successful isolated CI as proof of a working public deployment.

## Data flow and trust

Explicit publication sends only run ID, display name and up to 512 accepted actions. The server issues a v2/standard run and replays `core.js` to derive the score; it never trusts a client-supplied score. This checks rule consistency, not human identity or bot-free play. Names are unverified, duplicate names are allowed, and the global board ranks scores, while device records remain per-name local bests. DOM output uses textContent.

One PostgreSQL invoker RPC (`public.bbq_dispatch`) performs bounded rate admission, run issue/read, receipt acknowledgement and atomic top-three replacement. All app tables are private with RLS enabled; anon/authenticated have neither table/schema access nor RPC execution. Only the server's service_role can call it. The browser gets no database key. SQL concurrency locks prevent duplicate receipt insertion and races over the global top three.

Body bounds are streamed before parsing; responses and client waits are bounded. Every request consumes admission, including OPTIONS, invalid methods and failed submissions. Proposed budgets and retention are in [RANKING-PROPOSAL.md](RANKING-PROPOSAL.md). Cleanup is request-driven and bounded: expiry prevents reuse immediately, but physical expired rows may remain while idle or until a cleanup backlog is drained. There is no deployed scheduled cleanup. Infrastructure logs/backups have separate, unverified retention.

A configured, gateway-controlled IP header is required before online admission can operate. The Edge adapter fails closed when the header configuration, its value, allowed origin or HMAC secret is missing. Header provenance and spoof-resistance must be verified on the selected gateway: **do not configure arbitrary X-Forwarded-For data as trusted**. Temporary HMAC hashes rotate hourly; no raw IP is stored by app code. Provider metadata logs are outside that claim.

## Pending operations requiring exact-target approval

The selected project/ref, organisation, region, Free eligibility and pause behaviour must be confirmed by the owner. This implementation does not touch existing unrelated projects, create persistent credentials or add paid services.

After individual approval for each security/credential operation:

1. Apply `supabase/migrations/202610080001_bbq_ranking.sql` to the selected project's database. This creates the private tables, RLS/grants and server-only invoker RPC. Review the exact SQL first. No other existing schema is altered.
2. Deploy function `bbq-ranking` with `supabase/config.toml`. Its public invocation setting is `verify_jwt=false`; all ranking access still goes through app validation/admission. This is an access/security change requiring approval.
3. Configure backend-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (platform-provided only if verified), `BBQ_HASH_SECRET` (persistent HMAC credential, separately approve generation/storage), `BBQ_ALLOWED_ORIGIN=https://moruku36.github.io`, and verified `BBQ_TRUSTED_IP_HEADER`. No values belong in Git, browser code, screenshots, prompts or logs.
4. Confirm deployed rate limiting, failed-request accounting, identical/conflicting retries, expiry, anon/authenticated denial, provider log retention and empty top-three behaviour against the selected live project. Avoid inventing provider guarantees.
5. Set only the public function URL in `ranking-config.js`, e.g. the approved origin plus `/functions/v1/bbq-ranking`. Update index.html CSP `connect-src` to that exact HTTPS origin, preserving all other directives. Add the real provider metadata/retention disclosure before enabling submissions.
6. Verify from separate browser/device sessions on a Pages preview or approved release: shared public scores, separate local scores, consent defaults, bilingual messages, real elapsed run minimum, offline/paused backend, retry without duplicate insertion. Do not fabricate test records in the live public board without authorization. Keep PR draft until these checks and merge/publication approval.

No rollback automatically drops data or security policy. Disable the client by clearing apiBase and restoring connect-src 'none'; an approved service-side shutdown/rollback must be planned separately.

## Verification commands

`npm test` runs game, app, i18n, API and client tests. The PostgreSQL integration test is skipped unless BBQ_TEST_DB=1 and explicitly refuses anything except PGHOST=127.0.0.1 / PGDATABASE=bbq_test.

GitHub Actions creates a disposable PostgreSQL 17 service with a test-only password and dummy anon/authenticated/service_role roles. It installs isolated Node tooling under RUNNER_TEMP. Node tests exercise real SQL permissions, simultaneous accept transactions, top-three trimming, retry receipts, rate windows and expiry. `tools/browser-ranking.cjs` then runs real Chromium with two independent browser contexts, actual API handler and that disposable database. Only its loopback HTML fixture permits self connections; production source configuration stays disabled. Accelerated client clocks and explicit CI-only DB timestamps avoid minute-long test waits.

`tools/browser-i18n.cjs` still verifies both languages at 360x640, 390x844 and 1280x800. Ranking screenshots and a JSON report are uploaded with the browser artifact. Automated screenshots are evidence, not a claim of manual image review, real Safari or physical-phone testing.
