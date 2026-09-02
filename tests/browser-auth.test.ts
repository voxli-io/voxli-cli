import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { PassThrough, Writable } from "node:stream";
import {
  AuthCancelledError,
  browserAuth,
  browserLaunchCommand,
  parseCallbackInput,
  shouldLaunchBrowser,
  type BrowserAuthOptions,
} from "../src/lib/browser-auth.js";

const STATE = "expected-state-123";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("parseCallbackInput", () => {
  it("accepts the full redirect URL", () => {
    const r = parseCallbackInput(
      `http://127.0.0.1:53211/callback?code=abc&state=${STATE}`,
      STATE
    );
    assert.deepEqual(r, { ok: true, code: "abc" });
  });

  it("accepts a URL on a different host/port (e.g. a forwarded one)", () => {
    const r = parseCallbackInput(
      `http://localhost:9999/callback?code=abc&state=${STATE}`,
      STATE
    );
    assert.deepEqual(r, { ok: true, code: "abc" });
  });

  it("accepts path + query", () => {
    const r = parseCallbackInput(`/callback?code=abc&state=${STATE}`, STATE);
    assert.deepEqual(r, { ok: true, code: "abc" });
  });

  it("accepts a bare query string, with or without '?'", () => {
    assert.deepEqual(parseCallbackInput(`code=abc&state=${STATE}`, STATE), {
      ok: true,
      code: "abc",
    });
    assert.deepEqual(parseCallbackInput(`?state=${STATE}&code=abc`, STATE), {
      ok: true,
      code: "abc",
    });
  });

  it("strips surrounding whitespace and quotes", () => {
    const r = parseCallbackInput(
      `  "http://127.0.0.1:1/callback?code=abc&state=${STATE}"  `,
      STATE
    );
    assert.deepEqual(r, { ok: true, code: "abc" });
  });

  it("rejects plain text and a bare code", () => {
    for (const input of ["hello", "abc123", "", "http://"]) {
      const r = parseCallbackInput(input, STATE);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "not-a-redirect");
    }
  });

  it("recognises the login link being pasted back", () => {
    const r = parseCallbackInput(
      `https://api.voxli.io/oauth/authorize?response_type=code&client_id=x&redirect_uri=y&state=${STATE}`,
      STATE
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "login-url");
  });

  it("rejects a mismatched state", () => {
    const r = parseCallbackInput(
      "http://127.0.0.1:1/callback?code=abc&state=other",
      STATE
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "state-mismatch");
  });

  it("rejects a missing state", () => {
    const r = parseCallbackInput("http://127.0.0.1:1/callback?code=abc", STATE);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "state-mismatch");
  });

  it("reports a denial with its description", () => {
    const r = parseCallbackInput(
      `http://127.0.0.1:1/callback?error=access_denied&error_description=User%20said%20no&state=${STATE}`,
      STATE
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "denied");
      assert.match(r.message, /access_denied/);
      assert.match(r.message, /User said no/);
    }
  });

  it("checks state before trusting an error", () => {
    const r = parseCallbackInput(
      "http://127.0.0.1:1/callback?error=access_denied&state=other",
      STATE
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "state-mismatch");
  });

  it("rejects a redirect with state but no code", () => {
    const r = parseCallbackInput(
      `http://127.0.0.1:1/callback?state=${STATE}`,
      STATE
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "missing-code");
  });
});

