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

export function buildAgentIdentifier(name: string | undefined): string {
  const host = getStableHostname();
  if (!name) return host;
  const trimmed = name.replace(/\s+/g, "");
  return trimmed ? `${trimmed}-${host}` : host;
}
