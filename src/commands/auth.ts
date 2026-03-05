import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeConfig } from "../lib/config.js";
import { register, ApiError } from "../lib/api.js";
import { getStableHostname } from "../lib/hostname.js";
import { browserAuth } from "../lib/browser-auth.js";

async function promptForToken(): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const token = await rl.question("Enter your Voxli API key: ");
    if (!token.trim()) {
      console.error("API key cannot be empty.");
      process.exit(1);
    }
    return token.trim();
  } finally {
    rl.close();
  }
}

async function validateAndSave(
  token: string,
  extra?: { refreshToken?: string; clientId?: string },
  opts?: { local?: boolean }
): Promise<void> {
  const label = extra ? "Access token" : "API key";
  console.log("Validating...");
  try {
    const hostname = getStableHostname();
    await register(token, {
      name: hostname,
      unique_identifier: hostname,
    });
    console.log(`${label} is valid.`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      console.error(
        `Authentication failed (${err.status}). Check your ${label.toLowerCase()}.`
      );
      process.exit(1);
    }
    // Network error or other — warn but still save
    console.warn(
      "Warning: could not validate token (network error). Saving anyway."
    );
  }

  const target = opts?.local ? "local" : "global";
  const savedPath = await writeConfig(
    {
      accessToken: token,
      refreshToken: extra?.refreshToken,
      clientId: extra?.clientId,
    },
    { target }
  );
  console.log(`${label} saved to ${savedPath}`);
}

export async function authCommand(opts: {
  manual?: boolean;
  local?: boolean;
}): Promise<void> {
  if (!opts.manual) {
    try {
      const result = await browserAuth();
      await validateAndSave(
        result.accessToken,
        {
          refreshToken: result.refreshToken,
          clientId: result.clientId,
        },
        { local: opts.local }
      );
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\nBrowser auth failed: ${msg}`);
      console.log("Falling back to manual token entry.\n");
    }
  }

  const token = await promptForToken();
  await validateAndSave(token, undefined, { local: opts.local });
}
