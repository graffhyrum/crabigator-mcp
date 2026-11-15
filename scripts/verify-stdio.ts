import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EVIDENCE_DIR = "/tmp/crabigator-verify";
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
  const window = studyWindow();
  const api = startMock(window);
  try {
    const outcome = await callGetStatus(
      runtime,
      childEnv({
        WANIKANI_API_TOKEN: MOCK_TOKEN,
        WANIKANI_API_BASE: api.baseUrl,
      }),
    );
    if (outputContainsToken(outcome, MOCK_TOKEN)) {
      process.stderr.write("mock output contains the API token\n");
      return 1;
    }
    const evidenceFile = await writeEvidence("mock", outcome);
    return assertMock(outcome, window, evidenceFile);
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
  if (outputContainsToken(outcome, token)) {
    process.stderr.write("live output contains the API token\n");
    return 1;
  }
  const evidenceFile = await writeEvidence("live", outcome);
  if (outcome.isError) {
    process.stderr.write("get_status returned an error\n");
    return 1;
  }
  process.stdout.write(`evidence ${evidenceFile}\n`);
  return 0;
}

function startMock(window: StudyWindow): {
  readonly baseUrl: string;
  readonly stop: () => void;
} {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => mockResponse(request, window),
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v2`,
    stop: () => {
      server.stop(true);
    },
  };
}

function mockResponse(request: Request, window: StudyWindow): Response {
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
  if (path === "/v2/summary") return Response.json(mockSummary(window));
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
): Promise<string> {
  const file = `${EVIDENCE_DIR}/${Date.now()}-${process.pid}-${crypto.randomUUID()}/get-status.json`;
  const directory = file.slice(0, file.lastIndexOf("/"));
  await Bun.$`mkdir -p ${directory}`.quiet();
  await Bun.write(
    file,
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
  return file;
}

function assertMock(
  outcome: ToolOutcome,
  window: StudyWindow,
  evidenceFile: string,
): number {
  if (outcome.isError) {
    process.stderr.write("get_status returned an error\n");
    return 1;
  }
  const required = [
    "example_user is level 5.",
    "Lessons available now: 2",
    "Reviews available now: 3",
    `Next reviews: ${window.upcoming}`,
    `${window.upcoming} 1`,
  ];
  for (const line of required) {
    if (!outcome.text.includes(line)) {
      process.stderr.write(`get_status text is missing ${line}\n`);
      return 1;
    }
  }
  process.stdout.write(`evidence ${evidenceFile}\n`);
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

function outputContainsToken(outcome: ToolOutcome, token: string): boolean {
  return (
    containsToken(outcome.text, token) || containsToken(outcome.stderr, token)
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

function mockSummary(window: StudyWindow): unknown {
  return {
    object: "report",
    url: "http://127.0.0.1/v2/summary",
    data_updated_at: window.due,
    data: {
      lessons: [{ available_at: window.due, subject_ids: [25, 26] }],
      next_reviews_at: window.upcoming,
      reviews: [
        { available_at: window.due, subject_ids: [21, 23, 24] },
        { available_at: window.upcoming, subject_ids: [4] },
      ],
    },
  };
}

function studyWindow(): StudyWindow {
  const now = Date.now();
  return {
    due: new Date(now - 30 * 60 * 1000).toISOString(),
    upcoming: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  };
}

type StudyWindow = {
  readonly due: string;
  readonly upcoming: string;
};

type ToolOutcome = {
  readonly text: string;
  readonly isError: boolean;
  readonly stderr: string;
};
