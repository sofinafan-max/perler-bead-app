// ========== Color Science ==========
function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

function rgbToLab(r, g, b) {
  let rl = r / 255, gl = g / 255, bl = b / 255;
  rl = rl > 0.04045 ? Math.pow((rl + 0.055) / 1.055, 2.4) : rl / 12.92;
  gl = gl > 0.04045 ? Math.pow((gl + 0.055) / 1.055, 2.4) : gl / 12.92;
  bl = bl > 0.04045 ? Math.pow((bl + 0.055) / 1.055, 2.4) : bl / 12.92;
  let x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  let y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl) / 1.00000;
  let z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = f(x); y = f(y); z = f(z);
  return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

function labDistance(lab1, lab2) {
  const dL = lab1.L - lab2.L, da = lab1.a - lab2.a, db = lab1.b - lab2.b;
  const C1 = Math.sqrt(lab1.a * lab1.a + lab1.b * lab1.b);
  const C2 = Math.sqrt(lab2.a * lab2.a + lab2.b * lab2.b);
  const dC = C1 - C2;
  const dH2 = da * da + db * db - dC * dC;
  const dH = dH2 > 0 ? Math.sqrt(dH2) : 0;
  const sL = 1, sC = 1 + 0.045 * (C1 + C2) / 2, sH = 1 + 0.015 * (C1 + C2) / 2;
  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2);
}

const PERLER_LAB_CACHE = [];
function initLabCache() {
  if (PERLER_LAB_CACHE.length > 0) return;
  for (const color of PERLER_COLORS) {
    const { r, g, b } = hexToRgb(color.hex);
    PERLER_LAB_CACHE.push({ ...color, lab: rgbToLab(r, g, b) });
  }
}

function findNearestColor(r, g, b) {
  initLabCache();
  const lab = rgbToLab(r, g, b);
  let minDist = Infinity, best = PERLER_LAB_CACHE[0];
  for (const entry of PERLER_LAB_CACHE) {
    const dist = labDistance(lab, entry.lab);
    if (dist < minDist) { minDist = dist; best = entry; }
  }
  return best;
}

function textColorFor(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000' : '#fff';
}

function textColorForRgb(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000' : '#fff';
}

function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ========== Storage ==========
function getHistory() { return JSON.parse(localStorage.getItem('perler_history') || '[]'); }
function saveHistory(list) { localStorage.setItem('perler_history', JSON.stringify(list)); }
function getGallery() { return JSON.parse(localStorage.getItem('perler_gallery') || '[]'); }
function saveGallery(list) { localStorage.setItem('perler_gallery', JSON.stringify(list)); }
function getScoringHistory() { return JSON.parse(localStorage.getItem('perler_scoring') || '[]'); }
function saveScoringHistory(list) { localStorage.setItem('perler_scoring', JSON.stringify(list)); }

// ========== Global State ==========
let currentPattern = null;
let currentImageDataUrl = null;
let currentVariants = [];
let currentDirectPattern = null;
let currentDenoisedDataUrl = null;
let currentImg = null;
let resizedGridW = 0;
let resizedGridH = 0;

// ========== Bilateral Filter (Denoise) ==========
function bilateralFilter(canvas, radius, sigmaS, sigmaC) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  // For performance, work on a smaller version if image is large
  const maxDim = 800;
  let workCanvas = canvas, scale = 1;
  if (Math.max(w, h) > maxDim) {
    scale = maxDim / Math.max(w, h);
    workCanvas = document.createElement('canvas');
    workCanvas.width = Math.round(w * scale);
    workCanvas.height = Math.round(h * scale);
    const wCtx = workCanvas.getContext('2d');
    wCtx.drawImage(canvas, 0, 0, workCanvas.width, workCanvas.height);
  }

  const ww = workCanvas.width, wh = workCanvas.height;
  const wCtx = workCanvas.getContext('2d');
  const imageData = wCtx.getImageData(0, 0, ww, wh);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);

  const ss2 = 2 * sigmaS * sigmaS;
  const sc2 = 2 * sigmaC * sigmaC;

  for (let y = 0; y < wh; y++) {
    for (let x = 0; x < ww; x++) {
      const i = (y * ww + x) * 4;
      let rSum = 0, gSum = 0, bSum = 0, wSum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= ww || ny < 0 || ny >= wh) continue;
          const ni = (ny * ww + nx) * 4;
          const spatialW = Math.exp(-(dx * dx + dy * dy) / ss2);
          const dr = src[i] - src[ni], dg = src[i+1] - src[ni+1], db = src[i+2] - src[ni+2];
          const colorW = Math.exp(-(dr*dr + dg*dg + db*db) / sc2);
          const weight = spatialW * colorW;
          rSum += src[ni] * weight;
          gSum += src[ni+1] * weight;
          bSum += src[ni+2] * weight;
          wSum += weight;
        }
      }
      out[i] = rSum / wSum;
      out[i+1] = gSum / wSum;
      out[i+2] = bSum / wSum;
      out[i+3] = src[i+3];
    }
  }

  const outData = new ImageData(out, ww, wh);
  if (scale < 1) {
    // Write back to work canvas, then scale up to original
    wCtx.putImageData(outData, 0, 0);
    ctx.drawImage(workCanvas, 0, 0, w, h);
  } else {
    ctx.putImageData(outData, 0, 0);
  }
}

