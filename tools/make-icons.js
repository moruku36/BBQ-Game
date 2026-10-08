// Rasterizes the favicon.svg design into the two fallback files:
//   favicon.ico (32x32 PNG inside an ICO) and apple-touch-icon.png (180x180).
// The shapes below mirror favicon.svg by hand; Node's zlib is the only
// dependency. Run: node tools/make-icons.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
const SAMPLES = 4;

function hex(color) {
  return [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
}

function capsule(x1, y1, x2, y2, width, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length2 = dx * dx + dy * dy;
  const radius2 = (width / 2) * (width / 2);
  return {
    color: hex(color),
    hit(x, y) {
      const k = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length2));
      const px = x - (x1 + k * dx);
      const py = y - (y1 + k * dy);
      return px * px + py * py <= radius2;
    },
  };
}

function circle(cx, cy, r, color) {
  return { color: hex(color), hit: (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r };
}

function roundedSquare(size, r, color) {
  return {
    color: hex(color),
    hit(x, y) {
      const px = Math.max(r - x, 0, x - (size - r));
      const py = Math.max(r - y, 0, y - (size - r));
      return x >= 0 && y >= 0 && x <= size && y <= size && px * px + py * py <= r * r;
    },
  };
}

// Back to front, in the 64 x 64 space of favicon.svg.
function shapes(cornerRadius) {
  return [
    roundedSquare(64, cornerRadius, "#d8402f"),
    circle(32, 33, 23, "#fff6e0"),
    circle(32, 33, 20, "#2b2623"),
    capsule(22, 18, 22, 48, 2, "#5a504a"),
    capsule(32, 15, 32, 51, 2, "#5a504a"),
    capsule(42, 18, 42, 48, 2, "#5a504a"),
    capsule(21, 40, 43, 27, 12, "#b2502c"),
    capsule(22, 36, 39, 26, 2.5, "#f0a070"),
    capsule(27, 33, 30, 39, 2.5, "#3a1c10"),
    capsule(35, 28, 38, 34, 2.5, "#3a1c10"),
  ];
}

// RGBA pixels, supersampled; outside every shape stays transparent.
function render(size, cornerRadius) {
  const layers = shapes(cornerRadius);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const u = ((x + (sx + 0.5) / SAMPLES) / size) * 64;
          const v = ((y + (sy + 0.5) / SAMPLES) / size) * 64;
          for (let i = layers.length - 1; i >= 0; i -= 1) {
            if (layers[i].hit(u, v)) {
              sum[0] += layers[i].color[0];
              sum[1] += layers[i].color[1];
              sum[2] += layers[i].color[2];
              sum[3] += 1;
              break;
            }
          }
        }
      }
      const at = (y * size + x) * 4;
      const covered = sum[3] || 1;
      pixels[at] = Math.round(sum[0] / covered);
      pixels[at + 1] = Math.round(sum[1] / covered);
      pixels[at + 2] = Math.round(sum[2] / covered);
      pixels[at + 3] = Math.round((sum[3] / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return pixels;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([head, body, crc]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ico(size, image) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(1, 4); // one image
  header[6] = size;
  header[7] = size;
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(image.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, image]);
}

fs.writeFileSync(path.join(ROOT, "favicon.ico"), ico(32, png(32, render(32, 14))));
// iOS rounds the corners itself, so this one is a full square.
fs.writeFileSync(path.join(ROOT, "apple-touch-icon.png"), png(180, render(180, 0)));
