import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const lottieDir = join(root, "lotties");
const manifestPath = join(root, "manifest.json");
const syncStatePath = join(root, ".sync", "lark-state.json");

async function collectJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(fullPath)));
    }
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".json") {
      files.push(fullPath);
    }
  }

  return files;
}

function titleize(file) {
  return basename(file, ".json").replace(/[-_]+/g, " ");
}

async function getName(file) {
  try {
    const content = await readFile(file, "utf8");
    const data = JSON.parse(content);
    return data.nm || titleize(file);
  } catch {
    return titleize(file);
  }
}

const files = await collectJsonFiles(lottieDir);
const syncMeta = await loadSyncMeta();
const items = await Promise.all(
  files.map(async (file) => {
    const rel = `./${relative(root, file).replaceAll("\\", "/")}`;
    const meta = syncMeta[rel.replace(/^\.\//, "")] || syncMeta[rel];
    const category = relative(lottieDir, file).split(/[\\/]/)[0];
    const fallbackCategory = meta?.category || (category === basename(file) ? "未分类" : category);
    const fallbackName = fallbackCategory && fallbackCategory !== "未分类" ? fallbackCategory : await getName(file);
    return {
      name: meta?.name || fallbackName,
      file: rel,
      category: fallbackCategory,
      tags: meta?.tags || [],
      updatedAt: meta?.updatedAt || meta?.syncedAt || "",
    };
  }),
);

items.sort((left, right) => {
  const byTime = Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
  if (Number.isFinite(byTime) && byTime !== 0) return byTime;
  return left.file.localeCompare(right.file, "zh-Hans-CN");
});

await writeFile(manifestPath, `${JSON.stringify({ items }, null, 2)}\n`);
console.log(`Generated ${relative(root, manifestPath)} with ${items.length} items.`);

async function loadSyncMeta() {
  try {
    const state = JSON.parse(await readFile(syncStatePath, "utf8"));
    const meta = {};
    for (const item of Object.values(state.synced || {})) {
      if (item.output) meta[item.output] = item;
    }
    return meta;
  } catch {
    return {};
  }
}
