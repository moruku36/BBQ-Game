# BBQ Party

[English](README.md) | [日本語](README.ja.md)

BBQ Party is a 60-second grilling game for the browser. Pick an ingredient, tap an empty spot on the six-slot grill, and tap again to collect it at the right moment. It is plain static HTML, CSS, JavaScript and Canvas: no framework, no build step, no backend.

The in-game text is Japanese.

## Play

1. Open `index.html` in a browser (or serve the folder with any static file server).
2. Enter a nickname if you like (optional, up to 12 characters) and press **スタート**.
3. Choose an ingredient from the tray, then tap an empty grill slot to place it.
4. Tap the slot again to collect the food. Each slot shows a label and a timing bar.
5. After 60 seconds you get your result and can retry the same challenge straight away.

Keyboard: every slot and ingredient is a button (Tab / Enter / Space). `1`–`4` select an ingredient, `P` or `Esc` pauses.

## Rules

| Ingredient | Japanese name | Ideal time T | Base points |
| --- | --- | --- | --- |
| Shrimp | エビ | 3.0 s | 80 |
| Sausage | ソーセージ | 3.8 s | 100 |
| Kalbi beef | カルビ | 4.7 s | 125 |
| Corn | コーン | 6.0 s | 160 |

Cooking result by time on the grill (`age`):

| Range | Result | Points |
| --- | --- | --- |
| `age < 0.8T` | RAW | 0 |
| `0.8T <= age < T` | GOOD | 60% of base |
| `T <= age <= T + 0.8 s` | PERFECT | 100% of base |
| `T + 0.8 s < age <= 1.5T` | GOOD | 60% of base |
| `age > 1.5T` | BURNT | 0 |

- Boundaries: `0.8T` is GOOD, `T` is PERFECT, `T + 0.8 s` is still PERFECT, and exactly `1.5T` is still GOOD. Food burns the instant it goes past `1.5T`.
- Combo: collecting GOOD or PERFECT adds 1. Collecting RAW resets it. A burn resets it once, at the moment the food burns; clearing the burnt food afterwards costs nothing more.
- Multiplier: `min(2, 1 + 0.1 × combo)`, using the combo from before the collection.
- Popular ingredient: changes every 10 seconds (six phases, never the same twice in a row). The next one is previewed for the last 3 seconds of a phase. A GOOD or PERFECT collection of the ingredient that is popular at that moment earns a flat +50.
- Score for one collection: `round(base × quality × multiplier) + bonus`. The +50 is added after the multiplier and is not multiplied. Rounding is half-up.
- A slot ignores taps for 0.2 s after it was placed on or collected from, so a double tap cannot collect twice or pull food straight back off.
- The clock only runs during play. If the page is hidden, the timer and the food stop, and the game stays paused until you press **つづける**.
- When time is up, food still on the grill scores nothing and nothing more can be placed or collected.

## Challenges, records and sharing

- Each game is a challenge identified by a seed. The seed fixes the order of popular ingredients, and **同じチャレンジでもう一度** replays the same seed.
- A challenge link looks like `index.html#v=1&seed=123456789`. It contains only the version and the seed, never the nickname. Anything else in the fragment is rejected and a new random challenge is used.
- The share button uses the Web Share API when available, otherwise copies the link, otherwise shows it as text to copy by hand. Nothing is shared unless you press the button.
- Your best score, last nickname and mute setting are kept in this browser's `localStorage` only. There is no global ranking, no account and no server. If storage is unavailable the game still works and the best score lasts for the session.
- The page makes no network requests beyond loading its own files.

## Sound, motion and accessibility

- Short sound effects use Web Audio, created only after your first tap. The speaker button mutes them.
- With "reduce motion" enabled in the OS, particles, steam and the fly-to-plate animation are turned off.
- Cooking state is shown with a text label, a symbol and the timing bar's shape, not colour alone.

## Files

- `index.html` – page structure
- `styles.css` – layout and styling (mobile and desktop)
- `core.js` – game rules, timing, scoring, seeded schedule, link validation, storage and share helpers (no DOM)
- `art.js` – Canvas drawing for the garden, the grill and the food
- `app.js` – DOM wiring, rendering loop, sound and lifecycle
- `tests/` – Node tests

## Tests

Uses Node's built-in test runner (run here with Node.js 22). No dependencies to install.

```
npm test
```

`tests/core.test.js` covers the rules with an injected clock. `tests/app.test.js` loads the real page scripts into a small fake browser (`tests/helpers/fake-browser.js`) and plays through them. These are not real-browser tests: layout, rendering and audio output still need checking in an actual browser.
