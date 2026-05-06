const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");

const ingredientPicker = document.getElementById("ingredientPicker");
const heatInput = document.getElementById("heat");
const restartButton = document.getElementById("restartButton");
const selectedLabel = document.getElementById("selectedLabel");
const statusText = document.getElementById("statusText");

const SLOT_COUNT = 6;

const MEATS = {
  beef: {
    label: "牛カルビ",
    raw: "#b4473f",
    cooked: "#7c3820",
    burnt: "#241615",
    accent: "#efc38a",
    cookRate: 16,
    idealMin: 45,
    idealMax: 72,
  },
  pork: {
    label: "豚バラ",
    raw: "#d4837a",
    cooked: "#996038",
    burnt: "#2e211b",
    accent: "#f5d6be",
    cookRate: 14,
    idealMin: 52,
    idealMax: 78,
  },
  chicken: {
    label: "鶏もも",
    raw: "#d4a06f",
    cooked: "#9a5d2b",
    burnt: "#2f2218",
    accent: "#f4d8a2",
    cookRate: 13,
    idealMin: 58,
    idealMax: 82,
  },
};

const state = {
  lastTime: 0,
  sceneTime: 0,
  heat: Number(heatInput.value),
  selectedType: "beef",
  status: "空いている場所をクリックして肉を置く",
  slots: [],
  sparks: [],
};

function random(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createMeat(type) {
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

function getSlots() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const grillWidth = Math.min(width * 0.64, 620);
  const grillHeight = Math.min(height * 0.26, 210);
  const startX = (width - grillWidth) / 2;
  const startY = height * 0.5;
  const gap = 14;
  const cols = 3;
  const rows = 2;
  const slotWidth = (grillWidth - gap * (cols + 1)) / cols;
  const slotHeight = (grillHeight - gap * (rows + 1)) / rows;
  const slots = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      slots.push({
        x: startX + gap + col * (slotWidth + gap),
        y: startY + gap + row * (slotHeight + gap),
        width: slotWidth,
        height: slotHeight,
      });
    }
  }

  return slots;
}

function syncUi() {
  selectedLabel.textContent = MEATS[state.selectedType].label;
  statusText.textContent = state.status;

  ingredientPicker.querySelectorAll("[data-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.type === state.selectedType);
  });
}

function resetGame() {
  state.heat = Number(heatInput.value);
  state.selectedType = "beef";
  state.status = "空いている場所をクリックして肉を置く";
  state.slots = Array.from({ length: SLOT_COUNT }, () => null);
  state.sparks = [];
  syncUi();
}

function meatStage(meat) {
  const config = MEATS[meat.type];

  if (meat.progress < config.idealMin * 0.6) {
    return "まだ生";
  }
  if (meat.progress < config.idealMin) {
    return "焼きはじめ";
  }
  if (meat.progress <= config.idealMax) {
    return "食べごろ";
  }
  if (meat.progress < 92) {
    return "焼きすぎ";
  }
  return "焦げた";
}

function meatColor(meat) {
  const config = MEATS[meat.type];
  if (meat.progress > 92) {
    return config.burnt;
  }
  if (meat.progress >= config.idealMin) {
    return config.cooked;
  }
  return config.raw;
}

function placeMeat(index) {
  if (state.slots[index]) {
    return;
  }

  state.slots[index] = createMeat(state.selectedType);
  state.status = `${MEATS[state.selectedType].label}を置きました。焼けたらもう一度クリック。`;
  syncUi();
}

function collectMeat(index) {
  const meat = state.slots[index];
  if (!meat) {
    return;
  }

  const config = MEATS[meat.type];
  const stage = meatStage(meat);
  state.slots[index] = null;

  if (stage === "食べごろ") {
    state.status = `${config.label}がちょうどよく焼けました。`;
    addSparkBurst();
  } else if (stage === "焦げた") {
    state.status = `${config.label}が焦げました。もう一枚焼きましょう。`;
  } else {
    state.status = `${config.label}を回収しました。状態: ${stage}`;
  }

  syncUi();
}

