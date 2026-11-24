/**
 * The `pipeline` Session projection: rebuilds run state from `plugin:dsh-pipeline/*`
 * records and exposes it as a client view. Records before a fork cut are ignored:
 * a run belongs to the Session that started it.
 * @module dsh-pipeline/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import { runRecordSchema, runStatusRecordSchema, taskRecordSchema } from './records.ts'

/** Runs retained per Session; older runs fall out of memory-only projection state. */
const MAX_RUNS = 50
const TERMINAL = new Set(['done', 'failed', 'skipped'])

const taskViewSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'done', 'failed', 'skipped']),
  /** Display name; absent for runs recorded before it was written. */
  title: z.string().optional(),
  childSessionId: z.string().min(1).optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
})

const runViewSchema = z.object({
  runId: z.string().min(1),
  templateId: z.string().min(1),
  templateVersion: z.number().int().positive(),
  status: z.enum(['running', 'succeeded', 'failed', 'aborted']),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  params: z.json().optional(),
  tasks: z.array(taskViewSchema),
})

/** Projected task state. */
export type ProjectedTask = z.infer<typeof taskViewSchema>
/** Projected run state; its `status` never carries the view-only `interrupted` value. */
export type ProjectedRun = z.infer<typeof runViewSchema>

/** Projection state: the Session identity plus every run it owns. */
export const stateSchema = z.object({
  sessionId: z.string(),
  inherited: z.number().int().nonnegative(),
  runs: z.array(runViewSchema),
})

/** Rebuilt run state for one Session. */
export type PipelineState = z.infer<typeof stateSchema>
/** The wire view: exactly the runs, with no Session bookkeeping. */
export type PipelineView = { runs: ProjectedRun[] }

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    pipeline: PipelineView
  }
}

/** Fold one validated task record into the run's task list. */
function foldTask(tasks: ProjectedTask[], data: z.infer<typeof taskRecordSchema>, time: number): ProjectedTask[] {
  const index = tasks.findIndex(task => task.id === data.taskId)
  const previous = index < 0 ? undefined : tasks[index]
  const previousStartedAt = previous?.startedAt
  const previousEndedAt = previous?.endedAt
  // The child session id arrives once, with the activation's first transition;
  // the title only with the initial `pending` row.
  const childSessionId = data.childSessionId ?? previous?.childSessionId
  const title = data.title ?? previous?.title
  const next: ProjectedTask = {
    id: data.taskId,
    status: data.status,
    ...title === undefined ? {} : { title },
    ...childSessionId === undefined ? {} : { childSessionId },
    ...data.output === undefined ? {} : { output: data.output },
    ...data.error === undefined ? {} : { error: data.error },
    ...previousStartedAt === undefined ? {} : { startedAt: previousStartedAt },
    ...previousEndedAt === undefined ? {} : { endedAt: previousEndedAt },
  }
  if (data.status === 'in_progress' && previousStartedAt === undefined) next.startedAt = time
  if (TERMINAL.has(data.status)) next.endedAt = time
  return index < 0 ? [...tasks, next] : tasks.map((task, position) => position === index ? next : task)
}

/**
 * Apply one plugin record to the run table.
 * @param state - current projection state.
 * @param type - the record type.
 * @param data - raw record payload.
 * @param time - event time, used as the run and task timestamp.
 * @returns updated state, or the original reference for an unknown or invalid record.
 */
export function foldRecord(state: PipelineState, type: string, data: unknown, time: number): PipelineState {
  if (type === 'plugin:dsh-pipeline/run') {
    const { data: record } = runRecordSchema.safeParse(data)
    if (record === undefined || state.runs.some(run => run.runId === record.runId)) return state
    const runs: ProjectedRun[] = [...state.runs, {
      runId: record.runId,
      templateId: record.templateId,
      templateVersion: record.templateVersion,
      status: 'running',
      startedAt: time,
      tasks: [],
      ...record.params === undefined ? {} : { params: record.params },
    }]
    return { ...state, runs: runs.slice(-MAX_RUNS) }
  }
  if (type === 'plugin:dsh-pipeline/task') {
    const { data: record } = taskRecordSchema.safeParse(data)
    if (record === undefined) return state
    const index = state.runs.findIndex(run => run.runId === record.runId)
    const run = state.runs[index]
    if (run === undefined) return state
    const tasks = foldTask(run.tasks, record, time)
    return {
      ...state,
      runs: state.runs.map((item, position) => position === index ? { ...run, tasks } : item),
    }
  }
  if (type === 'plugin:dsh-pipeline/status') {
    const { data: record } = runStatusRecordSchema.safeParse(data)
    if (record === undefined) return state
    const index = state.runs.findIndex(run => run.runId === record.runId)
    const run = state.runs[index]
    if (run === undefined || run.status !== 'running') return state
    return {
      ...state,
      runs: state.runs.map((item, position) =>
        position === index ? { ...run, status: record.status, endedAt: time } : item),
    }
  }
  return state
}

/**
 * Build the `pipeline` projection.
 * @returns the projection definition registered by the service.
 */
export function createProjection(): ProjectionDefinition<'pipeline', PipelineState> & {
  wire: NonNullable<ProjectionDefinition<'pipeline', PipelineState>['wire']>
} {
  return {
    key: 'pipeline',
    // 2: task views carry a display title.
    stateVersion: 2,
    stateSchema,
    wire: {
      viewSchema: stateSchema.omit({ sessionId: true, inherited: true }),
      view: state => ({ runs: state.runs }),
      summary: false,
    },
    init: (header: SessionHeader, inherited: number) => ({ sessionId: header.id, inherited, runs: [] }),
    apply: (state, event: SessionEvent) => {
      if (event.seq < state.inherited) return state
      const record = pluginRecordOf(event)
      if (record === undefined) return state
      return foldRecord(state, record.type, record.data, event.time)
    },
  }
}
