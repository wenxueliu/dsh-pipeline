/**
 * `ctx.pipelines`: the template catalog and the run scheduler. Templates live in a
 * storage domain; runs are bound to the Session that started them and are rebuilt
 * from its log by the `pipeline` projection.
 * @module dsh-pipeline
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Registers the `ctx.subagents` Context member; imported for its declaration merge only.
import type {} from '@deepseek-ai/dsh-subagent'
import type { Session } from '@deepseek-ai/dsh-session'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { PipelineError } from './errors.ts'
import { createProjection } from './projection.ts'
import type { PipelineState, ProjectedRun } from './projection.ts'
import { DagRun } from './run.ts'
import type { TaskOutcome } from './run.ts'
import { taskDefinitionSchema, templatesDomain, validateTemplate } from './templates.ts'
import type { TemplateRecord } from './templates.ts'
import type {
  CreateTemplateInput,
  RunView,
  StartRunRequest,
  TaskDefinition,
  TemplateView,
} from './types.ts'

export { PipelineError } from './errors.ts'
export type { PipelineErrorCode } from './errors.ts'
export { DagRun } from './run.ts'
export type { TaskOutcome, TaskTransition, DagRunOptions } from './run.ts'
export { renderTaskPrompt } from './prompt.ts'
export { validateTemplate } from './templates.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    pipelines: PipelineService
  }
}

/** Plugin configuration. */
export interface Config {
  /** Subagent provider for tasks without a per-task `agent`. */
  defaultProvider: string
  /** Maximum tasks executing at once. */
  maxConcurrentTasks: number
  /** Per-task wall-clock limit in milliseconds. */
  taskTimeoutMs: number
}

const TASK_LIST_LIMIT = 64
const createInputSchema = zod.object({
  templateId: zod.string().min(1).max(80).optional(),
  name: zod.string().trim().min(1).max(120),
  description: zod.string().max(320).optional(),
  tasks: zod.array(taskDefinitionSchema).min(1).max(TASK_LIST_LIMIT),
})

/** The pipeline service. */
export class PipelineService extends Service {
  static inject = ['sessionProjections', 'sessions', 'subagents', 'storageDomain']

  /** Loader schema; defaults match the constructor's fallbacks. */
  static Config: z<Config> = z.object({
    defaultProvider: z.string().default('spawn'),
    maxConcurrentTasks: z.number().default(4),
    taskTimeoutMs: z.number().default(7_200_000),
  })

  private readonly resolved: Config
  private domain!: Domain<typeof templatesDomain>
  private projection!: ProjectionHandle<PipelineState>
  private readonly live = new Map<string, { session: Session; dag: DagRun; completion: Promise<void> }>()
  /** Serializes template creates: the domain has no insert-if-absent primitive. */
  private createChain: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - owning plugin context.
   * @param config - validated plugin config.
   * @throws when a numeric bound is not a positive safe integer.
   */
  constructor(ctx: Context, config: Partial<Config> = {}) {
    super(ctx, 'pipelines')
    const maxConcurrentTasks = config.maxConcurrentTasks ?? 4
    const taskTimeoutMs = config.taskTimeoutMs ?? 7_200_000
    if (!Number.isSafeInteger(maxConcurrentTasks) || maxConcurrentTasks < 1) {
      throw new Error(`dsh-pipeline: maxConcurrentTasks must be a positive integer, got ${String(maxConcurrentTasks)}`)
    }
    if (!Number.isFinite(taskTimeoutMs) || taskTimeoutMs <= 0) {
      throw new Error(`dsh-pipeline: taskTimeoutMs must be a positive number, got ${String(taskTimeoutMs)}`)
    }
    this.resolved = { defaultProvider: config.defaultProvider ?? 'spawn', maxConcurrentTasks, taskTimeoutMs }
  }

  protected async [Service.init](): Promise<void> {
    this.domain = await this.ctx.storageDomain.open(templatesDomain)
    this.ctx.effect(() => () => this.domain.close(), 'dsh-pipeline.templates')
    this.projection = await this.ctx.sessionProjections.register(createProjection())
    this.ctx.effect(() => () => {
      const runs = [...this.live.values()]
      for (const run of runs) run.dag.abort()
      return Promise.allSettled(runs.map(run => run.completion)).then(() => {})
    }, 'dsh-pipeline.runs')
  }

