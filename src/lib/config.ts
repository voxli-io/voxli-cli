import { readFile, writeFile, mkdir, chmod, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { VoxliConfig } from "../types.js";
import { refreshAccessToken } from "./oauth.js";
import { getApiBaseUrl } from "./api.js";

const GLOBAL_CONFIG_DIR = join(homedir(), ".voxli");
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from CWD looking for a `.voxli/config.json` file.
 * Returns the `.voxli` directory path if found, or null.
 */
export async function findLocalConfigDir(): Promise<string | null> {
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".voxli", "config.json");
    if (await fileExists(candidate)) {
      return join(dir, ".voxli");
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function readConfigFrom(
  configPath: string
): Promise<VoxliConfig | null> {
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as VoxliConfig;
  } catch {
    return null;
  }
}

export async function readConfig(): Promise<VoxliConfig | null> {
  return readConfigFrom(GLOBAL_CONFIG_PATH);
}

/**
 * Resolve config checking local first, then global.
 * Returns the config and the directory it was found in.
 */
export async function resolveConfig(): Promise<{
  config: VoxliConfig;
  configDir: string;
} | null> {
  const localDir = await findLocalConfigDir();
  if (localDir) {
    const config = await readConfigFrom(join(localDir, "config.json"));
    if (config) return { config, configDir: localDir };
  }
  const config = await readConfigFrom(GLOBAL_CONFIG_PATH);
  if (config) return { config, configDir: GLOBAL_CONFIG_DIR };
  return null;
}

export async function writeConfig(
  config: {
    accessToken: string;
    refreshToken?: string;
    clientId?: string;
  },
  opts?: { target?: "global" | "local"; configDir?: string }
): Promise<string> {
  let targetDir: string;
  if (opts?.configDir) {
    targetDir = opts.configDir;
  } else if (opts?.target === "local") {
    targetDir = join(process.cwd(), ".voxli");
  } else {
    targetDir = GLOBAL_CONFIG_DIR;
  }

  const targetPath = join(targetDir, "config.json");

  const data: Record<string, string> = { accessToken: config.accessToken };
  if (config.refreshToken) data.refreshToken = config.refreshToken;
  if (config.clientId) data.clientId = config.clientId;

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
  await chmod(targetPath, 0o600);

  return targetPath;
}

export function resolveApiKey(): string | null {
  const envKey = process.env.VOXLI_API_TOKEN;
  if (envKey) return envKey;
  return null;
}

export async function resolveApiKeyAsync(): Promise<string | null> {
  const envKey = resolveApiKey();
  if (envKey) return envKey;
  const resolved = await resolveConfig();
  const config = resolved?.config;
  return config?.accessToken ?? config?.apiKey ?? null;
}

export async function attemptTokenRefresh(
  expiredToken?: string
): Promise<string | null> {
  try {
    const resolved = await resolveConfig();
    if (!resolved) return null;
    const { config, configDir } = resolved;

    // Another listener may have already refreshed — adopt that token.
    if (
      expiredToken &&
      config.accessToken &&
      config.accessToken !== expiredToken
    ) {
      return config.accessToken;
    }

    if (!config.refreshToken || !config.clientId) return null;

    const baseUrl = getApiBaseUrl();
    try {
      const result = await refreshAccessToken(
        baseUrl,
        config.refreshToken,
        config.clientId
      );

      await writeConfig(
        {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken ?? config.refreshToken,
          clientId: config.clientId,
        },
        { configDir }
      );

      return result.accessToken;
    } catch {
      // Refresh failed (likely because a sibling listener already used the
      // refresh token). Retry-read the config briefly in case the winner is
      // still flushing its write to disk.
      if (!expiredToken) return null;
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const recheck = await resolveConfig();
        const fresh = recheck?.config.accessToken;
        if (fresh && fresh !== expiredToken) return fresh;
      }
      return null;
    }
  } catch {
    return null;
  }
}
