# dsh-pipeline

English | [简体中文](README.zh-CN.md)

Durable DAG orchestration for the DeepSeek Harness. Versioned pipeline templates executed as subagents, with run state owned by the Session that started the run.

This is the DeepSeek Harness equivalent of `services/harness_framework`: templates, instances (runs), and tasks with dependency scheduling. Execution goes through `ctx.subagents` instead of a separate ACP daemon.

## Install

`lib/` is a build artifact and is not tracked, so build the package first (and again after pulling changes):

```sh
pnpm install
pnpm build
```

Then add it to a profile:

```sh
cd services/deepseek-harness
pnpm dsh plugin --profile <profile> add ../dsh-pipeline
```

The bundle patch adds two rows: `pipeline` (the `ctx.pipelines` service) and `pipeline-tools` (the two model-facing tools). Requires a released `dsh >= 0.2.2-rc.3 < 0.3.0`.

## Configuration

| field | default | meaning |
|---|---|---|
| `defaultProvider` | `spawn` | Subagent provider for tasks without an `agent` |
| `maxConcurrentTasks` | `4` | Tasks executing at once |
| `taskTimeoutMs` | `7_200_000` | Per-task wall-clock limit |

Set these on the `pipeline` row in `cordis.yml`. Providers named in a template must be registered on the host, otherwise `startRun` fails with `PIPELINE_PROVIDER_UNAVAILABLE` before any task starts.

## Tools

`pipeline_template` — `create` / `list` / `get`. A create without `template_id` starts a new template; with `template_id` it appends a version and leaves earlier versions intact. Validation rejects empty task lists, duplicate ids, unknown or self dependencies, and cycles.

`pipeline_run` — `start` / `get` / `list` / `abort`. `start` returns immediately with the run id; tasks keep running in the background, so the model polls `get` until the status is `succeeded`, `failed`, `aborted`, or `interrupted`. A task's `output` and `error` appear in the same result.

Each task prompt is JSON shaped like harness_framework's:

```json
{ "do": "...", "input": { "params": { }, "upstream": { "<taskId>": "<output>" } }, "output": "..." }
```

## State

Templates live in the `dsh_pipeline_templates` storage domain (`ctx.storageDomain`), so they survive Sessions and are shared by every Session on the host.

Runs are appended to the owning Session's log as `plugin:dsh-pipeline/run`, `/task`, and `/status` records, and rebuilt by the `pipeline` Session projection. A run belongs to the Session that started it; `listRuns` never sees another Session's runs. The projection retains the newest 50 runs per Session.

## Web UI

The package also ships a browser half (`exports["./client"]`, declared through `dsh.client`), so `dsh web` picks it up with no change to the harness or the profile's patch:

- A **header entry** (`conversation.session.header.utilities`) shows the newest run's `done/total` and opens the panel. It renders nothing until the Session has a run.
- A **right-sidebar tab** ("Pipelines", `sidebarRightTabs` kind `pipeline`) lists runs newest first. Each run header shows `templateId vN`, status, `done/total`, and elapsed time; each task row shows a status icon, the task title, its duration, the error text, and the output behind a disclosure. Durations tick once a second while a run is running. The tab is also advertised in the sidebar guide.
- Task titles come from the first line of the task's `do` (capped at 120 code units), written with the initial `pending` record. Runs recorded before this field existed fall back to the task id.

Data flows through the existing `pipeline` Session projection; the browser bundle registers into slots and reads `useProjection('pipeline')`, so no polling reaches the server. UI copy is locale-owned (`dsh-pipeline` namespace, `zh` and `en`).

Client sources live in `src/client/` (React + TSX). The host program excludes that directory; `tsconfig.client.json` type-checks it with DOM and JSX, and `scripts/build-client.mjs` bundles it with esbuild into the single `lib/client.js` that the web host serves from the plugin's `/plugins/` resource path. `pnpm build` runs both `tsc` and that script; `pnpm typecheck` checks all three programs.

## Known limitations

- No retry, approval, output validation, failure rollback, pause/resume, or fan-in modes. A failed task skips its transitive dependents; that is the whole failure policy.
- Tasks execute as subagents of the calling agent's root, with `delivery: 'caller'`: no completion notification reaches the model, so progress is poll-only.
- A run that was still `running` when the process stopped reads back as `interrupted` from the tools. It never resumes; `abort` closes it by recording the remaining tasks as skipped and the run as `aborted`. The Web panel reads the projection, which carries no liveness, so such a run keeps showing as running there until `abort` records the terminal state.
- The panel is read-only: it has no abort control and no link into a task's child Session, and it shows each task's final `output` rather than the child Session's stream.
- `plugin:` records are best-effort across Session-format migrations; run history is not a durable audit log.
- External providers (`acp`, `codex`, `claude-code`) only accept plain text in and out here; capability-based options (`outputSchema`, `agentOptions`, presets) are not passed.
- The plugin lives outside `packages/`, so the harness's coverage, snapshot, and documentation gates do not cover it.
