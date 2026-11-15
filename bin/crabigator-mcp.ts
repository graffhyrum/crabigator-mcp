import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CONFIG } from "../config.ts";
import { runStdio } from "../src/server.ts";

await runStdio({
  transport: new StdioServerTransport(),
  token: CONFIG.apiToken,
  baseUrl: CONFIG.apiBase,
  fetch: (request) => fetch(request),
  clock: {
    now: () => Date.now(),
    // setTimeout runs in the Node build. Bun.sleep does not.
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  },
});
