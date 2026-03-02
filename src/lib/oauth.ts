import { randomBytes, createHash } from "node:crypto";

export function generatePkceChallenge(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

export async function registerOAuthClient(
  baseUrl: string,
  redirectUri: string
): Promise<{ clientId: string }> {
  const res = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Voxli CLI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!res.ok) {
    throw new Error(`OAuth client registration failed (${res.status})`);
  }

  const data = (await res.json()) as { client_id: string };
  return { clientId: data.client_id };
}

export async function exchangeCodeForToken(
  baseUrl: string,
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status})`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}

export async function refreshAccessToken(
  baseUrl: string,
  refreshToken: string,
  clientId: string
): Promise<{ accessToken: string; refreshToken?: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status})`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}

export function buildAuthorizeUrl(
  baseUrl: string,
  params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
  }
): string {
  const url = new URL("/oauth/authorize", baseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  return url.toString();
}
