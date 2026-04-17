import { join } from "node:path";
import {
  resolveApiKey,
  resolveConfig,
  attemptTokenRefresh,
} from "./config.js";
import { ApiError } from "./api.js";

export interface Credentials {
  apiKey: string;
  source: string;
  isEnvToken: boolean;
}

const REFRESH_THRESHOLD_SECONDS = 15 * 60;

export function isTokenExpiringSoon(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );
    if (!payload.exp) return false;
    return payload.exp - Date.now() / 1000 < REFRESH_THRESHOLD_SECONDS;
  } catch {
    return false;
  }
}

export async function resolveCredentials(): Promise<Credentials> {
  const isEnvToken = !!resolveApiKey();

  if (isEnvToken) {
    const apiKey = resolveApiKey();
    if (apiKey) {
      return { apiKey, source: "VOXLI_API_TOKEN", isEnvToken: true };
    }
  }

  const resolved = await resolveConfig();
  if (resolved) {
    const { config, configDir } = resolved;
    const apiKey = config.accessToken ?? config.apiKey ?? null;
    if (apiKey) {
      return {
        apiKey,
        source: join(configDir, "config.json"),
        isEnvToken: false,
      };
    }
  }

  console.error(
    "Error: No API key found. Set VOXLI_API_TOKEN or run `voxli auth`."
  );
  process.exit(1);
}

/**
 * Wraps an API call with automatic token refresh on 401/403.
 * Proactively refreshes the token if it expires within 15 minutes.
 */
export async function withAuth<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
  let credentials = await resolveCredentials();

  if (!credentials.isEnvToken && isTokenExpiringSoon(credentials.apiKey)) {
    const newToken = await attemptTokenRefresh();
    if (newToken) {
      credentials = { ...credentials, apiKey: newToken };
    }
  }

  try {
    return await fn(credentials.apiKey);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.status !== 401 && err.status !== 403) throw err;

    if (credentials.isEnvToken) {
      console.error(
        `Error: Authentication failed (${err.status}). Your VOXLI_API_TOKEN may be expired or invalid.`
      );
      process.exit(1);
    }

    const newToken = await attemptTokenRefresh();
    if (newToken) {
      return await fn(newToken);
    }

    console.error(
      "Error: Could not refresh access token. Please re-authenticate with `voxli auth`."
    );
    process.exit(1);
  }
}
