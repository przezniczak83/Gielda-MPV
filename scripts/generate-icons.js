#!/usr/bin/env node
// scripts/generate-icons.js
// Generates PWA icons in multiple sizes using sharp (SVG → PNG)
// Run: node scripts/generate-icons.js

const fs   = require("fs");
const path = require("path");

const SIZES  = [72, 96, 128, 144, 152, 192, 384, 512];
const OUT_DIR = path.join(__dirname, "../app/public/icons");

function makeSvg(size) {
  const rx  = Math.round(size * 0.18);
  const pad = Math.round(size * 0.10);
  const fs2 = Math.round(size * 0.60);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#111827" rx="${rx}"/>
  <text
    x="${size / 2}"
    y="${size / 2 + fs2 * 0.35}"
    font-size="${fs2}"
    text-anchor="middle"
    dominant-baseline="auto"
    font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif"
  >📈</text>
</svg>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    // Fallback: write SVG files instead of PNGs
    console.warn("sharp not found — writing SVG files instead.");
    for (const size of SIZES) {
      const svg  = makeSvg(size);
      const file = path.join(OUT_DIR, `icon-${size}.svg`);
      fs.writeFileSync(file, svg);
      console.log(`  wrote ${file}`);
    }
    console.log("Done (SVG fallback). Install sharp for real PNGs: npm install sharp --save-dev");
    return;
  }

  for (const size of SIZES) {
    const svg  = Buffer.from(makeSvg(size));
    const file = path.join(OUT_DIR, `icon-${size}.png`);
    await sharp(svg).png().toFile(file);
    console.log(`  wrote ${file} (${size}x${size})`);
  }

  console.log(`\nDone — ${SIZES.length} icons written to ${OUT_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
