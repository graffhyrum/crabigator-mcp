import { type, type ArkErrors } from "arktype";

const REVISION = "20170710";
const MAX_ATTEMPTS = 3;
const FALLBACK_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 65_000;

export type Fetch = (request: Request) => Promise<Response>;

export type Clock = {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
};

export type ClientOptions = {
  readonly token: string | undefined;
  readonly baseUrl: string;
  readonly fetch: Fetch;
  readonly clock: Clock;
};

export type Parse<T> = (data: unknown) => T | ArkErrors;

export type Resource<T> = {
  readonly kind: "resource";
  readonly path: string;
  readonly object: string;
  readonly data: Parse<T>;
};

export type Collection<T> = {
  readonly kind: "collection";
  readonly path: string;
  readonly item: Parse<T>;
};

export type WaniKaniClient = {
  read<T>(endpoint: Resource<T>): Promise<T>;
  read<T>(endpoint: Collection<T>): Promise<readonly T[]>;
};

export type WaniKaniFailure =
  | { readonly kind: "missing_token" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "rate_limited"; readonly retryAt: Date | null }
  | { readonly kind: "unexpected_status"; readonly status: number }
  | { readonly kind: "invalid_body"; readonly problem: string };

export type WaniKaniError = Error & { readonly failure: WaniKaniFailure };

type ApiUrl = string & { readonly __brand: "ApiUrl" };

type TokenState =
  | { readonly kind: "present"; readonly token: ApiToken }
  | { readonly kind: "missing" };

type Validator =
  | { readonly kind: "etag"; readonly etag: string }
  | { readonly kind: "last_modified"; readonly lastModified: string };

type CacheEntry = {
  readonly validator: Validator;
  readonly body: unknown;
};

type LimitState = {
  remaining: number | undefined;
  resetAtMs: number | undefined;
};

type ClientContext = {
  readonly baseUrl: string;
  readonly token: TokenState;
  readonly cache: Map<string, CacheEntry>;
  readonly fetch: Fetch;
  readonly clock: Clock;
  readonly limit: LimitState;
  tail: Promise<void>;
};

type Outcome =
  | {
      readonly kind: "fresh";
      readonly body: unknown;
      readonly validator: Validator | null;
    }
  | { readonly kind: "not_modified"; readonly validator: Validator | null }
  | { readonly kind: "rate_limited"; readonly resetAt: Date | null }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unexpected_status"; readonly status: number };

type RetryPlan =
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "give_up"; readonly retryAt: Date | null };

const ApiTokenSchema = type("string.trim").to("string > 0").brand("ApiToken");
type ApiToken = typeof ApiTokenSchema.infer;

const FailureSchema = type({ kind: "'missing_token'" })
  .or({ kind: "'unauthorized'" })
  .or({ kind: "'rate_limited'", retryAt: "Date | null" })
  .or({ kind: "'unexpected_status'", status: "number" })
  .or({ kind: "'invalid_body'", problem: "string" });

const ResourceEnvelope = type({ object: "string", data: "unknown" });

const CollectionEnvelope = type({
  object: "'collection'",
  pages: { next_url: "string | null" },
  data: "unknown[]",
});

export function createWaniKaniClient(options: ClientOptions): WaniKaniClient {
  const ctx = makeContext(options);
  return {
    read: (endpoint) => enqueue(ctx, () => dispatch(ctx, endpoint)),
  };
}

export function isWaniKaniError(value: unknown): value is WaniKaniError {
  if (!(value instanceof Error)) return false;
  if (value.name !== "WaniKaniError") return false;
  if (!("failure" in value)) return false;
  const parsed = FailureSchema(value.failure);
  return !(parsed instanceof type.errors);
}

function dispatch<T>(
  ctx: ClientContext,
  endpoint: Resource<T> | Collection<T>,
): Promise<T | readonly T[]> {
  switch (endpoint.kind) {
    case "resource":
      return readResource(ctx, endpoint);
    case "collection":
      return readCollection(ctx, endpoint);
  }
}

async function readResource<T>(
  ctx: ClientContext,
  endpoint: Resource<T>,
): Promise<T> {
  const url = toApiUrl(ctx.baseUrl, endpoint.path);
  if (url === undefined) {
    fail({
      kind: "invalid_body",
      problem: "The endpoint URL is outside the API base.",
    });
  }
  const body = await getJson(ctx, url);
  const envelope = ResourceEnvelope(body);
  if (envelope instanceof type.errors) {
    fail({ kind: "invalid_body", problem: envelope.summary });
  }
  if (envelope.object !== endpoint.object) {
    fail({
      kind: "invalid_body",
      problem: `Expected object ${endpoint.object}.`,
    });
  }
  const parsed = endpoint.data(envelope.data);
  if (parsed instanceof type.errors) {
    fail({ kind: "invalid_body", problem: parsed.summary });
  }
  return parsed;
}

