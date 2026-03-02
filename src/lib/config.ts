import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { VoxliConfig } from "../types.js";
import { refreshAccessToken } from "./oauth.js";
import { getApiBaseUrl } from "./api.js";

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

export async function writeConfig(config: {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
}): Promise<void> {
  const data: Record<string, string> = { accessToken: config.accessToken };
  if (config.refreshToken) data.refreshToken = config.refreshToken;
  if (config.clientId) data.clientId = config.clientId;

  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(
    CONFIG_PATH,
    JSON.stringify(data, null, 2) + "\n",
    { mode: 0o600 }
  );
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
  return config?.accessToken ?? config?.apiKey ?? null;
}

export async function attemptTokenRefresh(): Promise<string | null> {
  try {
    const config = await readConfig();
    if (!config?.refreshToken || !config?.clientId) return null;

    const baseUrl = getApiBaseUrl();
    const result = await refreshAccessToken(
      baseUrl,
      config.refreshToken,
      config.clientId
    );

    await writeConfig({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken ?? config.refreshToken,
      clientId: config.clientId,
    });

    return result.accessToken;
  } catch {
    return null;
  }
}