// ========== Image Preprocessing ==========
function preprocessImage(sourceCanvas, params) {
  const w = sourceCanvas.width, h = sourceCanvas.height;
  const ctx = sourceCanvas.getContext('2d');
  let imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // 1. Contrast enhancement
  const contrast = params.contrast || 1.0;
  if (contrast !== 1.0) {
    for (let i = 0; i < data.length; i += 4) {
      data[i]   = Math.max(0, Math.min(255, ((data[i]   - 128) * contrast) + 128));
      data[i+1] = Math.max(0, Math.min(255, ((data[i+1] - 128) * contrast) + 128));
      data[i+2] = Math.max(0, Math.min(255, ((data[i+2] - 128) * contrast) + 128));
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // 2. Unsharp mask (sharpen)
  const sharpness = params.sharpness || 0;
  if (sharpness > 0) {
    ctx.putImageData(imageData, 0, 0);
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = w; blurCanvas.height = h;
    const blurCtx = blurCanvas.getContext('2d');
    blurCtx.filter = 'blur(1px)';
    blurCtx.drawImage(sourceCanvas, 0, 0);
    const blurData = blurCtx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < data.length; i += 4) {
      data[i]   = Math.max(0, Math.min(255, data[i]   + (data[i]   - blurData[i])   * sharpness));
      data[i+1] = Math.max(0, Math.min(255, data[i+1] + (data[i+1] - blurData[i+1]) * sharpness));
      data[i+2] = Math.max(0, Math.min(255, data[i+2] + (data[i+2] - blurData[i+2]) * sharpness));
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return sourceCanvas;
}

// ========== Downsample ==========
function downsampleImage(img, gridW, gridH, params) {
  const darkThresh = params.darkThresh != null ? params.darkThresh : 40;
  const lightBgThresh = params.lightBgThresh != null ? params.lightBgThresh : 180;
  const darkMinRatio = params.darkMinRatio != null ? params.darkMinRatio : 0.02;
  const darkMaxRatio = params.darkMaxRatio != null ? params.darkMaxRatio : 0.4;

  // Draw full image (no square crop) and preprocess
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const w = img.naturalWidth, h = img.naturalHeight;
  canvas.width = w; canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);

  // Apply preprocessing
  preprocessImage(canvas, params);

  const raw = ctx.getImageData(0, 0, w, h).data;
  const blockW = w / gridW, blockH = h / gridH;
  const pixels = [];
  for (let gy = 0; gy < gridH; gy++) {
    const row = [];
    for (let gx = 0; gx < gridW; gx++) {
      let rs = 0, gs = 0, bs = 0, n = 0;
      let drs = 0, dgs = 0, dbs = 0, dn = 0;
      const y0 = Math.floor(gy * blockH), y1 = Math.floor((gy + 1) * blockH);
      const x0 = Math.floor(gx * blockW), x1 = Math.floor((gx + 1) * blockW);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * w + px) * 4;
          const a = raw[i + 3] / 255;
          const r = raw[i] * a + 255 * (1 - a);
          const g = raw[i + 1] * a + 255 * (1 - a);
          const b = raw[i + 2] * a + 255 * (1 - a);
          rs += r; gs += g; bs += b; n++;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum < darkThresh) { drs += r; dgs += g; dbs += b; dn++; }
        }
      }
      if (n === 0) { row.push({ r: 255, g: 255, b: 255 }); continue; }
      const avgR = rs / n, avgG = gs / n, avgB = bs / n;
      const avgLum = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
      if (dn > 0 && avgLum > lightBgThresh && (dn / n) >= darkMinRatio && (dn / n) < darkMaxRatio) {
        row.push({ r: drs / dn, g: dgs / dn, b: dbs / dn });
      } else {
        row.push({ r: avgR, g: avgG, b: avgB });
      }
    }
    pixels.push(row);
  }
  return pixels;
}

// ========== Pattern Generation ==========
function imageToPattern(img, gridW, gridH, params) {
  params = params || {};
  const ditherStrength = params.ditherStrength != null ? params.ditherStrength : 1.0;
  const pixels = downsampleImage(img, gridW, gridH, params);

  const work = [], grid = [], colorCount = {};
  for (let y = 0; y < gridH; y++) {
    work[y] = []; grid[y] = [];
    for (let x = 0; x < gridW; x++) {
      work[y][x] = { r: pixels[y][x].r, g: pixels[y][x].g, b: pixels[y][x].b };
    }
  }

  // Floyd-Steinberg dithering with configurable strength
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const p = work[y][x];
      const cr = Math.max(0, Math.min(255, Math.round(p.r)));
      const cg = Math.max(0, Math.min(255, Math.round(p.g)));
      const cb = Math.max(0, Math.min(255, Math.round(p.b)));
      const color = findNearestColor(cr, cg, cb);
      grid[y][x] = color;
      colorCount[color.code] = (colorCount[color.code] || 0) + 1;
      const m = hexToRgb(color.hex);
      const er = (p.r - m.r) * ditherStrength;
      const eg = (p.g - m.g) * ditherStrength;
      const eb = (p.b - m.b) * ditherStrength;
      const spread = (dx, dy, f) => {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
          work[ny][nx].r += er * f;
          work[ny][nx].g += eg * f;
          work[ny][nx].b += eb * f;
        }
      };
      spread(1,0,7/16); spread(-1,1,3/16); spread(0,1,5/16); spread(1,1,1/16);
    }
  }

  // Compute similarity metrics
  let totalLabDist = 0;
  const totalPixels = gridW * gridH;
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const orig = rgbToLab(Math.round(pixels[y][x].r), Math.round(pixels[y][x].g), Math.round(pixels[y][x].b));
      const matched = hexToRgb(grid[y][x].hex);
      totalLabDist += labDistance(orig, rgbToLab(matched.r, matched.g, matched.b));
    }
  }
  const overallSimilarity = Math.max(0, Math.min(100, (1 - totalLabDist / totalPixels / 30) * 100));

  const darkCodes = new Set(['H7', 'H6', 'H16', 'H5']);
  let darkRef = 0, darkHit = 0;
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const lum = 0.299 * pixels[y][x].r + 0.587 * pixels[y][x].g + 0.114 * pixels[y][x].b;
      if (lum < 50) { darkRef++; if (darkCodes.has(grid[y][x].code)) darkHit++; }
    }
  }
  const edgeOverlap = darkRef === 0 ? 100 : (darkHit / darkRef) * 100;

  const summary = Object.entries(colorCount)
    .map(([code, count]) => ({ ...PERLER_COLORS.find(c => c.code === code), count }))
    .sort((a, b) => b.count - a.count);

  return { grid, pixels, summary, gridW, gridH, overallSimilarity, edgeOverlap, params };
}

