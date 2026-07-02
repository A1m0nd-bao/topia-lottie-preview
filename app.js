const gallery = document.querySelector("#gallery");
const quickRail = document.querySelector("#quickRail");
const sidebar = document.querySelector(".sidebar");
const empty = document.querySelector("#empty");
const count = document.querySelector("#count");
const search = document.querySelector("#search");
const category = document.querySelector("#category");
const speed = document.querySelector("#speed");
const speedLabel = document.querySelector("#speedLabel");
const previewBg = document.querySelector("#previewBg");
const previewBgLabel = document.querySelector("#previewBgLabel");
const autoplay = document.querySelector("#autoplay");
const loop = document.querySelector("#loop");
const refresh = document.querySelector("#refresh");
const fileInput = document.querySelector("#fileInput");
const dropzone = document.querySelector("#dropzone");
const template = document.querySelector("#motionCard");
const quickTemplate = document.querySelector("#quickCard");
const detailDialog = document.querySelector("#detailDialog");
const detailTitle = document.querySelector("#detailTitle");
const detailPath = document.querySelector("#detailPath");
const detailPlayer = document.querySelector("#detailPlayer");
const detailClose = document.querySelector("#detailClose");
const detailPlay = document.querySelector("#detailPlay");
const detailPause = document.querySelector("#detailPause");
const detailSpeed = document.querySelector("#detailSpeed");
const detailSpeedLabel = document.querySelector("#detailSpeedLabel");
const detailLoop = document.querySelector("#detailLoop");
const detailPreviewBg = document.querySelector("#detailPreviewBg");
const detailPreviewBgLabel = document.querySelector("#detailPreviewBgLabel");
const detailResolution = document.querySelector("#detailResolution");
const detailTags = document.querySelector("#detailTags");
const detailTimeline = document.querySelector("#detailTimeline");
const detailCurrentFrame = document.querySelector("#detailCurrentFrame");
const detailTotalFrames = document.querySelector("#detailTotalFrames");
const detailCurrentTime = document.querySelector("#detailCurrentTime");
const detailTotalDuration = document.querySelector("#detailTotalDuration");
const detailCopy = document.querySelector("#detailCopy");
const detailOpen = document.querySelector("#detailOpen");
const detailDownload = document.querySelector("#detailDownload");

let motions = [];
let visibleMotions = [];
let activeMotion = null;
let activeMotionInfo = null;
let detailAnimationItem = null;
let timelineRaf = 0;
const motionInfoCache = new Map();
const previewBackgroundKey = "lottie-preview-bg";
const defaultPreviewBackground = "#0a0c10";
const lazyPlayerObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(handlePlayerVisibility, {
        root: null,
        rootMargin: "360px",
        threshold: 0.01,
      })
    : null;

if (window.matchMedia("(max-width: 820px)").matches) {
  sidebar.removeAttribute("open");
}

applyPreviewBackground(localStorage.getItem(previewBackgroundKey) || defaultPreviewBackground, {
  persist: false,
});

async function loadManifest() {
  try {
    const response = await fetch(`./manifest.json?time=${Date.now()}`);
    if (!response.ok) throw new Error("manifest not found");
    const data = await response.json();
    motions = Array.isArray(data.items) ? data.items : [];
  } catch {
    motions = [];
  }

  populateCategories();
  render();
}

function populateCategories() {
  const selected = category.value || "all";
  const categories = [...new Set(motions.map((item) => item.category || "未分类"))].sort();
  category.innerHTML = '<option value="all">全部分类</option>';

  for (const item of categories) {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    category.append(option);
  }

  category.value = categories.includes(selected) ? selected : "all";
}