describe("shouldLaunchBrowser", () => {
  const linux = (env: NodeJS.ProcessEnv) =>
    shouldLaunchBrowser({ platform: "linux", env });
  const darwin = (env: NodeJS.ProcessEnv) =>
    shouldLaunchBrowser({ platform: "darwin", env });

  it("launches on a plain macOS desktop", () => {
    assert.equal(darwin({}), true);
  });

  it("launches on Windows", () => {
    assert.equal(shouldLaunchBrowser({ platform: "win32", env: {} }), true);
  });

  it("does not launch when BROWSER=none", () => {
    assert.equal(darwin({ BROWSER: "none" }), false);
    assert.equal(darwin({ BROWSER: "NONE" }), false);
  });

  it("BROWSER overrides SSH and headless signals (VS Code Remote)", () => {
    assert.equal(
      linux({ BROWSER: "/vscode/helpers/browser.sh", SSH_CONNECTION: "x" }),
      true
    );
  });

  it("does not launch over SSH without BROWSER", () => {
    assert.equal(darwin({ SSH_CONNECTION: "1.2.3.4 1 5.6.7.8 22" }), false);
    assert.equal(linux({ SSH_TTY: "/dev/pts/0", DISPLAY: ":0" }), false);
  });

  it("does not launch in CI", () => {
    assert.equal(darwin({ CI: "true" }), false);
  });

  it("on Linux requires a display unless in WSL", () => {
    assert.equal(linux({}), false);
    assert.equal(linux({ DISPLAY: ":0" }), true);
    assert.equal(linux({ WAYLAND_DISPLAY: "wayland-0" }), true);
    assert.equal(linux({ WSL_DISTRO_NAME: "Ubuntu" }), true);
  });
});

describe("browserLaunchCommand", () => {
  const url = "https://api.example.com/oauth/authorize?a=1&b=2";

  it("uses BROWSER with %s substitution", () => {
    assert.deepEqual(
      browserLaunchCommand(url, { platform: "linux", env: { BROWSER: "firefox --new-tab %s" } }),
      { cmd: "firefox", args: ["--new-tab", url] }
    );
  });

  it("uses BROWSER appending the URL when there is no %s", () => {
    assert.deepEqual(
      browserLaunchCommand(url, { platform: "linux", env: { BROWSER: "/x/browser.sh" } }),
      { cmd: "/x/browser.sh", args: [url] }
    );
  });

  it("uses open on macOS", () => {
    assert.deepEqual(browserLaunchCommand(url, { platform: "darwin", env: {} }), {
      cmd: "open",
      args: [url],
    });
  });

  it("passes the URL as a single argument on Windows (no cmd parsing of &)", () => {
    const r = browserLaunchCommand(url, { platform: "win32", env: {} });
    assert.equal(r.cmd, "rundll32");
    assert.equal(r.args.at(-1), url);
  });

  it("uses the Windows launcher from WSL", () => {
    const r = browserLaunchCommand(url, { platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } });
    assert.equal(r.cmd, "rundll32.exe");
    assert.equal(r.args.at(-1), url);
  });

  it("uses xdg-open on Linux", () => {
    assert.deepEqual(browserLaunchCommand(url, { platform: "linux", env: { DISPLAY: ":0" } }), {
      cmd: "xdg-open",
      args: [url],
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end against a fake OAuth server
// ---------------------------------------------------------------------------

interface FakeOAuth {
  url: string;
  registrations: Array<{ redirect_uris: string[] }>;
  tokenRequests: URLSearchParams[];
  failRegistration: boolean;
  close(): Promise<void>;
}

function startFakeOAuth(): Promise<FakeOAuth> {
  const fake: FakeOAuth = {
    url: "",
    registrations: [],
    tokenRequests: [],
    failRegistration: false,
    close: async () => {},
  };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.method === "POST" && req.url === "/oauth/register") {
      if (fake.failRegistration) {
        res.writeHead(500);
        res.end("boom");
        return;
      }
      fake.registrations.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ client_id: "client-123" }));
      return;
    }
    if (req.method === "POST" && req.url === "/oauth/token") {
      fake.tokenRequests.push(new URLSearchParams(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ access_token: "access-abc", refresh_token: "refresh-xyz" })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      fake.close = () =>
        new Promise((r) => {
          server.closeAllConnections();
          server.close(() => r());
        });
      resolve(fake);
    });
  });
}

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const AUTH_URL_RE = /https?:\/\/\S+\/oauth\/authorize\?\S+/;