// ========== Direct Pattern (denoise → compress → edge dilate → color match) ==========
function imageToDirectPattern(img, gridW, gridH) {
  // Step 1: 最近邻压缩
  const canvas = document.createElement('canvas');
  canvas.width = gridW; canvas.height = gridH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, gridW, gridH);

  // Step 2: 读取像素并匹配 MARD 色号
  const raw = ctx.getImageData(0, 0, gridW, gridH).data;
  const pixels = [], grid = [], colorCount = {};
  for (let y = 0; y < gridH; y++) {
    pixels[y] = []; grid[y] = [];
    for (let x = 0; x < gridW; x++) {
      const i = (y * gridW + x) * 4;
      const r = raw[i], g = raw[i + 1], b = raw[i + 2];
      pixels[y][x] = { r, g, b };
      const color = findNearestColor(r, g, b);
      grid[y][x] = color;
      colorCount[color.code] = (colorCount[color.code] || 0) + 1;
    }
  }
  const summary = Object.entries(colorCount)
    .map(([code, count]) => ({ ...PERLER_COLORS.find(c => c.code === code), count }))
    .sort((a, b) => b.count - a.count);
  return { grid, pixels, summary, gridW, gridH };
}

// ========== Variant Generation ==========
const PARAM_KEYS = ['ditherStrength', 'sharpness', 'contrast', 'darkThresh', 'lightBgThresh', 'darkMinRatio', 'darkMaxRatio'];
const PARAM_RANGES = {
  ditherStrength: [0.1, 1.5], sharpness: [0, 2.0], contrast: [0.5, 1.5],
  darkThresh: [20, 70], lightBgThresh: [140, 220], darkMinRatio: [0.005, 0.05], darkMaxRatio: [0.2, 0.6]
};

// Initial presets for first run (no scoring data)
function getInitialPresets() {
  return [
    { ditherStrength: 1.0, sharpness: 0.5, contrast: 1.0, darkThresh: 40, lightBgThresh: 180, darkMinRatio: 0.02, darkMaxRatio: 0.4, label: '基准' },
    { ditherStrength: 0.5, sharpness: 0.5, contrast: 1.0, darkThresh: 40, lightBgThresh: 180, darkMinRatio: 0.02, darkMaxRatio: 0.4, label: '低抖动' },
    { ditherStrength: 1.3, sharpness: 0.5, contrast: 1.0, darkThresh: 40, lightBgThresh: 180, darkMinRatio: 0.02, darkMaxRatio: 0.4, label: '高抖动' },
    { ditherStrength: 0.7, sharpness: 0, contrast: 1.0, darkThresh: 40, lightBgThresh: 180, darkMinRatio: 0.02, darkMaxRatio: 0.4, label: '无锐化' },
    { ditherStrength: 1.0, sharpness: 1.5, contrast: 1.0, darkThresh: 40, lightBgThresh: 180, darkMinRatio: 0.02, darkMaxRatio: 0.4, label: '高锐化' },
    { ditherStrength: 1.0, sharpness: 0.5, contrast: 1.3, darkThresh: 40, lightBgThresh: 180, darkMinRatio: 0.02, darkMaxRatio: 0.4, label: '高对比' },
    { ditherStrength: 1.0, sharpness: 0.5, contrast: 0.8, darkThresh: 40, lightBgThresh: 180, darkMinRatio: 0.02, darkMaxRatio: 0.4, label: '低对比' },
    { ditherStrength: 0.8, sharpness: 1.0, contrast: 1.1, darkThresh: 30, lightBgThresh: 160, darkMinRatio: 0.01, darkMaxRatio: 0.5, label: '强线条' },
    { ditherStrength: 1.0, sharpness: 0.3, contrast: 1.0, darkThresh: 50, lightBgThresh: 200, darkMinRatio: 0.03, darkMaxRatio: 0.3, label: '弱线条' },
    { ditherStrength: 0.6, sharpness: 1.0, contrast: 1.2, darkThresh: 35, lightBgThresh: 170, darkMinRatio: 0.02, darkMaxRatio: 0.4, label: '综合优化' },
  ];
}

// Normalized distance between two param sets (0~1 per dimension)
function paramDistance(a, b) {
  let sum = 0;
  for (const k of PARAM_KEYS) {
    const [lo, hi] = PARAM_RANGES[k];
    sum += Math.abs((a[k] || 0) - (b[k] || 0)) / (hi - lo);
  }
  return sum / PARAM_KEYS.length;
}

