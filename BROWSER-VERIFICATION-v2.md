# Version 2 browser verification

Verified on 2026-10-08 with Chrome 153.0.8010.55 in a new, isolated headless profile and a loopback preview. This report covers the six-food revision. [The version 1 report](BROWSER-VERIFICATION.md) and its four-food images remain historical evidence.

All **113 Node tests** and **106 browser checks** passed. Browser sizes: **360×640**, **390×844**, and **1280×800**. No JavaScript exceptions or CSP violations occurred. The browser was headless; no existing desktop browser or private profile was used.

The browser checks exercised start/game/result bounds, 44-pixel controls, six ingredients and their real Canvas drawings, the local top-three display, scores earned by three fictitious players through game input, nickname text safety, double-click/drag selection prevention, selectable nickname/share inputs, prestart sound settings, independent SE/BGM mute and volume controls, continuous original WebAudio note scheduling, pause/explicit resume, actual hidden-tab pause, retry without overlapping AudioContexts, favicon resource decoding, seed-v2 sharing and clipboard/manual fallbacks, and resize. Share APIs were injected to exercise their branches; no native OS share sheet was opened. An injected clock offset reached cooking and result states without waiting a real minute for every scenario.

The Node suite separately covers six-food timing/balance, seed reproducibility and v1-link handling, name-best storage, tie order and guest collisions, limits/corrupt storage/quota failures, v1 migration without attributing an anonymous old score, BGM lifecycle, and the other game rules. A Node assertion is not a physical-device test.

## Review images

The names Aki, Yui, and Ken are fictitious test names. Their scores in these images were earned through the real game controls with the injected test clock; no score was inserted into storage.

| View | Image |
| --- | --- |
| 360×640 game | [Mobile 360](assets/v2-browser-proof-mobile360.png) |
| 390×844 game | [Mobile 390](assets/v2-browser-proof-mobile390.png) |
| Desktop game | [Desktop](assets/v2-browser-proof-desktop.png) |
| 360×640 start | [Start](assets/v2-browser-proof-mobile360-start.png) |
| Sound settings | [Sound settings](assets/v2-browser-proof-sound-settings.png) |

## Limits and publication status

Audible speaker output, physical phone touch, iOS Safari, and the native share sheet remain unverified. These checks used the local preview, not a deployed v2 site. Publishing, merging, and changing the repository About text await the owner's final review. The live Pages release remains version 1 until that approval.

## 日本語

2026-10-08、新規の隔離headless Chrome 153.0.8010.55で6食材版を確認しました。Node **113件**、実ブラウザ **106項目**がPASS。360×640・390×844・1280×800で画面の収まり、44px操作部、描画、端末内top3、文字選択、音設定、BGM継続、一時停止・明示再開、共有fallback、favicon、CSPを確認し、JavaScript例外・CSP違反はありませんでした。

画像のAki・Yui・Kenは架空のテスト名です。時間を進めるテスト用clockを使い、実際の操作でスコアを獲得しました。OS共有画面は開かず、API分岐を合成入力で確認しています。音の聞こえ方、実端末touch、iOS Safariは未確認です。旧画像・旧reportはv1の履歴として保存しています。今回はローカル検証で、merge・Pages・Aboutの公開反映は本人の最終確認待ちです。
