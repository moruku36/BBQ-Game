const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");

const heatInput = document.getElementById("heat");
const vibeInput = document.getElementById("vibe");
const toggleButton = document.getElementById("toggleButton");
const restartButton = document.getElementById("restartButton");
const ingredientPicker = document.getElementById("ingredientPicker");
const placeButton = document.getElementById("placeButton");
const flipButton = document.getElementById("flipButton");
const serveButton = document.getElementById("serveButton");
const discardButton = document.getElementById("discardButton");
const scoreOutput = document.getElementById("score");
const moodOutput = document.getElementById("mood");
const timeOutput = document.getElementById("timeLeft");
const comboOutput = document.getElementById("combo");
const orderList = document.getElementById("orderList");
const logList = document.getElementById("logList");
const slotSummary = document.getElementById("slotSummary");
const sceneCaption = document.getElementById("sceneCaption");

const TOTAL_TIME = 90;
const SLOT_COUNT = 6;

const INGREDIENTS = {
  beef: {
    label: "牛カルビ",
    shortLabel: "牛",
    colorRaw: "#b6423a",
    colorCooked: "#6f341d",
    colorBurnt: "#261818",
    accent: "#efc07e",
    rate: 16,
    target: [52, 76],
  },
  corn: {
    label: "とうもろこし",
    shortLabel: "とう",
    colorRaw: "#f3d75d",
    colorCooked: "#dfa63c",
    colorBurnt: "#6a4923",
    accent: "#fff2ab",
    rate: 11,
    target: [44, 68],
  },
  shrimp: {
    label: "えび串",
    shortLabel: "えび",
    colorRaw: "#8f7ea9",
    colorCooked: "#ff9b71",
    colorBurnt: "#4c2a28",
    accent: "#ffd1be",
    rate: 13,
    target: [48, 72],
  },
};

const FRIEND_NAMES = [
  "Haru",
  "Mio",
  "Ren",
  "Sora",
  "Yuna",
  "Aoi",
  "Kai",
  "Nagi",
  "Rin",
];

const state = {
  running: true,
  lastTime: 0,
  sceneTime: 0,
  score: 0,
  mood: 100,
  combo: 1,
  timeLeft: TOTAL_TIME,
  heat: Number(heatInput.value),
  vibe: Number(vibeInput.value),
  selectedType: "beef",
  selectedSlot: 0,
  grillSlots: [],
  orders: [],
  logEntries: [],
  sparks: [],
  ended: false,
};

function random(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function createItem(type) {
  return {
    type,
    cookA: 0,
    cookB: 0,
    side: "A",
    flipped: 0,
  };
}

function createOrder() {
  const type = pick(Object.keys(INGREDIENTS));
  const ingredient = INGREDIENTS[type];
  const targetCenter = random(ingredient.target[0], ingredient.target[1]);
  const spread = random(8, 12);

  return {
    id: crypto.randomUUID(),
    friend: pick(FRIEND_NAMES),
    type,
    min: Math.round(targetCenter - spread),
    max: Math.round(targetCenter + spread),
    patience: 100,
  };
}

function addLog(message) {
  state.logEntries.unshift(message);
  state.logEntries = state.logEntries.slice(0, 5);
}

function resetGame() {
  state.running = true;
  state.lastTime = 0;
  state.sceneTime = 0;
  state.score = 0;
  state.mood = 100;
  state.combo = 1;
  state.timeLeft = TOTAL_TIME;
  state.heat = Number(heatInput.value);
  state.vibe = Number(vibeInput.value);
  state.selectedType = "beef";
  state.selectedSlot = 0;
  state.grillSlots = Array.from({ length: SLOT_COUNT }, () => null);
  state.orders = Array.from({ length: 3 }, () => createOrder());
  state.logEntries = [];
  state.sparks = [];
  state.ended = false;

  addLog("夕焼けBBQスタート。焼き台をクリックして担当ポジションを決めましょう。");
  syncIngredientButtons();
  renderPanels();
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.floor(bounds.width * ratio);
  canvas.height = Math.floor(bounds.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function slotRects() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const grillWidth = Math.min(width * 0.62, 460);
  const grillHeight = Math.min(height * 0.24, 170);
  const startX = (width - grillWidth) / 2;
  const startY = height * 0.54;
  const gap = 12;
  const cols = 3;
  const rows = 2;
  const slotWidth = (grillWidth - gap * (cols + 1)) / cols;
  const slotHeight = (grillHeight - gap * (rows + 1)) / rows;
  const rects = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      rects.push({
        x: startX + gap + col * (slotWidth + gap),
        y: startY + gap + row * (slotHeight + gap),
        width: slotWidth,
        height: slotHeight,
      });
    }
  }

  return rects;
}

