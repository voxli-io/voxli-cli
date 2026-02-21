import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeConfig } from "../lib/config.js";
import { register, ApiError } from "../lib/api.js";
import { getStableHostname } from "../lib/hostname.js";

export async function authCommand(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const apiKey = await rl.question("Enter your Voxli API key: ");

    if (!apiKey.trim()) {
      console.error("API key cannot be empty.");
      process.exit(1);
    }

    const key = apiKey.trim();

    // Validate by calling /agents/register
    console.log("Validating...");
    try {
      const hostname = getStableHostname();
      await register(key, {
        name: hostname,
        unique_identifier: hostname,
      });
      console.log("API key is valid.");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        console.error(`Authentication failed (${err.status}). Check your API key.`);
        process.exit(1);
      }
      // Network error or other — warn but still save
      console.warn("Warning: could not validate key (network error). Saving anyway.");
    }

    await writeConfig({ apiKey: key });
    console.log("API key saved to ~/.voxli/config.json");
  } finally {
    rl.close();
  }
}
