import { join } from "node:path";
import { findLocalConfigDir, writeConfig } from "../lib/config.js";
import { register, ApiError } from "../lib/api.js";
import { getStableHostname } from "../lib/hostname.js";
import {
  browserAuth,
  AuthCancelledError,
  type BrowserAuthResult,
} from "../lib/browser-auth.js";

async function validateAndSave(
  result: BrowserAuthResult,
  opts?: { local?: boolean }
): Promise<void> {
  console.log("Validating...");
  try {
    const hostname = getStableHostname();
    await register(result.accessToken, {
      name: hostname,
      unique_identifier: hostname,
    });
    console.log("Access token is valid.");
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      console.error(
        `Authentication failed (${err.status}). Please try \`voxli auth\` again.`
      );
      process.exit(1);
    }
    // Network error or other — warn but still save
    console.warn(
      "Warning: could not validate token (network error). Saving anyway."
    );
  }

  // Target selection:
  // - --local: force cwd/.voxli (creates if missing).
  // - default: reuse an existing local config in the cwd ancestor chain so
  //   the listener (which reads local first) picks up the new credentials.
  //   Falls back to the global config if no local one exists.
  let writeOpts: { target?: "global" | "local"; configDir?: string };
  if (opts?.local) {
    writeOpts = { configDir: join(process.cwd(), ".voxli") };
  } else {
    const existingLocal = await findLocalConfigDir();
    if (existingLocal) {
      console.log(`Detected local config at ${existingLocal}; saving there.`);
      writeOpts = { configDir: existingLocal };
    } else {
      writeOpts = { target: "global" };
    }
  }

  const savedPath = await writeConfig(
    {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      clientId: result.clientId,
    },
    writeOpts
  );
  console.log(`Access token saved to ${savedPath}`);
}

export interface AuthCommandOptions {
  local?: boolean;
}

export async function authCommand(opts: AuthCommandOptions): Promise<void> {
  let result: BrowserAuthResult;
  try {
    result = await browserAuth();
  } catch (err) {
    if (err instanceof AuthCancelledError) {
      console.log("\nCancelled.");
      process.exit(130);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nAuthentication failed: ${msg}`);
    process.exit(1);
  }

  await validateAndSave(result, { local: opts.local });
}