function addSparkBurst() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  for (let i = 0; i < 18; i += 1) {
    state.sparks.push({
      x: width * 0.5 + random(-80, 80),
      y: height * 0.6 + random(-20, 20),
      vx: random(-40, 40),
      vy: random(-120, -30),
      size: random(2, 5),
      life: random(0.4, 0.9),
    });
  }
}

function updateMeats(delta) {
  const heatBoost = state.heat / 100;
  state.slots.forEach((meat) => {
    if (!meat) {
      return;
    }

    const config = MEATS[meat.type];
    meat.progress += config.cookRate * heatBoost * delta;
    meat.progress = clamp(meat.progress, 0, 110);
  });
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

function drawSky(width, height) {
  const sunset = ctx.createLinearGradient(0, 0, 0, height);
  sunset.addColorStop(0, "#fff3cf");
  sunset.addColorStop(0.36, "#ffb86d");
  sunset.addColorStop(0.7, "#c55f3d");
  sunset.addColorStop(1, "#47221b");
  ctx.fillStyle = sunset;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255, 246, 220, 0.82)";
  ctx.beginPath();
  ctx.arc(width * 0.78, height * 0.18, 56, 0, Math.PI * 2);
  ctx.fill();
}

function drawGround(width, height) {
  ctx.fillStyle = "#55703c";
  ctx.beginPath();
  ctx.moveTo(0, height * 0.7);
  ctx.quadraticCurveTo(width * 0.25, height * 0.62, width * 0.45, height * 0.72);
  ctx.quadraticCurveTo(width * 0.72, height * 0.82, width, height * 0.68);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
}

function drawTable(width, height) {
  ctx.fillStyle = "#7f4128";
  ctx.fillRect(width * 0.1, height * 0.72, width * 0.8, height * 0.04);
  ctx.fillStyle = "#4e271b";
  ctx.fillRect(width * 0.17, height * 0.76, width * 0.04, height * 0.16);
  ctx.fillRect(width * 0.79, height * 0.76, width * 0.04, height * 0.16);
}

