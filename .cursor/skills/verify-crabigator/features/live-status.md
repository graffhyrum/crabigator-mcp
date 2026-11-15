# Live study status

A person with a read-only WaniKani personal access token can ask `get_status` for their own study counts. The server sends the token only as a bearer header to `https://api.wanikani.com/v2`.

## Sub-features

- `status-live` calls `get_status` against the real API.
- `status-live-missing` exits 2 when `WANIKANI_API_TOKEN` is unset.

## How to get to it (user POV)

- Create a token at https://www.wanikani.com/settings/personal_access_tokens with every write permission box unchecked.
- Export `WANIKANI_API_TOKEN` in the shell that starts the server. Do not put the token in a file that is committed.
- Start the server with `bun bin/crabigator-mcp.ts` and call `get_status` from an MCP client.

## Driving it with the verify-stdio harness

Preconditions: doctor exits 0. The token is a read-only personal access token in the environment. Do not invent a token to make this path pass.

- Action: run live mode. Command: `bun scripts/verify-stdio.ts --live`. Result: exit 0. The printed evidence file has `"mode": "live"` and `"isError": false`. The text names a level. The file does not contain the token.
- Action: run live mode without the token. Command: `env -u WANIKANI_API_TOKEN bun scripts/verify-stdio.ts --live`. Result: exit 2 and a stderr line that tells you to set `WANIKANI_API_TOKEN`. The line does not contain a token value.

## Gotchas

- A missing token is a skipped live path, not a failed mock. Do not weaken the mock recipe to avoid this exit code.
- If the evidence or the child stderr contains the token, the script exits 1 and the message is `live output contains the API token`. Do not print the token while debugging that failure.
- Live mode forces `WANIKANI_API_BASE` to `https://api.wanikani.com/v2` so a leftover mock base cannot redirect the call.
- This path needs network access. A sandbox that blocks the API will return an error tool result and exit 1. Report that. Do not record it as a mock success.