function cookAmount(item) {
  return (item.cookA + item.cookB) / 2;
}

function donenessLabel(value) {
  if (value < 24) {
    return "まだ生っぽい";
  }
  if (value < 46) {
    return "焼きはじめ";
  }
  if (value < 74) {
    return "食べごろ";
  }
  if (value < 92) {
    return "香ばしい";
  }
  return "焦げ気味";
}

function updateSlotSummary() {
  const item = state.grillSlots[state.selectedSlot];
  if (!item) {
    slotSummary.textContent =
      "空きスロットです。食材を選んで「網に置く」を押すと焼き始めます。";
    return;
  }

  const ingredient = INGREDIENTS[item.type];
  const average = Math.round(cookAmount(item));
  slotSummary.innerHTML = [
    `${state.selectedSlot + 1}番網: ${ingredient.label}`,
    `表 ${Math.round(item.cookA)} / 裏 ${Math.round(item.cookB)} / 平均 ${average}`,
    `いま上になっている面: ${item.side === "A" ? "表" : "裏"}`,
    `状態: ${donenessLabel(average)}`,
  ].join("<br>");
}

function syncIngredientButtons() {
  const chips = ingredientPicker.querySelectorAll(".ingredient-chip");
  chips.forEach((button) => {
    button.classList.toggle("active", button.dataset.type === state.selectedType);
  });
}

function renderOrders() {
  orderList.innerHTML = "";

  state.orders.forEach((order) => {
    const ingredient = INGREDIENTS[order.type];
    const card = document.createElement("article");
    card.className = "order-card";

    const title = document.createElement("h3");
    title.textContent = `${order.friend} の希望: ${ingredient.label}`;

    const detail = document.createElement("p");
    detail.textContent = `理想の焼き加減 ${order.min} - ${order.max}。いまの待ち余裕 ${Math.round(order.patience)}%。`;

    const bar = document.createElement("div");
    bar.className = "patience-bar";

    const fill = document.createElement("div");
    fill.className = "patience-fill";
    fill.style.width = `${clamp(order.patience, 0, 100)}%`;
    bar.appendChild(fill);

    card.append(title, detail, bar);
    orderList.appendChild(card);
  });
}

function renderLog() {
  logList.innerHTML = "";
  state.logEntries.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    logList.appendChild(item);
  });
}

function renderPanels() {
  scoreOutput.textContent = String(state.score);
  moodOutput.textContent = `${Math.round(state.mood)}%`;
  timeOutput.textContent = `${Math.max(0, Math.ceil(state.timeLeft))}s`;
  comboOutput.textContent = `x${state.combo}`;
  toggleButton.textContent = state.running ? "一時停止" : "再開";

  if (state.ended) {
    sceneCaption.textContent =
      `パーティー終了。スコア ${state.score} / 盛り上がり ${Math.round(state.mood)}%。もう一度遊べます。`;
  } else {
    sceneCaption.textContent =
      "焼き台をクリックして選択。食材を置く、返す、盛り付けるの順で進めましょう。";
  }

  updateSlotSummary();
  renderOrders();
  renderLog();
}

function placeSelectedIngredient() {
  if (state.ended || !state.running) {
    return;
  }

  if (state.grillSlots[state.selectedSlot]) {
    addLog("その網にはすでに食材があります。返すか盛り付けてから次を置きましょう。");
    renderPanels();
    return;
  }

  state.grillSlots[state.selectedSlot] = createItem(state.selectedType);
  addLog(`${INGREDIENTS[state.selectedType].label}を ${state.selectedSlot + 1}番網 に置きました。`);
  renderPanels();
}

