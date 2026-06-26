import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const root = process.cwd();
const configPath = join(root, "lark-sync.config.json");

async function main() {
  const watch = process.argv.includes("--watch");
  const publish = process.argv.includes("--publish");
  const config = await loadConfig();

  if (watch) {
    await syncOnce(config, { publish });
    setInterval(() => {
      syncOnce(config, { publish }).catch((error) => {
        console.error(`[lark-sync] ${error.message}`);
      });
    }, config.pollSeconds * 1000);
    console.log(`[lark-sync] Watching every ${config.pollSeconds}s.`);
    return;
  }

  await syncOnce(config, { publish });
}

async function syncOnce(config, options = {}) {
  const state = await loadState(config.stateFile);
  const rows = await readSheet(config);
  const entries = parseRows(rows, config);
  const activeSourceIds = new Set(
    entries.flatMap((entry) => entry.files.map((fileRef) => fileRef.token || fileRef.url).filter(Boolean)),
  );
  let changed = false;

  for (const entry of entries) {
    for (const fileRef of entry.files) {
      const sourceId = fileRef.token || fileRef.url;
      if (!sourceId) continue;

      const token = fileRef.token || (await inspectUrl(fileRef.url, config.identity));
      if (!token) {
        console.warn(`[lark-sync] Skipped row ${entry.rowNumber}: no file token found.`);
        continue;
      }

      const existing = state.synced[sourceId];
      let output = existing?.output;

      if (!existing) {
        const fileName = buildFileName(entry, fileRef, token);
        const categoryDir = slugify(entry.category) || "未分类";
        const outputPath = join(root, config.outputDir, categoryDir, fileName);
        await downloadJson(token, outputPath, config.identity);
        output = relativePath(outputPath);
        console.log(`[lark-sync] Synced ${output}`);
      } else if (hasRemoteFileChanged(existing, fileRef)) {
        const outputPath = join(root, output);
        await downloadJson(token, outputPath, config.identity);
        console.log(`[lark-sync] Updated file content for row ${entry.rowNumber}: ${output}`);
      }

      const nextState = {
        token,
        output,
        slot: fileRef.slot,
        rowNumber: entry.rowNumber,
        name: entry.name,
        category: entry.category,
        tags: entry.tags,
        fileName: fileRef.name || "",
        fileSize: fileRef.size || 0,
        syncedAt: existing?.syncedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (!existing || hasStateChanged(existing, nextState)) {
        state.synced[sourceId] = nextState;
        changed = true;
        if (existing) console.log(`[lark-sync] Updated metadata for row ${entry.rowNumber}: ${output}`);
      }
    }
  }

  if (config.pruneMissing) {
    const activeOutputs = new Set(
      Object.entries(state.synced || {})
        .filter(([sourceId]) => activeSourceIds.has(sourceId))
        .map(([, item]) => item.output)
        .filter(Boolean),
    );
    for (const [sourceId, item] of Object.entries(state.synced || {})) {
      if (activeSourceIds.has(sourceId)) continue;

      delete state.synced[sourceId];
      changed = true;
      console.log(`[lark-sync] Removed stale attachment: ${item.output || sourceId}`);

      if (item.output && !activeOutputs.has(item.output)) {
        await removeSyncedFile(item.output, config.outputDir);
      }
    }
  }

  if (changed) {
    await saveState(config.stateFile, state);
    await run("node", ["./scripts/generate-manifest.mjs"], { cwd: root });
    if (options.publish) await publishChanges();
  } else {
    console.log("[lark-sync] No new JSON files.");
    if (options.publish) await pushPendingCommits();
  }
}

function hasStateChanged(current, next) {
  return (
    current.token !== next.token ||
    current.output !== next.output ||
    current.slot !== next.slot ||
    current.rowNumber !== next.rowNumber ||
    current.name !== next.name ||
    current.category !== next.category ||
    current.fileName !== next.fileName ||
    Number(current.fileSize || 0) !== Number(next.fileSize || 0) ||
    JSON.stringify(current.tags || []) !== JSON.stringify(next.tags || [])
  );
}

function hasRemoteFileChanged(existing, fileRef) {
  const currentSize = Number(existing?.fileSize || 0);
  const nextSize = Number(fileRef?.size || 0);
  return nextSize > 0 && currentSize !== nextSize;
}

async function publishChanges() {
  await run("git", ["add", "lotties", "manifest.json"], { cwd: root });
  const status = await run("git", ["status", "--short", "lotties", "manifest.json"], { cwd: root });
  if (!status.trim()) {
    console.log("[lark-sync] Nothing to publish.");
    await pushPendingCommits();
    return;
  }

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  await run("git", ["commit", "-m", `Sync Lottie files ${stamp}`], { cwd: root });
  await run("git", ["push"], { cwd: root });
  console.log("[lark-sync] Published changes to GitHub Pages.");
}

async function pushPendingCommits() {
  let pending = "0";
  try {
    pending = await run("git", ["rev-list", "--count", "@{u}..HEAD"], { cwd: root });
  } catch {
    return;
  }

  if (Number(pending.trim()) <= 0) return;
  await run("git", ["push"], { cwd: root });
  console.log("[lark-sync] Published pending commits to GitHub Pages.");
}

async function loadConfig() {
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    throw new Error("Missing lark-sync.config.json. Copy lark-sync.config.example.json and fill it in.");
  }

  const config = JSON.parse(raw);
  if (!config.spreadsheetUrl && !config.spreadsheetToken) {
    throw new Error("Config needs spreadsheetUrl or spreadsheetToken.");
  }
  if (!config.range) config.range = "A1:H200";
  if (!config.headerRow) config.headerRow = 1;
  if (config.rowStart != null) config.rowStart = Number(config.rowStart);
  if (config.rowEnd != null) config.rowEnd = Number(config.rowEnd);
  if (config.rowStart && config.rowEnd && config.rowStart > config.rowEnd) {
    throw new Error("Config rowStart cannot be greater than rowEnd.");
  }
  if (!config.identity) config.identity = "user";
  if (!config.pollSeconds) config.pollSeconds = 30;
  if (config.pruneMissing == null) config.pruneMissing = true;
  if (!config.outputDir) config.outputDir = "lotties";
  if (!config.stateFile) config.stateFile = ".sync/lark-state.json";
  if (!config.columns?.file) {
    throw new Error('Config needs columns.file, for example "JSON文件" or ["JSON文件", "附件1"].');
  }
  return config;
}

