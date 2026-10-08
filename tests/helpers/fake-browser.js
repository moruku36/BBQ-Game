// A small fake browser for booting the real index.html + core.js + art.js +
// app.js under Node. It models only what the app touches, and it is strict:
// unknown Canvas members and any innerHTML write throw, so typos and unsafe
// rendering fail the tests instead of passing silently.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

const CTX_METHODS = [
  "save", "restore", "translate", "rotate", "scale", "setTransform", "beginPath", "closePath",
  "moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo", "arc", "arcTo", "ellipse", "rect",
  "fill", "stroke", "clip", "fillRect", "clearRect", "strokeRect", "fillText", "strokeText",
  "drawImage", "setLineDash",
];
const CTX_PROPS = [
  "fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "globalAlpha", "font",
  "textAlign", "textBaseline", "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY",
  "globalCompositeOperation", "lineDashOffset",
];

function createContext2d(stats) {
  const state = {};
  const gradient = () => ({ addColorStop() {} });
  const methods = {
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText: (text) => ({ width: String(text).length * 8 }),
  };
  for (const name of CTX_METHODS) {
    methods[name] = () => {
      stats.drawCalls += 1;
    };
  }
  return new Proxy(state, {
    get(target, key) {
      if (typeof key === "symbol") {
        return undefined;
      }
      if (key in methods) {
        return methods[key];
      }
      if (CTX_PROPS.includes(key)) {
        return target[key];
      }
      throw new Error("Canvas 2D member not available: " + key);
    },
    set(target, key, value) {
      if (!CTX_PROPS.includes(key)) {
        throw new Error("Canvas 2D property not available: " + String(key));
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error("Canvas 2D property " + key + " set to " + value);
      }
      target[key] = value;
      return true;
    },
  });
}

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) {
    if (this.listeners.has(type)) {
      this.listeners.get(type).delete(fn);
    }
  }

  dispatch(type, init) {
    const event = Object.assign({ type, target: this, defaultPrevented: false }, init);
    event.preventDefault = () => {
      event.defaultPrevented = true;
    };
    for (const fn of Array.from(this.listeners.get(type) || [])) {
      fn(event);
    }
    return event;
  }

  listenerCount() {
    let count = 0;
    this.listeners.forEach((set) => {
      count += set.size;
    });
    return count;
  }
}

class FakeElement extends FakeTarget {
  constructor(env, tagName, attributes) {
    super();
    this.env = env;
    this.tagName = tagName.toUpperCase();
    this.attributes = Object.assign({}, attributes);
    this.id = this.attributes.id || "";
    this.className = this.attributes.class || "";
    this.hidden = "hidden" in this.attributes;
    this.disabled = false;
    this.inert = false;
    this.value = this.attributes.value || "";
    this.style = {};
    this.width = Number(this.attributes.width) || 300;
    this.height = Number(this.attributes.height) || 150;
    this._text = "";
    this.dataset = {};
    for (const key of Object.keys(this.attributes)) {
      if (key.startsWith("data-")) {
        this.dataset[key.slice(5)] = this.attributes[key];
      }
    }
    const self = this;
    this.classList = {
      list: () => self.className.split(/\s+/).filter(Boolean),
      contains: (name) => self.classList.list().includes(name),
      add: (name) => self.classList.toggle(name, true),
      remove: (name) => self.classList.toggle(name, false),
      toggle(name, force) {
        const names = new Set(self.classList.list());
        const on = force === undefined ? !names.has(name) : Boolean(force);
        if (on) {
          names.add(name);
        } else {
          names.delete(name);
        }
        self.className = Array.from(names).join(" ");
        return on;
      },
    };
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = String(value);
  }

  get innerHTML() {
    throw new Error("innerHTML read on #" + this.id);
  }