// Check if params are too close to any "bad" set
function isTooCloseToAny(params, badList, threshold) {
  for (const bad of badList) {
    if (paramDistance(params, bad) < threshold) return true;
  }
  return false;
}

// Clamp param to valid range
function clampParam(k, v) {
  const [lo, hi] = PARAM_RANGES[k];
  return Math.max(lo, Math.min(hi, v));
}

// Generate jittered variant near a center
function jitterParams(center, spread, label) {
  const result = { label };
  for (const k of PARAM_KEYS) {
    const [lo, hi] = PARAM_RANGES[k];
    const range = (hi - lo) * spread;
    result[k] = clampParam(k, center[k] + (Math.random() - 0.5) * range);
  }
  return result;
}

function generatePresetsFromScores() {
  const history = getScoringHistory();
  if (history.length === 0) return getInitialPresets();

  // Separate good (>=6) and bad (<=3) scores
  const good = history.filter(h => h.score >= 6).sort((a, b) => b.score - a.score);
  const bad = history.filter(h => h.score <= 3);

  // If no good scores yet, filter initial presets to exclude bad-similar ones
  if (good.length === 0) {
    const initial = getInitialPresets();
    return initial.filter(p => !isTooCloseToAny(p, bad.map(b => b.params), 0.15))
      .concat(Array.from({ length: 10 }, (_, i) => jitterParams(
        getInitialPresets()[Math.floor(Math.random() * 10)], 0.5, `探索${i + 1}`
      ))).slice(0, 10);
  }

  // Compute weighted center of good params
  let totalW = 0;
  const center = {};
  for (const k of PARAM_KEYS) center[k] = 0;
  for (const h of good) {
    const w = h.score * h.score;
    totalW += w;
    for (const k of PARAM_KEYS) center[k] += (h.params[k] || 0) * w;
  }
  for (const k of PARAM_KEYS) center[k] /= totalW;

  const presets = [];
  const badParams = bad.map(b => b.params);

  // #1: Exact best scored params
  presets.push({ ...good[0].params, label: `最佳(${good[0].score}分)` });

  // #2: Weighted center
  presets.push({ ...center, label: '加权中心' });

  // #3-8: Jittered around center with decreasing spread
  const spreads = [0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
  for (let i = 0; i < spreads.length; i++) {
    let attempt = 0;
    let p;
    do {
      p = jitterParams(center, spreads[i], `优化${i + 1}`);
      attempt++;
    } while (isTooCloseToAny(p, badParams, 0.1) && attempt < 20);
    presets.push(p);
  }

  // #9-10: Random exploration (avoid bad regions)
  for (let i = 0; i < 2; i++) {
    let attempt = 0;
    let p;
    do {
      p = {};
      for (const k of PARAM_KEYS) {
        const [lo, hi] = PARAM_RANGES[k];
        p[k] = lo + Math.random() * (hi - lo);
      }
      p.label = `探索${i + 1}`;
      attempt++;
    } while (isTooCloseToAny(p, badParams, 0.1) && attempt < 20);
    presets.push(p);
  }

  return presets;
}

function generateVariants(img, gridW, gridH) {
  const presets = generatePresetsFromScores();
  const variants = [];
  for (let i = 0; i < presets.length; i++) {
    const params = presets[i];
    const pattern = imageToPattern(img, gridW, gridH, params);
    const thumb = patternToThumbnail(pattern);
    variants.push({ id: i, pattern, thumbnail: thumb, params, score: null });
  }
  return variants;
}

// ========== Variant Thumbnail ==========
function patternToThumbnail(pattern) {
  const { grid, pixels, gridW, gridH } = pattern;
  const cellSize = 4;
  const canvas = document.createElement('canvas');
  canvas.width = gridW * cellSize; canvas.height = gridH * cellSize;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      if (pixels && pixels[y] && pixels[y][x]) {
        const p = pixels[y][x];
        ctx.fillStyle = `rgb(${Math.round(p.r)},${Math.round(p.g)},${Math.round(p.b)})`;
      } else {
        ctx.fillStyle = grid[y][x].hex;
      }
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }
  return canvas.toDataURL('image/png');
}

// ========== Render Variant Grid ==========
function renderVariantGrid(variants) {
  const ranked = variants
    .map(v => ({ ...v, weightedScore: v.pattern.overallSimilarity * 0.55 + v.pattern.edgeOverlap * 0.45 }))
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, 4);

  let html = `<div class="preprocess-info">压缩后尺寸：${resizedGridW}×${resizedGridH} 像素，已从10种方案中选出最优4种。</div>`;
  html += '<div class="variant-grid">';

  // 第1张：压缩原图直接匹配
  if (currentDirectPattern) {
    const directThumb = patternToThumbnail(currentDirectPattern);
    html += `<div class="variant-card" id="variant-direct">`;
    html += `<div class="variant-img-wrap" onclick="selectVariant('direct')">`;
    html += `<img src="${directThumb}" alt="原图对照">`;
    html += `<div class="variant-overlay"><button class="variant-overlay-btn">就选这个</button></div>`;
    html += `</div>`;
    html += `<div class="variant-info">`;
    html += `<div class="variant-metrics">`;
    html += `<div class="variant-metric" style="flex:1">原图对照<strong>直接匹配</strong></div>`;
    html += `</div>`;
    html += `</div></div>`;
  }

  // 后4张：优化方案
  for (let rank = 0; rank < ranked.length; rank++) {
    const v = ranked[rank];
    const sim = v.pattern.overallSimilarity.toFixed(1);
    const edge = v.pattern.edgeOverlap.toFixed(1);
    html += `<div class="variant-card" id="variant-${v.id}">`;
    html += `<div class="variant-img-wrap" onclick="selectVariant(${v.id})">`;
    html += `<img src="${v.thumbnail}" alt="方案${rank + 1}">`;
    html += `<div class="variant-overlay"><button class="variant-overlay-btn">就选这个</button></div>`;
    html += `</div>`;
    html += `<div class="variant-info">`;
    html += `<div class="variant-metrics">`;
    html += `<div class="variant-metric">相似度<strong>${sim}%</strong></div>`;
    html += `<div class="variant-metric">轮廓相似度<strong>${edge}%</strong></div>`;
    html += `</div>`;
    html += `</div></div>`;
  }
  html += '</div>';
  html += '<div id="selected-preview-area"></div>';
  return html;
}

