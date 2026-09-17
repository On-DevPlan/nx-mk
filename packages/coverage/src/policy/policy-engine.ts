/**
 * Coverage Policy Engine（plan §21 全量）—— 纯函数，无 IO。
 * 输入 manifest 字段子集 + config coverage 段，输出每字段 PolicyDecision（§21.4 逐字形状）。
 * 优先级 §21.5 逐字：user required > user ignored > user optional > default > unknown。
 * §21.1：ignored 不等于消失 —— 不进分母但仍出现在决策表（analyzer 据此产 ignored-returned）。
 */
import { matchGlob } from './glob.js'

export interface PolicyConfig {
  required?: string[]
  optional?: string[]
  ignored?: string[]
}

export interface MatchedRule {
  source: 'user-config' | 'default'
  pattern: string
  reason?: string
}

export type CoveragePolicyStatus = 'required' | 'optional' | 'ignored' | 'unknown'

export interface PolicyDecision {
  fieldId: string
  fieldPath: string
  status: CoveragePolicyStatus
  countedInRequiredCoverage: boolean
  countedInEffectiveCoverage: boolean
  matchedRule?: MatchedRule
}

/** analyzer/测试侧的 manifest 字段子集（不耦合 manifest-schema 类型） */
export interface ManifestFieldLike {
  id: string
  normalizedPath: string
  required?: boolean
}

// 用户列表内按声明顺序取首个命中；跨列表按优先级
function firstUserMatch(patterns: string[] | undefined, fieldPath: string): string | undefined {
  return patterns?.find((p) => matchGlob(p, fieldPath))
}

export function evaluatePolicy(fields: ManifestFieldLike[], policy: PolicyConfig): PolicyDecision[] {
  return fields.map((f) => {
    const fp = f.normalizedPath
    const req = firstUserMatch(policy.required, fp)
    if (req !== undefined) {
      return { fieldId: f.id, fieldPath: fp, status: 'required', countedInRequiredCoverage: true, countedInEffectiveCoverage: true, matchedRule: { source: 'user-config', pattern: req } }
    }
    const ign = firstUserMatch(policy.ignored, fp)
    if (ign !== undefined) {
      return { fieldId: f.id, fieldPath: fp, status: 'ignored', countedInRequiredCoverage: false, countedInEffectiveCoverage: false, matchedRule: { source: 'user-config', pattern: ign } }
    }
    const opt = firstUserMatch(policy.optional, fp)
    if (opt !== undefined) {
      return { fieldId: f.id, fieldPath: fp, status: 'optional', countedInRequiredCoverage: false, countedInEffectiveCoverage: true, matchedRule: { source: 'user-config', pattern: opt } }
    }
    // default：schema required 标记 → required，否则 optional（spec §3.2）
    if (f.required === true) {
      return { fieldId: f.id, fieldPath: fp, status: 'required', countedInRequiredCoverage: true, countedInEffectiveCoverage: true, matchedRule: { source: 'default', pattern: 'schema.required', reason: 'OpenAPI required 标记' } }
    }
    return { fieldId: f.id, fieldPath: fp, status: 'optional', countedInRequiredCoverage: false, countedInEffectiveCoverage: true, matchedRule: { source: 'default', pattern: 'schema.default', reason: '默认 optional' } }
  })
}
