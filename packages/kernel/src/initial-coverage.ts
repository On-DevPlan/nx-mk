/**
 * 初始覆盖率 —— 从 .nx-mk/manifest.json 读取字段作为 Goal Loop 起点（M14 收尾）
 *
 * 设计：
 * - manifest.json 由 plugin-swagger 在 beforeRun 阶段写入
 * - kernel.run() 触发 Goal Loop 时调用本函数，把 manifest.fields 转成 missing items
 * - 文件缺失或解析失败时回退到 placeholder（保持现有 demo 行为）
 *
 * 不直接依赖 @nx-mk/manifest 包：kernel 作为微内核不应耦合具体 Provider；
 * manifest.json 是公开契约（ApiManifest 形态），任何 Provider 都能产出。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Coverage, MissingItem } from './types'

// 极简 manifest 形状：kernel 不强依赖 manifest-schema，只取需要的字段
interface ManifestFieldSubset {
  id: string
}

interface ManifestSubset {
  fields?: ManifestFieldSubset[]
}

/**
 * 从 .nx-mk/manifest.json 构造 Goal Loop 起点 Coverage
 *
 * @param cwd - 项目根目录
 * @returns Coverage - total = fields 数量，missing = 所有 field id
 *
 * 文件不存在 / 解析失败 / fields 为空 → 返回 placeholder
 * （让 Goal Loop 至少跑一轮 demo 行为，便于在没生成 manifest 时不空转）
 */
export function readInitialCoverageFromManifest(cwd: string): Coverage {
  const PLACEHOLDER: Coverage = {
    total: 1,
    covered: 0,
    ratio: 0,
    missing: [{ kind: 'field', fieldId: '__placeholder__' }],
  }

  const manifestPath = join(cwd, '.nx-mk', 'manifest.json')
  if (!existsSync(manifestPath)) return PLACEHOLDER

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return PLACEHOLDER
  }

  const fields = (parsed as ManifestSubset | null)?.fields
  if (!Array.isArray(fields) || fields.length === 0) return PLACEHOLDER

  // manifest 每个 field 的 id = stableFieldId(method:path:direction:status:normalizedPath)
  // 正好对齐 MissingItem 的 field-kind（fieldId 即稳定哈希）
  const missing: MissingItem[] = fields
    .filter((f): f is ManifestFieldSubset => typeof f?.id === 'string' && f.id.length > 0)
    .map((f) => ({ kind: 'field', fieldId: f.id }))

  if (missing.length === 0) return PLACEHOLDER

  return {
    total: missing.length,
    covered: 0,
    ratio: 0,
    missing,
  }
}