// ========== Variant Interactions ==========
function viewVariant(id) {
  const v = currentVariants[id];
  if (!v) return;
  currentPattern = v.pattern;
  const modal = document.getElementById('modal');
  document.getElementById('modal-title').textContent = `方案 #${id + 1} ${v.params.label || ''}`;
  document.getElementById('modal-body').innerHTML = renderPattern(v.pattern);
  modal.classList.remove('hidden');
}

function selectVariant(id) {
  let pattern, title;
  if (id === 'direct') {
    if (!currentDirectPattern) return;
    pattern = currentDirectPattern;
    title = '原图对照 - 直接匹配';
  } else {
    const v = currentVariants[id];
    if (!v) return;
    pattern = v.pattern;
    title = `方案 #${id + 1} ${v.params.label || ''}`;
  }
  currentPattern = pattern;
  // Highlight selected card
  document.querySelectorAll('.variant-card').forEach(c => c.classList.remove('selected'));
  document.getElementById(`variant-${id}`).classList.add('selected');
  // Show inline preview below grid
  const container = document.getElementById('selected-preview-area');
  let html = '<div class="selected-preview">';
  html += '<div class="selected-preview-header">';
  html += `<h3>${title}</h3>`;
  html += '<button class="selected-preview-close" onclick="closeSelectedPreview()">&times;</button>';
  html += '</div>';
  html += renderPattern(pattern);
  html += '</div>';
  container.innerHTML = html;
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeSelectedPreview() {
  const container = document.getElementById('selected-preview-area');
  if (container) container.innerHTML = '';
  document.querySelectorAll('.variant-card').forEach(c => c.classList.remove('selected'));
}

function submitScores() {
  const history = getScoringHistory();
  let hasScore = false;
  for (const v of currentVariants) {
    const input = document.getElementById(`score-${v.id}`);
    const val = input.value.trim();
    if (val === '') continue;
    const score = parseInt(val);
    if (score >= 0 && score <= 10) {
      history.push({ params: v.params, score, timestamp: Date.now() });
      hasScore = true;
    }
  }
  if (!hasScore) { alert('请至少给一张图评分（0-10，0=最差，10=最好）'); return; }
  // Keep last 50 scores
  while (history.length > 50) history.shift();
  saveScoringHistory(history);
  alert('评分已保存！正在根据评分重新生成...');
  // Re-generate with bias
  if (currentImg) {
    const loading = document.getElementById('loading');
    const resultArea = document.getElementById('result-area');
    loading.classList.remove('hidden');
    resultArea.classList.add('hidden');
    document.getElementById('loading-text').textContent = '根据评分优化生成中...';
    setTimeout(() => {
      currentVariants = generateVariants(currentImg, resizedGridW, resizedGridH);
      resultArea.innerHTML = renderVariantGrid(currentVariants);
      resultArea.classList.remove('hidden');
      loading.classList.add('hidden');
    }, 100);
  }
}

// ========== Render Single Pattern ==========
function renderPattern(pattern) {
  const { grid, pixels, summary, gridW, gridH, overallSimilarity, edgeOverlap, params } = pattern;
  let html = '';
  if (overallSimilarity !== undefined) {
    const simPct = overallSimilarity.toFixed(1);
    const edgePct = (edgeOverlap || 0).toFixed(1);
    html += `<div style="display:flex;gap:10px;margin-bottom:16px;">`;
    html += `<div style="flex:1;background:#F5F5F7;padding:12px 14px;border-radius:12px;font-size:13px;text-align:center;color:#6E6E73;">整体相似度<br><strong style="font-size:22px;font-weight:600;color:#1D1D1F">${simPct}%</strong></div>`;
    html += `<div style="flex:1;background:#F5F5F7;padding:12px 14px;border-radius:12px;font-size:13px;text-align:center;color:#6E6E73;">轮廓相似度<br><strong style="font-size:22px;font-weight:600;color:#1D1D1F">${edgePct}%</strong></div>`;
    html += `</div>`;
  }
  if (params) {
    html += `<div class="variant-params" style="margin-bottom:10px;font-size:12px;">`;
    html += `尺寸: ${gridW}×${gridH} | 抖动=${(params.ditherStrength||1).toFixed(1)} 锐化=${(params.sharpness||0).toFixed(1)} 对比=${(params.contrast||1).toFixed(1)}`;
    html += `</div>`;
  }
  html += '<div class="pattern-wrapper"><div class="pattern-grid" style="grid-template-columns:repeat(' + gridW + ',22px)">';
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const c = grid[y][x];
      let bgColor, tc;
      if (pixels && pixels[y] && pixels[y][x]) {
        const p = pixels[y][x];
        bgColor = `rgb(${Math.round(p.r)},${Math.round(p.g)},${Math.round(p.b)})`;
        tc = textColorForRgb(p.r, p.g, p.b);
      } else {
        bgColor = c.hex;
        tc = textColorFor(c.hex);
      }
      html += `<div class="pattern-cell" style="background:${bgColor};color:${tc}" title="${c.name}(${c.code})">${c.code}</div>`;
    }
  }
  html += '</div></div>';
  html += '<div class="color-summary"><h3>颜色用量统计（共 ' + summary.reduce((s, c) => s + c.count, 0) + ' 颗）</h3><div class="color-list">';
  for (const c of summary) {
    html += `<div class="color-item"><div class="color-swatch" style="background:${c.hex}"></div><div class="color-info"><div class="color-code">${c.code} ${c.name}</div><div class="color-count">${c.count} 颗</div></div></div>`;
  }
  html += '</div></div>';
  html += '<div class="result-actions"><button class="btn-primary" onclick="saveToHistory()">保存到历史</button><button class="btn-primary" style="background:#27ae60" onclick="exportPattern()">导出图片</button></div>';
  return html;
}

