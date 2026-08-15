# Sweep-harness permissions — rationale for settings.json

This allowlist governs the headless `claude -p` iterations launched by `agent/run-sweep.sh`.
(JSON can't hold comments, so the rationale lives here, adjacent, so it survives future edits.)

## It is a GUARD, not a SANDBOX

`Bash(node:*)` already permits **arbitrary code execution** — `node -e '…'` can read/write files and reach
the network — and it **cannot be removed**, because `ITERATION_PROMPT.md` requires `node` for live-value
tracing in STEP 0 and diagnosis. Given that, the additions (`python3`, `jq`, `sed`, `wc`, `sort`, and the
read-only shell tools) carry **no marginal security cost** — each is a plausible reach that would otherwise
**hang the iteration**: an unlisted command → silent permission prompt → wait until `--max-turns` or the
runner's per-iteration wall-clock timeout. **Too-narrow is the more dangerous failure here.**

**Real containment is NOT this file.** It is the runner's design: an isolated branch, auto-revert on any
REGRESSION/TIMEOUT, and **never merging**. This allowlist only blocks accidental or unrelated commands.

## The deny list is deliberate

`commit / reset / checkout / merge / push / branch / tag` are the **runner's** job — the agent must never
touch git state. `rm / npm install / npx` are denied to stop destructive or environment-mutating actions.
(The runner's own git commands run in bash, **outside** this permission system, so they are unaffected.)

## curl is scoped to localhost:3001

so the agent can fetch live values from the app without opening external network.
