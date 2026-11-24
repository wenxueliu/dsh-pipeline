/**
 * Browser half of dsh-pipeline: registers the `pipeline` right-sidebar page type,
 * its panel body, and the Session-header entry that opens it. Run state comes from
 * the `pipeline` Session projection; this bundle performs no host calls.
 * @module dsh-pipeline/client
 */

import type { ClientContext } from './contract.ts'
import { en, NS, zh } from './locales.ts'
import { PipelineButton } from './PipelineButton.tsx'
import { PipelinePanel } from './PipelinePanel.tsx'

/** Services whose registries and seats this bundle contributes to. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

/** Page kind: what `openTab` names and what the tab chips show. */
const KIND = 'pipeline'
/** This implementation's identity; also the key of the panel body registration. */
const ID = 'dsh-pipeline'
/** Position of the panel's guide entry among every provider's entries. */
const GUIDE_ORDER = 50

/**
 * Register the panel, its tab type, and the header entry.
 * @param ctx - browser context carrying slots, locale, and the right sidebar.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-pipeline: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID,
    kind: KIND,
    title: () => t('panel.title'),
    guide: [{
      id: KIND,
      order: GUIDE_ORDER,
      title: () => t('panel.title'),
      description: () => t('panel.guide'),
    }],
  }), 'dsh-pipeline: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: ID,
    locale: NS,
  }, PipelinePanel)), 'dsh-pipeline: panel body')
  ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: ID,
    // Left of the overflow menu (order 0), right of the leading utilities (order -10).
    order: -4,
    locale: NS,
    inject: () => ({
      openPanel: () => { ctx.sidebarRight.openTab(KIND) },
    }),
  }, PipelineButton)), 'dsh-pipeline: header entry')
}
