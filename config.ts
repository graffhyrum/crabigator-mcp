import arkenv from "arkenv";

const env = arkenv({
  NODE_ENV: "'development' | 'production' | 'test' = 'development'",
  PORT: "number = 3000",
  WANIKANI_API_TOKEN: "string?",
  WANIKANI_API_BASE: "string = 'https://api.wanikani.com/v2'",
});

export const CONFIG = {
  nodeEnv: env.NODE_ENV,
  isDevelopment: env.NODE_ENV === "development",
  isProduction: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  port: env.PORT,
  apiToken: normalizeApiToken(env.WANIKANI_API_TOKEN),
  apiBase: normalizeApiBase(env.WANIKANI_API_BASE),
} as const;

export function normalizeApiToken(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return value;
}

export function normalizeApiBase(value: string): string {
  if (value.length === 0) return "https://api.wanikani.com/v2";
  return value;
}

export type Config = typeof CONFIG;
