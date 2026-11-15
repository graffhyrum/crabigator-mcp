---
name: verify-crabigator
description: Prove crabigator-mcp, a read-only stdio MCP server, by running the quality gate, building, and calling get_status through an MCP client against a mocked WaniKani API. Use after any change to the server, the API client, or get_status.
---

# Verify crabigator-mcp

crabigator-mcp is a stdio MCP server. A user starts it with `bun` or `node` and a client calls the `get_status` tool. Prove a change by doing that. Do not treat `bun check` alone as proof.

The mock API is the default. It never uses the network and never needs a real token. Live mode is optional. It reads `WANIKANI_API_TOKEN` from the environment. Do not print that value. Do not write it into evidence, commits, or logs.

Two runs can execute at the same time. Each mock listens on its own port, and each server is its own process.

## Launch

From the repo root, with Bun 1.4.4 on `PATH`:

```bash
bun install
bun run vet
bun run build
bun scripts/verify-stdio.ts --doctor
bun scripts/verify-stdio.ts
bun scripts/verify-stdio.ts --node
```

`bun run vet` is the quality gate. It runs format, audit, typecheck, lint, rule-validator, stepdown, crap4ts, mutate4ts, and the coverage test. The individual commands are `bun run fmt:check`, `bun run typecheck`, `bun run lint`, and `bun test`.

The mock run is ready when the process exits 0 and prints `evidence` followed by a path. Each run writes its own file under `/tmp/crabigator-verify/`.

Optional live run, only when a read-only token is already in the environment:

```bash
bun scripts/verify-stdio.ts --live
```

If the token is missing, the live run exits 2 and prints an instruction. It does not print a token.

Stop a run with Ctrl-C. The script stops the mock it started and closes the MCP client on the way out.

## Doctor

```bash
bun scripts/verify-stdio.ts --doctor
```

Doctor is read-only. It exits 0 when `bin/crabigator-mcp.ts` and `src/server.ts` exist. It prints the Bun version and whether `WANIKANI_API_TOKEN` is `set` or `missing`. It does not print the token and it does not start a server.

Run doctor first when a drive fails before `get_status` returns.

## Drive

The harness is `scripts/verify-stdio.ts`. It starts a local mock of `GET /v2/user` and `GET /v2/summary`, spawns the server over stdio, and calls `get_status` with the MCP client in `@modelcontextprotocol/sdk`.

Default command:

```bash
bun scripts/verify-stdio.ts
```

That spawns `bun bin/crabigator-mcp.ts` with `WANIKANI_API_TOKEN=test-token` and `WANIKANI_API_BASE` pointed at the mock.

After `bun run build`:

```bash
bun scripts/verify-stdio.ts --node
```

That spawns `node dist/crabigator-mcp.js` against the same mock. This is the `npx` path.

Live command:

```bash
bun scripts/verify-stdio.ts --live
```

That spawns `bun bin/crabigator-mcp.ts` with `WANIKANI_API_BASE=https://api.wanikani.com/v2` and the token already in the environment. The script checks that stdout evidence and the child stderr do not contain the token. A failure says `live output contains the API token` and does not repeat the token.

## Evidence

Every drive writes a new file under `/tmp/crabigator-verify/` and prints `evidence` plus that path. The file has `mode`, `tool`, `isError`, and `text`. It has no token and no request headers. Use the printed path. Do not assume a shared file name.

A proof is the command, the exit code, and that file. The text must show the level, the lesson count, the review count, the next review time, and an upcoming count. For the mock, the text includes `example_user is level 5.` and `Lessons available now: 2`.

The mock is the production HTTP boundary with a local base URL. It is not a test-only function inside the server. Live mode is the same server process against the real API. Confirm a live run by the evidence file and a non-zero or zero exit code. Do not assume the name `--live` means the network was used. The evidence `mode` field records which path ran.

## Cleanup

The script stops the mock with `server.stop(true)` and closes the MCP client, which stops the child process. Do not kill every `bun` process. Do not delete `/tmp/crabigator-verify/`. Evidence stays after cleanup.

## Helpers

`scripts/verify-stdio.ts` is the only helper. Invoke it as shown above. `--doctor` checks the checkout. No flags runs the mock with Bun. `--node` runs the built file. `--live` calls the real API when a token is present.

Feature recipes live in `features/`.
