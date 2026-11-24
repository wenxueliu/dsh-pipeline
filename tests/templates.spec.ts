import { describe, expect, it } from 'vitest'
import { validateTemplate } from '../src/templates.ts'
import type { TaskDefinition } from '../src/types.ts'

const task = (id: string, depends_on?: string[]): TaskDefinition => ({
  id,
  do: `work ${id}`,
  ...depends_on === undefined ? {} : { depends_on },
})

describe('validateTemplate', () => {
  it('accepts an acyclic graph', () => {
    expect(validateTemplate([task('a'), task('b', ['a']), task('c', ['a', 'b']), task('d')])).toBeUndefined()
  })

  it('rejects an empty task list', () => {
    expect(validateTemplate([])).toContain('at least one task')
  })

  it('rejects duplicate ids', () => {
    expect(validateTemplate([task('a'), task('a')])).toContain('duplicate task id')
  })

  it('rejects an unknown dependency', () => {
    expect(validateTemplate([task('a', ['missing'])])).toContain('unknown task')
  })

  it('rejects a self dependency', () => {
    expect(validateTemplate([task('a', ['a'])])).toContain('depends on itself')
  })

  it('rejects a cycle', () => {
    expect(validateTemplate([task('a', ['b']), task('b', ['c']), task('c', ['a'])])).toContain('dependency cycle')
  })
})
