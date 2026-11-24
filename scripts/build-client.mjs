#!/usr/bin/env node
/**
 * Build the browser half (`src/client/index.ts`) into `lib/client.js`, the
 * prebuilt bundle the Web client serves as `/plugins/dsh-pipeline/client.js`.
 *
 * The harness's client build preset is not published, so this reproduces the
 * wrapper the module loader expects: `window.__ModuleLoader__.load({ id, meta,
 * factory })`, with platform modules resolved through the injected `require`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(root, 'src/client/index.ts')
const stylesheet = resolve(root, 'src/client/styles.css')
const output = resolve(root, 'lib/client.js')

/** Modules the Web platform provides; everything else is bundled in. */
const EXTERNALS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'zod',
]

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: EXTERNALS,
  write: false,
  logLevel: 'warning',
  legalComments: 'none',
})

const produced = result.outputFiles[0]?.text
if (produced === undefined) throw new Error('dsh-pipeline: esbuild produced no bundle')
const css = readFileSync(stylesheet, 'utf8')
const body = produced.trimEnd().replace(/^"use strict";\n/, '')
const indented = body.split('\n').map(line => `    ${line}`).join('\n')

const file = `window.__ModuleLoader__.load({
  id: 'dsh-pipeline',
  meta() {
    return {
      stylesheets: {
        'pipeline.css': { text: () => ${JSON.stringify(css)} },
      },
    }
  },
  factory(require) {
    'use strict';
    var module = { exports: {} };
    var exports = module.exports;
${indented}
    return module.exports;
  },
});
`

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, file)
console.log(`dsh-pipeline: wrote ${output}`)
