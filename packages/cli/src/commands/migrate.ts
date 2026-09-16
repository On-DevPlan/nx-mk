/**
 * migrate 子命令 —— SDK-CG3 静态迁移的 CLI 薄适配（spec §3.6）
 *
 * 核心替换逻辑在 @nx-mk/client/migrate 引擎（纯函数）；本文件只做 IO 与展示：
 * 读 manifest.json → 收集源码文件 → 引擎 → 写盘/报告。全部 flag 有默认值，
 * `npx nx-mk migrate` 零配置可跑。
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { KernelError } from '@nx-mk/kernel'
import { migrateCodemod } from '@nx-mk/client/migrate'

export interface MigrateOptions {
  /** manifest 路径，默认 ./.nx-mk/manifest.json */
  manifestPath?: string
  /** 扫描目录，默认 ./src */
  dir?: string
  /** fetch URL 前缀，默认 /api */
  apiPrefix?: string
  /** 插入的 api import specifier，默认 ./generated-sdk */
  importSpecifier?: string
  /** 只报告不写盘 */
  dryRun?: boolean
  /** 机器可读 JSON 输出 */
  json?: boolean
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nx-mk'])

export async function runMigrate(opts: MigrateOptions = {}): Promise<void> {
  const cwd = process.cwd()
  const resolvePath = (p: string): string => (isAbsolute(p) ? p : join(cwd, p))

  const manifest = loadManifest(resolvePath(opts.manifestPath ?? '.nx-mk/manifest.json'))
  const dir = resolvePath(opts.dir ?? 'src')
  if (!existsSync(dir)) {
    throw new KernelError('CONFIG_NOT_FOUND', `migrate: source dir not found: ${dir}`)
  }

  const files = collectSourceFiles(dir).map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }))

  const result = migrateCodemod({
    manifest,
    files,
    apiPrefix: opts.apiPrefix,
    importSpecifier: opts.importSpecifier,
  })

  let written = 0
  if (!opts.dryRun) {
    for (const f of result.files) {
      if (f.changed) {
        writeFileSync(f.path, f.content)
        written++
      }
    }
  }

  emitReport(result, { dryRun: opts.dryRun ?? false, json: opts.json ?? false, written })
}

// ─── IO 辅助 ────────────────────────────────────────────────────────────────

function loadManifest(manifestPath: string): Parameters<typeof migrateCodemod>[0]['manifest'] {
  if (!existsSync(manifestPath)) {
    throw new KernelError(
      'CONFIG_NOT_FOUND',
      `migrate: manifest not found at ${manifestPath} — run 'nx-mk run' first`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    throw new KernelError('CONFIG_INVALID', `migrate: manifest is not valid JSON: ${(err as Error).message}`)
  }
  const manifest = parsed as { endpoints?: unknown }
  if (!manifest || !Array.isArray(manifest.endpoints)) {
    throw new KernelError('CONFIG_INVALID', `migrate: manifest missing 'endpoints' array`)
  }
  return manifest as Parameters<typeof migrateCodemod>[0]['manifest']
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(d, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (SOURCE_EXTS.has(full.slice(full.lastIndexOf('.')))) out.push(full)
    }
  }
  walk(dir)
  return out
}

// ─── 报告输出 ───────────────────────────────────────────────────────────────

interface ReportMeta {
  dryRun: boolean
  json: boolean
  written: number
}

function emitReport(
  result: ReturnType<typeof migrateCodemod>,
  meta: ReportMeta,
): void {
  const { report } = result
  if (meta.json) {
    console.log(JSON.stringify({ report, written: meta.written, dryRun: meta.dryRun }, null, 2))
    return
  }
  console.log(
    `✔ migrate: ${report.replaced.length} replaced, ${report.skipped.length} skipped` +
      (meta.dryRun ? ' (dry-run: no files written)' : `, ${meta.written} file(s) written`),
  )
  for (const r of report.replaced) {
    console.log(`  replaced  ${r.path}: ${r.from} → ${r.to}`)
  }
  for (const s of report.skipped) {
    console.log(`  skipped   ${s.path}: ${s.reason} — ${s.fetch}`)
  }
  if (report.skipped.length > 0) {
    console.log(`  tip: 未迁移的调用可由 patchGlobalFetch() 兜底（@nx-mk/client/runtime）`)
  }
}
