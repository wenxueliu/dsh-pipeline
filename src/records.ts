/**
 * Session-log record payloads for runs, task transitions, and run termination.
 * Records live under the ignorable `plugin:` namespace, so a reader that does not
 * know this plugin skips them and a format migration may drop them.
 * @module dsh-pipeline/records
 */

import { z } from 'zod'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { RunStatus, TaskStatus } from './types.ts'

/** Task states in lifecycle order. */
export const TASK_STATUSES = ['pending', 'in_progress', 'done', 'failed', 'skipped'] as const
/** Terminal run states; `running` exists only between the run record and this record. */
export const TERMINAL_RUN_STATUSES = ['succeeded', 'failed', 'aborted'] as const

const taskStatusSchema = z.enum(TASK_STATUSES)
const terminalRunStatusSchema = z.enum(TERMINAL_RUN_STATUSES)

/** Run creation: binds a run to the template version it executes. */
export const runRecordSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  templateId: z.string().min(1),
  templateVersion: z.number().int().positive(),
  params: z.json().optional(),
})

/** One task transition, appended for every state change including the initial `pending` rows. */
export const taskRecordSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  status: taskStatusSchema,
  /** Short display name, written with the initial `pending` row. */
  title: z.string().min(1).max(120).optional(),
  childSessionId: z.string().min(1).optional(),
  output: z.string().optional(),
  error: z.string().optional(),
})

/** Run termination; the last record a run writes. */
export const runStatusRecordSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  status: terminalRunStatusSchema,
})

/** Validated run record. */
export type RunRecord = z.infer<typeof runRecordSchema>
/** Validated task record. */
export type TaskRecord = z.infer<typeof taskRecordSchema>
/** Validated run-status record. */
export type RunStatusRecord = z.infer<typeof runStatusRecordSchema>

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Creation of one pipeline run. */
    'plugin:dsh-pipeline/run': {
      version: 1
      runId: string
      templateId: string
      templateVersion: number
      params?: JsonValue
    }
    /** One task state transition within a run. */
    'plugin:dsh-pipeline/task': {
      version: 1
      runId: string
      taskId: string
      status: TaskStatus
      title?: string
      childSessionId?: string
      output?: string
      error?: string
    }
    /** Terminal state of one run. */
    'plugin:dsh-pipeline/status': {
      version: 1
      runId: string
      status: Exclude<RunStatus, 'running'>
    }
  }
}
