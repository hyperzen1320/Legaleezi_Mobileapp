/* eslint-disable no-console */
// Generates the app's brand assets (icon, adaptive icon, splash seal,
// favicon) from pure SVG geometry — no fonts, so the render is identical
// on any machine. Identity: Editorial Gravitas — ink plate, paper "L",
// brass dot (the in-app BrandMark, scaled up), wax-seal circle for the
// splash. Re-run with:  node scripts/generate-brand-assets.js
const sharp = require("sharp");
const path = require("path");

const INK = "#0e1a2b";
const INK_2 = "#1b2d45";
const PAPER = "#f4ecda";
const BRASS = "#b68b3c";
const BRASS_DEEP = "#8e6a24";

const OUT = path.join(__dirname, "..", "assets");

// The "L" monogram as plain rectangles (stem + foot) with a brass dot —
// the TopBar BrandMark, drawn big. Group is positioned by translate.
function monogram({ scale = 1, dx = 0, dy = 0, paper = PAPER, brass = BRASS }) {
  return `
  <g transform="translate(${dx} ${dy}) scale(${scale})">
    <rect x="400" y="312" width="116" height="388" fill="${paper}"/>
    <rect x="400" y="596" width="264" height="104" fill="${paper}"/>
    <circle cx="652" cy="352" r="34" fill="${brass}"/>
  </g>`;
}

// App icon — full-bleed ink plate, engraved brass frame, monogram.
const iconSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${INK_2}"/>
      <stop offset="0.55" stop-color="${INK}"/>
      <stop offset="1" stop-color="#0a1422"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#plate)"/>
  <rect x="58" y="58" width="908" height="908" fill="none" stroke="${BRASS_DEEP}" stroke-width="4"/>
  <rect x="76" y="76" width="872" height="872" fill="none" stroke="${BRASS}" stroke-width="2" opacity="0.8"/>
  ${monogram({ scale: 1.04, dx: -36, dy: -20 })}
</svg>`;

// Android adaptive foreground — transparent canvas; everything critical
// inside the 66% safe circle (r ≈ 338 from centre). Background colour
// comes from app.json (ink).
const adaptiveSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <circle cx="512" cy="512" r="306" fill="none" stroke="${BRASS}" stroke-width="8" opacity="0.9"/>
  <circle cx="512" cy="512" r="282" fill="none" stroke="${BRASS_DEEP}" stroke-width="3" opacity="0.7"/>
  ${monogram({ scale: 0.62, dx: 182, dy: 200 })}
</svg>`;

// Splash seal — a round wax-seal mark, tight canvas; expo-splash-screen
// shows it at imageWidth dp on the paper background. Round so the
// Android 12+ circular splash mask never clips it.
const splashSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="seal" cx="0.38" cy="0.32" r="1">
      <stop offset="0" stop-color="${INK_2}"/>
      <stop offset="0.6" stop-color="${INK}"/>
      <stop offset="1" stop-color="#0a1422"/>
    </radialGradient>
  </defs>
  <circle cx="512" cy="512" r="486" fill="url(#seal)"/>
  <circle cx="512" cy="512" r="486" fill="none" stroke="${BRASS}" stroke-width="14"/>
  <circle cx="512" cy="512" r="438" fill="none" stroke="${BRASS_DEEP}" stroke-width="5" opacity="0.85"/>
  ${monogram({ scale: 0.86, dx: 60, dy: 78 })}
</svg>`;

// Android status-bar notification icon. The system reads this image's
// ALPHA CHANNEL ONLY and tints the silhouette with the accent colour from
// app.json — anything carrying colour or a background renders as a plain
// grey square in the status bar. So: the monogram in solid white on
// transparent, centred, nothing else. It's the mark that appears the
// moment a Senior Desk message lands.
//
// Centring maths: the monogram occupies x 400–686, y 312–700, so its
// centre is (543, 506); at scale s it lands at (dx + 543s, dy + 506s),
// and we want (512, 512) on a 1024 canvas.
const NOTIF_SCALE = 2.11;
const notificationSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${monogram({
    scale: NOTIF_SCALE,
    dx: 512 - 543 * NOTIF_SCALE,
    dy: 512 - 506 * NOTIF_SCALE,
    paper: "#ffffff",
    brass: "#ffffff",
  })}
</svg>`;

async function run() {
  await sharp(Buffer.from(iconSvg)).png().toFile(path.join(OUT, "icon.png"));
  await sharp(Buffer.from(notificationSvg))
    .resize(96, 96)
    .png()
    .toFile(path.join(OUT, "notification-icon.png"));
  await sharp(Buffer.from(adaptiveSvg))
    .png()
    .toFile(path.join(OUT, "adaptive-icon.png"));
  await sharp(Buffer.from(splashSvg))
    .png()
    .toFile(path.join(OUT, "splash-icon.png"));
  await sharp(Buffer.from(iconSvg))
    .resize(48, 48)
    .png()
    .toFile(path.join(OUT, "favicon.png"));
  console.log(
    "brand assets written: icon, adaptive-icon, splash-icon, favicon, notification-icon"
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
