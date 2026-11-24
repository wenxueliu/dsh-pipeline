/**
 * Wire-side mirror of the `pipeline` Session projection. The projection's shape is
 * owned by the host; this module narrows the JSON delivered to the browser and
 * exposes only the fields the panel renders.
 * @module dsh-pipeline/client/wire
 */

/** Task lifecycle, as recorded. */
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped'
/** Run state carried by the projection; the view-only `interrupted` never crosses the wire. */
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'aborted'

/** One task of a projected run. */
export interface TaskView {
  id: string
  status: TaskStatus
  /** Display name; absent for runs recorded before titles were written. */
  title?: string
  childSessionId?: string
  output?: string
  error?: string
  startedAt?: number
  endedAt?: number
}

/** One projected run. */
export interface RunView {
  runId: string
  templateId: string
  templateVersion: number
  status: RunStatus
  startedAt: number
  endedAt?: number
  tasks: TaskView[]
}

/** The projection's wire view. */
export interface PipelineView {
  runs: RunView[]
}

const TASK_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'done', 'failed', 'skipped'])
const RUN_STATUSES: ReadonlySet<string> = new Set(['running', 'succeeded', 'failed', 'aborted'])

/**
 * Read the projection value delivered by `useProjection('pipeline')`.
 * @param value - the projection value, `undefined` until the Session's first frame.
 * @returns the runs, or `undefined` when the value is absent or not the expected view.
 */
export function readPipelineView(value: unknown): PipelineView | undefined {
  if (!isRecord(value) || !Array.isArray(value.runs)) return undefined
  const runs: RunView[] = []
  for (const item of value.runs) {
    const run = readRun(item)
    if (run !== undefined) runs.push(run)
  }
  return { runs }
}

function readRun(value: unknown): RunView | undefined {
  if (!isRecord(value)) return undefined
  const runId = text(value.runId)
  const templateId = text(value.templateId)
  const templateVersion = count(value.templateVersion)
  const status = text(value.status)
  const startedAt = count(value.startedAt)
  if (runId === undefined || templateId === undefined || templateVersion === undefined
    || status === undefined || startedAt === undefined || !RUN_STATUSES.has(status)) return undefined
  const endedAt = count(value.endedAt)
  const tasks: TaskView[] = []
  if (Array.isArray(value.tasks)) {
    for (const item of value.tasks) {
      const task = readTask(item)
      if (task !== undefined) tasks.push(task)
    }
  }
  return {
    runId,
    templateId,
    templateVersion,
    status: status as RunStatus,
    startedAt,
    ...endedAt === undefined ? {} : { endedAt },
    tasks,
  }
}

function readTask(value: unknown): TaskView | undefined {
  if (!isRecord(value)) return undefined
  const id = text(value.id)
  const status = text(value.status)
  if (id === undefined || status === undefined || !TASK_STATUSES.has(status)) return undefined
  const title = text(value.title)
  const childSessionId = text(value.childSessionId)
  const output = text(value.output)
  const error = text(value.error)
  const startedAt = count(value.startedAt)
  const endedAt = count(value.endedAt)
  return {
    id,
    status: status as TaskStatus,
    ...title === undefined ? {} : { title },
    ...childSessionId === undefined ? {} : { childSessionId },
    ...output === undefined ? {} : { output },
    ...error === undefined ? {} : { error },
    ...startedAt === undefined ? {} : { startedAt },
    ...endedAt === undefined ? {} : { endedAt },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
