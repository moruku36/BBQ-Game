// BBQ Party — Canvas illustration. Pure drawing helpers: every function takes
// a 2D context plus geometry and keeps no state of its own.
(function (root) {
  "use strict";

  const TAU = Math.PI * 2;

  const PALETTE = {
    cream: "#fff6e0",
    creamDeep: "#f3e2b8",
    charcoal: "#2b2623",
    red: "#d8402f",
    redDeep: "#a92c20",
    yellow: "#f7c531",
    green: "#4f9d4a",
    greenDeep: "#2f6b35",
  };

  // Colour stops by doneness d = age / ideal time: raw, 0.8, 1.0, 1.5, burnt.
  const FOOD_COLORS = {
    shrimp: [[164, 172, 188], [246, 160, 120], [255, 128, 80], [176, 78, 44], [46, 34, 32]],
    sausage: [[236, 160, 150], [210, 112, 80], [178, 80, 44], [112, 52, 30], [40, 30, 28]],
    shiitake: [[184, 146, 108], [156, 110, 74], [128, 84, 52], [82, 52, 34], [38, 30, 26]],
    kalbi: [[204, 62, 66], [168, 84, 60], [136, 70, 42], [86, 46, 30], [36, 28, 26]],
    corn: [[252, 228, 120], [250, 204, 80], [242, 178, 48], [168, 108, 40], [52, 42, 32]],
    steak: [[190, 54, 60], [158, 80, 58], [122, 62, 40], [76, 42, 28], [34, 26, 24]],
  };
  const STOP_AT = [0, 0.8, 1, 1.5, 1.62];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function mix(a, b, k) {
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  function shade(color, k) {
    return k < 0 ? mix(color, [0, 0, 0], -k) : mix(color, [255, 255, 255], k);
  }

  function css(color, alpha) {
    const rgb = Math.round(color[0]) + "," + Math.round(color[1]) + "," + Math.round(color[2]);
    return alpha === undefined ? "rgb(" + rgb + ")" : "rgba(" + rgb + "," + alpha + ")";
  }

  function foodColor(id, doneness) {
    const stops = FOOD_COLORS[id];
    const d = clamp(doneness, 0, STOP_AT[STOP_AT.length - 1]);
    for (let i = 1; i < STOP_AT.length; i += 1) {
      if (d <= STOP_AT[i]) {
        return mix(stops[i - 1], stops[i], (d - STOP_AT[i - 1]) / (STOP_AT[i] - STOP_AT[i - 1]));
      }
    }
    return stops[stops.length - 1];
  }

  function roundedRect(ctx, x, y, w, h, radius) {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
  }

  // Smooth closed path through points (quadratic curves between midpoints).
  function blob(ctx, points, dy) {
    const n = points.length;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + dy];
    const start = mid(points[n - 1], points[0]);
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i += 1) {
      const next = mid(points[i], points[(i + 1) % n]);
      ctx.quadraticCurveTo(points[i][0], points[i][1] + dy, next[0], next[1]);
    }
    ctx.closePath();
  }

  // Deterministic pseudo-random for scenery, so the garden never reshuffles.
  function scenery(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
  }

  // ---- food ----------------------------------------------------------------

  function grillMarkAlpha(d) {
    return clamp((d - 0.55) / 0.45, 0, 1) * 0.72;
  }

  function drawShrimp(ctx, s, d, color) {
    const r = 0.2 * s;
    const body = 0.19 * s;
    const depth = 0.06 * s;
    const a0 = Math.PI * 0.3;
    const a1 = Math.PI * 1.8;
    const tailX = Math.cos(a0) * r;
    const tailY = Math.sin(a0) * r;
    const headX = Math.cos(a1) * r;
    const headY = Math.sin(a1) * r;

    // tail fan
    const tailAngle = Math.atan2(-Math.cos(a0), Math.sin(a0)) + 0.85;
    ctx.fillStyle = css(mix(shade(color, -0.12), [200, 60, 40], d >= 0.8 && d <= 1.5 ? 0.25 : 0));
    for (let i = -1; i <= 1; i += 2) {
      const angle = tailAngle + i * 0.38;
      ctx.save();
      ctx.translate(tailX + Math.cos(angle) * 0.1 * s, tailY + Math.sin(angle) * 0.1 * s);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.11 * s, 0.045 * s, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // antennae
    ctx.strokeStyle = css(shade(color, -0.22));
    ctx.lineWidth = Math.max(1, 0.014 * s);
    ctx.lineCap = "round";
    for (let i = 0; i < 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(headX + 0.04 * s, headY - 0.02 * s);
      ctx.quadraticCurveTo(headX + 0.2 * s, headY - (0.1 + i * 0.1) * s, headX + 0.3 * s, headY + (0.02 - i * 0.14) * s);
      ctx.stroke();
    }

    // thickness, then the top face
    ctx.lineCap = "round";
    ctx.lineWidth = body;
    ctx.strokeStyle = css(shade(color, -0.38));
    ctx.beginPath();
    ctx.arc(0, depth, r, a0, a1);
    ctx.stroke();
    ctx.strokeStyle = css(color);
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a1);
    ctx.stroke();

    // pale belly stripe
    ctx.strokeStyle = css(shade(color, 0.34), 0.85);
    ctx.lineWidth = 0.05 * s;
    ctx.beginPath();
    ctx.arc(0, 0, r - 0.045 * s, a0 + 0.1, a1 - 0.1);
    ctx.stroke();

    // shell segments and grill marks
    const marks = grillMarkAlpha(d);
    for (let k = 1; k <= 5; k += 1) {
      const angle = a0 + ((a1 - a0) * k) / 6;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.strokeStyle = css(shade(color, -0.28));
      ctx.lineWidth = Math.max(1, 0.02 * s);
      ctx.beginPath();
      ctx.moveTo(cos * (r - body / 2), sin * (r - body / 2));
      ctx.lineTo(cos * (r + body / 2), sin * (r + body / 2));
      ctx.stroke();
      if (marks > 0 && k % 2 === 0) {
        const off = angle + 0.22;
        ctx.strokeStyle = "rgba(48,24,14," + marks + ")";
        ctx.lineWidth = 0.035 * s;
        ctx.beginPath();
        ctx.moveTo(Math.cos(off) * r, Math.sin(off) * r);
        ctx.lineTo(Math.cos(off) * (r + body * 0.42), Math.sin(off) * (r + body * 0.42));
        ctx.stroke();
      }
    }

    // eye
    ctx.fillStyle = "#1c1513";
    circle(ctx, headX + 0.02 * s, headY - 0.035 * s, Math.max(1, 0.022 * s));
    ctx.fill();
  }

  function drawSausage(ctx, s, d, color) {
    ctx.rotate(-0.28);
    const length = 0.8 * s;
    const radius = 0.13 * s;
    const depth = 0.07 * s;

    ctx.fillStyle = css(shade(color, -0.32));
    circle(ctx, -length / 2 - 0.012 * s, depth * 0.5, 0.036 * s);
    ctx.fill();
    circle(ctx, length / 2 + 0.012 * s, depth * 0.5, 0.036 * s);
    ctx.fill();

    ctx.fillStyle = css(shade(color, -0.38));
    roundedRect(ctx, -length / 2, -radius + depth, length, radius * 2, radius);
    ctx.fill();

    const skin = ctx.createLinearGradient(0, -radius, 0, radius);
    skin.addColorStop(0, css(shade(color, 0.24)));
    skin.addColorStop(0.55, css(color));
    skin.addColorStop(1, css(shade(color, -0.2)));
    ctx.fillStyle = skin;
    roundedRect(ctx, -length / 2, -radius, length, radius * 2, radius);
    ctx.fill();

    const marks = grillMarkAlpha(d);
    if (marks > 0) {
      ctx.save();
      roundedRect(ctx, -length / 2, -radius, length, radius * 2, radius);
      ctx.clip();
      ctx.strokeStyle = "rgba(44,22,12," + marks + ")";
      ctx.lineWidth = 0.036 * s;
      ctx.lineCap = "round";
      for (let i = -2; i <= 2; i += 1) {
        const x = i * 0.15 * s;
        ctx.beginPath();
        ctx.moveTo(x - 0.05 * s, -radius);
        ctx.lineTo(x + 0.05 * s, radius);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.strokeStyle = "rgba(255,255,255," + (d > 1.5 ? 0.14 : 0.45) + ")";
    ctx.lineWidth = 0.03 * s;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-length / 2 + radius, -radius * 0.5);
    ctx.lineTo(length / 2 - radius * 1.7, -radius * 0.5);
    ctx.stroke();
  }

  function drawKalbi(ctx, s, d, color) {
    ctx.rotate(0.1);
    const points = [
      [-0.38, -0.1], [-0.2, -0.25], [0.1, -0.23], [0.36, -0.15],
      [0.41, 0.06], [0.22, 0.2], [-0.1, 0.22], [-0.35, 0.14],
    ].map((p) => [p[0] * s, p[1] * s]);
    const depth = 0.08 * s;
    const fat = d > 1.5 ? [74, 60, 50] : mix([250, 232, 214], [236, 198, 142], clamp(d, 0, 1));

    ctx.fillStyle = css(shade(color, -0.4));
    blob(ctx, points, depth);
    ctx.fill();

    const top = ctx.createLinearGradient(0, -0.25 * s, 0, 0.22 * s);
    top.addColorStop(0, css(shade(color, 0.16)));
    top.addColorStop(1, css(shade(color, -0.12)));
    ctx.fillStyle = top;
    blob(ctx, points, 0);
    ctx.fill();

    ctx.save();
    blob(ctx, points, 0);
    ctx.clip();

    // fat cap along the upper edge
    ctx.strokeStyle = css(fat);
    ctx.lineWidth = 0.1 * s;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    ctx.quadraticCurveTo(points[1][0], points[1][1], points[2][0], points[2][1]);
    ctx.quadraticCurveTo(points[3][0], points[3][1], points[4][0], points[4][1] - 0.08 * s);
    ctx.stroke();

    // marbling
    ctx.strokeStyle = css(fat, 0.82);
    ctx.lineWidth = Math.max(1, 0.024 * s);
    for (let i = 0; i < 3; i += 1) {
      const y = (-0.06 + i * 0.09) * s;
      ctx.beginPath();
      ctx.moveTo(-0.3 * s, y + 0.03 * s);
      ctx.quadraticCurveTo(-0.08 * s, y - 0.06 * s, 0.06 * s, y + 0.02 * s);
      ctx.quadraticCurveTo(0.18 * s, y + 0.07 * s, 0.33 * s, y - 0.02 * s);
      ctx.stroke();
    }

    const marks = grillMarkAlpha(d);
    if (marks > 0) {
      ctx.strokeStyle = "rgba(36,18,10," + marks + ")";
      ctx.lineWidth = 0.036 * s;
      for (let i = -2; i <= 2; i += 1) {
        const x = i * 0.17 * s;
        ctx.beginPath();
        ctx.moveTo(x - 0.14 * s, -0.3 * s);
        ctx.lineTo(x + 0.14 * s, 0.3 * s);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 0.14 * s, -0.3 * s);
        ctx.lineTo(x - 0.14 * s, 0.3 * s);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.ellipse(-0.08 * s, -0.08 * s, 0.2 * s, 0.07 * s, -0.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawCorn(ctx, s, d, color) {
    ctx.rotate(-0.14);
    const length = 0.78 * s;
    const height = 0.32 * s;
    const radius = height / 2;
    const depth = 0.07 * s;
    const left = -length / 2 + 0.04 * s;

    // husk leaves
    const husk = d > 1.5 ? [56, 60, 40] : mix([110, 176, 78], [96, 140, 62], clamp(d, 0, 1));
    ctx.fillStyle = css(husk);
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(left + 0.05 * s, i * 0.02 * s);
      ctx.quadraticCurveTo(left - 0.08 * s, i * 0.22 * s, left - 0.17 * s, i * 0.1 * s);
      ctx.quadraticCurveTo(left - 0.08 * s, i * 0.03 * s, left + 0.05 * s, -i * 0.03 * s);
      ctx.fill();
    }

    ctx.fillStyle = css(shade(color, -0.4));
    roundedRect(ctx, left, -radius + depth, length, height, radius);
    ctx.fill();
    ctx.fillStyle = css(shade(color, -0.12));
    roundedRect(ctx, left, -radius, length, height, radius);
    ctx.fill();

    ctx.save();
    roundedRect(ctx, left, -radius, length, height, radius);
    ctx.clip();
    const rows = 4;
    const cols = 9;
    const kw = length / cols;
    const kh = height / rows;
    const gap = Math.max(0.5, 0.012 * s);
    for (let row = 0; row < rows; row += 1) {
      for (let col = -1; col < cols; col += 1) {
        const x = left + col * kw + (row % 2 ? kw / 2 : 0);
        const y = -radius + row * kh;
        const hash = ((row * 9 + col + 1) * 37) % 17 / 17;
        const charred = clamp((d - 0.7 - hash * 0.5) / 0.25, 0, 1);
        ctx.fillStyle = css(mix(shade(color, 0.2), [70, 44, 22], charred * 0.85));
        roundedRect(ctx, x + gap, y + gap, kw - gap * 2, kh - gap * 2, kw * 0.3);
        ctx.fill();
      }
    }
    const gloss = ctx.createLinearGradient(0, -radius, 0, radius);
    gloss.addColorStop(0, "rgba(255,255,255,0.3)");
    gloss.addColorStop(0.45, "rgba(255,255,255,0)");
    gloss.addColorStop(1, "rgba(60,30,0,0.28)");
    ctx.fillStyle = gloss;
    ctx.fillRect(left, -radius, length, height);
    ctx.restore();
  }

  // Seen from above: a round cap with a star cut, the stem peeking out below.
  function drawShiitake(ctx, s, d, color) {
    const rx = 0.36 * s;
    const ry = 0.25 * s;
    const cy = -0.04 * s;
    const depth = 0.07 * s;
    const flesh = d > 1.5 ? [72, 60, 50] : mix([246, 234, 210], [226, 198, 150], clamp(d, 0, 1));

    ctx.fillStyle = css(shade(flesh, -0.28));
    roundedRect(ctx, -0.075 * s, 0.1 * s + depth * 0.5, 0.15 * s, 0.25 * s, 0.05 * s);
    ctx.fill();
    ctx.fillStyle = css(flesh);
    roundedRect(ctx, -0.075 * s, 0.1 * s, 0.15 * s, 0.23 * s, 0.05 * s);
    ctx.fill();

    ctx.fillStyle = css(shade(color, -0.4));
    ctx.beginPath();
    ctx.ellipse(0, cy + depth, rx, ry, 0, 0, TAU);
    ctx.fill();
    const top = ctx.createRadialGradient(-0.1 * s, cy - 0.1 * s, rx * 0.1, 0, cy, rx * 1.1);
    top.addColorStop(0, css(shade(color, 0.3)));
    top.addColorStop(1, css(shade(color, -0.14)));
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.ellipse(0, cy, rx, ry, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, cy, rx, ry, 0, 0, TAU);
    ctx.clip();

    // star cut
    ctx.strokeStyle = css(flesh);
    ctx.lineWidth = 0.05 * s;
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i += 1) {
      const angle = (i * Math.PI) / 3 + 0.26;
      const dx = Math.cos(angle) * rx * 0.5;
      const dy = Math.sin(angle) * ry * 0.5;
      ctx.beginPath();
      ctx.moveTo(-dx, cy - dy);
      ctx.lineTo(dx, cy + dy);
      ctx.stroke();
    }

    const marks = grillMarkAlpha(d);
    if (marks > 0) {
      ctx.strokeStyle = "rgba(40,22,12," + marks * 0.8 + ")";
      ctx.lineWidth = 0.03 * s;
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath();
        ctx.moveTo(i * 0.27 * s - 0.05 * s, cy - ry);
        ctx.lineTo(i * 0.27 * s + 0.05 * s, cy + ry);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(255,255,255," + (d > 1.5 ? 0.06 : 0.2) + ")";
    ctx.beginPath();
    ctx.ellipse(-0.14 * s, cy - 0.11 * s, 0.11 * s, 0.045 * s, -0.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // A thick slab: deep side face, fat rim on the left, one-way grill marks
  // and a pat of butter, so it never reads as the thin kalbi slice.
  function drawSteak(ctx, s, d, color) {
    ctx.rotate(-0.08);
    const points = [
      [-0.4, -0.06], [-0.3, -0.25], [-0.02, -0.31], [0.28, -0.27],
      [0.42, -0.08], [0.36, 0.13], [0.08, 0.21], [-0.26, 0.17],
    ].map((p) => [p[0] * s, p[1] * s]);
    const depth = 0.13 * s;
    const fat = d > 1.5 ? [74, 60, 50] : mix([250, 232, 214], [236, 198, 142], clamp(d, 0, 1));

    ctx.fillStyle = css(shade(color, -0.48));
    blob(ctx, points, depth);
    ctx.fill();
    ctx.fillStyle = css(shade(color, -0.3));
    blob(ctx, points, depth * 0.5);
    ctx.fill();

    const top = ctx.createLinearGradient(0, -0.31 * s, 0, 0.21 * s);
    top.addColorStop(0, css(shade(color, 0.18)));
    top.addColorStop(1, css(shade(color, -0.1)));
    ctx.fillStyle = top;
    blob(ctx, points, 0);
    ctx.fill();

    ctx.save();
    blob(ctx, points, 0);
    ctx.clip();

    // fat rim down the left edge
    ctx.strokeStyle = css(fat);
    ctx.lineWidth = 0.11 * s;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(points[1][0], points[1][1]);
    ctx.quadraticCurveTo(points[0][0], points[0][1], points[7][0], points[7][1]);
    ctx.stroke();

    const marks = grillMarkAlpha(d);
    if (marks > 0) {
      ctx.strokeStyle = "rgba(32,16,10," + marks + ")";
      ctx.lineWidth = 0.045 * s;
      for (let i = -1; i <= 2; i += 1) {
        const x = i * 0.19 * s - 0.04 * s;
        ctx.beginPath();
        ctx.moveTo(x - 0.12 * s, -0.34 * s);
        ctx.lineTo(x + 0.12 * s, 0.26 * s);
        ctx.stroke();
      }
    }
    ctx.restore();

    // butter pat
    const butter = d > 1.5 ? [66, 54, 44] : mix([255, 240, 164], [250, 214, 110], clamp(d, 0, 1));
    ctx.fillStyle = css(shade(butter, -0.25));
    roundedRect(ctx, 0.03 * s, -0.11 * s, 0.17 * s, 0.13 * s, 0.03 * s);
    ctx.fill();
    ctx.fillStyle = css(butter);
    roundedRect(ctx, 0.03 * s, -0.13 * s, 0.17 * s, 0.12 * s, 0.03 * s);
    ctx.fill();
  }

  const FOOD_PAINTERS = {
    shrimp: drawShrimp,
    sausage: drawSausage,
    shiitake: drawShiitake,
    kalbi: drawKalbi,
    corn: drawCorn,
    steak: drawSteak,
  };

  // look.doneness = age / ideal time, look.burnt forces the charred look.
  function drawFood(ctx, id, x, y, size, look) {
    const painter = FOOD_PAINTERS[id];
    if (!painter) {
      return;
    }
    const doneness = look && look.burnt ? STOP_AT[STOP_AT.length - 1] : clamp(look ? look.doneness : 1, 0, 1.5);
    ctx.save();
    ctx.translate(x, y);
    if (!look || look.shadow !== false) {
      ctx.fillStyle = "rgba(14,8,6,0.36)";
      ctx.beginPath();
      ctx.ellipse(0.03 * size, 0.17 * size, 0.4 * size, 0.13 * size, 0, 0, TAU);
      ctx.fill();
    }
    painter(ctx, size, doneness, foodColor(id, doneness));
    ctx.restore();

    if (look && look.burnt) {
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = "rgba(255,120,60,0.55)";
      ctx.lineWidth = Math.max(1, 0.018 * size);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-0.16 * size, -0.03 * size);
      ctx.lineTo(-0.06 * size, 0.03 * size);
      ctx.lineTo(0.02 * size, -0.02 * size);
      ctx.moveTo(0.1 * size, 0.04 * size);
      ctx.lineTo(0.18 * size, -0.02 * size);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- timing bar ------------------------------------------------------------

  // Zones differ by height and hatching as well as colour: the PERFECT zone is
  // the tall block with a star, BURNT is cross-hatched. The PERFECT block is
  // drawn to scale, so a narrow window looks narrow (but never under 3px).
  function drawTimingBar(ctx, x, y, w, h, windows, ageMs) {
    const total = windows.burnMs * 1.12;
    const at = (ms) => x + (clamp(ms, 0, total) / total) * w;
    const xGood = at(windows.goodStartMs);
    const xPerfect = at(windows.perfectStartMs);
    const xBurn = at(windows.burnMs);
    const xPerfectEnd = Math.max(at(windows.perfectEndMs), Math.min(xPerfect + 3, xBurn));

    ctx.save();
    ctx.fillStyle = "rgba(20,14,12,0.78)";
    roundedRect(ctx, x - 2, y - 2, w + 4, h + 4, (h + 4) / 2);
    ctx.fill();

    ctx.fillStyle = "#cfc6b4";
    ctx.fillRect(x, y + h * 0.35, xGood - x, h * 0.65);

    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(xGood, y + h * 0.15, xPerfect - xGood, h * 0.85);
    ctx.fillRect(xPerfectEnd, y + h * 0.15, xBurn - xPerfectEnd, h * 0.85);

    ctx.fillStyle = "#57b94f";
    ctx.fillRect(xPerfect, y - h * 0.45, xPerfectEnd - xPerfect, h * 1.45);
    ctx.strokeStyle = "#fffbe8";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(xPerfect, y - h * 0.45, xPerfectEnd - xPerfect, h * 1.45);

    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(xBurn, y + h * 0.15, x + w - xBurn, h * 0.85);
    ctx.strokeStyle = "rgba(20,14,12,0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let hx = xBurn + 1; hx < x + w; hx += 4) {
      ctx.moveTo(hx, y + h);
      ctx.lineTo(Math.min(hx + h * 0.85, x + w), y + h * 0.15);
    }
    ctx.stroke();

    // marker
    const mx = at(ageMs);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = PALETTE.charcoal;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mx, y + h * 0.2);
    ctx.lineTo(mx - 5, y - h * 0.9 - 2);
    ctx.lineTo(mx + 5, y - h * 0.9 - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(mx - 1, y, 2, h);
    ctx.restore();
  }

  // ---- garden ------------------------------------------------------------------

  function drawBunting(ctx, w, h) {
    const y0 = h * 0.03;
    const y1 = h * 0.045;
    const sag = h * 0.12;
    const colors = [PALETTE.red, PALETTE.yellow, PALETTE.green, PALETTE.cream];
    const count = Math.max(7, Math.round(w / 52));
    const point = (t) => {
      const u = 1 - t;
      return [t * w, u * u * y0 + 2 * u * t * sag + t * t * y1];
    };
    ctx.strokeStyle = PALETTE.charcoal;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.quadraticCurveTo(w / 2, sag, w, y1);
    ctx.stroke();
    const flagW = (w / count) * 0.62;
    for (let i = 0; i < count; i += 1) {
      const p = point((i + 0.5) / count);
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(p[0] - flagW / 2, p[1]);
      ctx.lineTo(p[0] + flagW / 2, p[1]);
      ctx.lineTo(p[0], p[1] + flagW * 1.1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(43,38,35,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawTree(ctx, x, groundY, size) {
    ctx.fillStyle = "#7a5433";
    roundedRect(ctx, x - size * 0.07, groundY - size * 0.6, size * 0.14, size * 0.62, size * 0.04);
    ctx.fill();
    ctx.fillStyle = PALETTE.greenDeep;
    circle(ctx, x, groundY - size * 0.82, size * 0.4);
    ctx.fill();
    circle(ctx, x - size * 0.28, groundY - size * 0.62, size * 0.28);
    ctx.fill();
    circle(ctx, x + size * 0.28, groundY - size * 0.62, size * 0.28);
    ctx.fill();
    ctx.fillStyle = "#63b058";
    circle(ctx, x - size * 0.1, groundY - size * 0.94, size * 0.22);
    ctx.fill();
    circle(ctx, x + size * 0.2, groundY - size * 0.74, size * 0.16);
    ctx.fill();
  }

  function drawGingham(ctx, x, y, w, h) {
    const cell = 18;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = PALETTE.cream;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(216,64,47,0.5)";
    for (let cx = x; cx < x + w; cx += cell * 2) {
      ctx.fillRect(cx, y, cell, h);
    }
    for (let cy = y; cy < y + h; cy += cell * 2) {
      ctx.fillRect(x, cy, w, cell);
    }
    ctx.fillStyle = "rgba(43,38,35,0.22)";
    ctx.fillRect(x, y, w, 4);
    ctx.restore();
  }

  function drawBackdrop(ctx, w, h) {
    const random = scenery(20261008);
    const horizon = Math.round(h * 0.3);
    const unit = Math.min(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#aee0f1");
    sky.addColorStop(1, "#fdf3d3");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    // sun
    const sunX = w * 0.84;
    const sunY = h * 0.1;
    const halo = ctx.createRadialGradient(sunX, sunY, unit * 0.03, sunX, sunY, unit * 0.22);
    halo.addColorStop(0, "rgba(255,236,150,0.85)");
    halo.addColorStop(1, "rgba(255,236,150,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(sunX - unit * 0.22, sunY - unit * 0.22, unit * 0.44, unit * 0.44);
    ctx.fillStyle = PALETTE.yellow;
    circle(ctx, sunX, sunY, unit * 0.06);
    ctx.fill();

    // clouds
    ctx.fillStyle = "rgba(255,252,240,0.92)";
    for (let i = 0; i < 3; i += 1) {
      const cx = w * (0.12 + i * 0.3) + random() * w * 0.06;
      const cy = h * (0.06 + random() * 0.1);
      const cr = unit * (0.035 + random() * 0.02);
      circle(ctx, cx, cy, cr);
      ctx.fill();
      circle(ctx, cx + cr * 1.1, cy + cr * 0.2, cr * 0.8);
      ctx.fill();
      circle(ctx, cx - cr * 1.1, cy + cr * 0.25, cr * 0.7);
      ctx.fill();
      roundedRect(ctx, cx - cr * 1.8, cy + cr * 0.2, cr * 3.6, cr * 0.75, cr * 0.37);
      ctx.fill();
    }

    // trees and hedge
    drawTree(ctx, w * 0.1, horizon, unit * 0.34);
    drawTree(ctx, w * 0.93, horizon, unit * 0.4);
    if (w > 700) {
      drawTree(ctx, w * 0.3, horizon, unit * 0.26);
      drawTree(ctx, w * 0.68, horizon, unit * 0.3);
    }
    ctx.fillStyle = "#3f8a41";
    const bump = Math.max(22, unit * 0.06);
    for (let x = -bump; x < w + bump; x += bump * 1.3) {
      circle(ctx, x + random() * bump * 0.4, horizon - bump * 0.35, bump * (0.75 + random() * 0.3));
      ctx.fill();
    }

    // picket fence
    const picket = Math.max(11, Math.min(20, w * 0.03));
    const fenceTop = horizon - unit * 0.075;
    const fenceBottom = horizon + unit * 0.02;
    ctx.fillStyle = "#e9d9ae";
    ctx.fillRect(0, fenceTop + (fenceBottom - fenceTop) * 0.3, w, 4);
    ctx.fillRect(0, fenceTop + (fenceBottom - fenceTop) * 0.7, w, 4);
    for (let x = picket * 0.3; x < w; x += picket + 5) {
      ctx.fillStyle = PALETTE.cream;
      ctx.beginPath();
      ctx.moveTo(x, fenceBottom);
      ctx.lineTo(x, fenceTop + picket * 0.5);
      ctx.lineTo(x + picket / 2, fenceTop);
      ctx.lineTo(x + picket, fenceTop + picket * 0.5);
      ctx.lineTo(x + picket, fenceBottom);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(43,38,35,0.14)";
      ctx.fillRect(x + picket - 3, fenceTop + picket * 0.5, 3, fenceBottom - fenceTop - picket * 0.5);
    }

    // lawn with mowing stripes
    const lawn = ctx.createLinearGradient(0, horizon, 0, h);
    lawn.addColorStop(0, "#9bd66b");
    lawn.addColorStop(1, PALETTE.green);
    ctx.fillStyle = lawn;
    ctx.fillRect(0, fenceBottom, w, h - fenceBottom);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let k = -8; k <= 8; k += 2) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + k * w * 0.035, fenceBottom);
      ctx.lineTo(w / 2 + (k + 1) * w * 0.035, fenceBottom);
      ctx.lineTo(w / 2 + (k + 1) * w * 0.3, h);
      ctx.lineTo(w / 2 + k * w * 0.3, h);
      ctx.closePath();
      ctx.fill();
    }

    // daisies
    for (let i = 0; i < 30; i += 1) {
      const fx = random() * w;
      const depthK = random();
      const fy = fenceBottom + 10 + depthK * (h - fenceBottom - 20);
      const fr = 1.6 + depthK * 2.4;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      for (let p = 0; p < 5; p += 1) {
        const angle = (p / 5) * TAU;
        circle(ctx, fx + Math.cos(angle) * fr, fy + Math.sin(angle) * fr * 0.7, fr * 0.75);
        ctx.fill();
      }
      ctx.fillStyle = PALETTE.yellow;
      circle(ctx, fx, fy, fr * 0.7);
      ctx.fill();
    }

    // gingham tablecloth along the bottom edge, where the ingredient tray sits
    const clothH = Math.max(96, Math.round(h * 0.15));
    drawGingham(ctx, 0, h - clothH, w, clothH);

    drawBunting(ctx, w, h);
  }

  // ---- grill ---------------------------------------------------------------------

  // rect is the area the six slots occupy; the kettle body is drawn around it.
  function drawGrill(ctx, rect, slotRects) {
    const pad = clamp(rect.w * 0.035, 8, 18);
    const depth = clamp(rect.h * 0.06, 12, 30);
    const outer = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
    const radius = clamp(rect.w * 0.06, 14, 34);
    const random = scenery(77);

    // ground shadow and legs
    ctx.fillStyle = "rgba(20,40,16,0.3)";
    ctx.beginPath();
    ctx.ellipse(outer.x + outer.w / 2, outer.y + outer.h + depth + 46, outer.w * 0.5, 16, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = PALETTE.charcoal;
    ctx.lineWidth = Math.max(6, pad * 0.7);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(outer.x + outer.w * 0.16, outer.y + outer.h);
    ctx.lineTo(outer.x + outer.w * 0.08, outer.y + outer.h + depth + 46);
    ctx.moveTo(outer.x + outer.w * 0.84, outer.y + outer.h);
    ctx.lineTo(outer.x + outer.w * 0.92, outer.y + outer.h + depth + 46);
    ctx.stroke();

    // wooden side handles
    ctx.fillStyle = "#c98d4f";
    roundedRect(ctx, outer.x - pad * 0.9, outer.y + outer.h * 0.38, pad * 1.4, outer.h * 0.24, pad * 0.5);
    ctx.fill();
    roundedRect(ctx, outer.x + outer.w - pad * 0.5, outer.y + outer.h * 0.38, pad * 1.4, outer.h * 0.24, pad * 0.5);
    ctx.fill();

    // red enamel bowl (front face gives the thickness)
    const enamel = ctx.createLinearGradient(0, outer.y + outer.h - radius, 0, outer.y + outer.h + depth);
    enamel.addColorStop(0, PALETTE.red);
    enamel.addColorStop(1, PALETTE.redDeep);
    ctx.fillStyle = enamel;
    roundedRect(ctx, outer.x, outer.y + depth, outer.w, outer.h, radius);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    roundedRect(ctx, outer.x + outer.w * 0.08, outer.y + outer.h + depth * 0.3, outer.w * 0.3, Math.max(3, depth * 0.18), 3);
    ctx.fill();

    // charcoal rim and fire bed
    ctx.fillStyle = PALETTE.charcoal;
    roundedRect(ctx, outer.x, outer.y, outer.w, outer.h, radius);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,246,224,0.28)";
    ctx.lineWidth = 2;
    roundedRect(ctx, outer.x + 2, outer.y + 2, outer.w - 4, outer.h - 4, radius - 2);
    ctx.stroke();

    const inner = { x: rect.x - 2, y: rect.y - 2, w: rect.w + 4, h: rect.h + 4 };
    ctx.save();
    roundedRect(ctx, inner.x, inner.y, inner.w, inner.h, radius * 0.7);
    ctx.clip();
    const bed = ctx.createLinearGradient(0, inner.y, 0, inner.y + inner.h);
    bed.addColorStop(0, "#1b1412");
    bed.addColorStop(1, "#2a1a14");
    ctx.fillStyle = bed;
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);

    // coals
    const coalCount = Math.round(clamp((inner.w * inner.h) / 2600, 24, 90));
    for (let i = 0; i < coalCount; i += 1) {
      const cx = inner.x + random() * inner.w;
      const cy = inner.y + random() * inner.h;
      const cr = 7 + random() * 9;
      const warmth = random();
      ctx.fillStyle = warmth > 0.55 ? "rgba(255,120,40,0.55)" : warmth > 0.25 ? "rgba(216,64,47,0.5)" : "rgba(70,60,56,0.8)";
      ctx.beginPath();
      ctx.ellipse(cx, cy, cr, cr * 0.72, random() * Math.PI, 0, TAU);
      ctx.fill();
      if (warmth > 0.55) {
        ctx.fillStyle = "rgba(255,214,110,0.55)";
        circle(ctx, cx - cr * 0.2, cy - cr * 0.15, cr * 0.35);
        ctx.fill();
      }
    }

    // grate
    ctx.strokeStyle = "rgba(150,146,142,0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let y = inner.y + 7; y < inner.y + inner.h; y += 11) {
      ctx.moveTo(inner.x, y);
      ctx.lineTo(inner.x + inner.w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = inner.y + 6; y < inner.y + inner.h; y += 11) {
      ctx.moveTo(inner.x, y);
      ctx.lineTo(inner.x + inner.w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(120,116,112,0.95)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 1; i < 3; i += 1) {
      const x = inner.x + (inner.w * i) / 3;
      ctx.moveTo(x, inner.y);
      ctx.lineTo(x, inner.y + inner.h);
    }
    ctx.stroke();
    ctx.restore();

    // slot seats
    ctx.fillStyle = "rgba(255,246,224,0.07)";
    for (const slot of slotRects) {
      roundedRect(ctx, slot.x + 3, slot.y + 3, slot.w - 6, slot.h - 6, 14);
      ctx.fill();
    }
  }

  function drawEmberGlow(ctx, rect, pulse) {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const reach = Math.max(rect.w, rect.h) * 0.62;
    const glow = ctx.createRadialGradient(cx, cy, reach * 0.05, cx, cy, reach);
    glow.addColorStop(0, "rgba(255,170,60," + (0.2 + pulse * 0.1) + ")");
    glow.addColorStop(1, "rgba(255,90,30,0)");
    ctx.save();
    roundedRect(ctx, rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, 16);
    ctx.clip();
    ctx.fillStyle = glow;
    ctx.fillRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
    ctx.restore();
  }

  root.BBQArt = {
    PALETTE,
    drawFood,
    drawTimingBar,
    drawBackdrop,
    drawGrill,
    drawEmberGlow,
    roundedRect,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
