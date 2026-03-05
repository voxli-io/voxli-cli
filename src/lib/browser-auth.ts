import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getApiBaseUrl } from "./api.js";
import {
  generatePkceChallenge,
  registerOAuthClient,
  exchangeCodeForToken,
  buildAuthorizeUrl,
} from "./oauth.js";

const AUTH_TIMEOUT_MS = 120_000;

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Voxli CLI</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb}
.card{text-align:center;padding:2rem;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{color:#0a3b29;margin:0 0 .5rem}p{color:#6b7280;margin:0}</style></head>
<body><div class="card"><h1>Authenticated!</h1><p>You can close this tab and return to the terminal.</p></div></body>
</html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Voxli CLI</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb}
.card{text-align:center;padding:2rem;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{color:#dc2626;margin:0 0 .5rem}p{color:#6b7280;margin:0}</style></head>
<body><div class="card"><h1>Authentication failed</h1><p>State mismatch. Please try again.</p></div></body>
</html>`;

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", url] : [url];

  execFile(cmd, args, (err) => {
    if (err) {
      console.log(`\nOpen this URL in your browser:\n  ${url}\n`);
    }
  });
}

export interface BrowserAuthResult {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
}

export async function browserAuth(): Promise<BrowserAuthResult> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    await rl.question("Press Enter to open the browser to authenticate...");
  } finally {
    rl.close();
  }

  const baseUrl = getApiBaseUrl();

  return new Promise<BrowserAuthResult>((resolve, reject) => {
    const state = randomBytes(32).toString("hex");

    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const returnedCode = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");

        if (returnedState !== state) {
          res.writeHead(403, { "Content-Type": "text/html" });
          res.end(ERROR_HTML);
          return;
        }

        if (!returnedCode) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(ERROR_HTML);
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(SUCCESS_HTML);

        cleanup();

        exchangeCodeForToken(
          baseUrl,
          returnedCode,
          codeVerifier,
          clientId,
          redirectUri
        )
          .then(({ accessToken, refreshToken }) =>
            resolve({ accessToken, refreshToken, clientId })
          )
          .catch(reject);
      }
    );

    let codeVerifier: string;
    let clientId: string;
    let redirectUri: string;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Browser authentication timed out after 2 minutes."));
    }, AUTH_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      server.closeAllConnections();
      server.close();
    }

    server.listen(0, "127.0.0.1", async () => {
      try {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          cleanup();
          reject(new Error("Failed to start local server."));
          return;
        }

        const port = addr.port;
        redirectUri = `http://127.0.0.1:${port}/callback`;

        const registration = await registerOAuthClient(baseUrl, redirectUri);
        clientId = registration.clientId;

        const pkce = generatePkceChallenge();
        codeVerifier = pkce.codeVerifier;

        const authUrl = buildAuthorizeUrl(baseUrl, {
          clientId,
          redirectUri,
          codeChallenge: pkce.codeChallenge,
          state,
        });

        console.log("Opening browser to authenticate...");
        openBrowser(authUrl);
        console.log("Waiting for authentication (timeout: 2 min)...");
        console.log(`\nIf the browser didn't open, visit:\n  ${authUrl}\n`);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  });
}
