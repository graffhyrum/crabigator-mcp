# Study status

A connector starts crabigator-mcp and calls `get_status`. The tool reports the username, level, lessons available now, reviews available now, the next review time, and review counts for the next 24 hours.

## Sub-features

- `status-mock` calls `get_status` against the local mock with Bun.
- `status-node` calls the same tool with the built `node` program.

## How to get to it (user POV)

- Local Bun command: `bun bin/crabigator-mcp.ts` with `WANIKANI_API_TOKEN` set.
- Built Node command: `node dist/crabigator-mcp.js` with `WANIKANI_API_TOKEN` set.
- The harness drives both. A person does not type MCP JSON by hand.

## Driving it with the verify-stdio harness

Preconditions: `bun scripts/verify-stdio.ts --doctor` exits 0. For `status-node`, `bun run build` has produced `dist/crabigator-mcp.js`.

- Action: run the mock drive. Command: `bun scripts/verify-stdio.ts`. Result: exit 0. The printed evidence file has `"mode": "mock"`, `"isError": false`, and text that contains `example_user is level 5.`, `Lessons available now: 2`, `Reviews available now: 3`, and `Next reviews:`.
- Action: run the Node drive. Command: `bun scripts/verify-stdio.ts --node`. Result: exit 0 and a new evidence file with the same shape. It does not replace the mock run's file.

## Gotchas

- Stdout of the server is the MCP stream. A log on stdout makes the client fail.
- The mock token is the literal `test-token`. Evidence and stderr must not contain it. The script exits 1 when they do.
- `status-node` fails closed when `dist/crabigator-mcp.js` is missing. Build first. Do not point the recipe at `bun bin/crabigator-mcp.ts` and call that the Node path.
