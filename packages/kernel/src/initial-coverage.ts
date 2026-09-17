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
  /** spec §3.1：missing 索引改用路径；旧 manifest 无此字段则跳过（防御） */
  normalizedPath?: string
}

interface ManifestSubset {
  fields?: ManifestFieldSubset[]
}

export interface InitialCoverageOptions {
  /** ⚠️计划细化：goal 侧 policy 联动 —— 命中任一 glob 的字段不进 missing
   *  （kernel 内置镜像 matcher，与 coverage/policy/glob 的 matchGlob 同语义，
   *   跨包契约测试以 (pattern, path, expected) 矩阵钉住两者一致；kernel 不 import coverage） */
  ignoredGlobs?: string[]
}

/**
 * 有限通配匹配（镜像 coverage/src/policy/glob.ts 的 matchGlob）：
 * 按 '.' 分段；'*' 匹配恰好一段；'**' 匹配零或多段；其余段字面全等。
 * 迭代 + 最近 '**' 回溯，与 coverage 侧实现同构；kernel 保持零依赖不直接复用。
 */
function matchesIgnored(globs: string[], path: string): boolean {
  return globs.some((pattern) => {
    const p = pattern.split('.').filter(Boolean)
    const s = path.split('.').filter(Boolean)
    let i = 0
    let j = 0
    let starIdx = -1 // 最近一个 '**' 的 pattern 下标
    let restoreJ = 0 // 回溯时 path 的位置（'**' 吞掉的下一段起点）
    while (j < s.length) {
      if (i < p.length && (p[i] === s[j] || p[i] === '*')) {
        i++
        j++
      } else if (i < p.length && p[i] === '**') {
        starIdx = i
        restoreJ = j
        i++
      } else if (starIdx !== -1) {
        // 回溯：让 '**' 多吞一段
        i = starIdx + 1
        restoreJ++
        j = restoreJ
      } else {
        return false
      }
    }
    // path 耗尽后，pattern 剩余只允许 '**'（匹配零段）
    while (i < p.length && p[i] === '**') i++
    return i === p.length
  })
}

/**
 * 从 .nx-mk/manifest.json 构造 Goal Loop 起点 Coverage
 *
 * @param cwd - 项目根目录
 * @param opts - ignoredGlobs：命中任一 glob 的字段不进 missing（goal 侧 policy 联动）
 * @returns Coverage - total = 参与计数的 fields 数量，missing = 各 field 的 normalizedPath
 *
 * 文件不存在 / 解析失败 / fields 为空 / 无可用字段（缺 id 或 normalizedPath）→ 返回 placeholder
 * （让 Goal Loop 至少跑一轮 demo 行为，便于在没生成 manifest 时不空转）
 */
export function readInitialCoverageFromManifest(
  cwd: string,
  opts?: InitialCoverageOptions,
): Coverage {
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

  // spec §3.1（id-space 对齐）：missing 项 fieldId = normalizedPath（与 field-hit 报告
  // 同处路径字符串空间），不再是 stableFieldId 哈希；旧 manifest 无 normalizedPath 则跳过
  const usable = fields.filter(
    (f): f is ManifestFieldSubset & { normalizedPath: string } =>
      typeof f?.id === 'string' && f.id.length > 0 &&
      typeof f?.normalizedPath === 'string' && f.normalizedPath.length > 0,
  )
  if (usable.length === 0) return PLACEHOLDER

  // ⚠️计划细化：命中 ignoredGlobs 的字段不进 missing（policy-ignored 字段永不被页面读取）
  const missing: MissingItem[] = usable
    .filter((f) => !(
      opts?.ignoredGlobs && opts.ignoredGlobs.length > 0 &&
      matchesIgnored(opts.ignoredGlobs, f.normalizedPath)
    ))
    .map((f) => ({ kind: 'field', fieldId: f.normalizedPath }))

  // 全部被 policy 排除 → 空 coverage（total 0 / ratio 1，对齐 computeCoverage 的
  // total=0 口径：goal-loop 的「初始已达成」边界检查零轮即 met）
  return {
    total: missing.length,
    covered: 0,
    ratio: missing.length === 0 ? 1 : 0,
    missing,
  }
}