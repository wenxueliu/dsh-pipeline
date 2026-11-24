/**
 * In-memory DAG scheduler. Execution, recording, and teardown are callbacks, so the
 * scheduling rules are testable without Cordis, subagents, or a Session.
 * @module dsh-pipeline/run
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { renderTaskPrompt } from './prompt.ts'
import type { RunStatus, TaskDefinition, TaskStatus } from './types.ts'

/** A task's settlement: its output text, or the reason it failed. */
export type TaskOutcome = { readonly output: string } | { readonly error: string }

/** One transition the service records. */
export type TaskTransition = {
  taskId: string
  status: TaskStatus
  childSessionId?: string
  output?: string
  error?: string
}

/** Collaborators the scheduler drives. */
export type DagRunOptions = {
  tasks: readonly TaskDefinition[]
  params?: JsonValue
  maxConcurrentTasks: number
  /**
   * Run one task. `started` reports the published child session so the transition
   * record carries it; the signal aborts on run abort and task timeout.
   */
  execute: (
    task: TaskDefinition,
    prompt: string,
    signal: AbortSignal,
    started: (childSessionId: string) => void,
  ) => Promise<TaskOutcome>
  onChange: (transition: TaskTransition) => void
  /** Called once with a terminal status after every task settled. */
  onFinish: (status: Exclude<RunStatus, 'running'>) => void
}

type TaskState = {
  readonly task: TaskDefinition
  status: TaskStatus
  output?: string
}

/** Runs one DAG to settlement with bounded parallelism. */
export class DagRun {
  private readonly states: TaskState[]
  private readonly controller = new AbortController()
  private completion: Promise<Exclude<RunStatus, 'running'>> | undefined

  /**
   * @param options - task list and the callbacks that execute, record, and finalize them.
   */
  constructor(private readonly options: DagRunOptions) {
    this.states = options.tasks.map(task => ({ task, status: 'pending' }))
  }

  /** Stop scheduling and abort in-flight tasks. */
  abort(): void {
    if (!this.controller.signal.aborted) this.controller.abort()
  }

  /**
   * Start driving the graph. Repeated calls share the one run.
   * @returns the terminal run status after every task settled and `onFinish` returned.
   */
  start(): Promise<Exclude<RunStatus, 'running'>> {
    this.completion ??= this.drive()
    return this.completion
  }

  private async drive(): Promise<Exclude<RunStatus, 'running'>> {
    const active = new Set<Promise<void>>()
    while (true) {
      this.spawnReady(active)
      if (active.size === 0) break
      if (this.controller.signal.aborted) {
        await Promise.allSettled([...active])
        break
      }
      await Promise.race(active)
    }
    if (this.controller.signal.aborted) {
      for (const state of this.states) {
        if (state.status === 'pending') this.transition(state, 'skipped', undefined, 'run aborted')
      }
      this.options.onFinish('aborted')
      return 'aborted'
    }
    for (const state of this.states) {
      // A blocked task whose dependency chain was never skipped is a scheduler bug; fail it loudly.
      if (state.status === 'pending') this.transition(state, 'failed', undefined, 'task was never runnable')
    }
    const status = this.states.every(state => state.status === 'done') ? 'succeeded' : 'failed'
    this.options.onFinish(status)
    return status
  }

  private spawnReady(active: Set<Promise<void>>): void {
    if (this.controller.signal.aborted) return
    for (const state of this.states) {
      if (active.size >= this.options.maxConcurrentTasks) return
      if (state.status !== 'pending') continue
      if (!(state.task.depends_on ?? []).every(dependency => this.stateOf(dependency)?.status === 'done')) continue
      const task = this.runTask(state)
      active.add(task)
      void task.then(() => { active.delete(task) }, () => { active.delete(task) })
    }
  }

  private async runTask(state: TaskState): Promise<void> {
    const upstream = new Map<string, string>()
    for (const dependency of state.task.depends_on ?? []) {
      upstream.set(dependency, this.stateOf(dependency)?.output ?? '')
    }
    const prompt = renderTaskPrompt(state.task, this.options.params, upstream)
    this.transition(state, 'in_progress')
    let outcome: TaskOutcome
    try {
      outcome = await this.options.execute(
        state.task,
        prompt,
        this.controller.signal,
        childSessionId => this.transition(state, 'in_progress', undefined, undefined, childSessionId),
      )
    } catch (error: unknown) {
      outcome = { error: error instanceof Error ? error.message : String(error) }
    }
    if ('error' in outcome) {
      this.transition(state, 'failed', undefined, outcome.error)
      this.skipDependents(state.task.id, failedDependencyMessage(state.task.id))
    } else {
      state.output = outcome.output
      this.transition(state, 'done', outcome.output)
    }
  }

  private skipDependents(failedId: string, reason: string): void {
    const queue = [failedId]
    while (true) {
      const id = queue.shift()
      if (id === undefined) return
      for (const state of this.states) {
        if (state.status !== 'pending') continue
        if (!(state.task.depends_on ?? []).includes(id)) continue
        this.transition(state, 'skipped', undefined, reason)
        queue.push(state.task.id)
      }
    }
  }

  private stateOf(id: string): TaskState | undefined {
    return this.states.find(state => state.task.id === id)
  }

  private transition(
    state: TaskState,
    status: TaskStatus,
    output?: string,
    error?: string,
    childSessionId?: string,
  ): void {
    if (state.status === status && childSessionId === undefined) return
    state.status = status
    this.options.onChange({
      taskId: state.task.id,
      status,
      ...output === undefined ? {} : { output },
      ...error === undefined ? {} : { error },
      ...childSessionId === undefined ? {} : { childSessionId },
    })
  }
}

/**
 * @param failedId - the failed dependency.
 * @returns the skip reason recorded for its dependents.
 */
function failedDependencyMessage(failedId: string): string {
  return `dependency "${failedId}" failed`
}
