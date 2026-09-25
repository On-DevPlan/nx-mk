/**
 * Coverage Policy Engine（plan §21 全量）—— 纯函数，无 IO。
 * 输入 manifest 字段子集 + config coverage 段，输出每字段 PolicyDecision（§21.4 逐字形状）。
 * 优先级 §21.5 逐字：user required > user ignored > user optional > default > unknown。
 * §21.1：ignored 不等于消失 —— 不进分母但仍出现在决策表（analyzer 据此产 ignored-returned）。
 */
import { matchGlob } from './glob.js'

/**
 * C2（§10 对齐）：策略条目 = 纯 glob 字符串（向后兼容）| {pattern, reason} 对象。
 * 对象形式的 reason 随 matchedRule 透出（报告 / coverage_fields.matched_rule_reason 消费）。
 */
export type PolicyRuleEntry = string | { pattern: string; reason?: string }

export interface PolicyConfig {
  required?: PolicyRuleEntry[]
  optional?: PolicyRuleEntry[]
  ignored?: PolicyRuleEntry[]
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

// 用户列表内按声明顺序取首个命中；跨列表按优先级。
// C2：返回命中的完整条目（含 reason），对象形式解出 pattern/reason，字符串形式 pattern 即条目
function firstUserMatch(entries: PolicyRuleEntry[] | undefined, fieldPath: string): MatchedRule | undefined {
  for (const e of entries ?? []) {
    const pattern = typeof e === 'string' ? e : e.pattern
    if (matchGlob(pattern, fieldPath)) {
      return { source: 'user-config', pattern, ...(typeof e === 'object' && e.reason ? { reason: e.reason } : {}) }
    }
  }
  return undefined
}

export function evaluatePolicy(fields: ManifestFieldLike[], policy: PolicyConfig): PolicyDecision[] {
  return fields.map((f) => {
    const fp = f.normalizedPath
    const req = firstUserMatch(policy.required, fp)
    if (req !== undefined) {
      return { fieldId: f.id, fieldPath: fp, status: 'required', countedInRequiredCoverage: true, countedInEffectiveCoverage: true, matchedRule: req }
    }
    const ign = firstUserMatch(policy.ignored, fp)
    if (ign !== undefined) {
      return { fieldId: f.id, fieldPath: fp, status: 'ignored', countedInRequiredCoverage: false, countedInEffectiveCoverage: false, matchedRule: ign }
    }
    const opt = firstUserMatch(policy.optional, fp)
    if (opt !== undefined) {
      return { fieldId: f.id, fieldPath: fp, status: 'optional', countedInRequiredCoverage: false, countedInEffectiveCoverage: true, matchedRule: opt }
    }
    // default：schema required 标记 → required，否则 optional（spec §3.2）
    if (f.required === true) {
      return { fieldId: f.id, fieldPath: fp, status: 'required', countedInRequiredCoverage: true, countedInEffectiveCoverage: true, matchedRule: { source: 'default', pattern: 'schema.required', reason: 'OpenAPI required 标记' } }
    }
    return { fieldId: f.id, fieldPath: fp, status: 'optional', countedInRequiredCoverage: false, countedInEffectiveCoverage: true, matchedRule: { source: 'default', pattern: 'schema.default', reason: '默认 optional' } }
  })
}
