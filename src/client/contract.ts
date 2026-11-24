/**
 * The browser services and slot props this bundle uses, declared locally because
 * the package is built outside the harness workspace and does not compile against
 * the client packages' type graph. Names match the shipped slot contracts; a
 * mismatch is caught only by loading the bundle in `dsh web`.
 * @module dsh-pipeline/client/contract
 */

import type { PipelineKey } from './locales.ts'

/** Translator bound to this bundle's namespace. */
export type Translate = (key: PipelineKey) => string

/** Props every Session-scoped slot receives from the slot runtime. */
export interface SessionProps {
  /** Host-computed projection values addressed by key. */
  useProjection: (key: 'pipeline') => unknown
}

/** Props of the right-sidebar panel body. */
export type PipelinePanelProps = SessionProps & { t: Translate }

/** Props of the Session-header entry. */
export type PipelineButtonProps = SessionProps & { t: Translate; openPanel: () => void }

/** The subset of the browser plugin context this bundle registers through. */
export interface ClientContext {
  effect: (body: () => () => void, label: string) => void
  locale: {
    register: (namespace: string, dictionaries: Record<string, Record<string, string>>) => () => void
    bind: (namespace: string) => Translate
  }
  slots: {
    inject: (name: string, register: () => () => void) => () => void
    register: (definition: Record<string, unknown>, component: unknown) => () => void
  }
  sidebarRightTabs: { register: (definition: unknown) => () => void }
  sidebarRight: { openTab: (kind: string) => void }
}