function render() {
  const query = search.value.trim().toLowerCase();
  const selectedCategory = category.value;

  visibleMotions = motions.filter((item) => {
    const haystack = [item.name, item.file, item.category, ...(item.tags || [])]
      .join(" ")
      .toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  lazyPlayerObserver?.disconnect();
  gallery.replaceChildren();
  quickRail.replaceChildren();
  count.textContent = String(visibleMotions.length);
  empty.hidden = visibleMotions.length > 0;

  for (const motion of visibleMotions) {
    gallery.append(createCard(motion));
    quickRail.append(createQuickCard(motion));
  }

  syncPlayers();
}

function createQuickCard(motion) {
  const node = quickTemplate.content.firstElementChild.cloneNode(true);
  const player = node.querySelector("lottie-player");
  const label = node.querySelector("span");

  setupPreviewPlayer(player, motion.file);
  label.textContent = motion.name || filenameToName(motion.file);
  node.title = `${label.textContent} - ${motion.category || "未分类"}`;
  node.addEventListener("click", () => openDetail(motion));

  return node;
}

function createCard(motion) {
  const node = template.content.firstElementChild.cloneNode(true);
  const player = node.querySelector("lottie-player");
  const title = node.querySelector("h2");
  const path = node.querySelector(".path");
  const resolution = node.querySelector(".resolution");
  const badge = node.querySelector(".badge");
  const tags = node.querySelector(".tags");
  const openLink = node.querySelector("a");
  const downloadLink = node.querySelector(".download-link");

  setupPreviewPlayer(player, motion.file);

  title.textContent = motion.name || filenameToName(motion.file);
  path.textContent = motion.file;
  path.title = motion.file;
  resolution.textContent = "分辨率 --";
  badge.textContent = motion.category || "未分类";
  openLink.href = motion.file;
  downloadLink.href = motion.file;
  downloadLink.download = getDownloadName(motion);

  for (const tag of motion.tags || []) {
    const tagNode = document.createElement("span");
    tagNode.textContent = tag;
    tags.append(tagNode);
  }

  node.addEventListener("click", async (event) => {
    const action = event.target.dataset.action;
    if (!action && event.target.closest("a")) return;
    if (!action) {
      openDetail(motion);
      return;
    }

    if (action === "play") {
      loadPreviewPlayer(player);
      player.play();
    }
    if (action === "pause") player.pause();
    if (action === "detail") openDetail(motion);
    if (action === "copy") {
      await navigator.clipboard.writeText(motion.file);
      event.target.textContent = "已复制";
      window.setTimeout(() => {
        event.target.textContent = "复制路径";
      }, 1100);
    }
  });

  return node;
}

function syncPlayers() {
  const players = document.querySelectorAll(".gallery lottie-player, .quick-rail lottie-player");
  for (const player of players) {
    syncPreviewPlayer(player);
  }
}

function setupPreviewPlayer(player, file) {
  player.dataset.src = file;
  player.dataset.loaded = "false";
  player.dataset.visible = "false";
  player.removeAttribute("src");
  player.removeAttribute("autoplay");
  player.setAttribute("loading", "lazy");
  player.setSpeed?.(Number(speed.value));
  player.toggleAttribute("loop", loop.checked);

  if (lazyPlayerObserver) {
    lazyPlayerObserver.observe(player);
    return;
  }

  player.dataset.visible = "true";
  loadPreviewPlayer(player);
  syncPreviewPlayer(player);
  updateVisibleCardResolution(player);
}

function handlePlayerVisibility(entries) {
  for (const entry of entries) {
    const player = entry.target;
    player.dataset.visible = entry.isIntersecting ? "true" : "false";

    if (entry.isIntersecting) {
      loadPreviewPlayer(player);
      syncPreviewPlayer(player);
      updateVisibleCardResolution(player);
    } else {
      player.pause?.();
    }
  }
}

function loadPreviewPlayer(player) {
  if (player.dataset.loaded === "true") return;
  const src = player.dataset.src;
  if (!src) return;

  player.setAttribute("src", src);
  player.dataset.loaded = "true";
}

function syncPreviewPlayer(player) {
  if (player.dataset.loaded !== "true" && autoplay.checked && player.dataset.visible === "true") {
    loadPreviewPlayer(player);
  }

  if (player.dataset.loaded === "true") {
    player.setSpeed(Number(speed.value));
    player.toggleAttribute("loop", loop.checked);
  }

  const shouldPlay = autoplay.checked && player.dataset.visible === "true";
  if (shouldPlay) player.play?.();
  if (!shouldPlay) player.pause?.();
}

function updateVisibleCardResolution(player) {
  const resolution = player.closest(".motion-card")?.querySelector(".resolution");
  if (!resolution || resolution.dataset.loaded === "true") return;
  resolution.dataset.loaded = "true";
  updateResolution(player.dataset.src, resolution);
}

async function openDetail(motion) {
  activeMotion = motion;
  const title = motion.name || filenameToName(motion.file);
  detailTitle.textContent = title;
  detailPath.textContent = motion.file;
  detailPath.title = motion.file;
  stopTimelineLoop();
  resetTimeline();
  detailResolution.textContent = "--";
  detailAnimationItem = null;
  detailPlayer.pause();
  detailPlayer.removeAttribute("src");
  detailPlayer.setSpeed(Number(detailSpeed.value));
  detailPlayer.toggleAttribute("loop", detailLoop.checked);
  detailOpen.href = motion.file;
  detailDownload.href = motion.file;
  detailDownload.download = getDownloadName(motion);
  detailTags.replaceChildren();

  const tags = motion.tags?.length ? motion.tags : [motion.category || "未分类"];
  for (const tag of tags) {
    const node = document.createElement("span");
    node.textContent = tag;
    detailTags.append(node);
  }

  detailDialog.showModal();
  updateDetailInfo(motion.file);
  await nextFrame();
  await loadDetailAnimation(motion.file);
  detailPlayer.play();
  startTimelineLoop();
}

function syncDetailPlayer() {
  detailSpeedLabel.textContent = `${detailSpeed.value}x`;
  detailPlayer.setSpeed(Number(detailSpeed.value));
  detailPlayer.toggleAttribute("loop", detailLoop.checked);
}

function applyPreviewBackground(value, options = {}) {
  const color = normalizeHexColor(value) || defaultPreviewBackground;
  const label = color.toUpperCase();
  document.documentElement.style.setProperty("--preview-bg", color);
  previewBg.value = color;
  detailPreviewBg.value = color;
  previewBgLabel.textContent = label;
  detailPreviewBgLabel.textContent = label;

  if (options.persist !== false) {
    localStorage.setItem(previewBackgroundKey, color);
  }
}

function normalizeHexColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toLowerCase();
  }
  return "";
}

