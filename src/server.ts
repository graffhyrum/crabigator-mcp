import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import packageJson from "../package.json" with { type: "json" };
import {
  createWaniKaniClient,
  isWaniKaniError,
  type ClientOptions,
  type Clock,
  type Fetch,
  type WaniKaniClient,
} from "./wanikani-client.ts";
import { summaryEndpoint, userEndpoint } from "./wanikani-endpoints.ts";
import { deriveStatus, renderStatus } from "./status.ts";

export type StdioDeps = {
  readonly transport: Transport;
  readonly token: string | undefined;
  readonly baseUrl: string;
  readonly fetch: Fetch;
  readonly clock: Clock;
};

export async function runStdio(deps: StdioDeps): Promise<void> {
  const server = createCrabigatorServer(deps);
  await server.connect(deps.transport);
}

export function createCrabigatorServer(options: ClientOptions): McpServer {
  const client = createWaniKaniClient(options);
  const server = new McpServer({
    name: "crabigator-mcp",
    version: packageJson.version,
  });
  server.registerTool(
    "get_status",
    {
      title: "Study status",
      description:
        "Read the current level, lessons available now, reviews available now, the next review time, and review counts for the next 24 hours.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    () => getStatus(client, options.clock),
  );
  return server;
}

async function getStatus(
  client: WaniKaniClient,
  clock: Clock,
): Promise<CallToolResult> {
  try {
    const user = await client.read(userEndpoint);
    const summary = await client.read(summaryEndpoint);
    const text = renderStatus(
      deriveStatus(user, summary, new Date(clock.now())),
    );
    return {
      content: [
        { type: "text", text: text.summary },
        { type: "text", text: text.json },
      ],
    };
  } catch (error) {
    return toolError(error);
  }
}

function toolError(error: unknown): CallToolResult {
  const text = isWaniKaniError(error)
    ? error.message
    : "The WaniKani API could not be reached.";
  return {
    isError: true,
    content: [{ type: "text", text }],
  };
}
