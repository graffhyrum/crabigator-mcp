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
  apiToken: env.WANIKANI_API_TOKEN,
  apiBase: env.WANIKANI_API_BASE,
} as const;

export type Config = typeof CONFIG;
