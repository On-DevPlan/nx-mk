import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { createKernel, makeRunId, type LogLevel } from '@nx-mk/kernel'

export interface RunDoctorOptions {
  configPath: string | undefined
  runId: string
  cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
}

interface Check {
  name: string
  ok: boolean
  detail?: string
}

export async function runDoctor(opts: RunDoctorOptions): Promise<void> {
  const checks: Check[] = []

  // 1. Node version
  const nodeVer = process.versions.node
  const major = parseInt(nodeVer.split('.')[0] ?? '0', 10)
  checks.push({
    name: 'Node.js >= 20',
    ok: major >= 20,
    detail: major >= 20 ? `current: ${nodeVer}` : `current: ${nodeVer} (need >= 20)`,
  })

  // 2. config file
  if (opts.configPath) {
    checks.push({
      name: 'nx-mk.config.yml',
      ok: existsSync(opts.configPath),
      detail: opts.configPath,
    })
  } else {
    checks.push({
      name: 'nx-mk.config.yml',
      ok: false,
      detail: 'not found; run `npx nx-mk init` to scaffold',
    })
  }

  // 3. .nx-mk/ writable
  try {
    mkdirSync('.nx-mk', { recursive: true })
    writeFileSync('.nx-mk/.doctor-test', 'ok')
    unlinkSync('.nx-mk/.doctor-test')
    checks.push({ name: '.nx-mk/ writable', ok: true })
  } catch (err) {
    checks.push({ name: '.nx-mk/ writable', ok: false, detail: (err as Error).message })
  }

  // 4. plugins loadable
  if (opts.configPath) {
    try {
      const kernel = createKernel({
        configPath: opts.configPath,
        runId: makeRunId(opts.runId),
        subcommand: 'doctor',
        cwd: process.cwd(),
      })
      await kernel.run()
      checks.push({ name: 'plugins loadable', ok: true })
    } catch (err) {
      checks.push({
        name: 'plugins loadable',
        ok: false,
        detail: (err as Error).message,
      })
    }
  }

  for (const c of checks) {
    const mark = c.ok ? '✔' : '✖'
    const tail = c.detail ? ` — ${c.detail}` : ''
    console.log(`${mark} ${c.name}${tail}`)
  }
  const allOk = checks.every((c) => c.ok)
  if (!allOk) {
    process.exit(2)
  }
  void dirname
}
