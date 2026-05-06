const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");

const heatInput = document.getElementById("heat");
const toggleButton = document.getElementById("toggleButton");
const restartButton = document.getElementById("restartButton");
const ingredientPicker = document.getElementById("ingredientPicker");
const scoreOutput = document.getElementById("score");
const servedCountOutput = document.getElementById("servedCount");
const timeOutput = document.getElementById("timeLeft");
const heatValueOutput = document.getElementById("heatValue");
const slotSummary = document.getElementById("slotSummary");
const logList = document.getElementById("logList");
const sceneCaption = document.getElementById("sceneCaption");

const TOTAL_TIME = 60;
const SLOT_COUNT = 6;

const INGREDIENTS = {
  beef: {
    label: "牛カルビ",
    shortLabel: "牛",
    colorRaw: "#b6423a",
    colorCooked: "#7b341f",
    colorBurnt: "#221717",
    accent: "#efc07e",
    rate: 18,
    idealMin: 48,
    idealMax: 74,
  },
  corn: {
    label: "とうもろこし",
    shortLabel: "とう",
    colorRaw: "#f3d75d",
    colorCooked: "#d99a35",
    colorBurnt: "#634922",
    accent: "#fff2ab",
    rate: 12,
    idealMin: 44,
    idealMax: 68,
  },
  shrimp: {
    label: "えび串",
    shortLabel: "えび",
    colorRaw: "#8f7ea9",
    colorCooked: "#ff9b71",
    colorBurnt: "#492927",
    accent: "#ffd1be",
    rate: 14,
    idealMin: 46,
    idealMax: 70,
  },
};

const state = {
  running: true,
  ended: false,
  lastTime: 0,
  sceneTime: 0,
  heat: Number(heatInput.value),
  timeLeft: TOTAL_TIME,
  selectedType: "beef",
  score: 0,
  servedCount: 0,
  grillSlots: [],
  sparks: [],
  logEntries: [],
};

