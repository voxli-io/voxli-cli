import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { VoxliConfig } from "../types.js";

const CONFIG_DIR = join(homedir(), ".voxli");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export async function readConfig(): Promise<VoxliConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as VoxliConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(config: VoxliConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  await chmod(CONFIG_PATH, 0o600);
}

export function resolveApiKey(): string | null {
  const envKey = process.env.VOXLI_API_KEY;
  if (envKey) return envKey;
  // Caller should await readConfig() for the file-based key
  return null;
}

export async function resolveApiKeyAsync(): Promise<string | null> {
  const envKey = resolveApiKey();
  if (envKey) return envKey;
  const config = await readConfig();
  return config?.apiKey ?? null;
}
