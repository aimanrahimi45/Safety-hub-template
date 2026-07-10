// Generate a module preview image via OpenRouter (bytedance-seed/seedream-4.5).
// Loads OPENROUTER_API_KEY from .env (gitignored).
//
// Usage:
//   node scripts/generate-image.mjs <prompt-file> <out-path> [size]
//
// Example:
//   node scripts/generate-image.mjs prompts/contractor.txt public/images/foo.webp 1800x790

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function loadEnv() {
  try {
    const envPath = path.join(ROOT, ".env");
    const text = await fs.readFile(envPath, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

async function main() {
  await loadEnv();
  const [, , promptArg, outArg, sizeArg] = process.argv;
  if (!promptArg || !outArg) {
    console.error("Usage: node scripts/generate-image.mjs <prompt-file> <out-path> [size]");
    process.exit(1);
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY not set in env or .env");
    process.exit(1);
  }

  const prompt = (await fs.readFile(path.resolve(promptArg), "utf8")).trim();
  const outPath = path.resolve(outArg);
  const body = {
    model: "bytedance-seed/seedream-4.5",
    prompt,
  };
  if (sizeArg) body.size = sizeArg;

  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body}`);
  }

  const data = await res.json();
  const item = data.data?.[0];
  if (!item) throw new Error("No image in response: " + JSON.stringify(data));

  let buffer;
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const imgRes = await fetch(item.url);
    buffer = Buffer.from(await imgRes.arrayBuffer());
  } else {
    throw new Error("Response had neither url nor b64_json: " + JSON.stringify(item));
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buffer);
  console.log(`Wrote ${buffer.length} bytes -> ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
