/* eslint-disable no-console */
// Generates the app's brand assets from two masters in assets/brand/.
// legaleezi-logo.png — the gold-ringed navy seal over the "Legaleezi"
// wordmark, on paper:
//   icon.png          the seal alone, centred on paper
//   adaptive-icon.png the seal inside Android's 66% safe circle
//   favicon.png       the icon at 48px
//   splash-icon.png   seal + wordmark — the native splash, and the
//                     BootScreen that takes over from it
// legaleezi-mark.png — the coral sword-and-scales mark, transparent:
//   logo.png          the in-app brand mark (dashboard, landing top bar)
// Geometry is measured from the masters, not hard-coded, so swapping in
// a re-export of the artwork just works. The notification icon is the
// one asset still drawn from SVG (see below).
// Re-run with:  node scripts/generate-brand-assets.js
const sharp = require("sharp");
const path = require("path");

const OUT = path.join(__dirname, "..", "assets");
const MASTER = path.join(OUT, "brand", "legaleezi-logo.png");
const MARK = path.join(OUT, "brand", "legaleezi-mark.png");

// How far a pixel may drift from the paper colour and still count as
// paper — the master's background carries a couple of levels of noise.
const INK_THRESHOLD = 12;

async function loadMaster() {
  const { data, info } = await sharp(MASTER)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const px = (x, y) => {
    const i = (y * width + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // Paper = the average of the outermost ring of pixels.
  const sum = [0, 0, 0];
  let n = 0;
  const add = (x, y) => {
    const p = px(x, y);
    sum[0] += p[0];
    sum[1] += p[1];
    sum[2] += p[2];
    n++;
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    add(width - 1, y);
  }
  const paper = sum.map((v) => Math.round(v / n));

  const isInk = (x, y) => {
    const p = px(x, y);
    return Math.max(...p.map((v, c) => Math.abs(v - paper[c]))) > INK_THRESHOLD;
  };

  // Bounding box of the ink in a band of rows.
  const bbox = (y0, y1) => {
    let x0 = width;
    let x1 = -1;
    let top = -1;
    let bottom = -1;
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < width; x++) {
        if (!isInk(x, y)) continue;
        if (top < 0) top = y;
        bottom = y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    return { x0, x1, y0: top, y1: bottom };
  };

  // The seal and the wordmark are separated by the first band of empty
  // rows below the seal.
  const inkRows = [];
  for (let y = 0; y < height; y++) {
    let hit = false;
    for (let x = 0; x < width && !hit; x++) hit = isInk(x, y);
    inkRows.push(hit);
  }
  const first = inkRows.indexOf(true);
  let gap = first;
  while (gap < height && inkRows[gap]) gap++;
  const seal = bbox(first, gap - 1);
  const logo = bbox(first, height - 1);

  // Furthest ink from the centre of the whole logo — what has to fit
  // inside Android 12+'s circular splash mask.
  const cx = (logo.x0 + logo.x1) / 2;
  const cy = (logo.y0 + logo.y1) / 2;
  let reach = 0;
  for (let y = logo.y0; y <= logo.y1; y++) {
    for (let x = logo.x0; x <= logo.x1; x++) {
      if (isInk(x, y)) reach = Math.max(reach, Math.hypot(x - cx, y - cy));
    }
  }

  return { width, height, paper, seal, logo, reach };
}

// A paper-filled square of `side` px with a region of the master pasted
// so that (cx, cy) lands dead centre, scaled to `size`. The region's own
// margin is paper, so the paste is seamless.
async function onPaper(master, region, cx, cy, side, size) {
  const S = Math.round(side);
  const crop = await sharp(MASTER)
    .removeAlpha()
    .extract({
      left: region.x0,
      top: region.y0,
      width: region.x1 - region.x0 + 1,
      height: region.y1 - region.y0 + 1,
    })
    .toBuffer();
  const [r, g, b] = master.paper;
  const flat = await sharp({
    create: { width: S, height: S, channels: 3, background: { r, g, b } },
  })
    .composite([
      {
        input: crop,
        left: Math.round(S / 2 - (cx - region.x0)),
        top: Math.round(S / 2 - (cy - region.y0)),
      },
    ])
    .png()
    .toBuffer();
  // Opaque RGB — App Store icons must not carry an alpha channel.
  return sharp(flat)
    .resize(size, size, { kernel: "lanczos3" })
    .removeAlpha()
    .png();
}

// `box` grown by `m` px on every side, clamped to the image.
function grow(master, box, m) {
  return {
    x0: Math.max(0, box.x0 - m),
    y0: Math.max(0, box.y0 - m),
    x1: Math.min(master.width - 1, box.x1 + m),
    y1: Math.min(master.height - 1, box.y1 + m),
  };
}

// The coral mark, cleaned up from its master. The master's background
// removal left the body at ~99% opacity, a faint haze around it and a
// few stray specks, so: alpha is re-levelled (haze → 0, body → solid,
// edges keep their anti-aliasing), blobs under SPECK px are dropped, and
// the colour is flattened to the body's coral.
const SPECK = 50;
const MARK_HEIGHT = 512; // ≥ 2× the largest place the mark is drawn

async function cleanMark() {
  const { data, info } = await sharp(MARK)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const N = width * height;

  const LO = 16;
  const HI = 245;
  const alpha = new Float32Array(N);
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < N; i++) {
    const a = data[i * 4 + 3];
    alpha[i] = Math.min(1, Math.max(0, (a - LO) / (HI - LO)));
    if (a > 200) {
      sum[0] += data[i * 4];
      sum[1] += data[i * 4 + 1];
      sum[2] += data[i * 4 + 2];
      n++;
    }
  }
  const [r, g, b] = sum.map((v) => Math.round(v / n));

  // Flood-fill each blob of visible pixels; keep only the real ones.
  const seen = new Uint8Array(N);
  const keep = new Uint8Array(N);
  const stack = [];
  for (let s = 0; s < N; s++) {
    if (seen[s] || alpha[s] === 0) continue;
    const blob = [];
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      blob.push(i);
      const x = i % width;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        i - width,
        i + width,
      ];
      for (const j of neighbours) {
        if (j >= 0 && j < N && !seen[j] && alpha[j] > 0) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (blob.length >= SPECK) for (const i of blob) keep[i] = 1;
  }

  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < N; i++) {
    if (!keep[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const pad = 4;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);

  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y0 + y) * width + (x0 + x);
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = keep[src] ? Math.round(alpha[src] * 255) : 0;
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .resize({ height: MARK_HEIGHT, kernel: "lanczos3" })
    .png();
}

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
function monogram({ scale = 1, dx = 0, dy = 0, paper, brass }) {
  return `
  <g transform="translate(${dx} ${dy}) scale(${scale})">
    <rect x="400" y="312" width="116" height="388" fill="${paper}"/>
    <rect x="400" y="596" width="264" height="104" fill="${paper}"/>
    <circle cx="652" cy="352" r="34" fill="${brass}"/>
  </g>`;
}
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
  const master = await loadMaster();
  const { seal, logo, reach } = master;
  const sealCx = (seal.x0 + seal.x1) / 2;
  const sealCy = (seal.y0 + seal.y1) / 2;
  const sealD = seal.x1 - seal.x0 + 1;
  // The seal's soft drop shadow reaches a few percent past its rim.
  const sealRegion = grow(master, seal, Math.round(sealD * 0.04));

  // App icon — the seal at 80% of the plate; iOS rounds the corners.
  const icon = await onPaper(master, sealRegion, sealCx, sealCy, sealD / 0.8, 1024);
  await icon.clone().toFile(path.join(OUT, "icon.png"));
  await icon.clone().resize(48, 48).toFile(path.join(OUT, "favicon.png"));

  // Android adaptive foreground — the seal at 62%, inside the 66% safe
  // circle every launcher mask keeps. Paper to the edges; app.json's
  // adaptiveIcon.backgroundColor is the same paper.
  await (
    await onPaper(master, sealRegion, sealCx, sealCy, sealD / 0.62, 1024)
  ).toFile(path.join(OUT, "adaptive-icon.png"));

  // Splash — seal + wordmark. Android 12+ shows the splash image inside
  // a circle 2/3 the width of its canvas, so all the ink sits within 92%
  // of the square's inscribed circle; app.json's imageWidth then makes
  // that circle exactly the mask.
  await (
    await onPaper(
      master,
      grow(master, logo, 16),
      (logo.x0 + logo.x1) / 2,
      (logo.y0 + logo.y1) / 2,
      (2 * reach) / 0.92,
      1024
    )
  ).toFile(path.join(OUT, "splash-icon.png"));

  await (await cleanMark()).toFile(path.join(OUT, "logo.png"));

  await sharp(Buffer.from(notificationSvg))
    .resize(96, 96)
    .png()
    .toFile(path.join(OUT, "notification-icon.png"));

  console.log(
    `paper rgb(${master.paper.join(", ")}) · ` +
      "brand assets written: icon, adaptive-icon, favicon, splash-icon, logo, notification-icon"
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