function random(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function addLog(message) {
  state.logEntries.unshift(message);
  state.logEntries = state.logEntries.slice(0, 5);
}

function createFood(type) {
  return {
    type,
    progress: 0,
  };
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

function donenessLabel(value) {
  if (value < 28) {
    return "まだ生です";
  }
  if (value < 48) {
    return "少しずつ焼けています";
  }
  if (value < 75) {
    return "食べごろです";
  }
  if (value < 92) {
    return "焼きすぎ気味です";
  }
  return "焦げています";
}

function updateSummary() {
  const ingredient = INGREDIENTS[state.selectedType];
  slotSummary.innerHTML = [
    `${ingredient.label}を選択中`,
    `食べごろの目安: ${ingredient.idealMin} - ${ingredient.idealMax}`,
    "空いている網をクリックで置く / 置いた食材をクリックで回収",
  ].join("<br>");
}

function syncIngredientButtons() {
  const chips = ingredientPicker.querySelectorAll(".ingredient-chip");
  chips.forEach((button) => {
    button.classList.toggle("active", button.dataset.type === state.selectedType);
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
  servedCountOutput.textContent = String(state.servedCount);
  timeOutput.textContent = `${Math.max(0, Math.ceil(state.timeLeft))}s`;
  heatValueOutput.textContent = `${state.heat}%`;
  toggleButton.textContent = state.running ? "一時停止" : "再開";

  if (state.ended) {
    sceneCaption.textContent = `終了。スコア ${state.score}、焼けた数 ${state.servedCount}。`;
  } else {
    sceneCaption.textContent =
      "食材を選び、空いている網をクリックして置きます。食べごろでクリック回収です。";
  }

  updateSummary();
  renderLog();
}

function resetGame() {
  state.running = true;
  state.ended = false;
  state.lastTime = 0;
  state.sceneTime = 0;
  state.heat = Number(heatInput.value);
  state.timeLeft = TOTAL_TIME;
  state.selectedType = "beef";
  state.score = 0;
  state.servedCount = 0;
  state.grillSlots = Array.from({ length: SLOT_COUNT }, () => null);
  state.sparks = [];
  state.logEntries = [];

  syncIngredientButtons();
  addLog("BBQスタート。空いている網をクリックして焼き始めましょう。");
  renderPanels();
}

function scoreFood(food) {
  const ingredient = INGREDIENTS[food.type];
  const progress = food.progress;

  if (progress >= ingredient.idealMin && progress <= ingredient.idealMax) {
    return 10;
  }
  if (progress < ingredient.idealMin) {
    return 4;
  }
  if (progress < 92) {
    return 6;
  }
  return 1;
}

function collectFood(index) {
  const food = state.grillSlots[index];
  if (!food) {
    return;
  }

  const ingredient = INGREDIENTS[food.type];
  const progress = Math.round(food.progress);
  const points = scoreFood(food);

  state.score += points;
  state.servedCount += 1;
  state.grillSlots[index] = null;

  if (progress >= ingredient.idealMin && progress <= ingredient.idealMax) {
    addLog(`${ingredient.label}がちょうどよく焼けました。+${points}点`);
    addSparkBurst();
  } else if (progress < ingredient.idealMin) {
    addLog(`${ingredient.label}を少し早めに回収しました。+${points}点`);
  } else if (progress < 92) {
    addLog(`${ingredient.label}は少し焼きすぎでした。+${points}点`);
  } else {
    addLog(`${ingredient.label}が焦げましたが回収しました。+${points}点`);
  }

  renderPanels();
}

function placeFood(index) {
  if (state.grillSlots[index]) {
    return;
  }

  const ingredient = INGREDIENTS[state.selectedType];
  state.grillSlots[index] = createFood(state.selectedType);
  addLog(`${ingredient.label}を網に置きました。`);
  renderPanels();
}

function updateGrill(delta) {
  const fireBoost = state.heat / 100;

  for (const food of state.grillSlots) {
    if (!food) {
      continue;
    }

    const ingredient = INGREDIENTS[food.type];
    food.progress += ingredient.rate * fireBoost * delta;
    food.progress = clamp(food.progress, 0, 110);
  }
}

function addSparkBurst() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  for (let i = 0; i < 14; i += 1) {
    state.sparks.push({
      x: width * 0.5 + random(-70, 70),
      y: height * 0.6 + random(-20, 20),
      vx: random(-32, 32),
      vy: random(-100, -25),
      life: random(0.5, 0.9),
      size: random(2, 4),
    });
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
  addLog("BBQ終了。また焼きたくなったら最初から遊べます。");
  renderPanels();
}

function update(delta) {
  updateSparks(delta);

  if (!state.running || state.ended) {
    return;
  }

  state.timeLeft -= delta;
  updateGrill(delta);

  if (Math.random() < delta * (0.8 + state.heat / 160)) {
    state.sparks.push({
      x: canvas.clientWidth * 0.5 + random(-90, 90),
      y: canvas.clientHeight * 0.67 + random(-10, 10),
      vx: random(-18, 18),
      vy: random(-80, -20),
      life: random(0.4, 0.8),
      size: random(1, 3),
    });
  }

  if (state.timeLeft <= 0) {
    finishGame();
  }
}

function foodColor(food) {
  const ingredient = INGREDIENTS[food.type];

  if (food.progress > 92) {
    return ingredient.colorBurnt;
  }
  if (food.progress > 48) {
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

function drawGuests(width, height) {
  const baseline = height * 0.48;
  const positions = [0.16, 0.3, 0.7, 0.84];
  positions.forEach((position, index) => {
    const cheer = Math.sin(state.sceneTime * 0.003 + index) * 3;
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

  rects.forEach((rect) => {
    ctx.strokeStyle = "rgba(255, 248, 239, 0.24)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    ctx.fillStyle = "rgba(255, 248, 239, 0.08)";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  });
}

function drawIngredient(rect, food) {
  const ingredient = INGREDIENTS[food.type];
  const color = foodColor(food);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  ctx.save();
  ctx.translate(centerX, centerY);

  if (food.type === "beef") {
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
  } else if (food.type === "corn") {
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

  ctx.fillStyle = "rgba(255, 248, 239, 0.92)";
  ctx.font = "700 12px 'Zen Maru Gothic'";
  ctx.textAlign = "center";
  ctx.fillText(`${Math.round(food.progress)}`, 0, rect.height * 0.36);
  ctx.restore();
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
  ctx.fillText(`スコア ${state.score} / 焼けた数 ${state.servedCount}`, width / 2, height * 0.4);
  ctx.fillText("最初から遊ぶでもう一度始められます。", width / 2, height * 0.45);
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
    const food = state.grillSlots[index];
    if (food) {
      drawIngredient(rect, food);
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
  if (state.ended || !state.running) {
    return;
  }

  const point = canvasPoint(event);
  const rects = slotRects();
  const hitIndex = rects.findIndex(
    (rect) =>
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
  );

  if (hitIndex === -1) {
    return;
  }

  if (state.grillSlots[hitIndex]) {
    collectFood(hitIndex);
  } else {
    placeFood(hitIndex);
  }
}

ingredientPicker.addEventListener("click", (event) => {
  const button = event.target.closest("[data-type]");
  if (!button) {
    return;
  }

  state.selectedType = button.dataset.type;
  syncIngredientButtons();
  renderPanels();
});

heatInput.addEventListener("input", (event) => {
  state.heat = Number(event.target.value);
  renderPanels();
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

canvas.addEventListener("click", handleCanvasClick);

window.addEventListener("resize", () => {
  resizeCanvas();
  renderPanels();
});

resizeCanvas();
resetGame();
requestAnimationFrame(render);
