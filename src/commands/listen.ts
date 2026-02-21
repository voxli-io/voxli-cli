import { spawn, type ChildProcess } from "node:child_process";
import { resolveApiKeyAsync } from "../lib/config.js";
import { getStableHostname } from "../lib/hostname.js";
import { register, ApiError } from "../lib/api.js";

const POLL_INTERVAL = 5_000;

export async function listenCommand(options: {
  command: string;
}): Promise<void> {
  const apiKey = await resolveApiKeyAsync();
  if (!apiKey) {
    console.error(
      "Error: No API key found. Set VOXLI_API_KEY or run `voxli auth`."
    );
    process.exit(1);
  }

  const hostname = getStableHostname();
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

  console.log(`Listening as ${hostname}...`);

  while (true) {
    try {
      const data = await register(apiKey, {
        name: hostname,
        unique_identifier: hostname,
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
          VOXLI_API_KEY: apiKey,
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
      if (err instanceof ApiError) {
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
