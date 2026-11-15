# crabigator-mcp verification map

This directory is the source for proving the user-facing behavior of crabigator-mcp. Read this index, then use the feature file as the recipe.

## Baseline preconditions

- Work from the repo root.
- Use Bun 1.4.4. `packageManager` is `bun@1.4.4`.
- Run `bun scripts/verify-stdio.ts --doctor` and require exit 0.
- The default drive uses the built-in mock. It does not read `WANIKANI_API_TOKEN`.
- Live mode reads `WANIKANI_API_TOKEN` and does not print it.
- Each drive starts its own mock and its own server process. Do not reuse a server from another run.

## Driving conventions

- Start from the baseline unless the feature names a live token.
- Run `bun scripts/verify-stdio.ts` for the mock and `bun scripts/verify-stdio.ts --node` after a build.
- Run `bun scripts/verify-stdio.ts --live` only for the live feature.
- Treat the command lines as exact.
- Keep the evidence file printed by the script. Each run has its own path under `/tmp/crabigator-verify/`.

## Proof and skip reporting

- Record the command, the exit code, and the evidence path printed by the script.
- The evidence text is the tool result. `isError` must be false for a passing drive.
- A missing live token is exit 2. Report that as a skipped live path, not as a failed mock.
- Do not report a mock drive as proof of the live path.

## Feature entry contract

Each feature file has an H1, one paragraph, and four H2 sections: `Sub-features`, `How to get to it (user POV)`, `Driving it with the verify-stdio harness`, and `Gotchas`.

## Features

- [Study status](./get-status.md) covers the mocked `get_status` call over stdio, including the Node build.
- [Live study status](./live-status.md) covers an optional call to the real API with a read-only token.
