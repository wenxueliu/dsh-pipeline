/**
 * Template catalog: one storage-domain row per template whose `versions` array only
 * grows, so a single `put` commits every version change.
 * @module dsh-pipeline/templates
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { TaskDefinition } from './types.ts'

/** One task definition as stored. */
export const taskDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  do: z.string().trim().min(1).max(4000),
  depends_on: z.array(z.string().trim().min(1).max(80)).max(63).optional(),
  agent: z.string().trim().min(1).max(80).optional(),
  output: z.string().trim().min(1).max(400).optional(),
}).strict()

/** One immutable template version. */
export const templateVersionSchema = z.object({
  version: z.number().int().positive(),
  tasks: z.array(taskDefinitionSchema).min(1).max(64),
  createdAt: z.number(),
}).strict()

/** One template with its full version history. */
export const templateRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(320).optional(),
  versions: z.array(templateVersionSchema).min(1),
  currentVersion: z.number().int().positive(),
}).strict()

/** Stored template row. */
export type TemplateRecord = z.infer<typeof templateRecordSchema>
/** Stored template version. */
export type TemplateVersion = z.infer<typeof templateVersionSchema>

/** The template catalog domain. */
export const templatesDomain = defineDomain({
  name: 'dsh_pipeline_templates',
  version: 1,
  tables: { templates: domainTable<string, TemplateRecord>(templateRecordSchema) },
})

/**
 * Validate a task graph before it is committed.
 * @param tasks - the proposed task list.
 * @returns a description of the first violation, or undefined when the graph is sound.
 */
export function validateTemplate(tasks: readonly TaskDefinition[]): string | undefined {
  if (tasks.length === 0) return 'a template needs at least one task'
  const byId = new Map<string, TaskDefinition>()
  for (const task of tasks) {
    if (byId.has(task.id)) return `duplicate task id "${task.id}"`
    byId.set(task.id, task)
  }
  for (const task of tasks) {
    for (const dependency of task.depends_on ?? []) {
      if (dependency === task.id) return `task "${task.id}" depends on itself`
      if (!byId.has(dependency)) return `task "${task.id}" depends on unknown task "${dependency}"`
    }
  }
  const marks = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string): string | undefined => {
    const mark = marks.get(id)
    if (mark === 'done') return undefined
    if (mark === 'visiting') return `dependency cycle through task "${id}"`
    marks.set(id, 'visiting')
    for (const dependency of byId.get(id)?.depends_on ?? []) {
      const violation = visit(dependency)
      if (violation !== undefined) return violation
    }
    marks.set(id, 'done')
    return undefined
  }
  for (const task of tasks) {
    const violation = visit(task.id)
    if (violation !== undefined) return violation
  }
  return undefined
}
