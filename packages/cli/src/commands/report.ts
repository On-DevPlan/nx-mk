/**
 * report 子命令（plan §9 命令清单「npx mk report — 打开报告」）：
 * 读取 .nx-mk/coverage-report.json 打印三指标摘要与产物路径；--open 用系统默认程序打开报告文件。
 * 报告缺失 → RUN_NOT_FOUND（用户可自修：先跑 nx-mk run / start）。
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { KernelError } from '@nx-mk/kernel'

export interface ReportMainOptions {
  cwd?: string
  /** --open：best-effort 用系统默认程序打开 coverage-report.json */
  open?: boolean
  /** 测试缝：不注入则用真实 opener */
  deps?: { openPath: (path: string) => void }
}

/** 报告 JSON 的最小读取形状（metrics 全可选：不臆造，缺失打印 (n/a)） */
interface ReportFile {
  runId?: string
  metrics?: {
    requiredCoverage?: number
    effectiveCoverage?: number
    rawBackendFieldCoverage?: number
    fieldsTotal?: number
    fieldsReturned?: number
    missingRequiredFields?: number
    ignoredReturnedFields?: number
    suspiciousFields?: number
    endpointsTotal?: number
    endpointsCalled?: number
  }
}

export async function reportMain(opts: ReportMainOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()
  const reportPath = join(cwd, '.nx-mk', 'coverage-report.json')
  if (!existsSync(reportPath)) {
    throw new KernelError(
      'RUN_NOT_FOUND',
      `coverage report not found: ${reportPath} — run \`nx-mk run\` or \`nx-mk start\` first`,
    )
  }
  const { readFileSync } = await import('node:fs')
  let report: ReportFile
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as ReportFile
  } catch (err) {
    throw new KernelError('RUN_NOT_FOUND', `coverage report unreadable: ${(err as Error).message}`)
  }
  const m = report.metrics ?? {}
  const pct = (v: number | undefined): string =>
    typeof v === 'number' ? `${Math.round(v * 100)}%` : '(n/a)'
  console.log(`Report: ${resolve(reportPath)}`)
  if (report.runId) console.log(`  Run: ${report.runId}`)
  console.log(
    `  Coverage: required ${pct(m.requiredCoverage)} | effective ${pct(m.effectiveCoverage)} | raw backend ${pct(m.rawBackendFieldCoverage)}`,
  )
  console.log(
    `  Fields: ${m.fieldsTotal ?? '(n/a)'} total / ${m.fieldsReturned ?? '(n/a)'} returned | missing required: ${m.missingRequiredFields ?? '(n/a)'} | ignored returned: ${m.ignoredReturnedFields ?? '(n/a)'} | suspicious: ${m.suspiciousFields ?? '(n/a)'}`,
  )
  console.log(`  Endpoints: ${m.endpointsCalled ?? '(n/a)'}/${m.endpointsTotal ?? '(n/a)'} called`)
  console.log('  Artifacts: .nx-mk/coverage.db · .nx-mk/coverage-report.json · .nx-mk/runs/')

  if (opts.open) {
    const opener = opts.deps?.openPath ?? openPathBestEffort
    opener(resolve(reportPath))
  }
}

/** best-effort 系统打开（同 start.ts openBrowser 模式：spawn 平台命令，失败仅 warn） */
function openPathBestEffort(path: string): void {
  try {
    const cmd = process.platform === 'win32'
      ? ['cmd', '/c', 'start', '', path]
      : process.platform === 'darwin'
        ? ['open', path]
        : ['xdg-open', path]
    const child = spawn(cmd[0]!, cmd.slice(1), { stdio: 'ignore', detached: true })
    child.on('error', (err) => {
      console.warn(`failed to open report: ${err.message}`)
    })
    child.unref()
  } catch (err) {
    console.warn(`failed to open report: ${(err as Error).message}`)
  }
}
