/**
 * Typed pipeline failures. Codes are stable so tools and callers route on `code`, never on messages.
 * @module dsh-pipeline/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Machine-routable failure kinds. */
export type PipelineErrorCode =
  | 'PIPELINE_TEMPLATE_INVALID'
  | 'PIPELINE_TEMPLATE_NOT_FOUND'
  | 'PIPELINE_RUN_NOT_FOUND'
  | 'PIPELINE_PROVIDER_UNAVAILABLE'

/** Typed error for pipeline failures. */
export class PipelineError extends HarnessError {
  override readonly code: PipelineErrorCode

  /**
   * @param message - actionable description naming the offending template, run, or provider.
   * @param code - stable failure kind.
   * @param options - optional cause.
   */
  constructor(message: string, code: PipelineErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'PipelineError'
    this.code = code
  }
}
