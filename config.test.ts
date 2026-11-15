import { expect, test } from "bun:test";
import { CONFIG } from "./config.ts";

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
  const token = CONFIG.apiToken;
  expect(token === undefined || token.length > 0).toBe(true);
});
