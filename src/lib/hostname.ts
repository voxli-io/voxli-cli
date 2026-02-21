import { execFileSync } from "node:child_process";
import { hostname } from "node:os";

export function getStableHostname(): string {
  if (process.platform === "darwin") {
    try {
      const result = execFileSync("scutil", ["--get", "LocalHostName"], {
        encoding: "utf-8",
      });
      return result.trim();
    } catch {
      // fall through to os.hostname()
    }
  }
  return hostname();
}
