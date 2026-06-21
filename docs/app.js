const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const PRESETS = {
  fujiClassic: { name: "经典负片感", mean: [137, 143, 130], std: [52, 49, 43], saturation: 0.84, warmth: -2, fade: 0.05 },
  fujiVelvia: { name: "鲜艳正片感", mean: [136, 148, 119], std: [72, 69, 66], saturation: 1.34, warmth: 2, fade: 0 },
  leicaCinema: { name: "徕卡电影感", mean: [139, 125, 116], std: [67, 59, 54], saturation: 0.96, warmth: 8, fade: 0.015 },
  portraWarm: { name: "暖调人像", mean: [171, 151, 137], std: [51, 46, 43], saturation: 0.9, warmth: 10, fade: 0.04 },
  japanAir: { name: "日系空气感", mean: [184, 190, 181], std: [43, 40, 39], saturation: 0.76, warmth: 1, fade: 0.08 },
  noir: { name: "黑白纪实", mean: [129, 129, 129], std: [68, 68, 68], saturation: 0, warmth: 0, fade: 0.015 }
};

const state = {
  reference: null,
  source: null,
  preset: null,
  styledFull: null,
  strength: 0.72,
  skinProtect: true,
  exposure: 0,
  contrast: 0,
  warmth: 0,
  smooth: 0,
  faceLight: 0,
  detail: 0,
  wow: true,
  recommendedPreset: null,
  composition: "original",
  focus: { x: 0.5, y: 0.5 },
  crop: null,
  rotation: 0,
  quarterTurn: 0
};

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url, file });
    image.onerror = reject;
    image.src = url;
  });
}

async function handleFile(input, kind) {
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("请选择照片文件");
  const data = await loadImageFile(file);
  if (kind === "reference") clearPreset(false);
  state[kind] = data;
  const isReference = kind === "reference";
  const card = $(isReference ? "#referenceDrop" : "#sourceDrop");
  const preview = $(isReference ? "#referencePreview" : "#sourcePreview");
  preview.src = data.url;
  card.classList.add("loaded");
  if (kind === "source" && !state.reference && !state.preset) recommendScene(data.image);
  updateReadyState();
}

function recommendScene(image) {
  const stats = sampleStats(image);
  const [r, g, b] = stats.mean;
  let key = "fujiClassic";
  let scene = "旅行与自然画面";
  if (stats.saturation < 0.12) {
    key = "noir"; scene = "低饱和建筑或纪实场景";
  } else if (g > r + 8 && g > b + 5) {
    key = "fujiVelvia"; scene = "森林、山谷或绿色风景";
  } else if (r > b + 18 && r > g + 5) {
    key = "portraWarm"; scene = "食品、咖啡或暖光场景";
  } else if (b > r + 8) {
    key = "fujiClassic"; scene = "海景、天空或清冷风景";
  } else if (stats.luminance < 105) {
    key = "leicaCinema"; scene = "夜景或低调光影";
  }
  state.recommendedPreset = key;
  $$(".preset-card").forEach(card => card.classList.toggle("recommended", card.dataset.preset === key));
  $("#sceneAdviceText").textContent = `识别为${scene}，建议使用“${PRESETS[key].name}”`;
  $("#sceneAdvice").classList.remove("hidden");
}

function selectPreset(key, shouldTransform = false) {
  state.preset = { key, ...PRESETS[key] };
  state.reference = null;
  $("#referenceInput").value = "";
  $("#referencePreview").removeAttribute("src");
  $("#referenceDrop").classList.remove("loaded");
  $$(".preset-card").forEach(card => card.classList.toggle("selected", card.dataset.preset === key));
  $("#presetStatus").classList.remove("hidden");
  $("#presetStatusName").textContent = `已选择：${PRESETS[key].name}`;
  updateReadyState();
  if (shouldTransform && state.source) {
    transformImage();
    renderAll();
  }
}

function clearPreset(update = true) {
  state.preset = null;
  $$(".preset-card").forEach(card => card.classList.remove("selected"));
  $("#presetStatus").classList.add("hidden");
  if (update) updateReadyState();
}

