import type { RegisterPayload, RegisterResponse } from "../types.js";

const DEFAULT_BASE_URL = "https://api.voxli.io";

function getBaseUrl(): string {
  return process.env.VOXLI_API_URL || DEFAULT_BASE_URL;
}

export async function register(
  apiKey: string,
  payload: RegisterPayload
): Promise<RegisterResponse> {
  const url = `${getBaseUrl()}/agents/register`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }

  return (await res.json()) as RegisterResponse;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`API error ${status}: ${body}`);
    this.name = "ApiError";
  }
}
