/**
 * Session-header entry: shows the newest run's step count and opens the panel.
 * Renders nothing for a Session that never started a pipeline, so the header
 * stays quiet where the plugin is unused.
 * @module dsh-pipeline/client/PipelineButton
 */

import { IconChecklistOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PipelineButtonProps } from './contract.ts'
import { fill } from './locales.ts'
import { readPipelineView } from './wire.ts'

/**
 * The header button.
 * @param props - Session projection seat, translator, and the panel opener.
 * @returns the entry, or `null` when the Session has no runs.
 */
export function PipelineButton({ useProjection, t, openPanel }: PipelineButtonProps) {
  const view = readPipelineView(useProjection('pipeline'))
  const latest = view?.runs[view.runs.length - 1]
  if (latest === undefined) return null
  const done = latest.tasks.filter(task => task.status === 'done').length
  return (
    <button
      type="button"
      className="dsh-pipeline-button"
      data-active={latest.status === 'running' ? 'true' : 'false'}
      aria-label={t('button.open')}
      title={t('button.open')}
      onClick={openPanel}
    >
      <IconChecklistOutlineRegular size={16} aria-hidden />
      <span>{fill(t('run.progress'), { done, total: latest.tasks.length })}</span>
    </button>
  )
}