function updateReadyState() {
  const ready = Boolean(state.source && (state.reference || state.preset));
  $("#matchButton").disabled = !ready;
  $("#matchHint").textContent = ready
    ? "照片已就绪，处理过程不会离开你的装置"
    : state.preset ? "现在只需上传自己的照片" : "选择一个范本或加入参考照片";
}

function sampleStats(image, max = 180) {
  const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  let lumSum = 0;
  let satSum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
    sums[0] += r; sums[1] += g; sums[2] += b;
    squares[0] += r * r; squares[1] += g * g; squares[2] += b * b;
    lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    satSum += maxC ? (maxC - minC) / maxC : 0;
    count++;
  }
  const mean = sums.map(value => value / count);
  const std = squares.map((value, index) => Math.sqrt(Math.max(1, value / count - mean[index] * mean[index])));
  return { mean, std, luminance: lumSum / count, saturation: satSum / count };
}

function isSkinPixel(r, g, b) {
  return r > 70 && g > 35 && b > 20 && r > g && r > b &&
    Math.max(r, g, b) - Math.min(r, g, b) > 15 && Math.abs(r - g) > 8;
}

function makeBlurData(canvas, radius = 2) {
  const blurred = document.createElement("canvas");
  blurred.width = canvas.width;
  blurred.height = canvas.height;
  const ctx = blurred.getContext("2d", { willReadFrequently: true });
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, blurred.width, blurred.height).data;
}

