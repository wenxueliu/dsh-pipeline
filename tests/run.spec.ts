import { describe, expect, it } from 'vitest'
import { DagRun } from '../src/run.ts'
import type { DagRunOptions, TaskOutcome, TaskTransition } from '../src/run.ts'
import type { TaskDefinition, RunStatus } from '../src/types.ts'

const task = (id: string, depends_on?: string[]): TaskDefinition => ({
  id,
  do: `work ${id}`,
  ...depends_on === undefined ? {} : { depends_on },
})

type Executor = DagRunOptions['execute']

function start(tasks: TaskDefinition[], execute: Executor, maxConcurrentTasks = 3) {
  const transitions: TaskTransition[] = []
  const finished: Exclude<RunStatus, 'running'>[] = []
  const dag = new DagRun({
    tasks,
    maxConcurrentTasks,
    execute,
    onChange: change => { transitions.push(change) },
    onFinish: status => { finished.push(status) },
  })
  return { dag, transitions, finished }
}

const settles = (outcome: TaskOutcome, ms = 5, id = ''): Executor =>
  (_task, _prompt, _signal, started) => new Promise(resolve => {
    started(`child-${id}`)
    setTimeout(() => resolve(outcome), ms)
  })

describe('DagRun', () => {
  it('runs dependencies in order and passes upstream output', async () => {
    const order: string[] = []
    const prompts: string[] = []
    const execute: Executor = (item, prompt) => new Promise(resolve => {
      order.push(item.id)
      prompts.push(prompt)
      setTimeout(() => resolve({ output: `out-${item.id}` }), 2)
    })
    const { dag, finished } = start([task('a'), task('b', ['a']), task('c', ['b'])], execute, 2)
    await dag.start()
    expect(order).toEqual(['a', 'b', 'c'])
    expect(JSON.parse(prompts[1] ?? '{}').input.upstream).toEqual({ a: 'out-a' })
    expect(JSON.parse(prompts[2] ?? '{}').input.upstream).toEqual({ b: 'out-b' })
    expect(finished).toEqual(['succeeded'])
  })

  it('bounds concurrent tasks', async () => {
    let active = 0
    let peak = 0
    const execute: Executor = (_task, _prompt, _signal, started) => new Promise(resolve => {
      active += 1
      peak = Math.max(peak, active)
      started('child')
      setTimeout(() => {
        active -= 1
        resolve({ output: 'done' })
      }, 5)
    })
    const tasks = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => task(id))
    const { dag, finished } = start(tasks, execute, 2)
    await dag.start()
    expect(peak).toBe(2)
    expect(finished).toEqual(['succeeded'])
  })

  it('skips transitive dependents of a failed task', async () => {
    const execute: Executor = id => Promise.resolve(
      id.id === 'a' ? { error: 'boom' } : { output: `out-${id.id}` },
    )
    const { dag, transitions, finished } = start(
      [task('a'), task('b', ['a']), task('c', ['b']), task('d')],
      execute,
    )
    await dag.start()
    const statuses = Object.fromEntries(transitions.map(change => [change.taskId, change.status]))
    expect(statuses).toMatchObject({ a: 'failed', b: 'skipped', c: 'skipped', d: 'done' })
    expect(finished).toEqual(['failed'])
  })

  it('aborts in-flight tasks and skips the rest', async () => {
    const execute: Executor = (_task, _prompt, signal, started) => new Promise(resolve => {
      started('child')
      signal.addEventListener('abort', () => resolve({ error: 'run aborted' }), { once: true })
    })
    const { dag, transitions, finished } = start([task('a'), task('b'), task('c')], execute, 1)
    const running = dag.start()
    await new Promise(resolve => setTimeout(resolve, 10))
    dag.abort()
    expect(await running).toBe('aborted')
    expect(finished).toEqual(['aborted'])
    const statuses = Object.fromEntries(transitions.map(change => [change.taskId, change.status]))
    expect(statuses.a).toBe('failed')
    expect(statuses.b).toBe('skipped')
    expect(statuses.c).toBe('skipped')
  })

  it('records the published child session on the transition', async () => {
    const { dag, transitions } = start([task('a')], settles({ output: 'x' }, 4, 'a-id'))
    await dag.start()
    expect(transitions.filter(change => change.status === 'in_progress').at(-1)?.childSessionId).toBe('child-a-id')
  })
})
