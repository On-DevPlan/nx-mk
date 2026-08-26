import { createKernel, makeRunId, type LogLevel } from '@nx-mk/kernel'

export interface RunMainOptions {
  configPath: string
  runId: string
  cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
}

export async function runMain(opts: RunMainOptions): Promise<void> {
  const kernel = createKernel({
    configPath: opts.configPath,
    runId: makeRunId(opts.runId),
    subcommand: 'run',
    cwd: process.cwd(),
  })
  const result = await kernel.run()
  console.log(`✔ Run ${result.runId} completed in ${result.durationMs}ms`)
  console.log(`  Logs: .nx-mk/runs/${result.runId}/`)
}