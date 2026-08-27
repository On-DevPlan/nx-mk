import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createKernel, makeRunId, type LogLevel } from '@nx-mk/kernel'

export interface RunInitOptions {
  configPath: string
  cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
}

const DEFAULT_CONFIG = `# nx-mk configuration
# See: docs/superpowers/specs/2026-08-26-nx-mk-phase0-foundation-design.md

plugins:
  - '@nx-mk/plugin-swagger'

logLevel: info
outputDir: ./.nx-mk/runs
`

export async function runInit(opts: RunInitOptions): Promise<void> {
  mkdirSync(dirname(opts.configPath), { recursive: true })

  if (existsSync(opts.configPath)) {
    console.log(`✔ nx-mk.config.yml already exists at ${opts.configPath}`)
  } else {
    writeFileSync(opts.configPath, DEFAULT_CONFIG, 'utf8')
    console.log(`✔ Created ${opts.configPath}`)
  }

  mkdirSync(join(dirname(opts.configPath), '.nx-mk', 'runs'), { recursive: true })
  console.log('✔ Created .nx-mk/runs/')

  const kernel = createKernel({
    configPath: opts.configPath,
    runId: makeRunId('init'),
    subcommand: 'init',
    cwd: dirname(opts.configPath),
  })
  await kernel.run()
  console.log('✔ Kernel lifecycle exercised; see .nx-mk/runs/init/')
}
