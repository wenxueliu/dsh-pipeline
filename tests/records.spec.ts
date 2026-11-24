import { describe, expect, it } from 'vitest'
import { createProjection, foldRecord } from '../src/projection.ts'
import type { PipelineState } from '../src/projection.ts'

const empty = (): PipelineState => ({ sessionId: 'session-1', inherited: 0, runs: [] })

const runRecord = { version: 1, runId: 'run-1', templateId: 'tpl-1', templateVersion: 1 }
const taskRecord = (taskId: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ version: 1, runId: 'run-1', taskId, status, ...extra })

describe('pipeline projection fold', () => {
  it('rebuilds a completed run from its records', () => {
    let state = foldRecord(empty(), 'plugin:dsh-pipeline/run', runRecord, 100)
    state = foldRecord(state, 'plugin:dsh-pipeline/task', taskRecord('a', 'pending', { title: 'Write the intro' }), 101)
    state = foldRecord(state, 'plugin:dsh-pipeline/task', taskRecord('a', 'in_progress', { childSessionId: 'child-1' }), 102)
    state = foldRecord(state, 'plugin:dsh-pipeline/task', taskRecord('a', 'done', { output: 'result-a' }), 103)
    state = foldRecord(state, 'plugin:dsh-pipeline/status', { version: 1, runId: 'run-1', status: 'succeeded' }, 104)

    const run = state.runs[0]
    expect(run?.status).toBe('succeeded')
    expect(run?.startedAt).toBe(100)
    expect(run?.endedAt).toBe(104)
    expect(run?.tasks).toEqual([{
      id: 'a', status: 'done', title: 'Write the intro', childSessionId: 'child-1', output: 'result-a', startedAt: 102, endedAt: 103,
    }])
  })

  it('ignores unknown record types and invalid payloads', () => {
    const state = empty()
    expect(foldRecord(state, 'plugin:other/thing', { version: 1 }, 1)).toBe(state)
    expect(foldRecord(state, 'plugin:dsh-pipeline/run', { version: 2, runId: 'run-1' }, 1)).toBe(state)
    expect(foldRecord(state, 'plugin:dsh-pipeline/task', { version: 1, runId: 'absent', taskId: 'a', status: 'done' }, 1)).toBe(state)
  })

  it('ignores a duplicated run record', () => {
    const state = foldRecord(empty(), 'plugin:dsh-pipeline/run', runRecord, 100)
    expect(foldRecord(state, 'plugin:dsh-pipeline/run', runRecord, 101)).toBe(state)
  })

  it('does not reopen a terminal run', () => {
    let state = foldRecord(empty(), 'plugin:dsh-pipeline/run', runRecord, 100)
    state = foldRecord(state, 'plugin:dsh-pipeline/status', { version: 1, runId: 'run-1', status: 'failed' }, 101)
    const after = foldRecord(state, 'plugin:dsh-pipeline/status', { version: 1, runId: 'run-1', status: 'aborted' }, 102)
    expect(after.runs[0]?.status).toBe('failed')
  })
})

describe('pipeline projection definition', () => {
  it('bumps the cached state version for titles', () => {
    expect(createProjection().stateVersion).toBe(2)
  })
})