  /**
   * Create a template, or append a version when `templateId` is set.
   * @param input - template identity and the task graph.
   * @returns the committed template.
   * @throws {@link PipelineError} `PIPELINE_TEMPLATE_INVALID` for a bad graph,
   *   `PIPELINE_TEMPLATE_NOT_FOUND` for an unknown `templateId`.
   */
  createTemplate(input: CreateTemplateInput): Promise<TemplateView> {
    return this.serialize(async () => {
      const parsed = createInputSchema.safeParse(input)
      if (!parsed.success) {
        throw new PipelineError(parsed.error.issues.map(issue => issue.message).join('; '), 'PIPELINE_TEMPLATE_INVALID', { cause: parsed.error })
      }
      const violation = validateTemplate(parsed.data.tasks)
      if (violation !== undefined) throw new PipelineError(violation, 'PIPELINE_TEMPLATE_INVALID')
      const table = this.domain.table('templates')
      const existing = parsed.data.templateId === undefined ? undefined : table.get(parsed.data.templateId)
      if (parsed.data.templateId !== undefined && existing === undefined) {
        throw new PipelineError(`unknown pipeline template "${parsed.data.templateId}"`, 'PIPELINE_TEMPLATE_NOT_FOUND')
      }
      const version = existing === undefined ? 1 : existing.currentVersion + 1
      const record: TemplateRecord = {
        id: existing?.id ?? `tpl-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        name: parsed.data.name,
        ...parsed.data.description === undefined ? {} : { description: parsed.data.description },
        versions: [...(existing?.versions ?? []), { version, tasks: parsed.data.tasks, createdAt: Date.now() }],
        currentVersion: version,
      }
      await table.put(record.id, record)
      return templateView(record)
    })
  }

  /**
   * @returns every template in the catalog.
   */
  listTemplates(): TemplateView[] {
    const views: TemplateView[] = []
    for (const record of this.domain.table('templates').entries()) views.push(templateView(record[1]))
    return views
  }

  /**
   * @param id - template id.
   * @returns the template and all its versions.
   * @throws {@link PipelineError} `PIPELINE_TEMPLATE_NOT_FOUND` when the id is unknown.
   */
  getTemplate(id: string): TemplateView {
    const record = this.domain.table('templates').get(id)
    if (record === undefined) throw new PipelineError(`unknown pipeline template "${id}"`, 'PIPELINE_TEMPLATE_NOT_FOUND')
    return templateView(record)
  }

  /**
   * Start a run. Returns immediately; tasks execute in the background.
   * @param agent - the calling agent; the run belongs to its Session.
   * @param request - template selection and parameters.
   * @returns the run view as recorded, status `running`.
   * @throws {@link PipelineError} for an unknown template/version or an unregistered provider.
   */
  async startRun(agent: Agent, request: StartRunRequest): Promise<RunView> {
    const record = this.domain.table('templates').get(request.templateId)
    if (record === undefined) throw new PipelineError(`unknown pipeline template "${request.templateId}"`, 'PIPELINE_TEMPLATE_NOT_FOUND')
    const versionNumber = request.templateVersion ?? record.currentVersion
    const version = record.versions.find(item => item.version === versionNumber)
    if (version === undefined) {
      throw new PipelineError(`template "${record.id}" has no version ${versionNumber}`, 'PIPELINE_TEMPLATE_NOT_FOUND')
    }
    const runProvider = request.agent ?? this.resolved.defaultProvider
    for (const task of version.tasks) {
      const provider = task.agent ?? runProvider
      if (this.ctx.subagents.getProvider(provider) === undefined) {
        throw new PipelineError(
          `no subagent provider "${provider}" is registered${task.agent === undefined ? ' as the pipeline default' : ` for task "${task.id}"`}`,
          'PIPELINE_PROVIDER_UNAVAILABLE',
        )
      }
    }
    const session = agent.session
    const runId = `run-${randomUUID().replaceAll('-', '').slice(0, 12)}`
    appendPluginRecord(session, 'plugin:dsh-pipeline/run', {
      version: 1,
      runId,
      templateId: record.id,
      templateVersion: version.version,
      ...request.params === undefined ? {} : { params: request.params },
    })
    for (const task of version.tasks) {
      const title = taskTitle(task.do)
      appendPluginRecord(session, 'plugin:dsh-pipeline/task', {
        version: 1, runId, taskId: task.id, status: 'pending', ...title === '' ? {} : { title },
      })
    }
    const root = this.ctx.subagents.rootOf(agent)
    const dag = new DagRun({
      tasks: version.tasks,
      ...request.params === undefined ? {} : { params: request.params },
      maxConcurrentTasks: this.resolved.maxConcurrentTasks,
      execute: (task, prompt, signal, started) => this.executeTask(runId, runProvider, root, task, prompt, signal, started),
      onChange: transition => this.record(() => {
        appendPluginRecord(session, 'plugin:dsh-pipeline/task', { version: 1, runId, ...transition })
      }),
      onFinish: status => this.record(() => {
        appendPluginRecord(session, 'plugin:dsh-pipeline/status', { version: 1, runId, status })
      }),
    })
    const completion = dag.start()
      .then(async () => {
        const flushed = await this.ctx.sessions.flush(session)
        if (!flushed) this.ctx.logger.warn(`dsh-pipeline: run ${runId} reached a terminal state but the Session could not be flushed`)
      })
      .catch((error: unknown) => {
        this.ctx.logger.warn(`dsh-pipeline: run ${runId} stopped without a terminal record: ${renderError(error)}`)
      })
      .finally(() => { this.live.delete(runId) })
    this.live.set(runId, { session, dag, completion })
    return this.runView(session, runId)
  }

  /**
   * Read one run owned by the calling agent's Session.
   * @param agent - the calling agent.
   * @param runId - run id.
   * @returns the run; status is `interrupted` when the log says running but no live run exists in this process.
   * @throws {@link PipelineError} `PIPELINE_RUN_NOT_FOUND` when this Session has no such run.
   */
  getRun(agent: Agent, runId: string): RunView {
    return this.runView(agent.session, runId)
  }

  /**
   * @param agent - the calling agent.
   * @returns every run in the Session, newest first.
   */
  listRuns(agent: Agent): RunView[] {
    const state = this.projection.stateOf(agent.session)
    return [...state.runs].reverse().map(run => withLiveness(run, this.live.has(run.runId)))
  }

  /**
   * Stop a live run, or close an interrupted one left behind by a previous process.
   * @param agent - the calling agent.
   * @param runId - run id.
   * @throws {@link PipelineError} `PIPELINE_RUN_NOT_FOUND` when this Session has no such run.
   */
  async abortRun(agent: Agent, runId: string): Promise<void> {
    const session = agent.session
    const live = this.live.get(runId)
    if (live !== undefined && live.session === session) {
      live.dag.abort()
      await live.completion
      return
    }
    const run = this.projection.stateOf(session).runs.find(item => item.runId === runId)
    if (run === undefined) throw new PipelineError(`unknown pipeline run "${runId}"`, 'PIPELINE_RUN_NOT_FOUND')
    if (run.status !== 'running') return
    for (const task of run.tasks) {
      if (task.status !== 'pending' && task.status !== 'in_progress') continue
      appendPluginRecord(session, 'plugin:dsh-pipeline/task', {
        version: 1, runId, taskId: task.id, status: 'skipped', error: 'run aborted',
      })
    }
    appendPluginRecord(session, 'plugin:dsh-pipeline/status', { version: 1, runId, status: 'aborted' })
    await this.ctx.sessions.flush(session)
  }

  private runView(session: Session, runId: string): RunView {
    const run = this.projection.stateOf(session).runs.find(item => item.runId === runId)
    if (run === undefined) throw new PipelineError(`unknown pipeline run "${runId}"`, 'PIPELINE_RUN_NOT_FOUND')
    return withLiveness(run, this.live.has(runId))
  }

  private async executeTask(
    runId: string,
    runProvider: string,
    root: Agent,
    task: TaskDefinition,
    prompt: string,
    signal: AbortSignal,
    started: (childSessionId: string) => void,
  ): Promise<TaskOutcome> {
    // AbortSignal.any covers both the run's cancellation and the per-task deadline.
    const taskSignal = AbortSignal.any([signal, AbortSignal.timeout(this.resolved.taskTimeoutMs)])
    const activation = await this.ctx.subagents.startActivation({
      provider: task.agent ?? runProvider,
      label: `pipeline ${runId} ${task.id}`,
      delivery: 'caller',
      parent: root,
      prompt: [{ type: 'text', text: prompt }],
      signal: taskSignal,
    })
    started(activation.childId)
    try {
      const result = await Promise.race([activation.result, rejectionOnAbort(taskSignal)])
      if (result.stopReason !== 'completed') {
        return { error: result.diagnostic ?? `child stopped with ${result.stopReason}` }
      }
      return { output: result.output.filter(block => block.type === 'text').map(block => block.text).join('') }
    } catch (error: unknown) {
      return { error: renderError(error) }
    } finally {
      await activation.dispose().catch((error: unknown) => {
        this.ctx.logger.warn(`dsh-pipeline: disposing task "${task.id}" failed: ${renderError(error)}`)
      })
    }
  }

  /** Contain a record failure: the run continues, but its projection will lag. */
  private record(write: () => void): void {
    try {
      write()
    } catch (error: unknown) {
      this.ctx.logger.warn(`dsh-pipeline: Session record could not be appended: ${renderError(error)}`)
    }
  }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const next = this.createChain.then(job, job)
    this.createChain = next.catch(() => undefined)
    return next
  }
}

/** Project a stored template row onto the public view. */
function templateView(record: TemplateRecord): TemplateView {
  return {
    id: record.id,
    name: record.name,
    ...record.description === undefined ? {} : { description: record.description },
    currentVersion: record.currentVersion,
    versions: record.versions.map(version => ({ version: version.version, tasks: version.tasks })),
  }
}

/**
 * The first line of a task instruction, shortened to the title limit in code units
 * so a surrogate pair is never split.
 * @param instruction - the task's `do` text.
 * @returns the display title, empty when the instruction has no printable content.
 */
function taskTitle(instruction: string): string {
  const firstLine = instruction.trim().split('\n', 1)[0]?.trim() ?? ''
  const candidate = firstLine === '' ? instruction.trim().replaceAll('\n', ' ') : firstLine
  let title = ''
  for (const character of candidate) {
    if (title.length + character.length > 120) break
    title += character
  }
  return title
}

/** A recorded `running` run with no live scheduler in this process did not survive the restart. */
function withLiveness(run: ProjectedRun, live: boolean): RunView {
  return run.status === 'running' && !live ? { ...run, status: 'interrupted' } : run
}

/** Reject when the signal aborts, carrying its reason. */
function rejectionOnAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

/**
 * @param error - any thrown value.
 * @returns a message safe to log or show.
 */
function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default PipelineService
