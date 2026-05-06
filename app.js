const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");

const windInput = document.getElementById("wind");
const leafCountInput = document.getElementById("leafCount");
const toggleButton = document.getElementById("toggleButton");
const burstButton = document.getElementById("burstButton");

const AIR_DENSITY = 1.225;
const GRAVITY = 180;
const PIXELS_PER_METER = 140;

const state = {
  leaves: [],
  running: true,
  lastTime: 0,
  windStrength: Number(windInput.value) / 100,
};

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.floor(bounds.width * ratio);
  canvas.height = Math.floor(bounds.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

function pick(colors) {
  return colors[Math.floor(Math.random() * colors.length)];
}

function wrapAngle(angle) {
  const tau = Math.PI * 2;
  let next = angle;
  while (next > Math.PI) {
    next -= tau;
  }
  while (next < -Math.PI) {
    next += tau;
  }
  return next;
}

function angleDifference(target, current) {
  return wrapAngle(target - current);
}

function createLeaf(y = random(-canvas.clientHeight, -20), horizontalBoost = 0) {
  const size = random(10, 24);
  const area = (size * size * 0.0009) / (PIXELS_PER_METER * PIXELS_PER_METER);
  const mass = random(0.0007, 0.0019);
  const palette = ["#c76b29", "#f0b24c", "#9d3e22", "#d88d3d", "#7a4c2d"];

  return {
    x: random(-40, canvas.clientWidth + 40),
    y,
    size,
    color: pick(palette),
    veinColor: "rgba(87, 43, 24, 0.35)",
    mass,
    area,
    dragCoeff: random(0.85, 1.25),
    liftCoeff: random(0.18, 0.48),
    angularDrag: random(1.8, 2.8),
    alignStrength: random(3.2, 5.6),
    flutterStrength: random(0.6, 1.4),
    flutterRate: random(3.5, 6.2),
    turbulenceOffset: random(0, Math.PI * 2),
    xVelocity: horizontalBoost + random(-8, 8),
    yVelocity: random(12, 30),
    rotation: random(-Math.PI, Math.PI),
    angularVelocity: random(-1.2, 1.2),
  };
}

function seedLeaves(count) {
  state.leaves = Array.from({ length: count }, () =>
    createLeaf(random(-canvas.clientHeight, canvas.clientHeight))
  );
}

function drawBackground(time) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#dbe8e1");
  sky.addColorStop(0.45, "#a6c6b2");
  sky.addColorStop(1, "#5d7f56");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255, 246, 228, 0.32)";
  ctx.beginPath();
  ctx.ellipse(width * 0.72, height * 0.18, 220, 90, -0.2, 0, Math.PI * 2);
  ctx.fill();

  const hillShift = Math.sin(time * 0.00008) * 12;
  ctx.fillStyle = "#54704f";
  ctx.beginPath();
  ctx.moveTo(0, height * 0.76);
  ctx.quadraticCurveTo(width * 0.2, height * 0.68 + hillShift, width * 0.45, height * 0.76);
  ctx.quadraticCurveTo(width * 0.68, height * 0.83, width, height * 0.72);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#324d35";
  ctx.beginPath();
  ctx.moveTo(0, height * 0.85);
  ctx.quadraticCurveTo(width * 0.3, height * 0.73, width * 0.54, height * 0.84);
  ctx.quadraticCurveTo(width * 0.8, height * 0.92, width, height * 0.8);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
}

function drawLeaf(leaf) {
  ctx.save();
  ctx.translate(leaf.x, leaf.y);
  ctx.rotate(leaf.rotation);

  ctx.fillStyle = leaf.color;
  ctx.beginPath();
  ctx.moveTo(0, -leaf.size * 1.25);
  ctx.bezierCurveTo(
    leaf.size * 0.8,
    -leaf.size * 0.7,
    leaf.size * 0.95,
    leaf.size * 0.15,
    0,
    leaf.size * 1.15
  );
  ctx.bezierCurveTo(
    -leaf.size * 0.95,
    leaf.size * 0.15,
    -leaf.size * 0.8,
    -leaf.size * 0.7,
    0,
    -leaf.size * 1.25
  );
  ctx.fill();

  ctx.strokeStyle = leaf.veinColor;
  ctx.lineWidth = Math.max(1, leaf.size * 0.08);
  ctx.beginPath();
  ctx.moveTo(0, -leaf.size * 1.08);
  ctx.lineTo(0, leaf.size * 1.08);
  ctx.moveTo(0, -leaf.size * 0.16);
  ctx.lineTo(leaf.size * 0.5, leaf.size * 0.26);
  ctx.moveTo(0, -leaf.size * 0.08);
  ctx.lineTo(-leaf.size * 0.52, leaf.size * 0.24);
  ctx.stroke();

  ctx.restore();
}