// ========== Export Pattern as PNG ==========
function exportPattern() {
  if (!currentPattern) return;
  const { grid, pixels, summary, gridW, gridH } = currentPattern;
  // Dynamic cellSize: short edge of grid area >= 1280px
  const minEdge = Math.min(gridW, gridH);
  const cellSize = Math.max(28, Math.ceil(1280 / minEdge));
  const fontSize = Math.max(9, Math.round(cellSize * 0.35));
  const padding = Math.round(cellSize * 0.7);
  const cols = 4;
  const summaryRows = Math.ceil(summary.length / cols);
  const summaryFontSize = Math.max(11, Math.round(cellSize * 0.5));
  const titleFontSize = Math.max(14, Math.round(cellSize * 0.6));
  const swatchSize = Math.max(16, Math.round(cellSize * 0.55));
  const rowHeight = Math.max(32, Math.round(cellSize * 1.1));
  const canvasW = gridW * cellSize + padding * 2;
  const canvasH = gridH * cellSize + padding * 2 + summaryRows * rowHeight + padding * 3;
  const canvas = document.createElement('canvas');
  canvas.width = canvasW; canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvasW, canvasH);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const c = grid[y][x];
      const px = padding + x * cellSize, py = padding + y * cellSize;
      if (pixels && pixels[y] && pixels[y][x]) {
        const p = pixels[y][x];
        ctx.fillStyle = `rgb(${Math.round(p.r)},${Math.round(p.g)},${Math.round(p.b)})`;
      } else {
        ctx.fillStyle = c.hex;
      }
      ctx.fillRect(px, py, cellSize, cellSize);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.strokeRect(px, py, cellSize, cellSize);
      if (pixels && pixels[y] && pixels[y][x]) {
        const p = pixels[y][x];
        ctx.fillStyle = textColorForRgb(p.r, p.g, p.b);
      } else {
        ctx.fillStyle = textColorFor(c.hex);
      }
      ctx.font = `bold ${fontSize}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.code, px + cellSize / 2, py + cellSize / 2);
    }
  }
  const sy = padding + gridH * cellSize + padding;
  ctx.fillStyle = '#333'; ctx.font = `bold ${titleFontSize}px sans-serif`; ctx.textAlign = 'left';
  ctx.fillText('颜色用量（共' + summary.reduce((s, c) => s + c.count, 0) + '颗）', padding, sy);
  const colW = (canvasW - padding * 2) / cols;
  summary.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = padding + col * colW, cy = sy + padding + row * rowHeight;
    ctx.fillStyle = c.hex; ctx.fillRect(cx, cy, swatchSize, swatchSize);
    ctx.strokeStyle = '#ccc'; ctx.strokeRect(cx, cy, swatchSize, swatchSize);
    ctx.fillStyle = '#333'; ctx.font = `${summaryFontSize}px sans-serif`;
    ctx.fillText(`${c.code} ${c.name}: ${c.count}颗`, cx + swatchSize + 6, cy + swatchSize * 0.75);
  });
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `perler_${gridW}x${gridH}_${Date.now()}.png`;
    a.click(); URL.revokeObjectURL(url);
  });
}

// ========== Fly to History Animation ==========
function flyToHistoryAnimation(thumbnailSrc) {
  const saveBtn = document.querySelector('.result-actions .btn-primary');
  const historyTab = document.querySelector('[data-tab="tab-history"]');
  if (!saveBtn || !historyTab) return;

  const startRect = saveBtn.getBoundingClientRect();
  const endRect = historyTab.getBoundingClientRect();

  const img = document.createElement('img');
  img.src = thumbnailSrc;
  img.className = 'fly-thumbnail';
  img.style.left = startRect.left + 'px';
  img.style.top = startRect.top + 'px';
  img.style.width = '60px';
  img.style.height = 'auto';
  document.body.appendChild(img);

  const dx = endRect.left + endRect.width / 2 - startRect.left - 30;
  const dy = endRect.top + endRect.height / 2 - startRect.top - 30;

  img.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.3 - 80}px) scale(0.6)`, opacity: 0.8, offset: 0.4 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0.3 }
  ], {
    duration: 700,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: 'forwards'
  }).onfinish = () => {
    img.remove();
    historyTab.classList.add('pulse');
    setTimeout(() => historyTab.classList.remove('pulse'), 600);
  };
}