async function readCollection<T>(
  ctx: ClientContext,
  endpoint: Collection<T>,
): Promise<readonly T[]> {
  const first = toApiUrl(ctx.baseUrl, endpoint.path);
  if (first === undefined) {
    fail({
      kind: "invalid_body",
      problem: "The endpoint URL is outside the API base.",
    });
  }
  const items: T[] = [];
  let url = first;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(url)) {
      fail({ kind: "invalid_body", problem: "Pagination repeated a URL." });
    }
    seen.add(url);
    const body = await getJson(ctx, url);
    const page = CollectionEnvelope(body);
    if (page instanceof type.errors) {
      fail({ kind: "invalid_body", problem: page.summary });
    }
    items.push(...appendItems(endpoint, page.data));
    if (page.pages.next_url === null) return items;
    const next = toApiUrl(ctx.baseUrl, page.pages.next_url);
    if (next === undefined) {
      fail({
        kind: "invalid_body",
        problem: "next_url is outside the API base.",
      });
    }
    url = next;
  }
}

function appendItems<T>(
  endpoint: Collection<T>,
  data: readonly unknown[],
): readonly T[] {
  const items: T[] = [];
  for (const item of data) {
    const parsed = endpoint.item(item);
    if (parsed instanceof type.errors) {
      fail({ kind: "invalid_body", problem: parsed.summary });
    }
    items.push(parsed);
  }
  return items;
}

async function getJson(ctx: ClientContext, url: ApiUrl): Promise<unknown> {
  const token = requireToken(ctx.token);
  let attemptNumber = 1;
  for (;;) {
    const shot = await send(ctx, url, token);
    if (shot.kind === "body") return shot.body;
    const plan = planRetry(attemptNumber, shot.resetAt, ctx.clock.now());
    if (plan.kind === "give_up") {
      fail({ kind: "rate_limited", retryAt: plan.retryAt });
    }
    await ctx.clock.sleep(plan.ms);
    attemptNumber += 1;
  }
}

async function send(
  ctx: ClientContext,
  url: ApiUrl,
  token: ApiToken,
): Promise<
  | { readonly kind: "body"; readonly body: unknown }
  | { readonly kind: "retry"; readonly resetAt: Date | null }
> {
  await waitForRemaining(ctx);
  const cached = ctx.cache.get(url);
  const response = await ctx.fetch(buildRequest(url, token, cached));
  noteLimit(ctx, response.headers);
  const outcome = await classify(response);
  switch (outcome.kind) {
    case "fresh":
      storeFresh(ctx, url, outcome);
      return { kind: "body", body: outcome.body };
    case "not_modified":
      return { kind: "body", body: cachedBody(ctx, url, outcome.validator) };
    case "rate_limited":
      return { kind: "retry", resetAt: outcome.resetAt };
    case "unauthorized":
      fail({ kind: "unauthorized" });
    case "unexpected_status":
      fail({ kind: "unexpected_status", status: outcome.status });
  }
}

async function waitForRemaining(ctx: ClientContext): Promise<void> {
  if (ctx.limit.remaining !== 0) return;
  const resetAtMs = ctx.limit.resetAtMs;
  if (resetAtMs === undefined) return;
  const delay = resetAtMs - ctx.clock.now();
  if (delay <= 0) return;
  await ctx.clock.sleep(clamp(delay, 0, MAX_BACKOFF_MS));
}

function noteLimit(ctx: ClientContext, headers: Headers): void {
  const remaining = parseRemaining(headers);
  if (remaining !== undefined) ctx.limit.remaining = remaining;
  const resetAt = resetAtFrom(headers);
  if (resetAt !== null) ctx.limit.resetAtMs = resetAt.getTime();
}

function requireToken(state: TokenState): ApiToken {
  switch (state.kind) {
    case "present":
      return state.token;
    case "missing":
      fail({ kind: "missing_token" });
  }
}

function buildRequest(
  url: ApiUrl,
  token: ApiToken,
  cached: CacheEntry | undefined,
): Request {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Wanikani-Revision", REVISION);
  if (cached !== undefined) {
    const header = conditionalHeader(cached.validator);
    headers.set(header.name, header.value);
  }
  return new Request(url, { method: "GET", headers });
}

function conditionalHeader(validator: Validator): {
  readonly name: string;
  readonly value: string;
} {
  switch (validator.kind) {
    case "etag":
      return { name: "If-None-Match", value: validator.etag };
    case "last_modified":
      return { name: "If-Modified-Since", value: validator.lastModified };
  }
}

