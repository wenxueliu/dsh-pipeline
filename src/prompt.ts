/**
 * Task prompt assembly. The child receives one JSON document so parameters and
 * upstream artifacts keep their boundaries instead of being concatenated into prose.
 * @module dsh-pipeline/prompt
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { TaskDefinition } from './types.ts'

/**
 * Render the initial message for one task.
 * @param task - the task definition.
 * @param params - run-level parameters supplied at start.
 * @param upstream - materialized outputs of the task's dependencies.
 * @returns the prompt text.
 */
export function renderTaskPrompt(
  task: TaskDefinition,
  params: JsonValue | undefined,
  upstream: ReadonlyMap<string, string>,
): string {
  return JSON.stringify({
    do: task.do,
    input: {
      ...params === undefined ? {} : { params },
      upstream: Object.fromEntries(upstream),
    },
    ...task.output === undefined ? {} : { output: task.output },
  }, null, 2)
}