function startAuth(opts: BrowserAuthOptions = {}) {
  const input = new PassThrough();
  let out = "";
  const output = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  const promise = browserAuth({
    launchBrowser: false,
    interactive: true,
    input,
    output,
    ...opts,
  });
  promise.catch(() => {}); // inspected later; don't surface as unhandled

  return {
    input,
    promise,
    output: () => out,
    async authUrl() {
      await waitFor(() => AUTH_URL_RE.test(out));
      const url = new URL(out.match(AUTH_URL_RE)![0]);
      const get = (k: string) => {
        const v = url.searchParams.get(k);
        assert.ok(v, `authorize URL is missing ${k}`);
        return v;
      };
      return {
        url,
        state: get("state"),
        redirectUri: get("redirect_uri"),
        codeChallenge: get("code_challenge"),
        clientId: get("client_id"),
      };
    },
  };
}

const EXPECTED_RESULT = {
  accessToken: "access-abc",
  refreshToken: "refresh-xyz",
  clientId: "client-123",
};

describe("browserAuth", () => {
  let fake: FakeOAuth;
  let savedApiUrl: string | undefined;

  before(async () => {
    fake = await startFakeOAuth();
    savedApiUrl = process.env.VOXLI_API_URL;
    process.env.VOXLI_API_URL = fake.url;
  });

  after(async () => {
    if (savedApiUrl === undefined) delete process.env.VOXLI_API_URL;
    else process.env.VOXLI_API_URL = savedApiUrl;
    await fake.close();
  });

  it("completes via the loopback callback", async () => {
    const auth = startAuth();
    const { state, redirectUri, codeChallenge, clientId } = await auth.authUrl();

    assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.deepEqual(fake.registrations.at(-1)?.redirect_uris, [redirectUri]);
    assert.equal(clientId, "client-123");

    const res = await fetch(`${redirectUri}?code=CODE1&state=${state}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Authenticated/);

    assert.deepEqual(await auth.promise, EXPECTED_RESULT);

    const token = fake.tokenRequests.at(-1)!;
    assert.equal(token.get("grant_type"), "authorization_code");
    assert.equal(token.get("code"), "CODE1");
    assert.equal(token.get("redirect_uri"), redirectUri);
    assert.equal(token.get("client_id"), "client-123");
    const verifier = token.get("code_verifier")!;
    assert.equal(
      createHash("sha256").update(verifier).digest("base64url"),
      codeChallenge,
      "PKCE verifier must match the challenge sent to /authorize"
    );
  });

  it("completes via a pasted redirect URL and shuts the server down", async () => {
    const auth = startAuth();
    const { state, redirectUri } = await auth.authUrl();
    assert.match(auth.output(), /paste the URL from your browser's address bar here:/);

    auth.input.write(`${redirectUri}?code=CODE2&state=${state}\n`);

    assert.deepEqual(await auth.promise, EXPECTED_RESULT);
    const token = fake.tokenRequests.at(-1)!;
    assert.equal(token.get("code"), "CODE2");
    // Exchange still uses the loopback redirect_uri the code was issued for.
    assert.equal(token.get("redirect_uri"), redirectUri);

    await assert.rejects(fetch(redirectUri), "loopback server should be closed");
  });

  it("accepts a pasted query string", async () => {
    const auth = startAuth();
    const { state } = await auth.authUrl();
    auth.input.write(`code=CODE3&state=${state}\n`);
    assert.deepEqual(await auth.promise, EXPECTED_RESULT);
    assert.equal(fake.tokenRequests.at(-1)!.get("code"), "CODE3");
  });

  it("rejects a bad paste, keeps waiting, then accepts a good one", async () => {
    const auth = startAuth();
    const { state, redirectUri } = await auth.authUrl();

    auth.input.write("hello there\n");
    await waitFor(() => /doesn't look like the page URL/.test(auth.output()));

    auth.input.write(`${redirectUri}?code=CODE4&state=wrong-state\n`);
    await waitFor(() => /different login attempt/.test(auth.output()));

    auth.input.write(`${redirectUri}?code=CODE5&state=${state}\n`);
    assert.deepEqual(await auth.promise, EXPECTED_RESULT);
    assert.equal(fake.tokenRequests.at(-1)!.get("code"), "CODE5");
  });

  it("answers 403 to a loopback hit with the wrong state and keeps waiting", async () => {
    const auth = startAuth();
    const { state, redirectUri } = await auth.authUrl();

    const bad = await fetch(`${redirectUri}?code=EVIL&state=nope`);
    assert.equal(bad.status, 403);

    const other = await fetch(`http://${new URL(redirectUri).host}/somewhere-else`);
    assert.equal(other.status, 404);

    const good = await fetch(`${redirectUri}?code=CODE6&state=${state}`);
    assert.equal(good.status, 200);
    assert.deepEqual(await auth.promise, EXPECTED_RESULT);
    assert.equal(fake.tokenRequests.at(-1)!.get("code"), "CODE6");
  });

  it("fails when the user denies via the pasted URL", async () => {
    const auth = startAuth();
    const { state, redirectUri } = await auth.authUrl();
    auth.input.write(
      `${redirectUri}?error=access_denied&error_description=nope&state=${state}\n`
    );
    await assert.rejects(auth.promise, /access_denied/);
  });

  it("fails when the user denies via the loopback callback", async () => {
    const auth = startAuth();
    const { state, redirectUri } = await auth.authUrl();
    const res = await fetch(`${redirectUri}?error=access_denied&state=${state}`);
    assert.equal(res.status, 400);
    await assert.rejects(auth.promise, /access_denied/);
  });

  it("times out", async () => {
    const auth = startAuth({ timeoutMs: 100 });
    await auth.authUrl();
    await assert.rejects(auth.promise, /Timed out/);
  });

  it("skips the paste prompt when not interactive but still serves loopback", async () => {
    const auth = startAuth({ interactive: false });
    const { state, redirectUri } = await auth.authUrl();
    assert.match(auth.output(), /stdin isn't a terminal/);
    assert.doesNotMatch(auth.output(), /paste the URL from your browser's address bar here:/);
    await fetch(`${redirectUri}?code=CODE8&state=${state}`);
    assert.deepEqual(await auth.promise, EXPECTED_RESULT);
  });

  it("propagates registration failures", async () => {
    fake.failRegistration = true;
    try {
      const auth = startAuth();
      await assert.rejects(auth.promise, /registration failed/);
    } finally {
      fake.failRegistration = false;
    }
  });

  it("cancels on Ctrl-C at the confirm prompt, before anything is opened", async () => {
    const input = new PassThrough();
    let out = "";
    // readline only handles Ctrl-C in terminal mode, which it picks from the
    // output stream; BROWSER keeps a regression from launching a real browser.
    const output = Object.assign(
      new Writable({
        write(chunk, _enc, cb) {
          out += chunk.toString();
          cb();
        },
      }),
      { isTTY: true }
    );
    const savedBrowser = process.env.BROWSER;
    process.env.BROWSER = "true";
    try {
      const promise = browserAuth({
        launchBrowser: true,
        interactive: true,
        // Bounds a regression: without this the flow would wait for a code.
        timeoutMs: 500,
        input,
        output,
      });
      promise.catch(() => {});
      await waitFor(() => /Press Enter/.test(out));

      input.write("\u0003");

      await assert.rejects(promise, (err) => err instanceof AuthCancelledError);
      assert.doesNotMatch(out, AUTH_URL_RE, "no login should have been started");
    } finally {
      if (savedBrowser === undefined) delete process.env.BROWSER;
      else process.env.BROWSER = savedBrowser;
    }
  });
});
