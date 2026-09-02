import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "dist", "cli.js");

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function run(args: string[], env?: Record<string, string>): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI_PATH, ...args],
      {
        env: { ...process.env, ...env },
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode: error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
            ? 1
            : ((error as { status?: number } | null)?.status ?? child.exitCode ?? 0),
        });
      }
    );
  });
}

export function runJson(args: string[], env?: Record<string, string>): Promise<{ result: CliResult; json: unknown }> {
  return run([...args, "--json"], env).then((result) => ({
    result,
    json: result.stdout.trim() ? JSON.parse(result.stdout) : null,
  }));
}

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}
