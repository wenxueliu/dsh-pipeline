/**
 * Pipeline vocabulary: template definitions, run and task status, and the views the tools return.
 * Ids stay plain strings; they cross a tool-JSON boundary where branding buys no validation.
 * Optional properties admit `undefined` explicitly so zod-derived records and the tool boundary
 * agree under `exactOptionalPropertyTypes`.
 * @module dsh-pipeline/types
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** One task in a template version. */
export type TaskDefinition = {
  /** Unique within the template version. */
  id: string
  /** The work the child agent must perform. */
  do: string
  /** Task ids that must reach `done` before this task starts. */
  depends_on?: string[] | undefined
  /** Subagent provider override; the run or plugin default fills the gap. */
  agent?: string | undefined
  /** Expected artifact, passed to the child as a hint. */
  output?: string | undefined
}

/** Task lifecycle; skipped covers tasks whose dependencies failed or whose run was aborted. */
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped'

/** Terminal or in-flight run state as recorded in the session log. */
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'aborted'

/** Run state as read back, including the view-only `interrupted` stop for a run no longer live in this process. */
export type RunViewStatus = RunStatus | 'interrupted'

/** One immutable template version. */
export type TemplateVersionView = {
  version: number
  tasks: TaskDefinition[]
}

/** One template with every version ever created. */
export type TemplateView = {
  id: string
  name: string
  description?: string | undefined
  currentVersion: number
  versions: TemplateVersionView[]
}

/** One task as read back from the session log. */
export type TaskView = {
  id: string
  status: TaskStatus
  /** Short display name derived from the task instruction. */
  title?: string | undefined
  /** Child session that executed the task, once its activation published. */
  childSessionId?: string | undefined
  output?: string | undefined
  error?: string | undefined
  startedAt?: number | undefined
  endedAt?: number | undefined
}

/** One run as read back from the session log. */
export type RunView = {
  runId: string
  templateId: string
  templateVersion: number
  status: RunViewStatus
  startedAt: number
  endedAt?: number | undefined
  params?: JsonValue | undefined
  tasks: TaskView[]
}

/** Input for {@link PipelineService.createTemplate}. With `templateId`, the call appends a version. */
export type CreateTemplateInput = {
  templateId?: string | undefined
  name: string
  description?: string | undefined
  tasks: TaskDefinition[]
}

/** Input for {@link PipelineService.startRun}. */
export type StartRunRequest = {
  templateId: string
  /** Defaults to the template's current version. */
  templateVersion?: number | undefined
  params?: JsonValue | undefined
  /** Run-level subagent provider override for tasks without their own `agent`. */
  agent?: string | undefined
}