async function readSheet(config) {
  const args = ["sheets", "+read", "--as", config.identity, "--range", config.range];
  if (config.spreadsheetToken) args.push("--spreadsheet-token", config.spreadsheetToken);
  else if (config.spreadsheetUrl) args.push("--url", config.spreadsheetUrl);
  if (config.sheetId) args.push("--sheet-id", config.sheetId);

  const output = await run("lark-cli", args, { cwd: root });
  const data = JSON.parse(output);
  return data.values || data.data?.valueRange?.values || data.data?.values || [];
}

function parseRows(rows, config) {
  const headerIndex = Math.max(0, Number(config.headerRow || 1) - 1);
  if (rows.length <= headerIndex) return [];

  const headers = rows[headerIndex].map((cell) => normalizeCellText(cell));
  const columnIndex = {
    name: findColumn(headers, config.columns.name),
    category: findColumn(headers, config.columns.category),
    tags: findColumn(headers, config.columns.tags),
    files: findColumns(headers, config.columns.file),
  };

  if (columnIndex.files.length === 0) {
    throw new Error(`Cannot find file columns "${config.columns.file}" in header row.`);
  }

  return rows.slice(headerIndex + 1).flatMap((row, index) => {
    const rowNumber = headerIndex + index + 2;
    if (config.rowStart && rowNumber < config.rowStart) return [];
    if (config.rowEnd && rowNumber > config.rowEnd) return [];

    const files = columnIndex.files.flatMap((fileIndex) =>
      extractFileRefs(row[fileIndex]).map((fileRef, refIndex) => ({
        ...fileRef,
        slot: `${rowNumber}:${fileIndex}:${refIndex}`,
      })),
    );
    if (files.length === 0) return [];

    return {
      rowNumber,
      name: readCell(row, columnIndex.name),
      category: readCell(row, columnIndex.category) || "未分类",
      tags: splitTags(readCell(row, columnIndex.tags)),
      files,
    };
  });
}

function findColumn(headers, label) {
  if (!label) return -1;
  const normalized = String(label).trim();
  return headers.findIndex((header) => header === normalized);
}

function findColumns(headers, labels) {
  const list = Array.isArray(labels) ? labels : [labels];
  return list.map((label) => findColumn(headers, label)).filter((index) => index >= 0);
}

function readCell(row, index) {
  if (index < 0) return "";
  return normalizeCellText(row[index]);
}