function transformImage() {
  const source = state.source.image;
  const sourceStats = sampleStats(source);
  const target = state.preset
    ? { mean: state.preset.mean, std: state.preset.std }
    : sampleStats(state.reference.image);
  const full = document.createElement("canvas");
  full.width = source.naturalWidth;
  full.height = source.naturalHeight;
  const ctx = full.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, full.width, full.height);
  const data = imageData.data;
  const needsTexture = state.smooth > 0 || state.detail > 0 || state.wow;
  const blurData = needsTexture ? makeBlurData(full, state.wow ? 3.2 : 2.2) : null;
  const amount = state.strength;
  const gains = sourceStats.std.map((value, index) => clamp(target.std[index] / value, 0.62, 1.65));
  const presetSaturation = state.preset?.saturation ?? 1;
  const presetWarmth = state.preset?.warmth ?? 0;
  const fade = state.preset?.fade ?? 0;

  for (let i = 0; i < data.length; i += 4) {
    const original = [data[i], data[i + 1], data[i + 2]];
    const skin = isSkinPixel(original[0], original[1], original[2]);
    const smoothMix = skin ? state.smooth / 100 : 0;
    const base = original.map((value, channel) => {
      if (!blurData) return value;
      const blurred = blurData[i + channel];
      const smoothed = value * (1 - smoothMix) + blurred * smoothMix;
      const localClarity = state.wow ? 0.26 : 0;
      return smoothed + (value - blurred) * (state.detail / 28 + localClarity);
    });
    const localAmount = skin && state.skinProtect ? amount * 0.3 : amount;
    let mapped = base.map((value, channel) => {
      const matched = (value - sourceStats.mean[channel]) * gains[channel] + target.mean[channel];
      return value * (1 - localAmount) + matched * localAmount;
    });
    const luminance = 0.2126 * mapped[0] + 0.7152 * mapped[1] + 0.0722 * mapped[2];
    const wowSaturation = state.wow ? 1.16 : 1;
    const effectiveSaturation = skin && state.skinProtect
      ? Math.min(1.04, presetSaturation * wowSaturation)
      : presetSaturation * wowSaturation;
    mapped = mapped.map(value => luminance + (value - luminance) * effectiveSaturation);
    mapped = mapped.map(value => value * (1 - fade) + 20 * fade);
    mapped[0] += (state.warmth + presetWarmth) * 0.55;
    mapped[2] -= (state.warmth + presetWarmth) * 0.55;
    if (state.wow && !skin) {
      const highlight = clamp((luminance - 105) / 120, 0, 1);
      mapped[0] += 10 * highlight;
      mapped[1] += 4 * highlight + 3 * (1 - highlight);
      mapped[2] += 5 * (1 - highlight) - 7 * highlight;
    }

    for (let channel = 0; channel < 3; channel++) {
      let value = mapped[channel] + state.exposure * 1.25;
      if (skin) value += state.faceLight * 0.75;
      const effectiveContrast = state.contrast + (state.wow ? 10 : 0);
      value = (value - 127.5) * (1 + effectiveContrast / 100) + 127.5;
      if (state.wow && value > 225) value = 225 + (value - 225) * 0.52;
      if (state.wow && value < 18) value = 18 + (value - 18) * 0.72;
      data[i + channel] = clamp(value, 0, 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  state.styledFull = full;
  state.focus = findFocus(source);
}

function findFocus(image) {
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  let sumX = 0, sumY = 0, total = 0;
  for (let y = 1; y < size - 1; y += 2) {
    for (let x = 1; x < size - 1; x += 2) {
      const i = (y * size + x) * 4;
      const right = (y * size + x + 1) * 4;
      const below = ((y + 1) * size + x) * 4;
      const edge = Math.abs(data[i] - data[right]) + Math.abs(data[i + 1] - data[right + 1]) +
        Math.abs(data[i + 2] - data[right + 2]) + Math.abs(data[i] - data[below]) +
        Math.abs(data[i + 1] - data[below + 1]) + Math.abs(data[i + 2] - data[below + 2]);
      const skin = isSkinPixel(data[i], data[i + 1], data[i + 2]) ? 260 : 0;
      const weight = edge + skin + 8;
      sumX += x * weight;
      sumY += y * weight;
      total += weight;
    }
  }
  return {
    x: clamp(sumX / total / size, 0.22, 0.78),
    y: clamp(sumY / total / size, 0.22, 0.78)
  };
}

function estimateHorizonAngle(image) {
  const width = 128;
  const height = Math.max(64, Math.round(width * image.naturalHeight / image.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = pixels[i * 4] * 0.2126 + pixels[i * 4 + 1] * 0.7152 + pixels[i * 4 + 2] * 0.0722;
  }
  let bestAngle = 0;
  let bestScore = -Infinity;
  for (let angle = -8; angle <= 8; angle += 0.5) {
    const slope = Math.tan(angle * Math.PI / 180);
    const bins = new Float32Array(height * 3);
    for (let x = 2; x < width - 2; x += 2) {
      for (let y = 2; y < height - 2; y += 2) {
        const edge = Math.abs(gray[(y + 1) * width + x] - gray[(y - 1) * width + x]);
        if (edge < 22) continue;
        const bin = Math.round(y - slope * x + height);
        if (bin >= 0 && bin < bins.length) bins[bin] += edge;
      }
    }
    let score = 0;
    for (const value of bins) score = Math.max(score, value);
    score -= Math.abs(angle) * 20;
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return clamp(-bestAngle, -8, 8);
}

function cropForMode(mode, width, height) {
  if (mode === "original") return { x: 0, y: 0, w: width, h: height };
  const ratio = mode === "portrait" ? 4 / 5 : 16 / 9;
  let w = width, h = height;
  if (width / height > ratio) w = height * ratio;
  else h = width / ratio;
  let x = state.focus.x * width - w / 2;
  let y = state.focus.y * height - h / 2;
  x = clamp(x, 0, width - w);
  y = clamp(y, 0, height - h);
  return { x, y, w, h };
}

function totalRotation() {
  return state.rotation + state.quarterTurn;
}

function paintCanvas(canvas, image, crop, fill = true, rotation = 0) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
  canvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
  const ctx = canvas.getContext("2d");
  drawTransformed(ctx, canvas.width, canvas.height, image, crop, fill, rotation);
}

function drawTransformed(ctx, width, height, image, crop, fill, rotation) {
  ctx.save();
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);
  const sourceRatio = crop.w / crop.h;
  const targetRatio = width / height;
  let drawWidth, drawHeight;
  if ((fill && sourceRatio > targetRatio) || (!fill && sourceRatio < targetRatio)) {
    drawHeight = height;
    drawWidth = drawHeight * sourceRatio;
  } else {
    drawWidth = width;
    drawHeight = drawWidth / sourceRatio;
  }
  const radians = rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const zoom = Math.max(
    (cos * drawWidth + sin * drawHeight) / drawWidth,
    (sin * drawWidth + cos * drawHeight) / drawHeight
  );
  ctx.translate(width / 2, height / 2);
  ctx.rotate(radians);
  ctx.drawImage(
    image,
    crop.x, crop.y, crop.w, crop.h,
    -drawWidth * zoom / 2, -drawHeight * zoom / 2,
    drawWidth * zoom, drawHeight * zoom
  );
  ctx.restore();
}

function renderAll() {
  if (!state.styledFull) return;
  const width = state.source.image.naturalWidth;
  const height = state.source.image.naturalHeight;
  state.crop = cropForMode(state.composition, width, height);
  paintCanvas($("#originalCanvas"), state.source.image, state.crop, false, totalRotation());
  paintCanvas($("#resultCanvas"), state.styledFull, state.crop, false, totalRotation());
  $$(".composition-card").forEach(card => {
    const mode = card.dataset.mode;
    const crop = cropForMode(mode, width, height);
    paintCanvas(card.querySelector("canvas"), state.styledFull, crop, true, totalRotation());
    card.classList.toggle("selected", mode === state.composition);
  });
  const editLabel = state.composition === "original" && totalRotation() === 0
    ? "完整画面"
    : "智慧重构并维持原尺寸";
  $("#exportMeta").textContent = `输出 ${width.toLocaleString()} × ${height.toLocaleString()} px · ${editLabel}`;
}

async function processPhotos() {
  const overlay = $("#processingOverlay");
  const bar = $("#progressBar");
  overlay.classList.remove("hidden");
  bar.style.width = "18%";
  await wait(220);
  $("#processingTitle").textContent = "正在分析光影";
  $("#processingDetail").textContent = "比对曝光、对比、色温与阴影…";
  bar.style.width = "46%";
  await wait(240);
  transformImage();
  bar.style.width = "78%";
  $("#processingTitle").textContent = "正在寻找视觉重心";
  $("#processingDetail").textContent = "准备适合这张照片的构图选择…";
  await wait(260);
  renderAll();
  bar.style.width = "100%";
  await wait(220);
  overlay.classList.add("hidden");
  $("#studio").classList.remove("hidden");
  $("#hero").classList.add("hidden");
  $("#presetSection").classList.add("hidden");
  $(".upload-grid").classList.add("hidden");
  $(".action-zone").classList.add("hidden");
  $("#studio").scrollIntoView({ behavior: "smooth" });
}

function exportImage() {
  const source = state.source.image;
  const out = document.createElement("canvas");
  out.width = source.naturalWidth;
  out.height = source.naturalHeight;
  const ctx = out.getContext("2d");
  drawTransformed(ctx, out.width, out.height, state.styledFull, state.crop, true, totalRotation());
  const mime = $("#exportFormat").value;
  const extension = mime === "image/png" ? "png" : "jpg";
  out.toBlob(blob => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `LumaMatch-${Date.now()}.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast(`已导出 ${out.width} × ${out.height} px`);
  }, mime, 0.96);
}

function updateControl(name, value) {
  state[name] = Number(value);
  const slider = $(`#${name}Slider`);
  const output = $(`#${name}Value`);
  if (slider) slider.value = value;
  if (output) output.textContent = Number(value) > 0 ? `+${value}` : String(value);
}

function autoRetouch() {
  const stats = sampleStats(state.source.image);
  updateControl("exposure", Math.round(clamp((145 - stats.luminance) / 5.5, -14, 14)));
  updateControl("contrast", Math.round(clamp(16 - stats.std.reduce((a, b) => a + b, 0) / 11, -5, 12)));
  updateControl("smooth", 24);
  updateControl("faceLight", 10);
  updateControl("detail", 12);
  transformImage();
  renderAll();
  showToast("已套用 AI 推荐修图");
}

function autoStraighten() {
  const angle = estimateHorizonAngle(state.source.image);
  state.rotation = angle;
  $("#rotationSlider").value = angle.toFixed(1);
  $("#rotationValue").textContent = `${angle.toFixed(1)}°`;
  renderAll();
  showToast(Math.abs(angle) < 0.3 ? "画面已经接近水平" : `已校正 ${angle.toFixed(1)}°`);
}

function applyPrompt() {
  const prompt = $("#editPrompt").value.trim();
  if (!prompt) return showToast("先告诉我你想要的感觉");
  const actions = [];
  let presetKey = null;
  if (/富士|经典负片/.test(prompt)) presetKey = "fujiClassic";
  if (/鲜艳|正片|风景浓郁/.test(prompt)) presetKey = "fujiVelvia";
  if (/徕卡|电影感|电影色/.test(prompt)) presetKey = "leicaCinema";
  if (/柯达|portra|奶油|胶片人像/i.test(prompt)) presetKey = "portraWarm";
  if (/日系|空气感|清新/.test(prompt)) presetKey = "japanAir";
  if (/黑白|单色/.test(prompt)) presetKey = "noir";
  if (presetKey) {
    selectPreset(presetKey, false);
    actions.push(PRESETS[presetKey].name);
  }
  if (/亮一点|更亮|通透|明亮/.test(prompt)) { updateControl("exposure", 12); actions.push("提高明暗"); }
  if (/暗一点|压暗|低调|情绪感/.test(prompt)) { updateControl("exposure", -10); actions.push("压低曝光"); }
  if (/暖一点|温暖|夕阳|暖色/.test(prompt)) { updateControl("warmth", 16); actions.push("增加暖调"); }
  if (/冷一点|清冷|冷色|蓝调/.test(prompt)) { updateControl("warmth", -16); actions.push("增加冷调"); }
  if (/高对比|对比强|硬朗/.test(prompt)) { updateControl("contrast", 16); actions.push("加强对比"); }
  if (/柔和|柔一点|低对比/.test(prompt)) { updateControl("contrast", -10); actions.push("柔化对比"); }
  if (/磨皮|皮肤细腻|皮肤柔/.test(prompt)) { updateControl("smooth", 30); actions.push("自然磨皮"); }
  if (/人物亮|脸亮|提亮人像/.test(prompt)) { updateControl("faceLight", 14); actions.push("人物提亮"); }
  if (/清晰|细节|锐利/.test(prompt)) { updateControl("detail", 16); actions.push("增强细节"); }
  if (/肤色自然|保护肤色|不要偏色/.test(prompt)) {
    state.skinProtect = true;
    $("#skinProtect").checked = true;
    actions.push("保护肤色");
  }
  if (/水平|拉直|地平线/.test(prompt)) {
    autoStraighten();
    actions.push("水平校正");
  }
  if (!actions.length) {
    autoRetouch();
    actions.push("AI 推荐明暗与人像修图");
  } else {
    transformImage();
    renderAll();
  }
  $("#promptResult").textContent = `已理解：${actions.join("、")}`;
  $("#promptResult").classList.remove("hidden");
  showToast("已按照描述完成修图");
}

function setCompare(value) {
  const percent = clamp(value, 0, 100);
  $("#compareSlider").value = percent;
  $("#originalLayer").style.width = `${percent}%`;
  $("#compareLine").style.left = `${percent}%`;
}

function updateCompareFromPointer(event) {
  const rect = $("#resultStage").getBoundingClientRect();
  setCompare((event.clientX - rect.left) / rect.width * 100);
}

function resetApp() { location.reload(); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

$("#referenceInput").addEventListener("change", event => handleFile(event.target, "reference"));
$("#sourceInput").addEventListener("change", event => handleFile(event.target, "source"));
$("#matchButton").addEventListener("click", processPhotos);
$("#restartButton").addEventListener("click", resetApp);
$("#exportButton").addEventListener("click", exportImage);
$("#clearPreset").addEventListener("click", () => clearPreset());
$$(".preset-card").forEach(card => card.addEventListener("click", () => selectPreset(card.dataset.preset)));

$("#compareSlider").addEventListener("input", event => setCompare(event.target.value));
let compareDragging = false;
$("#resultStage").addEventListener("pointerdown", event => {
  compareDragging = true;
  $("#resultStage").setPointerCapture?.(event.pointerId);
  updateCompareFromPointer(event);
});
$("#resultStage").addEventListener("pointermove", event => {
  if (compareDragging) updateCompareFromPointer(event);
});
$("#resultStage").addEventListener("pointerup", event => {
  compareDragging = false;
  $("#resultStage").releasePointerCapture?.(event.pointerId);
});
$("#resultStage").addEventListener("pointercancel", () => { compareDragging = false; });

$("#strengthSlider").addEventListener("input", event => {
  $("#strengthValue").textContent = `${event.target.value}%`;
});
$("#strengthSlider").addEventListener("change", event => {
  state.strength = event.target.value / 100;
  transformImage();
  renderAll();
});
$("#skinProtect").addEventListener("change", event => {
  state.skinProtect = event.target.checked;
  transformImage();
  renderAll();
});
$("#wowMode").addEventListener("change", event => {
  state.wow = event.target.checked;
  transformImage();
  renderAll();
  showToast(state.wow ? "已开启惊艳增强" : "已切换为自然效果");
});
$("#useRecommendation").addEventListener("click", () => {
  if (!state.recommendedPreset) return;
  selectPreset(state.recommendedPreset);
  $("#sceneAdvice").classList.add("hidden");
  showToast(`已采用“${PRESETS[state.recommendedPreset].name}”`);
});
["exposure", "contrast", "warmth", "smooth", "faceLight", "detail"].forEach(name => {
  const slider = $(`#${name}Slider`);
  const output = $(`#${name}Value`);
  slider.addEventListener("input", event => {
    output.textContent = event.target.value > 0 ? `+${event.target.value}` : event.target.value;
  });
  slider.addEventListener("change", event => {
    state[name] = Number(event.target.value);
    transformImage();
    renderAll();
  });
});
$("#autoRetouchButton").addEventListener("click", autoRetouch);

$$(".composition-card").forEach(card => card.addEventListener("click", () => {
  state.composition = card.dataset.mode;
  renderAll();
}));
$("#rotationSlider").addEventListener("input", event => {
  state.rotation = Number(event.target.value);
  $("#rotationValue").textContent = `${state.rotation.toFixed(1)}°`;
  renderAll();
});
$("#rotateLeftButton").addEventListener("click", () => {
  state.quarterTurn = (state.quarterTurn - 90) % 360;
  renderAll();
});
$("#rotateRightButton").addEventListener("click", () => {
  state.quarterTurn = (state.quarterTurn + 90) % 360;
  renderAll();
});
$("#autoStraightenButton").addEventListener("click", autoStraighten);

$("#applyPromptButton").addEventListener("click", applyPrompt);
$("#editPrompt").addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") applyPrompt();
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
$("#voiceButton").addEventListener("click", () => {
  if (!SpeechRecognition) return showToast("此浏览器暂不支持语音识别，可直接输入文字");
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  $("#voiceButton").classList.add("listening");
  showToast("正在聆听…");
  recognition.onresult = event => {
    $("#editPrompt").value = event.results[0][0].transcript;
    applyPrompt();
  };
  recognition.onerror = () => showToast("没有听清楚，请再试一次");
  recognition.onend = () => $("#voiceButton").classList.remove("listening");
  recognition.start();
});
$("#voiceButton").addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") $("#voiceButton").click();
});

window.addEventListener("resize", () => { if (state.styledFull) renderAll(); });
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

let installPrompt = null;
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
});
$("#installButton").addEventListener("click", async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    return;
  }
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  showToast(isIOS ? "请点 Safari 的分享按钮，再选“加入主画面”" : "请从浏览器选单选择“安装应用程序”");
});