// ========== Save to History ==========
function saveToHistory() {
  if (!currentPattern) return;
  const thumb = patternToThumbnail(currentPattern);
  // 保存时去掉 pixels 数据以节省 localStorage 空间
  const { pixels, ...patternWithoutPixels } = currentPattern;
  const item = {
    id: generateId(), timestamp: Date.now(),
    title: '拼豆图纸 ' + formatDate(Date.now()),
    thumbnail: thumb, pattern: patternWithoutPixels,
    sourceImage: currentImageDataUrl
  };
  const list = getHistory(); list.unshift(item); saveHistory(list);
  flyToHistoryAnimation(thumb);
  renderHistoryList();
}

// ========== History CRUD ==========
function renderHistoryList() {
  const container = document.getElementById('history-list');
  const list = getHistory();
  if (list.length === 0) {
    container.innerHTML = '<p class="empty-hint">暂无历史记录</p>';
    return;
  }
  container.innerHTML = list.map(item => `
    <div class="masonry-item" data-id="${item.id}">
      <img src="${item.thumbnail}" alt="${item.title}">
      <div class="masonry-item-info">
        <div class="title">${item.title}</div>
        <div class="date">${formatDate(item.timestamp)}</div>
        <div class="masonry-item-actions">
          <button class="btn-outline" onclick="viewHistory('${item.id}')">查看</button>
          <button class="btn-outline" onclick="renameHistory('${item.id}')">重命名</button>
          <button class="btn-outline" style="color:var(--danger)" onclick="deleteHistory('${item.id}')">删除</button>
        </div>
      </div>
    </div>
  `).join('');
}

function viewHistory(id) {
  const item = getHistory().find(i => i.id === id);
  if (!item) return;
  currentPattern = item.pattern;
  const modal = document.getElementById('modal');
  document.getElementById('modal-title').textContent = item.title;
  document.getElementById('modal-body').innerHTML = renderPattern(item.pattern);
  modal.classList.remove('hidden');
}

function renameHistory(id) {
  const list = getHistory();
  const item = list.find(i => i.id === id);
  if (!item) return;
  const name = prompt('请输入新名称：', item.title);
  if (name && name.trim()) { item.title = name.trim(); saveHistory(list); renderHistoryList(); }
}

function deleteHistory(id) {
  if (!confirm('确定删除这条记录？')) return;
  saveHistory(getHistory().filter(i => i.id !== id)); renderHistoryList();
}

function clearHistory() {
  if (!confirm('确定清空所有历史记录？')) return;
  saveHistory([]); renderHistoryList();
}

// ========== Gallery ==========
function renderGalleryList() {
  const container = document.getElementById('gallery-list');
  const list = getGallery();
  if (list.length === 0) {
    container.innerHTML = '<p class="empty-hint">暂无作品，快去上传吧</p>';
    return;
  }
  container.innerHTML = list.map(item => `
    <div class="masonry-item" data-id="${item.id}">
      <img src="${item.image}" alt="${item.title}">
      <div class="masonry-item-info">
        <div class="title">${item.title}</div>
        <div class="date">${formatDate(item.timestamp)}</div>
        <div class="masonry-item-actions">
          <button class="btn-outline" onclick="viewGalleryItem('${item.id}')">查看</button>
          <button class="btn-outline" style="color:var(--danger)" onclick="deleteGalleryItem('${item.id}')">删除</button>
        </div>
      </div>
    </div>
  `).join('');
}

function viewGalleryItem(id) {
  const item = getGallery().find(i => i.id === id);
  if (!item) return;
  const modal = document.getElementById('modal');
  document.getElementById('modal-title').textContent = item.title;
  document.getElementById('modal-body').innerHTML = `<img src="${item.image}" alt="${item.title}">`;
  modal.classList.remove('hidden');
}

function deleteGalleryItem(id) {
  if (!confirm('确定删除这个作品？')) return;
  saveGallery(getGallery().filter(i => i.id !== id)); renderGalleryList();
}

function uploadGalleryWork(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const title = prompt('给作品起个名字吧：', '我的拼豆作品');
    if (!title) return;
    const item = { id: generateId(), timestamp: Date.now(), title: title.trim(), image: e.target.result };
    const list = getGallery(); list.unshift(item); saveGallery(list);
    renderGalleryList();
  };
  reader.readAsDataURL(file);
}

