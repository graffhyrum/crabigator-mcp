import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, test } from "bun:test";
import { createCrabigatorServer, runStdio } from "./server.ts";
import type { Fetch } from "./wanikani-client.ts";

const BASE = "https://api.wanikani.com/v2";
const NOW = Date.parse("2018-04-11T21:30:00.000Z");

test("get_status returns the level, counts, next review, and 24 hour forecast", async () => {
  const http = script([jsonResponse(userBody()), jsonResponse(summaryBody())]);
  const result = await callTool(http.fetch);
  expect(result.isError).toBeFalsy();
  const text = textOf(result);
  expect(text).toContain("example_user is level 5.");
  expect(text).toContain("Lessons available now: 2");
  expect(text).toContain("Reviews available now: 3");
  expect(text).toContain("Next reviews: 2018-04-11T22:00:00.000Z");
  expect(text).toContain("2018-04-11T22:00:00.000Z 1");
  expect(text).toContain('"username":"example_user"');
  expect(http.requests.map((request) => new URL(request.url).pathname)).toEqual(
    ["/v2/user", "/v2/summary"],
  );
});

test("get_status reports a missing token and does not call fetch", async () => {
  const http = script([]);
  const result = await callTool(http.fetch, { token: undefined });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain("WANIKANI_API_TOKEN is missing");
  expect(http.requests).toHaveLength(0);
});

test("get_status does not request the summary when the token is rejected", async () => {
  const http = script([
    jsonResponse({ error: "Unauthorized. Nice try.", code: 401 }, 401),
  ]);
  const result = await callTool(http.fetch);
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain("token was rejected");
  expect(http.requests).toHaveLength(1);
});

test("get_status hides transport errors", async () => {
  const fetch: Fetch = async () => {
    throw new Error("WANIKANI_API_TOKEN=secret-token");
  };
  const result = await callTool(fetch);
  expect(result.isError).toBe(true);
  const text = textOf(result);
  expect(text).toBe("The WaniKani API could not be reached.");
  expect(text.includes("secret-token")).toBe(false);
});

async function callTool(
  fetch: Fetch,
  options: { readonly token?: string } = {},
) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createCrabigatorServer({
    token: "token" in options ? options.token : "test-token",
    baseUrl: BASE,
    fetch,
    clock: { now: () => NOW, sleep: async () => undefined },
  });
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  const result = await client.callTool({ name: "get_status", arguments: {} });
  await client.close();
  return result;
}

function textOf(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    return "";
  }
  const content = result.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (isTextBlock(block)) parts.push(block.text);
  }
  return parts.join("\n");
}

function isTextBlock(value: unknown): value is { readonly text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function script(responses: readonly Response[]): {
  readonly fetch: Fetch;
  readonly requests: Request[];
} {
  const queue = [...responses];
  const requests: Request[] = [];
  const fetch: Fetch = async (request) => {
    requests.push(request);
    const next = queue.shift();
    if (next === undefined) throw new Error("no scripted response");
    return next;
  };
  return { fetch, requests };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function userBody(): unknown {
  return {
    object: "user",
    url: `${BASE}/user`,
    data_updated_at: "2018-04-06T14:26:53.022245Z",
    data: {
      username: "example_user",
      level: 5,
    },
  };
}

function summaryBody(): unknown {
  return {
    object: "report",
    url: `${BASE}/summary`,
    data_updated_at: "2018-04-11T21:00:00.000000Z",
    data: {
      lessons: [
        {
          available_at: "2018-04-11T21:00:00.000Z",
          subject_ids: [25, 26],
        },
      ],
      next_reviews_at: "2018-04-11T22:00:00.000Z",
      reviews: [
        {
          available_at: "2018-04-11T21:00:00.000Z",
          subject_ids: [21, 23, 24],
        },
        {
          available_at: "2018-04-11T22:00:00.000Z",
          subject_ids: [4],
        },
      ],
    },
  };
}

test("runStdio serves get_status on the transport it is given", async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await runStdio({
    transport: serverSide,
    token: undefined,
    baseUrl: BASE,
    fetch: async () => {
      throw new Error("fetch should not run");
    },
    clock: { now: () => NOW, sleep: async () => undefined },
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  const result = await client.callTool({ name: "get_status", arguments: {} });
  expect(result.isError).toBe(true);
  await client.close();
});