function flipSelectedSlot() {
  const item = state.grillSlots[state.selectedSlot];
  if (!item || state.ended) {
    return;
  }

  item.side = item.side === "A" ? "B" : "A";
  item.flipped += 1;
  addLog(`${INGREDIENTS[item.type].label}をひっくり返しました。`);
  renderPanels();
}

function removeSelectedSlot(reason) {
  const item = state.grillSlots[state.selectedSlot];
  if (!item) {
    return;
  }

  state.grillSlots[state.selectedSlot] = null;
  addLog(`${INGREDIENTS[item.type].label}を${reason}。`);
  renderPanels();
}

function scoreDish(order, item) {
  const average = cookAmount(item);
  const bothSidesReady = Math.min(item.cookA, item.cookB) >= 24;
  const inRange = average >= order.min && average <= order.max;
  const distance = average < order.min ? order.min - average : average > order.max ? average - order.max : 0;
  const precision = Math.max(0, 22 - distance);
  const burnPenalty = average > 94 ? 24 : 0;
  let points = bothSidesReady ? 26 : 10;
  points += inRange ? 36 : precision;
  points -= burnPenalty;

  return {
    average: Math.round(average),
    bothSidesReady,
    inRange,
    points: Math.max(0, Math.round(points)),
  };
}

function serveSelectedSlot() {
  const item = state.grillSlots[state.selectedSlot];
  if (!item || state.ended) {
    return;
  }

  const orderIndex = state.orders.findIndex((order) => order.type === item.type);
  if (orderIndex === -1) {
    addLog("この食材を待っている友人がいません。もう少し様子を見るか片付けましょう。");
    renderPanels();
    return;
  }

  const order = state.orders[orderIndex];
  const result = scoreDish(order, item);

  if (result.points >= 54) {
    state.combo += 1;
    state.mood = clamp(state.mood + 8, 0, 100);
    addSparkBurst();
    addLog(`${order.friend} が大喜び。${INGREDIENTS[item.type].label}は大成功です。`);
  } else if (result.points >= 30) {
    state.combo = Math.max(1, state.combo);
    state.mood = clamp(state.mood + 3, 0, 100);
    addLog(`${order.friend} に一皿を届けました。いい感じの焼き加減です。`);
  } else {
    state.combo = 1;
    state.mood = clamp(state.mood - 8, 0, 100);
    addLog(`${order.friend} は少し惜しい表情。次はもう少し丁寧に焼けそうです。`);
  }

  state.score += result.points * state.combo;
  state.orders.splice(orderIndex, 1, createOrder());
  state.grillSlots[state.selectedSlot] = null;
  renderPanels();
}

function addSparkBurst() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  for (let i = 0; i < 16; i += 1) {
    state.sparks.push({
      x: width * 0.5 + random(-60, 60),
      y: height * 0.58 + random(-30, 20),
      vx: random(-38, 38),
      vy: random(-110, -30),
      life: random(0.6, 1.1),
      size: random(2, 5),
    });
  }
}

function updateOrders(delta) {
  for (let index = 0; index < state.orders.length; index += 1) {
    const order = state.orders[index];
    const patienceDrain = 4 + (100 - state.vibe) * 0.02;
    order.patience -= patienceDrain * delta * 6;

    if (order.patience <= 0) {
      state.orders[index] = createOrder();
      state.combo = 1;
      state.mood = clamp(state.mood - 12, 0, 100);
      addLog(`${order.friend} が待ちきれず、別の話題で盛り上がり始めました。`);
    }
  }
}

