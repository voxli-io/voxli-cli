import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { getApiBaseUrl } from "./api.js";
import {
  generatePkceChallenge,
  registerOAuthClient,
  exchangeCodeForToken,
  buildAuthorizeUrl,
} from "./oauth.js";

const DEFAULT_AUTH_TIMEOUT_MS = 10 * 60_000;
const CALLBACK_PATH = "/callback";
const PASTE_PROMPT = "> ";

export class AuthCancelledError extends Error {
  constructor() {
    super("Authentication cancelled.");
    this.name = "AuthCancelledError";
  }
}

// ---------------------------------------------------------------------------
// HTML pages served on the loopback callback
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(heading: string, message: string, color: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Voxli CLI</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb}
.card{text-align:center;padding:2rem;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{color:${color};margin:0 0 .5rem}p{color:#6b7280;margin:0}</style></head>
<body><div class="card"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p></div></body>
</html>`;
}

const SUCCESS_HTML = page(
  "Authenticated!",
  "You can close this tab and return to the terminal.",
  "#0a3b29"
);

function errorHtml(message: string): string {
  return page("Authentication failed", message, "#dc2626");
}

// ---------------------------------------------------------------------------
// Parsing the redirect (from the loopback request or pasted by the user)
// ---------------------------------------------------------------------------

export type CallbackParse =
  | { ok: true; code: string }
  | {
      ok: false;
      reason:
        | "not-a-redirect"
        | "login-url"
        | "state-mismatch"
        | "missing-code"
        | "denied";
      message: string;
    };

const NOT_A_REDIRECT_MSG =
  "That doesn't look like the page URL. Copy the full address from the browser's address bar and paste it here.";

/**
 * Extract the authorization code from a redirect, which may arrive as:
 *  - the full URL the browser was sent to (`http://127.0.0.1:PORT/callback?code=…&state=…`)
 *  - just the path + query (`/callback?code=…&state=…`)
 *  - just the query string (`code=…&state=…`)
 *
 * The `state` must match the one generated for this attempt; without it we
 * can't tell the redirect belongs to us, so it's rejected.
 */
export function parseCallbackInput(
  raw: string,
  expectedState: string
): CallbackParse {
  const text = raw.trim().replace(/^["'<]+|[>"']+$/g, "");
  let params: URLSearchParams;

  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      params = new URL(text).searchParams;
    } else if (text.startsWith("/")) {
      params = new URL(text, "http://127.0.0.1").searchParams;
    } else if (/(^|[?&])(code|state|error)=/.test(text)) {
      params = new URLSearchParams(text.replace(/^\?/, ""));
    } else {
      return { ok: false, reason: "not-a-redirect", message: NOT_A_REDIRECT_MSG };
    }
  } catch {
    return { ok: false, reason: "not-a-redirect", message: NOT_A_REDIRECT_MSG };
  }

  if (params.has("response_type")) {
    return {
      ok: false,
      reason: "login-url",
      message:
        "That's the login link itself. Open it in a browser, log in, then paste the URL of the page you end up on.",
    };
  }

  if (params.get("state") !== expectedState) {
    return {
      ok: false,
      reason: "state-mismatch",
      message:
        "That URL is from a different login attempt. Paste the full URL, including everything after '?', from this one.",
    };
  }

  const error = params.get("error");
  if (error) {
    const description = params.get("error_description");
    return {
      ok: false,
      reason: "denied",
      message: `Authorization failed: ${error}${description ? ` (${description})` : ""}`,
    };
  }

  const code = params.get("code");
  if (!code) {
    return {
      ok: false,
      reason: "missing-code",
      message:
        "That URL has no login code in it. Paste the full URL, including everything after '?'.",
    };
  }

  return { ok: true, code };
}

// ---------------------------------------------------------------------------
// Browser launching
// ---------------------------------------------------------------------------

export interface LaunchEnv {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

function browserOverride(env: NodeJS.ProcessEnv): string | null {
  const value = env.BROWSER?.trim();
  if (!value || value.toLowerCase() === "none") return null;
  return value;
}

/**
 * Best-effort guess at whether launching a browser here would put it in front
 * of the user. We can only detect the clear "no" cases; the URL is always
 * printed as well, so a wrong guess costs nothing.
 */
export function shouldLaunchBrowser({ platform, env }: LaunchEnv): boolean {
  if (env.BROWSER?.trim()) return browserOverride(env) !== null;
  if (env.CI) return false;
  // Over SSH the browser would open on the remote desktop, not the user's.
  // (VS Code Remote and similar set BROWSER, handled above.)
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (platform === "linux") {
    if (env.WSL_DISTRO_NAME) return true;
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  }
  return true;
}

export function browserLaunchCommand(
  url: string,
  { platform, env }: LaunchEnv
): { cmd: string; args: string[] } {
  const override = browserOverride(env);
  if (override) {
    // Same convention as xdg-open: whitespace-separated, optional %s placeholder.
    const [cmd, ...rest] = override.split(/\s+/);
    if (rest.some((a) => a.includes("%s"))) {
      return { cmd, args: rest.map((a) => a.replaceAll("%s", url)) };
    }
    return { cmd, args: [...rest, url] };
  }
  if (platform === "darwin") return { cmd: "open", args: [url] };
  // rundll32 takes the URL as a plain argument, so `&` in the query string is
  // safe (unlike `cmd /c start`, which treats it as a command separator).
  if (platform === "win32") {
    return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }
  if (env.WSL_DISTRO_NAME) {
    return { cmd: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  }
  return { cmd: "xdg-open", args: [url] };
}

function openBrowser(url: string, onError: () => void): void {
  const { cmd, args } = browserLaunchCommand(url, {
    platform: process.platform,
    env: process.env,
  });
  execFile(cmd, args, (err) => {
    if (err) onError();
  });
}

// ---------------------------------------------------------------------------
// Loopback server
// ---------------------------------------------------------------------------

/** Listen on a free loopback port and return it. */
function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to start local callback server."));
        return;
      }
      resolve(addr.port);
    });
  });
}

// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------

type Input = NodeJS.ReadableStream & { isTTY?: boolean };
type Output = NodeJS.WritableStream;

function confirm(input: Input, output: Output, prompt: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input, output });
    rl.on("SIGINT", () => {
      rl.close();
      reject(new AuthCancelledError());
    });
    // EOF on stdin: nothing to wait for, just carry on.
    rl.on("close", () => resolve());
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Wait for the authorization code to arrive over either channel:
 *  - the browser hitting the loopback callback, or
 *  - the user pasting the redirect URL into the terminal (when the browser
 *    is on another machine and can't reach this one).
 * Whichever happens first wins.
 */
function waitForCode(opts: {
  server: Server;
  state: string;
  input: Input;
  output: Output;
  interactive: boolean;
  timeoutMs: number;
}): Promise<string> {
  const { server, state, input, output, interactive, timeoutMs } = opts;

  return new Promise((resolve, reject) => {
    let settled = false;

    // `timer` and `rl` are declared below; finish() only runs from async
    // callbacks, so they're always initialised by the time it's called.
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.removeListener("request", onRequest);
      if (rl) {
        rl.close();
        output.write("\n");
      }
      done();
    };

    const onRequest = (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const parsed = parseCallbackInput(url.href, state);
      if (parsed.ok) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(SUCCESS_HTML, () => finish(() => resolve(parsed.code)));
        return;
      }

      const status = parsed.reason === "state-mismatch" ? 403 : 400;
      res.writeHead(status, { "Content-Type": "text/html" });
      // A denial with a matching state is the real user saying no; stop waiting.
      // Anything else (stray requests, bad state) is ignored and we keep waiting.
      const onFlushed =
        parsed.reason === "denied"
          ? () => finish(() => reject(new Error(parsed.message)))
          : undefined;
      res.end(errorHtml(parsed.message), onFlushed);
    };

    server.on("request", onRequest);

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `Timed out waiting for authentication after ${Math.round(timeoutMs / 60_000)} minutes.`
          )
        )
      );
    }, timeoutMs);

    const rl: Interface | undefined = interactive
      ? createInterface({ input, output, prompt: PASTE_PROMPT })
      : undefined;
    if (!rl) return;

    rl.on("SIGINT", () => finish(() => reject(new AuthCancelledError())));
    rl.on("line", (line) => {
      if (settled) return;
      if (!line.trim()) {
        rl.prompt();
        return;
      }
      const parsed = parseCallbackInput(line, state);
      if (parsed.ok) {
        finish(() => resolve(parsed.code));
      } else if (parsed.reason === "denied") {
        finish(() => reject(new Error(parsed.message)));
      } else {
        output.write(parsed.message + "\n");
        rl.prompt();
      }
    });
    rl.prompt();
  });
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

export interface BrowserAuthResult {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
}

export interface BrowserAuthOptions {
  /** Try to launch a browser. Default: auto-detect via shouldLaunchBrowser(). */
  launchBrowser?: boolean;
  /** Give up after this long. Default: 10 minutes. */
  timeoutMs?: number;
  /** Offer the paste-the-redirect-URL prompt. Default: input.isTTY. */
  interactive?: boolean;
  input?: Input;
  output?: Output;
}

export async function browserAuth(
  opts: BrowserAuthOptions = {}
): Promise<BrowserAuthResult> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const interactive = opts.interactive ?? !!input.isTTY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const launch =
    opts.launchBrowser ??
    shouldLaunchBrowser({ platform: process.platform, env: process.env });
  const log = (line = "") => output.write(line + "\n");

  if (launch) {
    await confirm(input, output, "Press Enter to open your browser and log in...");
  }

  const baseUrl = getApiBaseUrl();
  const state = randomBytes(32).toString("hex");

  const server = createServer();
  const port = await listen(server);
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

  try {
    const { clientId } = await registerOAuthClient(baseUrl, redirectUri);
    const pkce = generatePkceChallenge();
    const authUrl = buildAuthorizeUrl(baseUrl, {
      clientId,
      redirectUri,
      codeChallenge: pkce.codeChallenge,
      state,
    });

    if (launch) {
      log("Opening your browser...");
      openBrowser(authUrl, () => log("Couldn't open a browser. Use the link above."));
      log();
      log("If it didn't open, use this link:");
    } else {
      log("Open this link in a browser on any device and log in:");
    }
    log(`  ${authUrl}`);
    log();
    log("Waiting for you to finish logging in... (Ctrl-C to cancel)");
    if (interactive) {
      log("If the redirect page shows a connection error, paste the URL from your browser's address bar here:");
    } else {
      log("Can't paste here: stdin isn't a terminal. If the browser can't reach this machine,");
      log("re-run in an interactive terminal (e.g. `ssh -t`).");
    }

    const code = await waitForCode({
      server,
      state,
      input,
      output,
      interactive,
      timeoutMs,
    });

    const { accessToken, refreshToken } = await exchangeCodeForToken(
      baseUrl,
      code,
      pkce.codeVerifier,
      clientId,
      redirectUri
    );
    return { accessToken, refreshToken, clientId };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
