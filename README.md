# crabigator-mcp

crabigator-mcp is an unofficial third-party tool. It is not affiliated with WaniKani or Tofugu. It is not endorsed by either of them.

The program is a read-only MCP server. It speaks stdio. It reads the WaniKani API v2 with a personal access token.

## Create a read-only token

1. Open https://www.wanikani.com/settings/personal_access_tokens.
2. Create a personal access token.
3. Leave every write permission box unchecked. The token can read your study data and cannot change it.
4. Copy the token into the `WANIKANI_API_TOKEN` environment variable for the server process.

Do not commit the token. Do not paste a real token into this repo, a shell history you share, or a log.

## Run the server

Install dependencies with Bun 1.4.4.

```bash
bun install
```

Local checkout, Bun:

```json
{
  "mcpServers": {
    "crabigator": {
      "command": "bun",
      "args": ["bin/crabigator-mcp.ts"],
      "cwd": "/absolute/path/to/crabigator-mcp",
      "env": {
        "WANIKANI_API_TOKEN": "paste-your-read-only-token-here"
      }
    }
  }
}
```

After `bun run build`, Node can run the same server. Use this shape with `npx` once the package is installed, or with `node` from this repo:

```json
{
  "mcpServers": {
    "crabigator": {
      "command": "node",
      "args": ["dist/crabigator-mcp.js"],
      "cwd": "/absolute/path/to/crabigator-mcp",
      "env": {
        "WANIKANI_API_TOKEN": "paste-your-read-only-token-here"
      }
    }
  }
}
```

`bunx crabigator-mcp` runs the `crabigator-mcp` bin after the package is installed. The placeholder above is not a token.

The server prints MCP JSON on stdout. Do not write logs to stdout.

## Tool

`get_status` takes no arguments. It reads `GET /user` and `GET /summary`. The text reports the username, the level, lessons available now, reviews available now, the next review time, and review counts for the next 24 hours. A second text block is the same report as JSON.

## Test locally

The quality gate is the same command CI runs.

```bash
bun run vet
```

`vet` runs format, audit, typecheck, lint, rule-validator, stepdown, crap4ts, mutate4ts, and the coverage test. Unit tests use a mocked `fetch`. They do not call the network.

Drive `get_status` over stdio against a local mock:

```bash
bun run build
bun scripts/verify-stdio.ts --doctor
bun scripts/verify-stdio.ts
bun scripts/verify-stdio.ts --node
```

The mock writes `/tmp/crabigator-verify/get-status.json`. The file does not contain a token.

Optional live check, with your own read-only token already in the environment:

```bash
bun scripts/verify-stdio.ts --live
```

The live command does not print the token. If the variable is missing, it exits 2.

## Commands

| Command         | Description                             |
| --------------- | --------------------------------------- |
| `bun run dev`   | Run the stdio server with reload        |
| `bun run build` | Build `dist/crabigator-mcp.js` for Node |
| `bun run start` | Run the stdio server                    |
| `bun run test`  | Run unit tests                          |
| `bun run vet`   | Run the quality gate                    |

## Code style

- Use ArkType for runtime values. Do not use `any`.
- Use arkenv in `config.ts` for environment variables.
- Use factory functions. Do not use classes for services.
- Use template literals. Do not build strings with `+`.
- Import from the source file. Do not add barrel `index.ts` re-exports.
- Put `*.test.ts` next to the source file. Use `bun:test`.

`AGENTS.md` has the same rules for coding agents. `.cursor/skills/verify-crabigator/SKILL.md` tells an agent how to prove a change.
