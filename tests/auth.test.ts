import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTokenExpiringSoon } from "../src/lib/auth.js";

/** Build a fake JWT with the given payload (signature is ignored). */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url"
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

function nowPlus(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

describe("isTokenExpiringSoon", () => {
  it("returns true when token expires in less than 15 minutes", () => {
    const token = fakeJwt({ exp: nowPlus(10 * 60) }); // 10 min from now
    assert.equal(isTokenExpiringSoon(token), true);
  });

  it("returns true when token is already expired", () => {
    const token = fakeJwt({ exp: nowPlus(-60) }); // 1 min ago
    assert.equal(isTokenExpiringSoon(token), true);
  });

  it("returns false when token has more than 15 minutes left", () => {
    const token = fakeJwt({ exp: nowPlus(30 * 60) }); // 30 min from now
    assert.equal(isTokenExpiringSoon(token), false);
  });

  it("returns false when token has exactly 15 minutes left", () => {
    // At exactly the boundary (with a small buffer), should not refresh
    const token = fakeJwt({ exp: nowPlus(15 * 60 + 5) });
    assert.equal(isTokenExpiringSoon(token), false);
  });

  it("returns false for a non-JWT string", () => {
    assert.equal(isTokenExpiringSoon("not-a-jwt"), false);
  });

  it("returns false for a JWT without exp claim", () => {
    const token = fakeJwt({ sub: "user123" });
    assert.equal(isTokenExpiringSoon(token), false);
  });

  it("returns false for malformed base64 payload", () => {
    assert.equal(isTokenExpiringSoon("a.!!!.c"), false);
  });
});