  set innerHTML(value) {
    throw new Error("innerHTML write on #" + this.id + ": " + value);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  hasAttribute(name) {
    return name in this.attributes;
  }

  getContext(kind) {
    if (this.tagName !== "CANVAS" || kind !== "2d") {
      return null;
    }
    if (!this._ctx) {
      this._ctx = createContext2d(this.env.stats);
    }
    return this._ctx;
  }

  getBoundingClientRect() {
    return this.env.rectFor(this.id);
  }

  focus() {
    this.env.document.activeElement = this;
  }

  select() {
    this.selectedText = this.value;
  }

  click() {
    if (!this.disabled) {
      this.dispatch("click");
    }
  }
}

function parseElements(env, html) {
  const elements = new Map();
  const tagPattern = /<([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
  let tag = tagPattern.exec(html);
  while (tag) {
    const attributes = {};
    const attrPattern = /([a-zA-Z_:][-\w:.]*)(?:="([^"]*)")?/g;
    let attr = attrPattern.exec(tag[2]);
    while (attr) {
      attributes[attr[1]] = attr[2] === undefined ? "" : attr[2];
      attr = attrPattern.exec(tag[2]);
    }
    if (attributes.id) {
      elements.set(attributes.id, new FakeElement(env, tag[1], attributes));
    }
    tag = tagPattern.exec(html);
  }
  return elements;
}

function createStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

// Audio nodes are strict too: the app swallows audio errors on purpose, so an
// unknown member is also recorded in env.audioErrors for the tests to check.
function strictAudio(env, kind, members) {
  return new Proxy(members, {
    get(target, key) {
      if (typeof key === "symbol" || key in target) {
        return target[key];
      }
      const error = new Error("Web Audio member not available: " + kind + "." + String(key));
      env.audioErrors.push(error.message);
      throw error;
    },
  });
}

function createAudioParam(env, initial) {
  return strictAudio(env, "AudioParam", {
    value: initial,
    setValueAtTime(value) {
      this.value = value;
    },
    exponentialRampToValueAtTime() {},
    setTargetAtTime(value) {
      this.value = value;
    },
    cancelScheduledValues() {},
  });
}

// The context clock follows the test clock while "running" and stands still
// while suspended, like the real one. Every oscillator is kept with its
// start/stop times and the node chain it feeds, so tests can tell which bus
// (sound effects or BGM) a note went to and whether notes overlap.
class FakeAudioContext {
  constructor(env) {
    env.audioContexts.push(this);
    this.env = env;
    this.state = "running";
    this.destination = { name: "destination" };
    this.nodes = 0;
    this.oscillators = [];
    this.gains = [];
    this.banked = 0;
    this.since = env.clock;
  }

  get currentTime() {
    return this.state === "running" ? this.banked + (this.env.clock - this.since) / 1000 : this.banked;
  }

  createOscillator() {
    this.nodes += 1;
    const frequency = createAudioParam(this.env, 440);
    const osc = strictAudio(this.env, "OscillatorNode", {
      type: "sine",
      frequency,
      out: null,
      startAt: null,
      stopAt: null,
      onended: null,
      connect(target) {
        this.out = target;
      },
      disconnect() {},
      start(at) {
        this.startAt = at;
      },
      stop(at) {
        this.stopAt = at;
      },
    });
    this.oscillators.push(osc);
    return osc;
  }

  createGain() {
    const node = strictAudio(this.env, "GainNode", {
      gain: createAudioParam(this.env, 1),
      out: null,
      connect(target) {
        this.out = target;
      },
      disconnect() {},
    });
    this.gains.push(node);
    return node;
  }

  // Buses are the gain nodes wired straight to the destination, in creation
  // order: sound effects first, then BGM.
  buses() {
    const wired = this.gains.filter((node) => node.out === this.destination);
    return { se: wired[0], bgm: wired[1] };
  }

  notes(channel) {
    const bus = this.buses()[channel];
    return this.oscillators.filter((osc) => osc.out && osc.out.out === bus);
  }

  resume() {
    if (this.state === "suspended") {
      this.since = this.env.clock;
      this.state = "running";
    }
    return Promise.resolve();
  }

  suspend() {
    if (this.state === "running") {
      this.banked = this.currentTime;
      this.state = "suspended";
    }
    return Promise.resolve();
  }

  close() {
    this.banked = this.currentTime;
    this.state = "closed";
    return Promise.resolve();
  }
}

// options: { hash, storage: "ok" | "throw-access" | "throw-methods" | object,
//            stored, navigator, reducedMotion, width, height, audio }
function boot(options) {
  const opts = Object.assign({ hash: "", storage: "ok", width: 390, height: 844 }, options);
  const env = {
    clock: 0,
    stats: { drawCalls: 0 },
    audioContexts: [],
    audioErrors: [],
    rafCallbacks: new Map(),
    timeouts: new Map(),
    nextId: 1,
    size: { width: opts.width, height: opts.height },
    replacedHashes: [],
  };

  env.rectFor = (id) => {
    const { width, height } = env.size;
    const grill = { left: 24, top: Math.round(height * 0.3), width: width - 48, height: Math.round(height * 0.38) };
    const rect = (left, top, w, h) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h });
    if (id === "app") {
      return rect(0, 0, width, height);
    }
    if (id === "grill") {
      return rect(grill.left, grill.top, grill.width, grill.height);
    }
    if (id === "scoreCard") {
      return rect(width * 0.35, 56, width * 0.3, 56);
    }
    const slot = /^slot-(\d)$/.exec(id);
    if (slot) {
      const index = Number(slot[1]);
      const w = grill.width / 3;
      const h = grill.height / 2;
      return rect(grill.left + (index % 3) * w, grill.top + Math.floor(index / 3) * h, w, h);
    }
    return rect(0, 0, 0, 0);
  };

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const elements = parseElements(env, html);

