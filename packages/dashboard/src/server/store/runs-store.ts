/**
 * runs 目录扫描（spec §3.1）：.nx-mk/runs/ 子目录即 runId 主键来源——
 * 非 collect run 没有 db 行，目录是唯一普适存在。runId 形如 run_YYYYMMDD_HHMMSS，
 * 字典序 = 时间序。任何 IO 异常按空处理（spec §4：只读降级不抛）。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface FileRun {
  runId: string
  hasEvents: boolean
}

export function listRuns(nxMkDir: string): FileRun[] {
  const runsDir = join(nxMkDir, 'runs')
  if (!existsSync(runsDir)) return []
  let entries: string[]
  try {
    entries = readdirSync(runsDir)
  } catch {
    return []
  }
  const out: FileRun[] = []
  for (const name of entries) {
    const p = join(runsDir, name)
    try {
      if (!statSync(p).isDirectory()) continue
    } catch {
      continue
    }
    out.push({ runId: name, hasEvents: existsSync(join(p, 'events.jsonl')) })
  }
  return out.sort((a, b) => a.runId.localeCompare(b.runId))
}