function normalizeCellText(cell) {
  if (cell == null) return "";
  if (typeof cell === "string" || typeof cell === "number") return String(cell).trim();
  if (Array.isArray(cell)) return cell.map(normalizeCellText).filter(Boolean).join(" ").trim();
  if (typeof cell === "object") {
    return [
      cell.text,
      cell.name,
      cell.file_name,
      cell.link,
      cell.url,
      cell.fileToken,
      cell.file_token,
      cell.token,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return String(cell).trim();
}

function extractFileRefs(cell) {
  const refs = [];
  const visit = (value) => {
    if (value == null) return;

    if (typeof value === "string") {
      for (const url of value.match(/https?:\/\/\S+/g) || []) {
        refs.push({ url: url.replace(/[),，。]+$/, "") });
      }
      for (const token of value.match(/\bbox[a-zA-Z0-9_-]+\b/g) || []) {
        refs.push({ token });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value === "object") {
      const token = value.fileToken || value.file_token || value.token;
      const url = value.url || value.link;
      const name = value.name || value.file_name || value.text;
      const size = Number(value.size || value.file_size || 0);
      if (token || url) refs.push({ token, url, name, size });
      Object.values(value).forEach(visit);
    }
  };

  visit(cell);
  return dedupeRefs(refs);
}

function dedupeRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    const key = ref.token || ref.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function inspectUrl(url, identity) {
  if (!url) return "";
  const output = await run("lark-cli", ["drive", "+inspect", "--as", identity, "--url", url], { cwd: root });
  const data = JSON.parse(output);
  return data.token || data.file_token || data.obj_token || "";
}

async function downloadJson(token, outputPath, identity) {
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.download`;
  await removeIfExists(tempPath);
  await run(
    "lark-cli",
    [
      "api",
      "GET",
      `/open-apis/drive/v1/medias/${token}/download`,
      "--as",
      identity,
      "--output",
      relativePath(tempPath),
    ],
    { cwd: root },
  );
  await ensureJsonFile(tempPath);
  await rename(tempPath, outputPath);
}

async function removeIfExists(filePath) {
  try {
    await rm(filePath);
  } catch {
    // Missing temp files are fine.
  }
}

async function removeSyncedFile(output, outputDir) {
  const normalized = output.replaceAll("\\", "/");
  if (!normalized.startsWith(`${outputDir.replaceAll("\\", "/")}/`)) return;
  await removeIfExists(join(root, normalized));
}

async function ensureJsonFile(filePath) {
  try {
    await parseJsonFile(filePath);
    return;
  } catch (error) {
    if (!(await isZipFile(filePath))) throw error;
  }

  const content = await extractLottieJson(filePath);
  JSON.parse(content);
  await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`);
  console.log(`[lark-sync] Extracted JSON from package: ${relativePath(filePath)}`);
}

async function parseJsonFile(filePath) {
  const content = await readFile(filePath, "utf8");
  JSON.parse(content);
}

async function isZipFile(filePath) {
  const buffer = await readFile(filePath);
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

async function extractLottieJson(filePath) {
  const listOutput = await run("unzip", ["-Z1", filePath], { cwd: root });
  const entries = listOutput
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const candidates = [
    ...entries.filter((item) => /^animations\/.+\.json$/i.test(item)),
    ...entries.filter((item) => /\.json$/i.test(item) && !/^manifest\.json$/i.test(item)),
  ];

  for (const entry of candidates) {
    const content = await run("unzip", ["-p", filePath, entry], { cwd: root });
    try {
      const data = JSON.parse(content);
      if (data && typeof data === "object" && ("layers" in data || "fr" in data || "v" in data)) {
        return content;
      }
    } catch {
      // Keep looking for a valid animation JSON inside the package.
    }
  }

  throw new Error(`No Lottie JSON found inside package ${relativePath(filePath)}`);
}

function buildFileName(entry, fileRef, token) {
  const base = fileRef.name || entry.name || token;
  const stem = slugify(base.replace(/\.json$/i, ""));
  const hash = createHash("sha1").update(token).digest("hex").slice(0, 8);
  return `${stem || "motion"}-${hash}.json`;
}

function slugify(value) {
  return String(value)
    .trim()
    .replace(extname(value), "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function splitTags(value) {
  if (!value) return [];
  return value
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadState(filePath) {
  try {
    const data = JSON.parse(await readFile(join(root, filePath), "utf8"));
    return { synced: data.synced || {} };
  } catch {
    return { synced: {} };
  }
}

async function saveState(filePath, state) {
  const fullPath = join(root, filePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, `${JSON.stringify(state, null, 2)}\n`);
}

function relativePath(filePath) {
  return filePath.replace(`${root}/`, "");
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`));
      }
    });
  });
}

main().catch((error) => {
  console.error(`[lark-sync] ${error.message}`);
  process.exitCode = 1;
});