function sampleWind(leaf, time) {
  const baseWind = 20 + state.windStrength * 95;
  const gust = 22 * Math.sin(time * 0.00045 + leaf.turbulenceOffset);
  const cross = 10 * Math.cos(time * 0.00033 + leaf.turbulenceOffset * 1.7);
  const vortex = 8 * Math.sin((leaf.y / Math.max(canvas.clientHeight, 1)) * Math.PI * 2 + time * 0.0011);

  return {
    x: baseWind + gust + vortex,
    y: cross,
  };
}

function respawnLeaf(leaf, carryBoost = 0) {
  Object.assign(leaf, createLeaf(random(-120, -20), carryBoost));
}

function updateLeafPhysics(leaf, delta, time) {
  const wind = sampleWind(leaf, time);
  const relX = wind.x - leaf.xVelocity;
  const relY = wind.y - leaf.yVelocity;
  const relSpeed = Math.hypot(relX, relY);
  const safeSpeed = Math.max(relSpeed, 0.001);

  const dragMagnitude =
    0.5 * AIR_DENSITY * leaf.dragCoeff * leaf.area * safeSpeed * safeSpeed * PIXELS_PER_METER;
  const dragX = (dragMagnitude * relX) / safeSpeed;
  const dragY = (dragMagnitude * relY) / safeSpeed;

  const normalX = -relY / safeSpeed;
  const normalY = relX / safeSpeed;
  const flowAngle = Math.atan2(relY, relX);
  const angleOfAttack = angleDifference(flowAngle, leaf.rotation);
  const liftMagnitude =
    0.5 *
    AIR_DENSITY *
    leaf.liftCoeff *
    leaf.area *
    safeSpeed *
    safeSpeed *
    Math.sin(angleOfAttack * 2) *
    PIXELS_PER_METER;
  const liftX = normalX * liftMagnitude;
  const liftY = normalY * liftMagnitude;

  const gravityY = leaf.mass * GRAVITY;
  const xAcceleration = (dragX + liftX) / leaf.mass;
  const yAcceleration = (dragY + liftY + gravityY) / leaf.mass;

  leaf.xVelocity += xAcceleration * delta;
  leaf.yVelocity += yAcceleration * delta;
  leaf.x += leaf.xVelocity * delta;
  leaf.y += leaf.yVelocity * delta;

  const broadsideAngle = flowAngle + Math.PI / 2;
  const alignTorque = angleDifference(broadsideAngle, leaf.rotation) * leaf.alignStrength;
  const flutterTorque =
    Math.sin(time * leaf.flutterRate * 0.001 + leaf.turbulenceOffset) * leaf.flutterStrength;
  const dampingTorque = -leaf.angularVelocity * leaf.angularDrag;
  const angularAcceleration = alignTorque + flutterTorque + dampingTorque;

  leaf.angularVelocity += angularAcceleration * delta;
  leaf.rotation = wrapAngle(leaf.rotation + leaf.angularVelocity * delta);
}

function updateLeaves(delta, time) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const respawnBoost = 10 + state.windStrength * 35;

  for (const leaf of state.leaves) {
    updateLeafPhysics(leaf, delta, time);

    if (leaf.y > height + 36 || leaf.x < -90 || leaf.x > width + 90) {
      respawnLeaf(leaf, respawnBoost);
    }
  }
}

function render(time) {
  if (!state.lastTime) {
    state.lastTime = time;
  }

  const delta = Math.min((time - state.lastTime) / 1000, 0.033);
  state.lastTime = time;

  drawBackground(time);

  if (state.running) {
    updateLeaves(delta, time);
  }

  for (const leaf of state.leaves) {
    drawLeaf(leaf);
  }

  requestAnimationFrame(render);
}

function syncLeafCount(nextCount) {
  const count = Number(nextCount);
  const current = state.leaves.length;

  if (count > current) {
    for (let i = current; i < count; i += 1) {
      state.leaves.push(createLeaf(random(-canvas.clientHeight, canvas.clientHeight)));
    }
    return;
  }

  state.leaves.length = count;
}

windInput.addEventListener("input", (event) => {
  state.windStrength = Number(event.target.value) / 100;
});

leafCountInput.addEventListener("input", (event) => {
  syncLeafCount(event.target.value);
});

toggleButton.addEventListener("click", () => {
  state.running = !state.running;
  toggleButton.textContent = state.running ? "一時停止" : "再開";
});

burstButton.addEventListener("click", () => {
  for (let i = 0; i < 12; i += 1) {
    state.leaves.push(createLeaf(random(0, canvas.clientHeight * 0.25), random(15, 45)));
  }
  leafCountInput.value = String(state.leaves.length);
});

window.addEventListener("resize", () => {
  resizeCanvas();
  syncLeafCount(leafCountInput.value);
});

resizeCanvas();
seedLeaves(Number(leafCountInput.value));
requestAnimationFrame(render);
