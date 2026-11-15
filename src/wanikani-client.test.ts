import { expect, test } from "bun:test";
import { type } from "arktype";
import {
  createWaniKaniClient,
  isWaniKaniError,
  type ClientOptions,
  type Clock,
  type Collection,
  type Fetch,
  type WaniKaniFailure,
} from "./wanikani-client.ts";
import { userEndpoint } from "./wanikani-endpoints.ts";

const BASE = "https://api.wanikani.com/v2";
const TOKEN = "test-token";
const NOW = 1_700_000_000_000;

const subjects = {
  kind: "collection",
  path: "subjects",
  item: type({ id: "number.integer" }),
} satisfies Collection<{ readonly id: number }>;

test("every request sends the bearer token and the revision header", async () => {
  const http = script([jsonResponse(userBody(), 200, { ETag: '"u1"' })]);
  const user = await client(http.fetch).read(userEndpoint);
  expect(user.username).toBe("example_user");
  expect(`${user.level}`).toBe("5");
  expect(http.requests).toHaveLength(1);
  const request = http.requests[0];
  if (request === undefined) throw new Error("missing request");
  expect(request.method).toBe("GET");
  expect(request.url).toBe(`${BASE}/user`);
  expect(request.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
  expect(request.headers.get("Wanikani-Revision")).toBe("20170710");
});

test("a blank token fails before fetch", async () => {
  const http = script([]);
  const failure = await failureOf(() =>
    client(http.fetch, { token: "   " }).read(userEndpoint),
  );
  expect(failure.kind).toBe("missing_token");
  expect(http.requests).toHaveLength(0);
});

test("a missing token fails before fetch", async () => {
  const http = script([]);
  const failure = await failureOf(() =>
    client(http.fetch, { token: undefined }).read(userEndpoint),
  );
  expect(failure.kind).toBe("missing_token");
  expect(http.requests).toHaveLength(0);
});

test("401 maps to an unauthorized error", async () => {
  const http = script([
    jsonResponse({ error: "Unauthorized. Nice try.", code: 401 }, 401),
  ]);
  const failure = await failureOf(() => client(http.fetch).read(userEndpoint));
  expect(failure).toEqual({ kind: "unauthorized" });
  expect(http.requests).toHaveLength(1);
});

test("pagination follows next_url and concatenates data", async () => {
  const second = `${BASE}/subjects?page_after_id=2`;
  const http = script([
    jsonResponse(collection([{ id: 1 }, { id: 2 }], second)),
    jsonResponse(collection([{ id: 3 }], null)),
  ]);
  const items = await client(http.fetch).read(subjects);
  expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  expect(http.requests.map((request) => request.url)).toEqual([
    `${BASE}/subjects`,
    second,
  ]);
  for (const request of http.requests) {
    expect(request.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(request.headers.get("Wanikani-Revision")).toBe("20170710");
  }
});

test("an off-host next_url is rejected and the token stays on the API base", async () => {
  const http = script([
    jsonResponse(collection([{ id: 1 }], "https://evil.test/subjects")),
  ]);
  const failure = await failureOf(() => client(http.fetch).read(subjects));
  expect(failure.kind).toBe("invalid_body");
  expect(http.requests).toHaveLength(1);
});

test("a repeated page URL is rejected", async () => {
  const url = `${BASE}/subjects`;
  const http = script([jsonResponse(collection([{ id: 1 }], url))]);
  const failure = await failureOf(() => client(http.fetch).read(subjects));
  expect(failure.kind).toBe("invalid_body");
  expect(http.requests).toHaveLength(1);
});

test("a 429 waits until RateLimit-Reset and then retries", async () => {
  const clock = fakeClock(NOW);
  const reset = NOW / 1000 + 5;
  const http = script([
    jsonResponse({ error: "Rate Limit Exceeded" }, 429, {
      "RateLimit-Reset": `${reset}`,
    }),
    jsonResponse(userBody()),
  ]);
  const user = await client(http.fetch, { clock }).read(userEndpoint);
  expect(user.username).toBe("example_user");
  expect(clock.sleeps).toEqual([5_000]);
  expect(http.requests).toHaveLength(2);
  const retried = http.requests[1];
  if (retried === undefined) throw new Error("missing retry");
  expect(retried.headers.get("Wanikani-Revision")).toBe("20170710");
});

test("a 429 without RateLimit-Reset waits for the fallback", async () => {
  const clock = fakeClock(NOW);
  const http = script([
    jsonResponse({ error: "Rate Limit Exceeded" }, 429),
    jsonResponse(userBody()),
  ]);
  await client(http.fetch, { clock }).read(userEndpoint);
  expect(clock.sleeps).toEqual([5_000]);
});

test("a 429 with a far reset waits until RateLimit-Reset", async () => {
  const clock = fakeClock(NOW);
  const reset = NOW / 1000 + 120;
  const http = script([
    jsonResponse({}, 429, { "RateLimit-Reset": `${reset}` }),
    jsonResponse(userBody()),
  ]);
  await client(http.fetch, { clock }).read(userEndpoint);
  expect(clock.sleeps).toEqual([65_000, 55_000]);
  expect(http.requests).toHaveLength(2);
});

test("a 429 with a past reset does not wait", async () => {
  const clock = fakeClock(NOW);
  const reset = NOW / 1000 - 10;
  const http = script([
    jsonResponse({}, 429, { "RateLimit-Reset": `${reset}` }),
    jsonResponse(userBody()),
  ]);
  await client(http.fetch, { clock }).read(userEndpoint);
  expect(clock.sleeps).toEqual([]);
});

test("three 429 responses become a rate limit error", async () => {
  const clock = fakeClock(NOW);
  const http = script([
    jsonResponse({}, 429),
    jsonResponse({}, 429),
    jsonResponse({}, 429),
  ]);
  const failure = await failureOf(() =>
    client(http.fetch, { clock }).read(userEndpoint),
  );
  expect(failure.kind).toBe("rate_limited");
  expect(clock.sleeps).toEqual([5_000, 5_000]);
  expect(http.requests).toHaveLength(3);
});

test("RateLimit-Remaining 0 delays the next request until reset", async () => {
  const clock = fakeClock(NOW);
  const reset = NOW / 1000 + 5;
  const http = script([
    jsonResponse(userBody(), 200, {
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": `${reset}`,
    }),
    jsonResponse(userBody()),
  ]);
  const api = client(http.fetch, { clock });
  await api.read(userEndpoint);
  await api.read(userEndpoint);
  expect(clock.sleeps).toEqual([5_000]);
  expect(http.requests).toHaveLength(2);
});

test("RateLimit-Remaining 0 without a reset does not delay the next request", async () => {
  const clock = fakeClock(NOW);
  const http = script([
    jsonResponse(userBody(), 200, { "RateLimit-Remaining": "0" }),
    jsonResponse(userBody()),
  ]);
  const api = client(http.fetch, { clock });
  await api.read(userEndpoint);
  await api.read(userEndpoint);
  expect(clock.sleeps).toEqual([]);
});

test("RateLimit-Remaining 0 with a past reset does not delay the next request", async () => {
  const clock = fakeClock(NOW);
  const reset = NOW / 1000 - 10;
  const http = script([
    jsonResponse(userBody(), 200, {
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": `${reset}`,
    }),
    jsonResponse(userBody()),
  ]);
  const api = client(http.fetch, { clock });
  await api.read(userEndpoint);
  await api.read(userEndpoint);
  expect(clock.sleeps).toEqual([]);
});

test("a non-numeric rate limit header does not delay the next request", async () => {
  const clock = fakeClock(NOW);
  const http = script([
    jsonResponse(userBody(), 200, {
      "RateLimit-Remaining": "nope",
      "RateLimit-Reset": "soon",
    }),
    jsonResponse(userBody()),
  ]);
  const api = client(http.fetch, { clock });
  await api.read(userEndpoint);
  await api.read(userEndpoint);
  expect(clock.sleeps).toEqual([]);
});

test("a 304 returns the cached body and the next request sends If-None-Match", async () => {
  const http = script([
    jsonResponse(userBody(), 200, {
      ETag: '"one"',
      "Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT",
    }),
    new Response(null, { status: 304, headers: { ETag: '"two"' } }),
    new Response(null, { status: 304 }),
  ]);
  const api = client(http.fetch);
  const first = await api.read(userEndpoint);
  const second = await api.read(userEndpoint);
  const third = await api.read(userEndpoint);
  expect(second).toEqual(first);
  expect(third).toEqual(first);
  expect(http.requests[1]?.headers.get("If-None-Match")).toBe('"one"');
  expect(http.requests[1]?.headers.get("If-Modified-Since")).toBeNull();
  expect(http.requests[2]?.headers.get("If-None-Match")).toBe('"two"');
});

test("Last-Modified is sent when the response has no ETag", async () => {
  const modified = "Wed, 21 Oct 2015 07:28:00 GMT";
  const http = script([
    jsonResponse(userBody(), 200, { "Last-Modified": modified }),
    new Response(null, { status: 304 }),
  ]);
  const api = client(http.fetch);
  await api.read(userEndpoint);
  await api.read(userEndpoint);
  expect(http.requests[1]?.headers.get("If-Modified-Since")).toBe(modified);
  expect(http.requests[1]?.headers.get("If-None-Match")).toBeNull();
});

test("a response with no validator is not reused", async () => {
  const http = script([jsonResponse(userBody()), jsonResponse(userBody())]);
  const api = client(http.fetch);
  await api.read(userEndpoint);
  await api.read(userEndpoint);
  expect(http.requests[1]?.headers.get("If-None-Match")).toBeNull();
  expect(http.requests[1]?.headers.get("If-Modified-Since")).toBeNull();
});

test("a 304 with no cached body is an unexpected status", async () => {
  const http = script([new Response(null, { status: 304 })]);
  const failure = await failureOf(() => client(http.fetch).read(userEndpoint));
  expect(failure).toEqual({ kind: "unexpected_status", status: 304 });
});

test("a 500 is an unexpected status", async () => {
  const http = script([jsonResponse({ error: "nope", code: 500 }, 500)]);
  const failure = await failureOf(() => client(http.fetch).read(userEndpoint));
  expect(failure).toEqual({ kind: "unexpected_status", status: 500 });
});

test("a non-JSON body is rejected", async () => {
  const http = script([new Response("nope", { status: 200 })]);
  const failure = await failureOf(() => client(http.fetch).read(userEndpoint));
  expect(failure.kind).toBe("invalid_body");
});

test("a user payload with the wrong object is rejected", async () => {
  const http = script([jsonResponse({ object: "collection", data: [] })]);
  const failure = await failureOf(() => client(http.fetch).read(userEndpoint));
  expect(failure.kind).toBe("invalid_body");
});

test("a collection item that fails the schema is rejected", async () => {
  const http = script([jsonResponse(collection([{ id: "nope" }], null))]);
  const failure = await failureOf(() => client(http.fetch).read(subjects));
  expect(failure.kind).toBe("invalid_body");
});

test("an empty ETag falls through to Last-Modified", async () => {
  const modified = "Wed, 21 Oct 2015 07:28:00 GMT";
  const http = script([
    jsonResponse(userBody(), 200, { ETag: "", "Last-Modified": modified }),
    new Response(null, { status: 304 }),
  ]);
  const api = client(http.fetch);
  await api.read(userEndpoint);
  await api.read(userEndpoint);
  expect(http.requests[1]?.headers.get("If-Modified-Since")).toBe(modified);
  expect(http.requests[1]?.headers.get("If-None-Match")).toBeNull();
});

test("an empty Last-Modified header is not cached", async () => {
  const http = script([
    jsonResponse(userBody(), 200, { "Last-Modified": "" }),
    jsonResponse(userBody()),
  ]);
  const api = client(http.fetch);
  await api.read(userEndpoint);
  await api.read(userEndpoint);
  expect(http.requests[1]?.headers.get("If-Modified-Since")).toBeNull();
});

test("a JSON value that is not an object is rejected", async () => {
  const http = script([jsonResponse("nope")]);
  const failure = await failureOf(() => client(http.fetch).read(userEndpoint));
  expect(failure.kind).toBe("invalid_body");
});

test("a collection payload with the wrong shape is rejected", async () => {
  const http = script([jsonResponse({ object: "user", data: {} })]);
  const failure = await failureOf(() => client(http.fetch).read(subjects));
  expect(failure.kind).toBe("invalid_body");
});

test("a user below level 1 is rejected", async () => {
  const http = script([
    jsonResponse({
      object: "user",
      data: { username: "example_user", level: 0 },
    }),
  ]);
  const failure = await failureOf(() => client(http.fetch).read(userEndpoint));
  expect(failure.kind).toBe("invalid_body");
});

test("a collection URL outside the API base is rejected before fetch", async () => {
  const http = script([]);
  const endpoint = { ...subjects, path: "https://evil.test/subjects" };
  const failure = await failureOf(() => client(http.fetch).read(endpoint));
  expect(failure.kind).toBe("invalid_body");
  expect(http.requests).toHaveLength(0);
});

test("an unparseable URL is rejected before fetch", async () => {
  const http = script([]);
  const endpoint = { ...userEndpoint, path: "http://[" };
  const failure = await failureOf(() => client(http.fetch).read(endpoint));
  expect(failure.kind).toBe("invalid_body");
  expect(http.requests).toHaveLength(0);
});

test("an absolute URL outside the API base is rejected before fetch", async () => {
  const http = script([]);
  const endpoint = { ...userEndpoint, path: "https://evil.test/user" };
  const failure = await failureOf(() => client(http.fetch).read(endpoint));
  expect(failure.kind).toBe("invalid_body");
  expect(http.requests).toHaveLength(0);
});

test("a base URL with a trailing slash still requests the resource", async () => {
  const http = script([jsonResponse(userBody())]);
  await client(http.fetch, { baseUrl: `${BASE}/` }).read(userEndpoint);
  expect(http.requests[0]?.url).toBe(`${BASE}/user`);
});

test("a hung request times out and the next read still runs", async () => {
  const http = script([jsonResponse(userBody())]);
  let hung = false;
  const fetch: Fetch = (request) => {
    if (!hung) {
      hung = true;
      return new Promise(() => undefined);
    }
    return http.fetch(request);
  };
  const api = client(fetch, { requestTimeoutMs: 30 });
  await expect(api.read(userEndpoint)).rejects.toThrow("timed out");
  const user = await api.read(userEndpoint);
  expect(user.username).toBe("example_user");
});

test("isWaniKaniError rejects values that are not client failures", () => {
  expect(isWaniKaniError(null)).toBe(false);
  expect(isWaniKaniError(new Error("network"))).toBe(false);
  const renamed = new Error("nope");
  renamed.name = "OtherError";
  expect(isWaniKaniError(renamed)).toBe(false);
  const unnamed = Object.assign(new Error("nope"), {
    failure: { kind: "missing_token" },
  });
  expect(isWaniKaniError(unnamed)).toBe(false);
  const bad = Object.assign(new Error("nope"), { failure: { kind: "nope" } });
  bad.name = "WaniKaniError";
  expect(isWaniKaniError(bad)).toBe(false);
});

function client(
  fetch: Fetch,
  overrides: Partial<ClientOptions> = {},
): ReturnType<typeof createWaniKaniClient> {
  return createWaniKaniClient({
    token: TOKEN,
    baseUrl: BASE,
    fetch,
    clock: fakeClock(NOW),
    ...overrides,
  });
}

function fakeClock(start: number): Clock & { readonly sleeps: number[] } {
  let now = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
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

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function userBody(): unknown {
  return {
    object: "user",
    url: `${BASE}/user`,
    data_updated_at: "2018-04-06T14:26:53.022245Z",
    data: {
      id: "5a6a5234-a392-4a87-8f3f-33342afe8a42",
      username: "example_user",
      level: 5,
      profile_url: "https://www.wanikani.com/users/example_user",
      started_at: "2012-05-11T00:52:18.958466Z",
      current_vacation_started_at: null,
    },
  };
}

function collection(data: readonly unknown[], nextUrl: string | null): unknown {
  return {
    object: "collection",
    url: `${BASE}/subjects`,
    pages: { next_url: nextUrl, previous_url: null, per_page: 500 },
    total_count: data.length,
    data_updated_at: "2018-04-11T21:00:00.000000Z",
    data,
  };
}

async function failureOf(
  work: () => Promise<unknown>,
): Promise<WaniKaniFailure> {
  try {
    await work();
  } catch (error) {
    if (!isWaniKaniError(error)) throw error;
    return error.failure;
  }
  throw new Error("expected a WaniKani error");
}