// ========== App Initialization ==========
document.addEventListener('DOMContentLoaded', () => {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const fileInput = document.getElementById('file-input');
  const uploadPlaceholder = document.getElementById('upload-placeholder');
  const previewArea = document.getElementById('preview-area');
  const previewImg = document.getElementById('preview-img');
  const resizeControls = document.getElementById('resize-controls');
  const btnPreviewResize = document.getElementById('btn-preview-resize');
  const resizePreview = document.getElementById('resize-preview');
  const resizeCanvas = document.getElementById('resize-canvas');
  const btnConfirmResize = document.getElementById('btn-confirm-resize');
  const loading = document.getElementById('loading');
  const resultArea = document.getElementById('result-area');
  const maxEdgeInput = document.getElementById('max-edge');
  const rightEmptyState = document.getElementById('right-empty-state');
  const galleryFileInput = document.getElementById('gallery-file-input');

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // File upload
  uploadPlaceholder.addEventListener('click', () => fileInput.click());
  uploadPlaceholder.addEventListener('dragover', (e) => {
    e.preventDefault(); uploadPlaceholder.classList.add('dragover');
  });
  uploadPlaceholder.addEventListener('dragleave', () => {
    uploadPlaceholder.classList.remove('dragover');
  });
  uploadPlaceholder.addEventListener('drop', (e) => {
    e.preventDefault(); uploadPlaceholder.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.match(/image\/(png|jpeg)/)) handleImageFile(file);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleImageFile(e.target.files[0]);
  });

  function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      currentImageDataUrl = e.target.result;
      previewImg.src = e.target.result;
      uploadPlaceholder.classList.add('hidden');
      previewArea.classList.remove('hidden');
      // Show original dimensions
      const tmpImg = new Image();
      tmpImg.onload = () => {
        document.getElementById('original-info').textContent = `原图尺寸：${tmpImg.naturalWidth} × ${tmpImg.naturalHeight} 像素`;
      };
      tmpImg.src = e.target.result;
      // Show resize controls
      resizeControls.classList.remove('hidden');
      resizePreview.classList.add('hidden');
      resultArea.classList.add('hidden');
      currentVariants = [];
      currentPattern = null;
      currentDirectPattern = null;
    };
    reader.readAsDataURL(file);
  }

  // Denoise slider value display
  document.getElementById('denoise-level').addEventListener('input', (e) => {
    document.getElementById('denoise-value').textContent = e.target.value;
  });

  // Resize preview (with optional denoise + edge dilation)
  btnPreviewResize.addEventListener('click', () => {
    if (!previewImg.src) return;
    const maxEdge = parseInt(maxEdgeInput.value) || 58;
    const denoiseLevel = parseInt(document.getElementById('denoise-level').value) || 0;
    const denoiseIterations = Math.round(denoiseLevel / 10);

    const tmpImg = new Image();
    tmpImg.onload = () => {
      const w = tmpImg.naturalWidth, h = tmpImg.naturalHeight;

      // Step 1: Apply denoise if needed
      let denoisedSource = tmpImg;
      if (denoiseIterations > 0) {
        const denoiseCanvas = document.createElement('canvas');
        denoiseCanvas.width = w; denoiseCanvas.height = h;
        const dCtx = denoiseCanvas.getContext('2d');
        dCtx.drawImage(tmpImg, 0, 0);
        for (let i = 0; i < denoiseIterations; i++) {
          bilateralFilter(denoiseCanvas, 3, 3, 30);
        }
        denoisedSource = denoiseCanvas;
      }

      // Save denoised source (for all cards)
      currentDenoisedDataUrl = (denoisedSource === tmpImg)
        ? currentImageDataUrl
        : denoisedSource.toDataURL('image/png');

      const scale = maxEdge / Math.max(w, h);
      resizedGridW = Math.round(w * scale);
      resizedGridH = Math.round(h * scale);

      // Step 2: Nearest-neighbor downsampling
      resizeCanvas.width = resizedGridW;
      resizeCanvas.height = resizedGridH;
      const ctx = resizeCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(denoisedSource, 0, 0, resizedGridW, resizedGridH);

      // Scale up for display
      resizeCanvas.style.width = Math.min(300, resizedGridW * 4) + 'px';
      const denoiseInfo = denoiseIterations > 0 ? `（平滑×${denoiseIterations}）` : '';
      document.getElementById('resize-info').textContent =
        `压缩后：${resizedGridW} × ${resizedGridH} 像素（共 ${resizedGridW * resizedGridH} 颗拼豆）${denoiseInfo}`;
      resizePreview.classList.remove('hidden');
      rightEmptyState.classList.add('hidden');
    };
    tmpImg.src = currentImageDataUrl;
  });

  // Confirm resize → directly generate
  btnConfirmResize.addEventListener('click', () => {
    if (!previewImg.src || resizedGridW === 0) return;
    loading.classList.remove('hidden');
    resultArea.classList.add('hidden');
    document.getElementById('loading-text').textContent =
      `生成 ${resizedGridW}×${resizedGridH} 的10种方案中...`;
    setTimeout(() => {
      const img = new Image();
      img.onload = () => {
        currentImg = img;
        // First card: denoise → compress → color match
        currentDirectPattern = imageToDirectPattern(img, resizedGridW, resizedGridH);
        // Cards 2-5: use original image (v1.1 behavior)
        const origImg = new Image();
        origImg.onload = () => {
          currentVariants = generateVariants(origImg, resizedGridW, resizedGridH);
          resultArea.innerHTML = renderVariantGrid(currentVariants);
          resultArea.classList.remove('hidden');
          loading.classList.add('hidden');
        };
        origImg.src = currentImageDataUrl;
      };
      img.src = currentDenoisedDataUrl || currentImageDataUrl;
    }, 100);
  });

  // Reupload — reset page only
  document.getElementById('btn-reupload').addEventListener('click', () => {
    resultArea.classList.add('hidden');
    resultArea.innerHTML = '';
    resizePreview.classList.add('hidden');
    rightEmptyState.classList.remove('hidden');
    resizeControls.classList.add('hidden');
    previewArea.classList.add('hidden');
    uploadPlaceholder.classList.remove('hidden');
    currentVariants = [];
    currentPattern = null;
    currentDirectPattern = null;
    currentDenoisedDataUrl = null;
    currentImg = null;
    currentImageDataUrl = null;
    resizedGridW = 0;
    resizedGridH = 0;
    fileInput.value = '';
  });

  // Gallery upload
  document.getElementById('btn-upload-work').addEventListener('click', () => galleryFileInput.click());
  galleryFileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) uploadGalleryWork(e.target.files[0]);
    e.target.value = '';
  });

  // Clear history
  document.getElementById('btn-clear-history').addEventListener('click', clearHistory);

  // Modal close
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal').classList.add('hidden');
  });
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  // Initial render
  renderHistoryList();
  renderGalleryList();
});