async function classify(response: Response): Promise<Outcome> {
  const validator = validatorFrom(response.headers);
  switch (response.status) {
    case 200:
      return { kind: "fresh", body: await readJson(response), validator };
    case 304:
      return { kind: "not_modified", validator };
    case 401:
      return { kind: "unauthorized" };
    case 429:
      return { kind: "rate_limited", resetAt: resetAtFrom(response.headers) };
    default:
      return { kind: "unexpected_status", status: response.status };
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    fail({ kind: "invalid_body", problem: "Response was not JSON." });
  }
}

function validatorFrom(headers: Headers): Validator | null {
  const etag = headers.get("ETag");
  if (etag !== null && etag.length > 0) return { kind: "etag", etag };
  const lastModified = headers.get("Last-Modified");
  if (lastModified !== null && lastModified.length > 0) {
    return { kind: "last_modified", lastModified };
  }
  return null;
}

function resetAtFrom(headers: Headers): Date | null {
  const raw = headers.get("RateLimit-Reset");
  if (raw === null) return null;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isNaN(seconds)) return null;
  return new Date(seconds * 1000);
}

function storeFresh(
  ctx: ClientContext,
  url: ApiUrl,
  outcome: { readonly body: unknown; readonly validator: Validator | null },
): void {
  if (outcome.validator === null) {
    ctx.cache.delete(url);
    return;
  }
  ctx.cache.set(url, { validator: outcome.validator, body: outcome.body });
}

function cachedBody(
  ctx: ClientContext,
  url: ApiUrl,
  validator: Validator | null,
): unknown {
  const entry = ctx.cache.get(url);
  if (entry === undefined) fail({ kind: "unexpected_status", status: 304 });
  if (validator !== null) {
    ctx.cache.set(url, { validator, body: entry.body });
  }
  return entry.body;
}

function planRetry(
  attemptNumber: number,
  resetAt: Date | null,
  now: number,
): RetryPlan {
  if (attemptNumber >= MAX_ATTEMPTS)
    return { kind: "give_up", retryAt: resetAt };
  if (resetAt === null) return { kind: "wait", ms: FALLBACK_BACKOFF_MS };
  return {
    kind: "wait",
    ms: clamp(resetAt.getTime() - now, 0, MAX_BACKOFF_MS),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function parseRemaining(headers: Headers): number | undefined {
  const raw = headers.get("RateLimit-Remaining");
  if (raw === null) return undefined;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) return undefined;
  return value;
}

function toApiUrl(base: string, raw: string): ApiUrl | undefined {
  let href: string;
  try {
    href = new URL(raw, normalizeBase(base)).href;
  } catch {
    return undefined;
  }
  if (isApiUrl(href, normalizeBase(base))) return href;
  return undefined;
}

function isApiUrl(value: string, baseWithSlash: string): value is ApiUrl {
  return value.startsWith(baseWithSlash);
}

function normalizeBase(base: string): string {
  if (base.endsWith("/")) return base;
  return `${base}/`;
}

function makeContext(options: ClientOptions): ClientContext {
  return {
    baseUrl: options.baseUrl,
    token: tokenStateFrom(options.token),
    cache: new Map(),
    fetch: options.fetch,
    clock: options.clock,
    limit: { remaining: undefined, resetAtMs: undefined },
    tail: Promise.resolve(),
  };
}

function tokenStateFrom(raw: string | undefined): TokenState {
  if (raw === undefined) return { kind: "missing" };
  const parsed = ApiTokenSchema(raw);
  if (parsed instanceof type.errors) return { kind: "missing" };
  return { kind: "present", token: parsed };
}

function enqueue<T>(ctx: ClientContext, work: () => Promise<T>): Promise<T> {
  const run = ctx.tail.then(work, work);
  ctx.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function fail(failure: WaniKaniFailure): never {
  const error = new Error(messageFor(failure));
  error.name = "WaniKaniError";
  throw Object.assign(error, { failure });
}

function messageFor(failure: WaniKaniFailure): string {
  switch (failure.kind) {
    case "missing_token":
      return "WANIKANI_API_TOKEN is missing. Set a read-only personal access token.";
    case "unauthorized":
      return "The WaniKani token was rejected. Check WANIKANI_API_TOKEN.";
    case "rate_limited":
      return "The WaniKani rate limit is still exceeded.";
    case "unexpected_status":
      return `WaniKani returned HTTP ${failure.status}.`;
    case "invalid_body":
      return `WaniKani returned a body the client could not use. ${failure.problem}`;
  }
}
