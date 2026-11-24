/**
 * Right-sidebar body: every pipeline run of the Session, newest first, with one
 * row per task. State arrives through the `pipeline` projection, which the host
 * pushes on each record, so no polling reaches the server.
 * @module dsh-pipeline/client/PipelinePanel
 */

import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import {
  IconCheckCircleOutlineRegular,
  IconChevronRightOutlineRegular,
  IconClockOutlineRegular,
  IconCloseCircleFillRegular,
  IconLoadingOutlineRegular,
  IconStopFillRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PipelinePanelProps, Translate } from './contract.ts'
import { fill } from './locales.ts'
import type { TaskStatus, TaskView } from './wire.ts'
import { readPipelineView } from './wire.ts'

const TASK_ICONS: Record<TaskStatus, ComponentType<IconProps>> = {
  pending: IconClockOutlineRegular,
  in_progress: IconLoadingOutlineRegular,
  done: IconCheckCircleOutlineRegular,
  failed: IconCloseCircleFillRegular,
  skipped: IconStopFillRegular,
}

const UNKNOWN_DURATION = '–'

/**
 * The panel body.
 * @param props - Session projection seat and this bundle's translator.
 * @returns the run list, or the empty state when the Session has no runs.
 */
export function PipelinePanel({ useProjection, t }: PipelinePanelProps) {
  const view = readPipelineView(useProjection('pipeline'))
  const runs = view === undefined ? [] : [...view.runs].reverse()
  const live = runs.some(run => run.status === 'running')
  const now = useNow(live)
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({})

  if (runs.length === 0) {
    return <div className="dsh-pipeline-root"><p className="dsh-pipeline-empty">{t('panel.empty')}</p></div>
  }

  return (
    <div className="dsh-pipeline-root">
      <ul className="dsh-pipeline-runs">
        {runs.map((run, index) => {
          const expanded = toggled[run.runId] ?? index === 0
          const done = run.tasks.filter(task => task.status === 'done').length
          return (
            <li key={run.runId} className="dsh-pipeline-run">
              <button
                type="button"
                className="dsh-pipeline-runHeader"
                aria-expanded={expanded}
                title={fill(t('run.label'), {
                  template: `${run.templateId} v${run.templateVersion}`,
                  status: t(`run.status.${run.status}`),
                })}
                onClick={() => {
                  setToggled(previous => ({ ...previous, [run.runId]: !expanded }))
                }}
              >
                <IconChevronRightOutlineRegular className="dsh-pipeline-chevron" size={14} aria-hidden />
                <span className="dsh-pipeline-runTitle">
                  {run.templateId} <span className="dsh-pipeline-duration">{fill(t('run.version'), { version: run.templateVersion })}</span>
                </span>
                <span className="dsh-pipeline-runMeta">
                  <span className="dsh-pipeline-status" data-status={run.status}>{t(`run.status.${run.status}`)}</span>
                  <span>{fill(t('run.progress'), { done, total: run.tasks.length })}</span>
                  <span className="dsh-pipeline-duration">
                    {renderDuration(t, run.startedAt, run.endedAt, run.status === 'running', now)}
                  </span>
                </span>
              </button>
              {expanded
                ? (
                  <ul className="dsh-pipeline-tasks">
                    {run.tasks.map(task => <TaskRow key={task.id} task={task} t={t} now={now} />)}
                  </ul>
                )
                : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function TaskRow({ task, t, now }: { task: TaskView; t: Translate; now: number }) {
  const Icon = TASK_ICONS[task.status]
  const duration = task.startedAt === undefined
    ? UNKNOWN_DURATION
    : renderDuration(t, task.startedAt, task.endedAt, task.status === 'in_progress', now)
  const label = task.title ?? task.id
  return (
    <li className="dsh-pipeline-task" data-status={task.status}>
      <span className="dsh-pipeline-taskIcon" role="img" aria-label={t(`task.status.${task.status}`)}>
        <Icon size={14} aria-hidden />
      </span>
      <span className="dsh-pipeline-taskTitle" title={label}>{label}</span>
      <span className="dsh-pipeline-duration">{duration}</span>
      {task.error === undefined ? null : <p className="dsh-pipeline-error">{task.error}</p>}
      {task.output === undefined ? null : (
        <details className="dsh-pipeline-output">
          <summary>{t('task.output')}</summary>
          <pre>{task.output}</pre>
        </details>
      )}
    </li>
  )
}

/** Re-render every second only while a run is in flight. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [live])
  return now
}

function renderDuration(t: Translate, startedAt: number, endedAt: number | undefined, live: boolean, now: number): string {
  const stop = endedAt ?? (live ? now : undefined)
  if (stop === undefined) return UNKNOWN_DURATION
  const seconds = Math.max(0, Math.round((stop - startedAt) / 1000))
  return seconds < 60
    ? fill(t('duration.seconds'), { s: seconds })
    : fill(t('duration.minutes'), { m: Math.floor(seconds / 60), s: seconds % 60 })
}
