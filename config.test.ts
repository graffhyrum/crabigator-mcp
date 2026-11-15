import { expect, test } from "bun:test";
import { CONFIG, normalizeApiBase, normalizeApiToken } from "./config.ts";

test("config follows NODE_ENV", () => {
  const nodeEnv = process.env.NODE_ENV;
  const expected =
    nodeEnv === "production"
      ? "production"
      : nodeEnv === "test"
        ? "test"
        : "development";
  expect(CONFIG.nodeEnv).toBe(expected);
  expect(CONFIG.isDevelopment).toBe(expected === "development");
  expect(CONFIG.isProduction).toBe(expected === "production");
  expect(CONFIG.isTest).toBe(expected === "test");
  expect(CONFIG.port).toBe(Number(process.env.PORT ?? 3000));
  const configuredBase = process.env.WANIKANI_API_BASE;
  const expectedBase =
    configuredBase === undefined || configuredBase.length === 0
      ? "https://api.wanikani.com/v2"
      : configuredBase;
  expect(CONFIG.apiBase).toBe(expectedBase);
  expect(CONFIG.apiToken).toBe(
    normalizeApiToken(process.env.WANIKANI_API_TOKEN),
  );
});

test("an empty API base falls back to the WaniKani API", () => {
  expect(normalizeApiBase("")).toBe("https://api.wanikani.com/v2");
  expect(normalizeApiBase("https://example.test/v2")).toBe(
    "https://example.test/v2",
  );
});

test("an empty token counts as missing", () => {
  expect(normalizeApiToken(undefined)).toBeUndefined();
  expect(normalizeApiToken("")).toBeUndefined();
  expect(normalizeApiToken("read-only-token")).toBe("read-only-token");
});
