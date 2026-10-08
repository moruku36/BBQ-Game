"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const I18n = require("../i18n.js");
const Core = require("../core.js");
const { boot, createStorage, ROOT } = require("./helpers/fake-browser.js");
const HASH = "#v=2&seed=123456789";

test("translation keys/placeholders match and every static target exists once", () => {
  assert.deepEqual(Object.keys(I18n.DICTIONARY.en), Object.keys(I18n.DICTIONARY.ja));
  for (const key of Object.keys(I18n.DICTIONARY.ja)) {
    const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort();
    assert.deepEqual(placeholders(I18n.DICTIONARY.ja[key]), placeholders(I18n.DICTIONARY.en[key]), key);
  }
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [id] of I18n.STATIC_TARGETS) assert.ok(ids.includes(id), id);
});

test("browser preference, saved language, invalid storage and denied storage", () => {
  assert.equal(I18n.detect({ languages: ["fr", "ja-JP"], language: "en" }), "ja");
  assert.equal(I18n.detect({ language: "fr" }), "en");
  const storage = createStorage({ [I18n.STORAGE_KEY]: "ja" });
  const env = boot({ storage, navigator: { language: "en" } });
  assert.equal(env.document.documentElement.getAttribute("lang"), "ja");
  env.click("languageStart");
  assert.equal(storage.getItem(I18n.STORAGE_KEY), "en");
  assert.equal(boot({ storage }).document.documentElement.getAttribute("lang"), "en");
  for (const kind of ["throw-access", "throw-methods"]) {
    const blocked = boot({ storage: kind, navigator: { language: "en" } });
    blocked.click("languageStart"); blocked.start();
    assert.equal(blocked.text("hudPlayer"), "ゲスト");
  }
  const invalid = boot({ stored: { [I18n.STORAGE_KEY]: "evil" }, navigator: { language: "en" } });
  assert.equal(invalid.document.documentElement.getAttribute("lang"), "en");
});

test("static help, results, sound, ingredient and aria labels change together", () => {
  const env = boot({ hash: HASH });
  env.click("languageStart");
  const tr = I18n.create({ navigator: { language: "en" } });
  for (const [id, attr, key] of I18n.STATIC_TARGETS) {
    if (["soundText", "pauseReason", "soundButton"].includes(id)) continue;
    const node = env.$(id);
    assert.equal(attr === "textContent" ? node.textContent : node.getAttribute(attr), tr.t(key), id);
  }
  assert.equal(env.text("ingName-steak"), "Steak");
  assert.match(env.$("ing-steak").getAttribute("aria-label"), /Expert/);
  assert.equal(env.$("nicknameInput").getAttribute("placeholder"), "Guest");
  assert.match(env.$("slot-0").getAttribute("aria-label"), /Slot 1: empty/);
  env.click("languageStart");
  assert.equal(env.text("startButton"), "スタート");
  assert.equal(env.$("slot-0").getAttribute("aria-label"), "網1: 空き。押すとエビを置く");
});

test("a live language change keeps food, timer, score, seed and the audio context", () => {
  const env = boot({ hash: HASH });
  env.start("Ken"); env.click("slot-0"); env.advance(1000); env.frame();
  const time = env.text("hudTime"), hash = env.window.location.hash, context = env.audioContexts[0];
  env.click("languageGame");
  assert.equal(env.text("hudTime"), time);
  assert.equal(env.window.location.hash, hash);
  assert.equal(env.$("slot-0").className, "slot is-raw");
  assert.match(env.$("slot-0").getAttribute("aria-label"), /Shrimp.*Still raw/);
  assert.equal(env.audioContexts.length, 1);
  assert.equal(env.audioContexts[0], context);
  assert.match(env.text("statusLine"), /Placed Shrimp/);
  env.advance(2000); env.click("slot-0");
  assert.equal(env.text("hudScore"), "80");
  assert.match(env.text("statusLine"), /Shrimp PERFECT! \+80 pts/);
});

test("language changes while hidden or paused do not resume the clock", () => {
  const env = boot({ hash: HASH });
  env.start(); env.click("slot-0"); env.advance(1000); env.setHidden(true);
  const time = env.text("hudTime");
  env.click("languagePause");
  assert.match(env.text("pauseReason"), /left the page/);
  env.advance(90000);
  assert.equal(env.text("hudTime"), time);
  assert.equal(env.rafCallbacks.size, 0);
  env.setHidden(false); env.click("resumeButton"); env.advance(2000); env.click("slot-0");
  assert.equal(env.text("hudScore"), "80");
});

test("result switching records no duplicate; retry keeps seed and language", () => {
  const env = boot({ hash: HASH });
  env.start(); env.click("slot-0"); env.advance(3000); env.click("slot-0"); env.advance(57000); env.frame();
  const record = env.storage.getItem(Core.STORAGE_KEY), hash = env.window.location.hash;
  env.click("languageResult");
  assert.equal(env.text("resultNickname"), "Guest");
  assert.equal(env.text("resultScore"), "80");
  assert.match(env.text("resultBest"), /Guest's best: 80 pts/);
  assert.equal(env.storage.getItem(Core.STORAGE_KEY), record);
  env.click("retryButton");
  assert.equal(env.text("hudScore"), "0");
  assert.equal(env.window.location.hash, hash);
  assert.equal(env.document.documentElement.getAttribute("lang"), "en");
});

test("English sound controls, error messages, and unsafe nickname remain text", () => {
  const env = boot({ hash: HASH, navigator: { language: "en" } });
  env.click("startSoundButton"); env.click("seToggle");
  assert.equal(env.text("seToggle"), "✕ Off");
  env.click("languageSound");
  assert.equal(env.text("seToggle"), "✕ オフ");
  env.click("languageSound"); env.click("soundCloseButton");
  env.start("x".repeat(13));
  assert.equal(env.text("nicknameError"), "Keep your nickname to 12 characters.");
  env.click("languageStart");
  assert.match(env.text("nicknameError"), /12文字/);
  env.start("<b>Ken</b>");
  assert.equal(env.text("hudPlayer"), "<b>Ken</b>");
});

test("share text, copy feedback and old-link explanation are translated", async () => {
  const copied = [];
  const env = boot({ hash: "#v=1&seed=42", navigator: { language: "en", clipboard: { writeText: async x => copied.push(x) } } });
  assert.match(env.text("linkNotice"), /v1 link/);
  env.start("Ken"); env.advance(60000); env.frame(); env.click("shareButton"); await env.flush();
  assert.equal(env.text("shareStatus"), "Link copied");
  assert.equal(copied.length, 1);
  assert.doesNotMatch(copied[0], /Ken/);
  env.click("languageResult");
  assert.equal(env.text("shareStatus"), "リンクをコピーしました");
});
