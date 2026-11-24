# dsh-pipeline

[English](README.md) | 简体中文

面向 DeepSeek Harness 的持久化 DAG 编排。带版本的流水线模板以 subagent 方式执行，run 状态归属于启动该 run 的 Session。

这是 `services/harness_framework` 在 DeepSeek Harness 中的对应实现：模板（templates）、实例（runs）与带依赖调度的任务（tasks）。执行走 `ctx.subagents`，而不是独立的 ACP daemon。

## 安装

`lib/` 是构建产物，不纳入版本控制，因此安装前先构建（拉取更新后也要重新构建）：

```sh
pnpm install
pnpm build
```

然后把它加入某个 profile：

```sh
cd services/deepseek-harness
pnpm dsh plugin --profile <profile> add ../dsh-pipeline
```

bundle patch 会插入两行：`pipeline`（即 `ctx.pipelines` 服务）和 `pipeline-tools`（两个面向模型的工具）。需要已发布的 `dsh >= 0.2.2-rc.3 < 0.3.0`。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `defaultProvider` | `spawn` | 未指定 `agent` 的任务所使用的 subagent provider |
| `maxConcurrentTasks` | `4` | 同时执行的任务数 |
| `taskTimeoutMs` | `7_200_000` | 单个任务的墙钟时间上限 |

在 `cordis.yml` 的 `pipeline` 行上设置这些字段。模板中指定的 provider 必须在宿主上注册，否则 `startRun` 会在任何任务开始前以 `PIPELINE_PROVIDER_UNAVAILABLE` 失败。

## 工具

`pipeline_template` — `create` / `list` / `get`。不带 `template_id` 的 create 会新建一个模板；带 `template_id` 时则追加一个版本，并保持早先版本不变。校验会拒绝空任务列表、重复 id、未知依赖或自依赖，以及环。

`pipeline_run` — `start` / `get` / `list` / `abort`。`start` 立即返回 run id；任务在后台继续执行，模型轮询 `get`，直到状态为 `succeeded`、`failed`、`aborted` 或 `interrupted`。任务的 `output` 与 `error` 出现在同一个结果里。

每个任务的 prompt 是如下形状的 JSON，与 harness_framework 一致：

```json
{ "do": "...", "input": { "params": { }, "upstream": { "<taskId>": "<output>" } }, "output": "..." }
```

## 状态

模板存放在 `dsh_pipeline_templates` storage domain（`ctx.storageDomain`）中，因此能跨 Session 存活，并由宿主上的每个 Session 共享。

run 会以 `plugin:dsh-pipeline/run`、`/task` 和 `/status` 记录追加到所属 Session 的日志，并由 `pipeline` Session projection 重建。一个 run 属于启动它的 Session；`listRuns` 永远看不到其他 Session 的 run。projection 每个 Session 保留最新的 50 个 run。

## Web UI

包同时附带浏览器端（`exports["./client"]`，通过 `dsh.client` 声明），因此 `dsh web` 无需改动 harness 或 profile 的 patch 即可加载：

- **头部入口**（`conversation.session.header.utilities`）显示最新 run 的 `done/total`，点击后打开面板。Session 还没有 run 时不渲染任何内容。
- **右侧栏标签页**（"Pipelines"，`sidebarRightTabs` 的 `pipeline` 类型）按最新优先列出 run。每个 run 头部显示 `templateId vN`、状态、`done/total` 和耗时；每个任务行显示状态图标、任务标题、时长、错误文本，以及折叠在 disclosure 后面的输出。run 运行期间耗时每秒刷新。该标签也会出现在侧栏指南中。
- 任务标题取自任务 `do` 的第一行（上限 120 个 code unit），随初始 `pending` 记录一起写入。早于该字段产生的 run 会回退到任务 id。

数据通过既有的 `pipeline` Session projection 流动；浏览器 bundle 注册进 slot 并读取 `useProjection('pipeline')`，因此不会有轮询打到服务器。UI 文案由 locale 管理（`dsh-pipeline` 命名空间，含 `zh` 与 `en`）。

客户端源码位于 `src/client/`（React + TSX）。宿主程序排除该目录；`tsconfig.client.json` 带着 DOM 与 JSX 对它做类型检查，`scripts/build-client.mjs` 用 esbuild 将其打包为单个 `lib/client.js`，再由 web 宿主从插件名下的 `/plugins/` 资源路径提供。`pnpm build` 同时运行 `tsc` 和该脚本；`pnpm typecheck` 检查全部三个 program。

## 已知限制

- 没有重试、审批、输出校验、失败回滚、暂停/恢复，也没有 fan-in 模式。失败的任务会跳过其传递依赖；这就是全部失败策略。
- 任务作为调用方 agent 根节点的 subagent 执行，使用 `delivery: 'caller'`：不会有完成通知到达模型，因此进度只能轮询。
- 进程停止时仍处于 `running` 的 run，从工具侧读回来会是 `interrupted`。它永远不会恢复；`abort` 会通过把剩余任务记为 skipped、把 run 记为 `aborted` 来关闭它。Web 面板读取的 projection 不携带存活信息，因此这类 run 在 `abort` 记录终态之前会一直显示为 running。
- 面板是只读的：没有 abort 控件，也没有进入任务子 Session 的链接，并且显示每个任务的最终 `output`，而不是子 Session 的实时流。
- `plugin:` 记录在 Session 格式迁移之间是尽力而为的；run 历史不是持久审计日志。
- 外部 provider（`acp`、`codex`、`claude-code`）在此处只接受纯文本进出；基于能力的选项（`outputSchema`、`agentOptions`、presets）不会传递。
- 插件位于 `packages/` 之外，因此 harness 的覆盖率、快照与文档门禁不覆盖它。
