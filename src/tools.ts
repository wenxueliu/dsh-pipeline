/**
 * Model-facing tools over `ctx.pipelines`: template authoring and run control.
 * @module dsh-pipeline/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Cordis plugin name. */
export const name = 'pipeline-tools'
/** Services required by the pipeline tools. */
export const inject = ['pipelines', 'tools']

/** The tool plugin takes no configuration. */
export type Config = Record<never, never>

/** Loader schema for the tool plugin. */
export const Config: z<Config> = z.object({})

/**
 * Declare a lossless-JSON output: both tools answer by action, so one fixed
 * object schema per tool would misdescribe three of the four branches.
 * @param schema - the declared output schema.
 * @returns the `output` declaration accepted by `defineTool`.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/**
 * Widen a plugin-built view to the lossless JSON an output schema promises.
 * The views hold no non-JSON values, so the round trip is lossless.
 * @param value - view built by the pipeline service.
 * @returns the same data as `JsonValue`.
 */
function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/** Recover the calling Agent the tool executor guarantees for a live call. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  if (agent === undefined) throw new ToolContextUnavailableError(`${toolName} requires a calling Agent`)
  return agent
}

const TASK_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: 'Unique task id within the template.' },
    do: { type: 'string', required: true, description: 'Work the child agent must perform, stated as an instruction.' },
    depends_on: { type: 'array', items: { type: 'string' }, description: 'Task ids that must finish before this task starts.' },
    agent: { type: 'string', description: 'Subagent provider for this task; omit to use the pipeline default.' },
    output: { type: 'string', description: 'Expected artifact, passed to the child as guidance.' },
  },
} as const

/**
 * Register the pipeline template and run tools.
 * @param ctx - context carrying the pipeline service and the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'pipeline_template',
    description: [
      'Create, list, or read durable DAG pipeline templates.',
      'A template is a named task graph; each task runs as a subagent and may depend on earlier tasks.',
      'create without template_id starts a new template. create with template_id appends a new version and leaves earlier versions intact.',
      'Templates persist across sessions; prefer appending a version over creating a duplicate template when revising a pipeline.',
    ].join(' '),
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'list', 'get'], description: 'Operation to perform.' },
      template_id: { type: 'string', description: 'Existing template id: required for get, optional for create (append a version).' },
      name: { type: 'string', description: 'Template name, required for create.' },
      description: { type: 'string', description: 'Optional human-readable template description.' },
      tasks: { type: 'array', items: TASK_ITEM_SCHEMA, description: 'Complete task graph, required for create.' },
    },
    output: jsonOutput({ type: 'json' }),
    execute(args) {
      if (args.action === 'list') return Promise.resolve(asJson({ templates: ctx.pipelines.listTemplates() }))
      if (args.action === 'get') {
        if (args.template_id === undefined) throw new ToolArgsError(['template_id is required for action "get"'])
        return Promise.resolve(asJson({ template: ctx.pipelines.getTemplate(args.template_id) }))
      }
      if (args.name === undefined || args.tasks === undefined) {
        throw new ToolArgsError(['name and tasks are required for action "create"'])
      }
      const tasks = args.tasks.map(task => ({
        id: task.id,
        do: task.do,
        ...task.depends_on === undefined ? {} : { depends_on: task.depends_on },
        ...task.agent === undefined ? {} : { agent: task.agent },
        ...task.output === undefined ? {} : { output: task.output },
      }))
      return ctx.pipelines.createTemplate({
        ...args.template_id === undefined ? {} : { templateId: args.template_id },
        name: args.name,
        ...args.description === undefined ? {} : { description: args.description },
        tasks,
      }).then(template => asJson({ template }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pipeline_run',
    description: [
      'Start, inspect, list, or abort pipeline runs.',
      'start returns immediately with the run id; the tasks keep executing in the background.',
      'Poll with action "get" until status is succeeded, failed, aborted, or interrupted, then read each task output from the same result.',
      'A run belongs to this session. "interrupted" means the process restarted before it finished: abort it, then start a new run.',
    ].join(' '),
    parameters: {
      action: { type: 'string', required: true, enum: ['start', 'get', 'list', 'abort'], description: 'Operation to perform.' },
      run_id: { type: 'string', description: 'Run id: required for get and abort.' },
      template_id: { type: 'string', description: 'Template to run, required for start.' },
      template_version: { type: 'integer', description: 'Template version to run; defaults to the current version.' },
      params: { type: 'json', description: 'Run parameters passed to every task as input.params.' },
      agent: { type: 'string', description: 'Subagent provider for tasks without their own agent; omit to use the pipeline default.' },
    },
    output: jsonOutput({ type: 'json' }),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'pipeline_run')
      if (args.action === 'list') return asJson({ runs: ctx.pipelines.listRuns(caller) })
      if (args.action === 'start') {
        if (args.template_id === undefined) throw new ToolArgsError(['template_id is required for action "start"'])
        if (args.template_version !== undefined && (!Number.isSafeInteger(args.template_version) || args.template_version < 1)) {
          throw new ToolArgsError(['template_version must be a positive integer'])
        }
        return asJson({
          run: await ctx.pipelines.startRun(caller, {
            templateId: args.template_id,
            ...args.template_version === undefined ? {} : { templateVersion: args.template_version },
            ...args.params === undefined ? {} : { params: args.params },
            ...args.agent === undefined ? {} : { agent: args.agent },
          }),
        })
      }
      if (args.run_id === undefined) throw new ToolArgsError([`run_id is required for action "${args.action}"`])
      if (args.action === 'abort') {
        await ctx.pipelines.abortRun(caller, args.run_id)
        return asJson({ run: ctx.pipelines.getRun(caller, args.run_id) })
      }
      return asJson({ run: ctx.pipelines.getRun(caller, args.run_id) })
    },
  }))
}
