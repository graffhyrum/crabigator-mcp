import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EVIDENCE_DIR = "/tmp/crabigator-verify";
const EVIDENCE_FILE = `${EVIDENCE_DIR}/get-status.json`;
const MOCK_TOKEN = "test-token";
const LIVE_BASE = "https://api.wanikani.com/v2";

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}

async function main(args: readonly string[]): Promise<number> {
  if (args.includes("--doctor")) return doctor();
  if (args.includes("--live")) return live();
  if (args.includes("--node")) return mocked("node");
  return mocked("bun");
}

async function doctor(): Promise<number> {
  const entry = Bun.file("bin/crabigator-mcp.ts");
  const server = Bun.file("src/server.ts");
  if (!(await entry.exists()) || !(await server.exists())) {
    process.stderr.write("doctor: server entry is missing\n");
    return 1;
  }
  const token = process.env.WANIKANI_API_TOKEN;
  const tokenState =
    token === undefined || token.length === 0 ? "missing" : "set";
  process.stdout.write(`doctor ok\nbun ${Bun.version}\ntoken ${tokenState}\n`);
  return 0;
}

async function mocked(runtime: "bun" | "node"): Promise<number> {
  if (
    runtime === "node" &&
    !(await Bun.file("dist/crabigator-mcp.js").exists())
  ) {
    process.stderr.write(
      "dist/crabigator-mcp.js is missing. Run bun run build.\n",
    );
    return 1;
  }
  const api = startMock();
  try {
    const outcome = await callGetStatus(
      runtime,
      childEnv({
        WANIKANI_API_TOKEN: MOCK_TOKEN,
        WANIKANI_API_BASE: api.baseUrl,
      }),
    );
    await writeEvidence("mock", outcome);
    return assertMock(outcome);
  } finally {
    api.stop();
  }
}

async function live(): Promise<number> {
  const token = process.env.WANIKANI_API_TOKEN;
  if (token === undefined || token.length === 0) {
    process.stderr.write(
      "Set WANIKANI_API_TOKEN to a read-only personal access token.\n",
    );
    return 2;
  }
  const outcome = await callGetStatus(
    "bun",
    childEnv({ WANIKANI_API_BASE: LIVE_BASE }),
  );
  await writeEvidence("live", outcome);
  if (
    containsToken(outcome.text, token) ||
    containsToken(outcome.stderr, token)
  ) {
    process.stderr.write("live output contains the API token\n");
    return 1;
  }
  if (outcome.isError) {
    process.stderr.write("get_status returned an error\n");
    return 1;
  }
  process.stdout.write(`evidence ${EVIDENCE_FILE}\n`);
  return 0;
}

function startMock(): { readonly baseUrl: string; readonly stop: () => void } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => mockResponse(request),
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v2`,
    stop: () => {
      server.stop(true);
    },
  };
}

function mockResponse(request: Request): Response {
  if (request.headers.get("authorization") !== `Bearer ${MOCK_TOKEN}`) {
    return Response.json(
      { error: "Unauthorized. Nice try.", code: 401 },
      { status: 401 },
    );
  }
  if (request.headers.get("wanikani-revision") !== "20170710") {
    return Response.json(
      { error: "missing revision", code: 400 },
      { status: 400 },
    );
  }
  const path = new URL(request.url).pathname;
  if (path === "/v2/user") return Response.json(mockUser());
  if (path === "/v2/summary") return Response.json(mockSummary());
  return Response.json({ error: "not found", code: 404 }, { status: 404 });
}

async function callGetStatus(
  runtime: "bun" | "node",
  env: Record<string, string>,
): Promise<ToolOutcome> {
  const transport = new StdioClientTransport({
    command: runtime,
    args:
      runtime === "node"
        ? ["dist/crabigator-mcp.js"]
        : ["bin/crabigator-mcp.ts"],
    cwd: `${import.meta.dir}/..`,
    env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: unknown) => {
    stderr += String(chunk);
  });
  const client = new Client({ name: "crabigator-verify", version: "0.1.0" });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "get_status", arguments: {} });
    return {
      text: textOf(result),
      isError: isToolError(result),
      stderr,
    };
  } finally {
    await client.close();
  }
}

async function writeEvidence(
  mode: "mock" | "live",
  outcome: ToolOutcome,
): Promise<void> {
  await Bun.$`mkdir -p ${EVIDENCE_DIR}`.quiet();
  await Bun.write(
    EVIDENCE_FILE,
    `${JSON.stringify(
      {
        mode,
        tool: "get_status",
        isError: outcome.isError,
        text: outcome.text,
      },
      null,
      2,
    )}\n`,
  );
}

function assertMock(outcome: ToolOutcome): number {
  if (
    containsToken(outcome.text, MOCK_TOKEN) ||
    containsToken(outcome.stderr, MOCK_TOKEN)
  ) {
    process.stderr.write("mock output contains the API token\n");
    return 1;
  }
  if (outcome.isError) {
    process.stderr.write("get_status returned an error\n");
    return 1;
  }
  const window = studyWindow();
  const required = [
    "example_user is level 5.",
    "Lessons available now: 2",
    "Reviews available now: 3",
    `Next reviews: ${window.next}`,
    `${window.next} 1`,
  ];
  for (const line of required) {
    if (!outcome.text.includes(line)) {
      process.stderr.write(`get_status text is missing ${line}\n`);
      return 1;
    }
  }
  process.stdout.write(`evidence ${EVIDENCE_FILE}\n`);
  return 0;
}

function childEnv(
  extra: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) env[key] = value;
  return env;
}

function textOf(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    return "";
  }
  if (!Array.isArray(result.content)) return "";
  const parts: string[] = [];
  for (const block of result.content) {
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

function isToolError(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "isError" in result &&
    result.isError === true
  );
}

function containsToken(text: string, token: string): boolean {
  return token.length > 0 && text.includes(token);
}

function mockUser(): unknown {
  return {
    object: "user",
    url: "http://127.0.0.1/v2/user",
    data_updated_at: "2018-04-06T14:26:53.022245Z",
    data: { username: "example_user", level: 5 },
  };
}

function mockSummary(): unknown {
  const window = studyWindow();
  return {
    object: "report",
    url: "http://127.0.0.1/v2/summary",
    data_updated_at: window.current,
    data: {
      lessons: [{ available_at: window.current, subject_ids: [25, 26] }],
      next_reviews_at: window.next,
      reviews: [
        { available_at: window.current, subject_ids: [21, 23, 24] },
        { available_at: window.next, subject_ids: [4] },
      ],
    },
  };
}

function studyWindow(): { readonly current: string; readonly next: string } {
  const now = new Date();
  const current = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
    ),
  );
  const next = new Date(current.getTime() + 60 * 60 * 1000);
  return { current: current.toISOString(), next: next.toISOString() };
}

type ToolOutcome = {
  readonly text: string;
  readonly isError: boolean;
  readonly stderr: string;
};