  const document = new FakeTarget();
  document.hidden = false;
  document.visibilityState = "visible";
  document.activeElement = null;
  document.getElementById = (id) => elements.get(id) || null;
  document.createElement = (tagName) => new FakeElement(env, tagName, {});
  env.document = document;
  env.elements = elements;

  const window = new FakeTarget();
  window.window = window;
  window.document = document;
  window.console = console;
  window.devicePixelRatio = opts.devicePixelRatio || 2;
  window.performance = { now: () => env.clock };
  window.navigator = opts.navigator || {};
  window.location = {
    hash: opts.hash,
    href: "https://example.test/BBQ-Game/?utm=ignored" + opts.hash,
  };
  window.history = {
    replaceState(state, title, url) {
      env.replacedHashes.push(url);
      window.location.hash = url;
    },
  };
  window.matchMedia = (query) => ({ matches: Boolean(opts.reducedMotion) && /reduce/.test(query) });
  window.requestAnimationFrame = (fn) => {
    const id = env.nextId;
    env.nextId += 1;
    env.rafCallbacks.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    env.rafCallbacks.delete(id);
  };
  window.setTimeout = (fn, ms) => {
    const id = env.nextId;
    env.nextId += 1;
    env.timeouts.set(id, { fn, at: env.clock + (ms || 0) });
    return id;
  };
  window.clearTimeout = (id) => {
    env.timeouts.delete(id);
  };
  if (opts.audio !== false) {
    window.AudioContext = function AudioContext() {
      return new FakeAudioContext(env);
    };
  }
  if (opts.crypto !== false) {
    window.crypto = {
      getRandomValues(box) {
        box[0] = opts.randomSeed === undefined ? 123456789 : opts.randomSeed;
        return box;
      },
    };
  }

  if (opts.storage === "throw-access") {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("SecurityError: storage is disabled");
      },
    });
  } else if (opts.storage === "throw-methods") {
    window.localStorage = {
      getItem() {
        throw new Error("getItem failed");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };
  } else {
    env.storage = typeof opts.storage === "object" ? opts.storage : createStorage(opts.stored);
    window.localStorage = env.storage;
  }

  env.window = window;
  const context = vm.createContext(window);
  for (const file of ["core.js", "art.js", "app.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  }

  env.$ = (id) => {
    const node = elements.get(id);
    if (!node) {
      throw new Error("no element #" + id);
    }
    return node;
  };
  env.text = (id) => env.$(id).textContent;
  env.click = (id) => env.$(id).click();

  function runDueTimeouts() {
    for (const [id, timer] of Array.from(env.timeouts)) {
      if (timer.at <= env.clock && env.timeouts.has(id)) {
        env.timeouts.delete(id);
        timer.fn();
      }
    }
  }

  function runFrame() {
    const callbacks = Array.from(env.rafCallbacks);
    env.rafCallbacks.clear();
    for (const entry of callbacks) {
      entry[1](env.clock);
    }
  }

  // Moves the clock to `target`, rendering frames at `fps` on the way.
  // fps = 0 moves the clock without rendering any frame.
  env.runUntil = (target, fps) => {
    if (fps) {
      const step = 1000 / fps;
      let k = Math.floor(env.clock / step) + 1;
      while (k * step < target) {
        env.clock = k * step;
        runDueTimeouts();
        runFrame();
        k += 1;
      }
    }
    env.clock = target;
    runDueTimeouts();
  };
  env.advance = (ms, fps) => env.runUntil(env.clock + ms, fps === undefined ? 60 : fps);
  env.frame = runFrame;

  env.setHidden = (hidden) => {
    document.hidden = hidden;
    document.visibilityState = hidden ? "hidden" : "visible";
    document.dispatch("visibilitychange");
  };
  env.resize = (width, height) => {
    env.size = { width, height };
    window.dispatch("resize");
  };
  env.start = (nickname) => {
    if (nickname !== undefined) {
      env.$("nicknameInput").value = nickname;
    }
    return env.$("startForm").dispatch("submit");
  };
  env.listenerCount = () => {
    let count = window.listenerCount() + document.listenerCount();
    elements.forEach((node) => {
      count += node.listenerCount();
    });
    return count;
  };
  env.flush = () => new Promise((resolve) => setImmediate(resolve));

  return env;
}

module.exports = { boot, createStorage, ROOT };