function updateGrill(delta) {
  const fireBoost = state.heat / 100;
  for (const item of state.grillSlots) {
    if (!item) {
      continue;
    }

    const ingredient = INGREDIENTS[item.type];
    const cookingSide = item.side === "A" ? "cookA" : "cookB";
    const restSide = item.side === "A" ? "cookB" : "cookA";
    item[cookingSide] += ingredient.rate * fireBoost * delta;
    item[restSide] += ingredient.rate * 0.18 * fireBoost * delta;
    item.cookA = clamp(item.cookA, 0, 110);
    item.cookB = clamp(item.cookB, 0, 110);
  }
}

function updateSparks(delta) {
  state.sparks = state.sparks
    .map((spark) => ({
      ...spark,
      x: spark.x + spark.vx * delta,
      y: spark.y + spark.vy * delta,
      vy: spark.vy + 120 * delta,
      life: spark.life - delta,
    }))
    .filter((spark) => spark.life > 0);
}

function finishGame() {
  state.running = false;
  state.ended = true;
  addLog("今日のBBQはここでひと区切り。次は実際にまた集まりましょう。");
  renderPanels();
}

function update(delta) {
  if (!state.running || state.ended) {
    return;
  }

  state.timeLeft -= delta;
  updateGrill(delta);
  updateOrders(delta);
  updateSparks(delta);

  if (Math.random() < delta * (0.8 + state.heat / 180)) {
    state.sparks.push({
      x: canvas.clientWidth * 0.5 + random(-90, 90),
      y: canvas.clientHeight * 0.67 + random(-10, 10),
      vx: random(-18, 18),
      vy: random(-80, -20),
      life: random(0.4, 0.8),
      size: random(1, 3),
    });
  }

  state.mood = clamp(state.mood - delta * 0.6 + state.vibe * 0.004 * delta, 0, 100);

  if (state.timeLeft <= 0 || state.mood <= 0) {
    finishGame();
  }
}

function ingredientColor(item) {
  const ingredient = INGREDIENTS[item.type];
  const average = cookAmount(item);
  if (average > 92) {
    return ingredient.colorBurnt;
  }
  if (average > 48) {
    return ingredient.colorCooked;
  }
  return ingredient.colorRaw;
}