async function loadDetailAnimation(file) {
  detailPlayer.setAttribute("src", file);

  if (typeof detailPlayer.load === "function") {
    try {
      await detailPlayer.load(file);
      await captureDetailAnimationItem();
      return;
    } catch {
      detailPlayer.setAttribute("src", file);
    }
  }

  await nextFrame();
  await captureDetailAnimationItem();
}

async function captureDetailAnimationItem() {
  if (typeof detailPlayer.getLottie !== "function") {
    detailAnimationItem = null;
    return;
  }

  try {
    detailAnimationItem = await detailPlayer.getLottie();
  } catch {
    detailAnimationItem = null;
  }
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

async function updateDetailInfo(file) {
  try {
    const info = await getMotionInfo(file);
    if (activeMotion?.file !== file) return;
    applyMotionInfo(info);
    detailResolution.textContent = formatResolution(info);
  } catch {
    if (activeMotion?.file !== file) return;
    resetTimeline("未知");
    detailResolution.textContent = "未知";
  }
}

async function updateResolution(file, node) {
  try {
    const info = await getMotionInfo(file);
    node.textContent = `分辨率 ${formatResolution(info)}`;
  } catch {
    node.textContent = "分辨率 未知";
  }
}

async function getMotionInfo(file) {
  if (motionInfoCache.has(file)) return motionInfoCache.get(file);

  const response = await fetch(file);
  if (!response.ok) throw new Error("Unable to read lottie json");
  const data = await response.json();
  const frameRate = Number(data.fr) || 0;
  const inPoint = Number(data.ip) || 0;
  const outPoint = Number(data.op) || 0;
  const width = Number(data.w) || 0;
  const height = Number(data.h) || 0;
  const frames = Math.max(0, Math.round(outPoint - inPoint));
  const duration = frameRate > 0 ? frames / frameRate : 0;
  const info = { frameRate, inPoint, outPoint, width, height, frames, duration };
  motionInfoCache.set(file, info);
  return info;
}

function formatResolution(info) {
  if (!info?.width || !info?.height) return "未知";
  return `${Math.round(info.width).toLocaleString()} × ${Math.round(info.height).toLocaleString()}`;
}

function resetTimeline(label = "--") {
  activeMotionInfo = null;
  detailTimeline.disabled = true;
  detailTimeline.min = "0";
  detailTimeline.max = "0";
  detailTimeline.value = "0";
  detailCurrentFrame.textContent = label;
  detailTotalFrames.textContent = label;
  detailCurrentTime.textContent = label;
  detailTotalDuration.textContent = label;
}

function applyMotionInfo(info) {
  activeMotionInfo = info;
  detailTimeline.disabled = info.frames <= 0;
  detailTimeline.min = "0";
  detailTimeline.max = String(info.frames);
  detailTimeline.value = "0";
  detailTotalFrames.textContent = info.frames.toLocaleString();
  detailTotalDuration.textContent = `${formatSeconds(info.duration)}s`;
  updateTimelineLabels(0);
}

function updateTimelineLabels(frame) {
  if (!activeMotionInfo) return;
  const safeFrame = Math.min(activeMotionInfo.frames, Math.max(0, Math.round(frame)));
  const currentSeconds = activeMotionInfo.frameRate > 0 ? safeFrame / activeMotionInfo.frameRate : 0;
  detailCurrentFrame.textContent = safeFrame.toLocaleString();
  detailCurrentTime.textContent = `${formatSeconds(currentSeconds)}s`;
  detailTimeline.value = String(safeFrame);
}

function seekDetailFrame(frame) {
  const targetFrame = Number(frame);
  if (!Number.isFinite(targetFrame)) return;

  detailPlayer.pause();
  stopTimelineLoop();

  if (detailAnimationItem && typeof detailAnimationItem.goToAndStop === "function") {
    detailAnimationItem.goToAndStop(targetFrame, true);
  } else if (typeof detailPlayer.seek === "function") {
    detailPlayer.seek(targetFrame);
  }

  updateTimelineLabels(targetFrame);
}

function startTimelineLoop() {
  stopTimelineLoop();

  const tick = () => {
    if (activeMotionInfo) {
      const frame = Number(detailAnimationItem?.currentFrame ?? detailTimeline.value);
      updateTimelineLabels(frame);
    }

    timelineRaf = window.requestAnimationFrame(tick);
  };

  timelineRaf = window.requestAnimationFrame(tick);
}

function stopTimelineLoop() {
  if (!timelineRaf) return;
  window.cancelAnimationFrame(timelineRaf);
  timelineRaf = 0;
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) return "0.00";
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function filenameToName(file) {
  return file
    .split("/")
    .pop()
    .replace(/\.json$/i, "")
    .replace(/[-_]+/g, " ");
}

function getDownloadName(motion) {
  if (motion.downloadName) return motion.downloadName;

  try {
    const url = new URL(motion.file, window.location.href);
    const fileName = decodeURIComponent(url.pathname.split("/").pop() || "");
    if (fileName.toLowerCase().endsWith(".json")) return fileName;
  } catch {
    const fileName = String(motion.file || "").split("/").pop() || "";
    if (fileName.toLowerCase().endsWith(".json")) return fileName;
  }

  return `${slugifyFileName(motion.name || "lottie-animation")}.json`;
}

function slugifyFileName(value) {
  return String(value)
    .trim()
    .replace(/\.json$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "lottie-animation";
}

function addLocalFiles(files) {
  const jsonFiles = [...files].filter((file) => file.name.toLowerCase().endsWith(".json"));
  const localItems = jsonFiles.map((file) => ({
    name: filenameToName(file.name),
    file: URL.createObjectURL(file),
    downloadName: file.name,
    category: "临时预览",
    tags: ["local"],
  }));

  motions = [...localItems, ...motions.filter((item) => item.category !== "临时预览")];
  populateCategories();
  category.value = "临时预览";
  render();
}

search.addEventListener("input", render);
category.addEventListener("change", render);
refresh.addEventListener("click", loadManifest);

speed.addEventListener("input", () => {
  speedLabel.textContent = `${speed.value}x`;
  syncPlayers();
});

previewBg.addEventListener("input", (event) => applyPreviewBackground(event.target.value));
autoplay.addEventListener("change", syncPlayers);
loop.addEventListener("change", syncPlayers);
fileInput.addEventListener("change", (event) => addLocalFiles(event.target.files));
detailClose.addEventListener("click", () => detailDialog.close());
detailPlay.addEventListener("click", () => {
  detailPlayer.play();
  startTimelineLoop();
});
detailPause.addEventListener("click", () => {
  detailPlayer.pause();
  stopTimelineLoop();
});
detailSpeed.addEventListener("input", syncDetailPlayer);
detailLoop.addEventListener("change", syncDetailPlayer);
detailPreviewBg.addEventListener("input", (event) => applyPreviewBackground(event.target.value));
detailTimeline.addEventListener("input", (event) => seekDetailFrame(event.target.value));

detailCopy.addEventListener("click", async () => {
  if (!activeMotion) return;
  await navigator.clipboard.writeText(activeMotion.file);
  detailCopy.textContent = "已复制";
  window.setTimeout(() => {
    detailCopy.textContent = "复制路径";
  }, 1100);
});

detailDialog.addEventListener("click", (event) => {
  if (event.target === detailDialog) detailDialog.close();
});

detailDialog.addEventListener("close", () => {
  detailPlayer.pause();
  stopTimelineLoop();
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("active");
});

dropzone.addEventListener("dragleave", () => dropzone.classList.remove("active"));

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("active");
  addLocalFiles(event.dataTransfer.files);
});

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".tab.active").classList.remove("active");
    button.classList.add("active");
    gallery.classList.toggle("list", button.dataset.view === "list");
  });
});

loadManifest();
window.setInterval(loadManifest, 30000);
