# BBQ Party

[English](README.md) | [日本語](README.ja.md)

BBQ Party is a 60-second grilling game for the browser. Pick one of six ingredients, tap an empty spot on the six-slot grill, and tap again to collect it at the right moment. Chain good collections for a combo multiplier, follow the "popular" ingredient for a bonus, and try to beat the top three scores on your device. The game is static HTML, CSS, JavaScript and Canvas with no framework or build step. A Supabase API provides optional shared scores.

The interface supports Japanese and English. The language button is available on every screen, remembers your choice when storage works and keeps the current round intact. Initial language follows the browser's supported preference (otherwise English).

Shared top-three scores are separate from device bests. Publishing requires explicit consent to make the nickname and score public; no device records are automatically uploaded. Online service failure leaves local play available.

[Play the published game](https://moruku36.github.io/BBQ-Game/) | [Version 2 verification and images](BROWSER-VERIFICATION-v2.md) — owner-reviewed and published.

## Play

1. Open `index.html` in a browser (or serve the folder with any static file server).
2. Enter a nickname if you like (optional, up to 12 characters). Sound can be set up here with **♪ 音の設定** before the game starts. Press **スタート**.
3. Choose an ingredient from the ingredient tray, then tap an empty grill slot to place it.
4. Tap the slot again to collect the food. Each slot shows a label and a timing bar.
5. After 60 seconds you get your result and can retry the same challenge straight away.

Keyboard: every slot and ingredient is a button (Tab / Enter / Space). `1`–`6` select an ingredient, `P` or `Esc` pauses.

## What changed in version 2

- **Six ingredients.** Shiitake (beginner) and thick-cut steak (expert) join the original four, each with its own picture, timing bar and tray label. The four originals keep their version 1 timing and points.
- **A PERFECT window per ingredient.** The width of the PERFECT window is now part of each ingredient's character and is written on its tray button.
- **Top three on this device.** Each nickname keeps its best score in this browser, and the top three are shown during play, on the start card and on the result card.
- **Original background music.** A short loop written for this game and synthesised with Web Audio. Sound effects and music have separate on/off switches and volumes.
- **Challenge links are version 2.** Version 1 links are recognised and explained, never replayed with a different meaning.
- **Smaller fixes.** Instructions no longer say where the tray is (it sits below the grill on phones and beside it on desktop); fast taps and drags no longer select game text; a favicon, a `noindex` request and a Content-Security-Policy were added.

## Rules

| Ingredient | Japanese name | Ideal time T | Base points | PERFECT window P | Character |
| --- | --- | --- | --- | --- | --- |
| Shrimp | エビ | 3.0 s | 80 | 0.8 s | fast |
| Sausage | ソーセージ | 3.8 s | 100 | 0.8 s | |
| Shiitake | しいたけ | 4.2 s | 100 | 1.4 s (widest) | beginner: mid speed, forgiving |
| Kalbi beef | カルビ | 4.7 s | 125 | 0.8 s | |
| Corn | コーン | 6.0 s | 160 | 0.8 s | slow |
| Thick-cut steak | 厚切りステーキ | 7.0 s | 210 | 0.5 s (narrowest) | expert: slowest, highest score |

Balance: with perfect timing a slot earns about 30 points per second from steak, about 26–27 from the four originals and about 24 from shiitake. A steak that only reaches GOOD earns less than a PERFECT of anything else, so steak pays off only for precise timing, the originals for average timing and shiitake for loose timing. No single ingredient is best for everyone; the tests check this.

Cooking result by time on the grill (`age`), with `P` taken from the table:

| Range | Result | Points |
| --- | --- | --- |
| `age < 0.8T` | RAW | 0 |
| `0.8T <= age < T` | GOOD | 60% of base |
| `T <= age <= T + P` | PERFECT | 100% of base |
| `T + P < age <= 1.5T` | GOOD | 60% of base |
| `age > 1.5T` | BURNT | 0 |

- Boundaries: `0.8T` is GOOD, `T` is PERFECT, `T + P` is still PERFECT, and exactly `1.5T` is still GOOD. Food burns the instant it goes past `1.5T`.
- The game lasts 60 seconds on a grill of 6 slots.
- Combo: collecting GOOD or PERFECT adds 1. Collecting RAW resets it. A burn resets it once, at the moment the food burns; clearing the burnt food afterwards costs nothing more.
- Multiplier: `min(2, 1 + 0.1 × combo)`, using the combo from before the collection.
- Popular ingredient: changes every 10 seconds (six phases, never the same twice in a row, drawn from all six ingredients). The next one is previewed for the last 3 seconds of a phase. A GOOD or PERFECT collection of the ingredient that is popular at that moment earns a flat +50.
- Score for one collection: `round(base × quality × multiplier) + bonus`. The +50 is added after the multiplier and is not multiplied. Rounding is half-up.
- A slot ignores taps for 0.2 s after it was placed on or collected from, so a double tap cannot collect twice or pull food straight back off.
- The clock only runs during play. If the page is hidden, the timer and the food stop, and the game stays paused until you press **つづける**.
- When time is up, food still on the grill scores nothing and nothing more can be placed or collected.

## Challenges, links and versions

- Each game is a challenge identified by a seed. The seed fixes the order of popular ingredients, and **同じチャレンジでもう一度** replays the same seed.
- A challenge link looks like `index.html#v=2&seed=123456789`. It contains only the version and the seed, never the nickname. Anything else in the fragment is rejected and a new random challenge is used.
- **Version 1 links (`#v=1&seed=…`) are not replayed.** With six ingredients the same seed number would pick a different popular order, so the meaning of an old link would change silently. Instead the start card says the link is from version 1 and starts a new version 2 challenge with a new seed; the old seed number is not reused.
- Version 2 schedules are pinned by tests. A future rule change that alters them must raise the version instead.
- The share button uses the Web Share API when available, otherwise copies the link, otherwise shows it in a text field to copy by hand. Nothing is shared unless you press the button.

## Top three on this device

- The ranking is **local to this browser on this device**. It is stored in `localStorage` and is not a global or online ranking: there is no account, no server and no way to see anyone else's scores.
- The same nickname is one player and keeps only its best score. Names are compared as typed after trimming (case-sensitive, Unicode-normalised).
- Playing without a name, or typing `ゲスト`, uses one shared guest entry for everyone. It is labelled as shared on the start and result cards.
- Equal scores are ordered by who reached the score first, and the order stays the same after a reload.
- Up to 20 names are stored and the top 3 are shown. A score is recorded only if it is a whole number from 1 to 99,999. Names are limited to 12 characters and are only ever written to the page as text.
- Damaged or hand-edited storage is repaired entry by entry. If storage is unavailable or full the game still works; the result card says the score could not be saved and it lasts for the session.
- **Migration from version 1:** version 1 stored a single best score with no name. It is not given to the last nickname or to anyone else. It is shown separately on the start card as an old version 1 best that is outside the ranking, and the version 1 record itself is left untouched. A version 1 mute setting carries over as both sound channels off.

## Sound

- The background music is an original eight-bar loop written for this game (C major, a square-wave melody over a triangle-wave bass, about 17 seconds). It is generated in the browser with Web Audio oscillators: no audio files, no third-party music, no downloads.
- Sound effects and music are independent: **♪ 音の設定** gives each an on/off switch and five volume levels, and changing one plays a short sample of that channel. The panel opens from the start card, from the pause card and from the speaker button during play (which pauses the game first). Settings are saved on this device.
- Audio starts only after a tap or key press. The music plays only during play: it stops on pause, when the tab is hidden and at the end of the round; it continues from where it stopped when you press **つづける**, and starts from the top on a retry. There is one audio context and one loop; the loop is driven by the game's frame loop, not by a timer of its own.

## Layout, motion and accessibility

- The game fits one screen without scrolling. Phones were designed for at 360×640 and 390×844: the top three is one slim line, the six ingredients sit in a 3 × 2 tray, and the grill keeps the remaining space. On desktop the grill takes the wide column and the HUD, top three and a 2 × 3 tray sit beside it.
- Tap targets are at least 44 px. Every control is a real button with a text label and works with the keyboard; focus is always visible.
- Cooking state is shown with a text label, a symbol and the timing bar's shape, not colour alone. The current player in the top three is marked with a pointer and an underline, and sound switches say on/off in words.
- Game text cannot be selected by fast taps, double clicks or drags. The nickname field and the share-link field can still be selected and copied.
- With "reduce motion" enabled in the OS, particles, steam and the fly-to-plate animation are turned off.

## Security and what it does not do

- The page loads only its own files from the same origin and makes no other network requests. Scripts, styles and icons are local files; nothing is inline.
- A `Content-Security-Policy` meta tag restricts the page to that: `default-src 'none'`, same-origin scripts, styles and images, no connections, no plugins, no `<base>`, no form submission target.
- Nicknames, stored data and the link fragment are untrusted input: they are validated (length, whole-number ranges, entry limits) and only ever written with `textContent` or as a form value.
- `<meta name="robots" content="noindex, nofollow">` asks search engines not to list the page. There is no `robots.txt` block, so crawlers can read that request.
- **Limits.** `noindex` is a request, not access control. The site URL, the repository and the source are public, and anyone with the URL can open the game. GitHub Pages does not let this project set HTTP response headers, so HSTS, `X-Frame-Options` and header-only CSP directives such as `frame-ancestors` are not configured by this repository. There is no password, login or private mode.
- The repository has a read-only test workflow, no deployment workflow or secrets, and no runtime dependencies. Browser tooling is installed only in the isolated CI runner.

## Technical structure

- `index.html` – page structure, CSP and robots meta tags, favicon links
- `styles.css` – layout and styling (mobile and desktop)
- `core.js` – everything with rules and no DOM: ingredient table, cook windows, scoring, the seeded popular schedule, challenge-link parsing and versions, nickname normalisation, the per-name record store and its migration, the BGM score and sequencer, share helper, the game state machine. It takes an injected clock, so it runs unchanged in Node.
- `art.js` – Canvas drawing for the garden, the grill, the six foods and the timing bar
- `i18n.js` – UI, help, results, sound and accessible labels in Japanese/English
- `app.js` – DOM wiring, the single frame loop, Web Audio (one context, a sound-effect bus and a BGM bus), the sound panel, screens and lifecycle
- `favicon.svg`, `favicon.ico`, `apple-touch-icon.png` – self-made icon; `tools/make-icons.js` regenerates the two fallback files
- `tests/` – Node tests
- `assets/` and `BROWSER-VERIFICATION.md` – screenshots and the real-browser report of version 1 (see below)

## Tests and verification

Uses Node's built-in test runner (run here with Node.js 22). No dependencies to install.

```
npm test
```

`tests/i18n.test.js` checks language selection, switches without state loss, optional storage, translated errors, sharing and text safety. `tools/browser-i18n.cjs` checks real Chromium in both languages at three viewports. It accelerates a round with clock offsets; it does not verify physical phones, Safari, audible output or the native share sheet. Previous v2 test/browser reports below describe the prior release, not this change.

`tests/core.test.js` covers the rules with an injected clock. `tests/app.test.js` loads the real page scripts into a small fake browser (`tests/helpers/fake-browser.js`) and plays through them.

Verified for version 2 by the Node tests (113 tests, all passing): the six-ingredient table, boundaries and balance; seeded schedules and pinned version 2 seeds; version 1 link handling; per-name bests, ties, the guest entry, limits, invalid scores, damaged storage and version 1 migration; nickname text safety; BGM start from a gesture, pause, hidden tab, end, retry and no overlapping loop; independent sound settings; text-selection handlers; the CSP and robots meta tags; and the CSS sizes behind the mobile layout.

Version 2 was also checked in a new isolated headless Chrome 153.0.8010.55: **106 browser checks passed** at 360×640, 390×844 and 1280×800, with no JavaScript exceptions or CSP violations. The checks exercised rendering, screen fit, controls, the local top three, sound settings and continuous BGM scheduling, pause/resume, selection behaviour, sharing fallbacks and favicon decoding. See [the version 2 report and review images](BROWSER-VERIFICATION-v2.md). Audible speaker output, physical phone touch, iOS Safari and the native share sheet remain unverified. This was a local preview; publishing awaits the owner’s final review.

History: [BROWSER-VERIFICATION.md](BROWSER-VERIFICATION.md) and the screenshots in `assets/` record the real Chrome verification of **version 1** (four ingredients, 69 Node tests). They are kept as a record of that release and do not show or verify version 2.

## Optional shared scores

The bilingual UI connects to the Tokyo Supabase project through one public Edge Function. Browsers receive no database key and cannot access the four private tables or server-only RPC. The API validates action logs, recalculates scores and uses shared rate limits. See [ranking operations](RANKING-OPERATIONS.md) for limits, retention and rollback. CI uses a disposable database and disables production requests.
