import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  resolveApiKey,
  resolveConfig,
  attemptTokenRefresh,
} from "../lib/config.js";
import { buildAgentIdentifier, getStableHostname } from "../lib/hostname.js";
import { register, ApiError } from "../lib/api.js";
import { getJwtExpiry } from "../lib/oauth.js";

const POLL_INTERVAL = 5_000;
const REFRESH_BUFFER_SECONDS = 30 * 60;

export async function listenCommand(options: {
  command: string;
  name?: string;
}): Promise<void> {
  const isEnvToken = !!resolveApiKey();
  let apiKey: string | null = null;
  let credentialSource: string | null = null;

  if (isEnvToken) {
    apiKey = resolveApiKey();
    credentialSource = "VOXLI_API_TOKEN";
  } else {
    const resolved = await resolveConfig();
    if (resolved) {
      const { config, configDir } = resolved;
      apiKey = config.accessToken ?? config.apiKey ?? null;
      credentialSource = join(configDir, "config.json");
    }
  }

  if (!apiKey) {
    console.error(
      "Error: No API key found. Set VOXLI_API_TOKEN or run `voxli auth`."
    );
    process.exit(1);
  }

  const displayName = options.name ?? getStableHostname();
  const uniqueIdentifier = buildAgentIdentifier(options.name);
  const children = new Set<ChildProcess>();

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    for (const child of children) {
      child.kill("SIGTERM");
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(
    `Listening as ${displayName} (${uniqueIdentifier}) using credentials from ${credentialSource}`
  );

  while (true) {
    try {
      // Proactively refresh if the token expires within the buffer window so
      // newly-spawned subprocesses inherit a token that will outlast the test.
      if (!isEnvToken) {
        const exp = getJwtExpiry(apiKey);
        const nowSec = Math.floor(Date.now() / 1000);
        if (exp !== null && exp - nowSec < REFRESH_BUFFER_SECONDS) {
          const newToken = await attemptTokenRefresh(apiKey);
          if (newToken && newToken !== apiKey) {
            apiKey = newToken;
            console.log("Access token refreshed proactively.");
          }
        }
      }

      const data = await register(apiKey, {
        name: displayName,
        unique_identifier: uniqueIdentifier,
      });

      const testResultIds = data.test_result_ids ?? [];

      if (testResultIds.length > 0) {
        const runId = data.run_id;
        const label = runId ? `run ${runId}` : "standalone";
        console.log(
          `Spawning subprocess for ${testResultIds.length} test(s) (${label})`
        );

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          VOXLI_API_TOKEN: apiKey,
          VOXLI_API_URL: process.env.VOXLI_API_URL,
          VOXLI_APP_URL: process.env.VOXLI_APP_URL,
          TEST_RESULT_IDS: JSON.stringify(testResultIds),
        };
        if (runId) {
          env.RUN_ID = runId;
        }

        const child = spawn(options.command, {
          stdio: "inherit",
          env,
          shell: true,
        });
        children.add(child);

        child.on("error", (err) => {
          children.delete(child);
          console.error(`Subprocess (${label}) failed to start: ${err.message}`);
        });

        child.on("close", (code) => {
          children.delete(child);
          if (code !== 0 && code !== null) {
            console.log(`Subprocess (${label}) exited with code ${code}`);
          }
        });

        // Don't sleep when work was received — poll again immediately
        continue;
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 401 || err.status === 403)
      ) {
        if (isEnvToken) {
          console.error(
            `Error: Authentication failed (${err.status}). Your VOXLI_API_TOKEN environment variable may be expired or invalid.`
          );
          process.exit(1);
        }

        console.log("Access token expired, attempting refresh...");
        const newToken = await attemptTokenRefresh(apiKey ?? undefined);
        if (newToken) {
          apiKey = newToken;
          console.log("Token refreshed successfully.");
          continue;
        }

        console.error(
          "Error: Could not refresh access token. Please re-authenticate with `voxli auth`."
        );
        process.exit(1);
      } else if (err instanceof ApiError) {
        console.error(`Poll error: API ${err.status}`);
      } else {
        console.error(`Poll error: ${err}`);
      }
    }

    await sleep(POLL_INTERVAL);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
