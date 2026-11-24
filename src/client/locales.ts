/**
 * Copy for the pipeline panel and its Session-header entry.
 * @module dsh-pipeline/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'dsh-pipeline'

/** English copy; its keys are the namespace's key type. */
export const en = {
  'panel.title': 'Pipelines',
  'panel.guide': 'Per-step progress of the pipeline runs in this session',
  'panel.empty': 'No pipeline runs in this session.',
  'button.open': 'Open pipelines',
  'run.label': '{template} · {status}',
  'run.version': 'v{version}',
  'run.progress': '{done}/{total}',
  'run.status.running': 'Running',
  'run.status.succeeded': 'Succeeded',
  'run.status.failed': 'Failed',
  'run.status.aborted': 'Aborted',
  'task.status.pending': 'Pending',
  'task.status.in_progress': 'Running',
  'task.status.done': 'Done',
  'task.status.failed': 'Failed',
  'task.status.skipped': 'Skipped',
  'task.output': 'Output',
  'duration.seconds': '{s}s',
  'duration.minutes': '{m}m {s}s',
}

/** One key of the namespace. */
export type PipelineKey = keyof typeof en

/** Chinese copy. */
export const zh: Record<PipelineKey, string> = {
  'panel.title': '流水线',
  'panel.guide': '本会话中流水线运行的逐步进展',
  'panel.empty': '本会话还没有流水线运行。',
  'button.open': '打开流水线',
  'run.label': '{template} · {status}',
  'run.version': 'v{version}',
  'run.progress': '{done}/{total}',
  'run.status.running': '运行中',
  'run.status.succeeded': '已完成',
  'run.status.failed': '失败',
  'run.status.aborted': '已中止',
  'task.status.pending': '等待中',
  'task.status.in_progress': '执行中',
  'task.status.done': '完成',
  'task.status.failed': '失败',
  'task.status.skipped': '已跳过',
  'task.output': '输出',
  'duration.seconds': '{s} 秒',
  'duration.minutes': '{m} 分 {s} 秒',
}

/**
 * Substitute `{name}` placeholders.
 * @param template - translated text.
 * @param values - placeholder values; a missing name leaves its placeholder in place.
 * @returns the filled text.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name]
    return value === undefined ? placeholder : String(value)
  })
}