function drawGuests(width, height) {
  const positions = [0.16, 0.3, 0.7, 0.84];
  const baseline = height * 0.48;

  positions.forEach((position, index) => {
    const sway = Math.sin(state.sceneTime * 0.003 + index) * 3;
    const x = width * position;

    ctx.fillStyle = "#31211f";
    ctx.beginPath();
    ctx.arc(x, baseline - 50 + sway, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = index % 2 === 0 ? "#ffd26f" : "#9dd0ff";
    ctx.beginPath();
    ctx.roundRect(x - 20, baseline - 30, 40, 52, 16);
    ctx.fill();
  });
}

function drawGrill(width, height, slots) {
  const grill = {
    x: width * 0.18,
    y: height * 0.48,
    width: width * 0.64,
    height: height * 0.28,
  };

  ctx.fillStyle = "#2b221f";
  ctx.beginPath();
  ctx.roundRect(grill.x, grill.y, grill.width, grill.height, 28);
  ctx.fill();

  const ember = ctx.createRadialGradient(width * 0.5, height * 0.65, 10, width * 0.5, height * 0.65, 210);
  ember.addColorStop(0, `rgba(255, 204, 92, ${0.35 + state.heat / 180})`);
  ember.addColorStop(0.45, `rgba(255, 117, 58, ${0.24 + state.heat / 240})`);
  ember.addColorStop(1, "rgba(81, 29, 22, 0)");
  ctx.fillStyle = ember;
  ctx.fillRect(grill.x, grill.y, grill.width, grill.height);

  ctx.strokeStyle = "#bec0c2";
  ctx.lineWidth = 4;
  for (let i = 0; i < 8; i += 1) {
    const x = grill.x + 24 + i * ((grill.width - 48) / 7);
    ctx.beginPath();
    ctx.moveTo(x, grill.y + 18);
    ctx.lineTo(x, grill.y + grill.height - 18);
    ctx.stroke();
  }

  slots.forEach((slot, index) => {
    const meat = state.slots[index];
    ctx.strokeStyle = meat ? "rgba(255, 241, 195, 0.55)" : "rgba(255, 248, 239, 0.28)";
    ctx.lineWidth = meat ? 2.5 : 1.5;
    ctx.strokeRect(slot.x, slot.y, slot.width, slot.height);

    if (!meat) {
      ctx.fillStyle = "rgba(255, 248, 239, 0.08)";
      ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
    }
  });
}

function drawMeat(slot, meat) {
  const config = MEATS[meat.type];
  const color = meatColor(meat);
  const centerX = slot.x + slot.width / 2;
  const centerY = slot.y + slot.height / 2;

  ctx.save();
  ctx.translate(centerX, centerY);

  if (meat.type === "beef") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-slot.width * 0.24, -slot.height * 0.18, slot.width * 0.48, slot.height * 0.36, 18);
    ctx.fill();
    ctx.strokeStyle = config.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-slot.width * 0.14, -3);
    ctx.lineTo(slot.width * 0.14, -3);
    ctx.moveTo(-slot.width * 0.14, 6);
    ctx.lineTo(slot.width * 0.14, 6);
    ctx.stroke();
  } else if (meat.type === "pork") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-slot.width * 0.24, -slot.height * 0.18, slot.width * 0.48, slot.height * 0.36, 18);
    ctx.fill();
    ctx.strokeStyle = config.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-slot.width * 0.16, -8);
    ctx.lineTo(slot.width * 0.16, 8);
    ctx.moveTo(-slot.width * 0.16, 8);
    ctx.lineTo(slot.width * 0.16, -8);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-slot.width * 0.22, -slot.height * 0.16, slot.width * 0.44, slot.height * 0.32, 16);
    ctx.fill();
    ctx.strokeStyle = config.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-slot.width * 0.14, 0);
    ctx.lineTo(slot.width * 0.14, 0);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255, 248, 239, 0.92)";
  ctx.font = "700 12px 'Zen Maru Gothic'";
  ctx.textAlign = "center";
  ctx.fillText(meatStage(meat), 0, slot.height * 0.35);
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

function drawScene() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const slots = getSlots();

  drawSky(width, height);
  drawGround(width, height);
  drawGuests(width, height);
  drawTable(width, height);
  drawGrill(width, height, slots);

  slots.forEach((slot, index) => {
    const meat = state.slots[index];
    if (meat) {
      drawMeat(slot, meat);
    }
  });

  drawSparks();
}

function update(delta) {
  updateMeats(delta);
  updateSparks(delta);

  if (Math.random() < delta * (0.8 + state.heat / 160)) {
    state.sparks.push({
      x: canvas.clientWidth * 0.5 + random(-100, 100),
      y: canvas.clientHeight * 0.66 + random(-10, 10),
      vx: random(-18, 18),
      vy: random(-80, -20),
      size: random(1, 3),
      life: random(0.35, 0.8),
    });
  }
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
  requestAnimationFrame(render);
}

function handleCanvasClick(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const slots = getSlots();
  const index = slots.findIndex(
    (slot) =>
      x >= slot.x &&
      x <= slot.x + slot.width &&
      y >= slot.y &&
      y <= slot.y + slot.height
  );

  if (index === -1) {
    state.status = "肉を置くなら、網の四角い場所をクリック。";
    syncUi();
    return;
  }

  if (state.slots[index]) {
    collectMeat(index);
  } else {
    placeMeat(index);
  }
}

ingredientPicker.addEventListener("click", (event) => {
  const button = event.target.closest("[data-type]");
  if (!button) {
    return;
  }

  state.selectedType = button.dataset.type;
  state.status = `${MEATS[state.selectedType].label}を選びました。空いている場所をクリック。`;
  syncUi();
});

heatInput.addEventListener("input", (event) => {
  state.heat = Number(event.target.value);
  state.status = `火力を ${state.heat}% にしました。`;
  syncUi();
});

restartButton.addEventListener("click", () => {
  resetGame();
});

canvas.addEventListener("click", handleCanvasClick);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
resetGame();
requestAnimationFrame(render);