function drawSky(width, height) {
  const sunset = ctx.createLinearGradient(0, 0, 0, height);
  sunset.addColorStop(0, "#fff2c6");
  sunset.addColorStop(0.34, "#ffb46f");
  sunset.addColorStop(0.68, "#cb6442");
  sunset.addColorStop(1, "#47231d");
  ctx.fillStyle = sunset;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255, 245, 223, 0.78)";
  ctx.beginPath();
  ctx.arc(width * 0.78, height * 0.2, 54, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  for (let i = 0; i < 4; i += 1) {
    const x = width * (0.18 + i * 0.16) + Math.sin(state.sceneTime * 0.00025 + i) * 12;
    const y = height * (0.17 + (i % 2) * 0.05);
    ctx.beginPath();
    ctx.ellipse(x, y, 44, 18, 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGround(width, height) {
  ctx.fillStyle = "#6f4f2a";
  ctx.fillRect(0, height * 0.74, width, height * 0.26);

  ctx.fillStyle = "#55703c";
  ctx.beginPath();
  ctx.moveTo(0, height * 0.68);
  ctx.quadraticCurveTo(width * 0.2, height * 0.62, width * 0.38, height * 0.7);
  ctx.quadraticCurveTo(width * 0.58, height * 0.78, width, height * 0.66);
  ctx.lineTo(width, height * 0.78);
  ctx.lineTo(0, height * 0.8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(41, 19, 12, 0.28)";
  ctx.fillRect(width * 0.12, height * 0.72, width * 0.76, height * 0.05);
}

function drawBanner(width, height) {
  const sway = Math.sin(state.sceneTime * 0.0018) * 6;
  ctx.strokeStyle = "rgba(72, 30, 16, 0.65)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width * 0.14, height * 0.18);
  ctx.lineTo(width * 0.86, height * 0.16);
  ctx.stroke();

  ctx.fillStyle = "#fff1cf";
  ctx.beginPath();
  ctx.moveTo(width * 0.3, height * 0.18 + sway);
  ctx.lineTo(width * 0.7, height * 0.16 - sway);
  ctx.lineTo(width * 0.66, height * 0.27 - sway);
  ctx.lineTo(width * 0.34, height * 0.29 + sway);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#823419";
  ctx.font = "700 24px 'Zen Maru Gothic'";
  ctx.textAlign = "center";
  ctx.fillText("SUNSET BBQ", width * 0.5, height * 0.23);
}

function drawTable(width, height) {
  ctx.fillStyle = "#7f4128";
  ctx.fillRect(width * 0.11, height * 0.72, width * 0.78, height * 0.04);
  ctx.fillStyle = "#4d2519";
  ctx.fillRect(width * 0.18, height * 0.76, width * 0.04, height * 0.15);
  ctx.fillRect(width * 0.78, height * 0.76, width * 0.04, height * 0.15);
}

function drawGrill(width, height, rects) {
  const grillBody = {
    x: width * 0.2,
    y: height * 0.5,
    width: width * 0.6,
    height: height * 0.24,
  };

  ctx.fillStyle = "#2b2220";
  ctx.beginPath();
  ctx.roundRect(grillBody.x, grillBody.y, grillBody.width, grillBody.height, 28);
  ctx.fill();

  const ember = ctx.createRadialGradient(width * 0.5, height * 0.66, 10, width * 0.5, height * 0.66, 180);
  ember.addColorStop(0, `rgba(255, 208, 96, ${0.3 + state.heat / 180})`);
  ember.addColorStop(0.45, `rgba(255, 120, 60, ${0.2 + state.heat / 240})`);
  ember.addColorStop(1, "rgba(78, 28, 24, 0)");
  ctx.fillStyle = ember;
  ctx.fillRect(grillBody.x, grillBody.y, grillBody.width, grillBody.height);

  ctx.strokeStyle = "#b9babd";
  ctx.lineWidth = 4;
  for (let i = 0; i < 7; i += 1) {
    const x = grillBody.x + 24 + i * ((grillBody.width - 48) / 6);
    ctx.beginPath();
    ctx.moveTo(x, grillBody.y + 18);
    ctx.lineTo(x, grillBody.y + grillBody.height - 18);
    ctx.stroke();
  }

  rects.forEach((rect, index) => {
    const selected = index === state.selectedSlot;
    ctx.strokeStyle = selected ? "#fff1b5" : "rgba(255, 248, 239, 0.24)";
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    if (!state.grillSlots[index]) {
      ctx.fillStyle = "rgba(255, 248, 239, 0.08)";
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  });
}

function drawIngredient(rect, item) {
  const ingredient = INGREDIENTS[item.type];
  const color = ingredientColor(item);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const average = cookAmount(item);

  ctx.save();
  ctx.translate(centerX, centerY);

  if (item.type === "beef") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-rect.width * 0.26, -rect.height * 0.2, rect.width * 0.52, rect.height * 0.4, 18);
    ctx.fill();
    ctx.strokeStyle = ingredient.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-rect.width * 0.16, 0);
    ctx.lineTo(rect.width * 0.16, 0);
    ctx.stroke();
  } else if (item.type === "corn") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-rect.width * 0.22, -rect.height * 0.18, rect.width * 0.44, rect.height * 0.36, 16);
    ctx.fill();
    ctx.fillStyle = ingredient.accent;
    for (let row = -1; row <= 1; row += 1) {
      for (let col = -3; col <= 3; col += 1) {
        ctx.beginPath();
        ctx.arc(col * 8, row * 9, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    ctx.strokeStyle = "#cfb497";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-rect.width * 0.18, rect.height * 0.22);
    ctx.lineTo(rect.width * 0.18, -rect.height * 0.22);
    ctx.stroke();
    ctx.fillStyle = color;
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath();
      ctx.arc(i * 12, i % 2 === 0 ? -4 : 6, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (average > 82) {
    ctx.fillStyle = "rgba(255, 249, 232, 0.12)";
    ctx.fillRect(-rect.width * 0.18, -rect.height * 0.2, rect.width * 0.36, rect.height * 0.1);
  }

  ctx.fillStyle = "rgba(255, 248, 239, 0.9)";
  ctx.font = "700 12px 'Zen Maru Gothic'";
  ctx.textAlign = "center";
  ctx.fillText(ingredient.shortLabel, 0, rect.height * 0.36);
  ctx.restore();
}

function drawGuests(width, height) {
  const baseline = height * 0.48;
  const positions = [0.16, 0.3, 0.7, 0.84];
  positions.forEach((position, index) => {
    const cheer = Math.sin(state.sceneTime * 0.003 + index) * (2 + state.vibe / 40);
    const x = width * position;
    ctx.fillStyle = "#31211f";
    ctx.beginPath();
    ctx.arc(x, baseline - 50 + cheer, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = index % 2 === 0 ? "#ffd26f" : "#9dd0ff";
    ctx.beginPath();
    ctx.roundRect(x - 20, baseline - 30, 40, 52, 16);
    ctx.fill();
  });
}

function drawSparks() {
  state.sparks.forEach((spark) => {
    ctx.fillStyle = `rgba(255, 217, 118, ${clamp(spark.life, 0, 1)})`;
    ctx.beginPath();
    ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawOverlay(width, height) {
  if (!state.ended) {
    return;
  }

  ctx.fillStyle = "rgba(28, 14, 12, 0.56)";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#fff6e8";
  ctx.textAlign = "center";
  ctx.font = "900 34px 'Zen Maru Gothic'";
  ctx.fillText("BBQフィニッシュ", width / 2, height * 0.34);
  ctx.font = "500 18px 'Zen Maru Gothic'";
  ctx.fillText(`スコア ${state.score} / 盛り上がり ${Math.round(state.mood)}%`, width / 2, height * 0.4);
  ctx.fillText("もう一度遊ぶで再開できます。", width / 2, height * 0.45);
}

function drawScene() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const rects = slotRects();

  drawSky(width, height);
  drawGround(width, height);
  drawBanner(width, height);
  drawGuests(width, height);
  drawTable(width, height);
  drawGrill(width, height, rects);

  rects.forEach((rect, index) => {
    const item = state.grillSlots[index];
    if (item) {
      drawIngredient(rect, item);
    }
  });

  drawSparks();
  drawOverlay(width, height);
}

function render(time) {
  if (!state.lastTime) {
    state.lastTime = time;
  }

  const delta = Math.min((time - state.lastTime) / 1000, 0.033);
  state.lastTime = time;
  state.sceneTime = time;

  update(delta);
  drawScene();

  if (Math.floor(time / 250) !== Math.floor((time - 16) / 250)) {
    renderPanels();
  }

  requestAnimationFrame(render);
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function handleCanvasClick(event) {
  const point = canvasPoint(event);
  const rects = slotRects();
  const hitIndex = rects.findIndex(
    (rect) =>
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
  );

  if (hitIndex !== -1) {
    state.selectedSlot = hitIndex;
    renderPanels();
  }
}

ingredientPicker.addEventListener("click", (event) => {
  const button = event.target.closest("[data-type]");
  if (!button) {
    return;
  }

  state.selectedType = button.dataset.type;
  syncIngredientButtons();
});

heatInput.addEventListener("input", (event) => {
  state.heat = Number(event.target.value);
});

vibeInput.addEventListener("input", (event) => {
  state.vibe = Number(event.target.value);
});

toggleButton.addEventListener("click", () => {
  if (state.ended) {
    return;
  }

  state.running = !state.running;
  renderPanels();
});

restartButton.addEventListener("click", () => {
  resetGame();
});

placeButton.addEventListener("click", placeSelectedIngredient);
flipButton.addEventListener("click", flipSelectedSlot);
serveButton.addEventListener("click", serveSelectedSlot);
discardButton.addEventListener("click", () => {
  removeSelectedSlot("片付けました");
});

canvas.addEventListener("click", handleCanvasClick);

window.addEventListener("resize", () => {
  resizeCanvas();
  renderPanels();
});

resizeCanvas();
resetGame();
requestAnimationFrame(render);
