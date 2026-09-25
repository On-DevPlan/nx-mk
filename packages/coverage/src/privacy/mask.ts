/**
 * §24 响应隐私脱敏 —— response_preview 落库前的默认脱敏层。
 *
 * Plan §24：响应值必须默认脱敏；`privacy.responseValues.mode` 三态
 * masked（默认，按规则打码）| raw（原文，行为同 §3.1 演进列）| none（不落库）。
 *
 * 设计约束：
 * - D2 零外部依赖：纯字符串 / JSON 处理，不引库。
 * - 安全默认：调用方不传 privacy（或段缺失）→ masked + 内置规则表，
 *   覆盖 email / phone / token / password / secret / authorization 常见键。
 * - 规则匹配：pattern 为 glob（`*` 跨层级），对 JSON 叶子键的**点分路径**匹配
 *   （如 `*.email` 命中 `data.email`；裸 `email` 仅命中顶层键）。
 * - 已知限制：采集侧 previewOf 在浏览器内已截断 ≤500 字符，超长响应体落库前
 *   可能不是合法 JSON —— 此时退化为字符串级正则脱敏（email / 11 位手机号），
 *   结构化键打码失效。彻底解法（提高采集上限 / 采集侧脱敏）见 backlog。
 */

export type MaskStrategy = 'email' | 'phone' | 'full'

export interface PrivacyMaskRule {
  /** 字段路径 glob（`*` 跨层级匹配），对 JSON 叶子键的点分路径生效 */
  pattern: string
  strategy: MaskStrategy
}

export interface PrivacyConfig {
  responseValues?: { mode?: 'masked' | 'raw' | 'none' }
  mask?: PrivacyMaskRule[]
}

/** Plan §24 示例语义的内置默认规则（无 privacy: 段或 mask 为空时生效） */
export const DEFAULT_MASK_RULES: readonly PrivacyMaskRule[] = [
  { pattern: '*email*', strategy: 'email' },
  { pattern: '*phone*', strategy: 'phone' },
  { pattern: '*mobile*', strategy: 'phone' },
  { pattern: '*token*', strategy: 'full' },
  { pattern: '*password*', strategy: 'full' },
  { pattern: '*secret*', strategy: 'full' },
  { pattern: '*authorization*', strategy: 'full' },
]

const FULL_MASK = '***'

/** email 策略：保首字符 + *** + @域名（形如 j***@gmail.com，对齐 Plan §24 示例） */
function maskEmail(v: string): string {
  const at = v.indexOf('@')
  if (at <= 0) return FULL_MASK
  return v.slice(0, 1) + '***' + v.slice(at)
}

/** phone 策略：≥8 位保前 3 后 4（138****5678），否则全遮 */
function maskPhone(v: string): string {
  if (v.length >= 8) return v.slice(0, 3) + '****' + v.slice(-4)
  return FULL_MASK
}

function maskLeaf(strategy: MaskStrategy, value: unknown): string {
  if (strategy === 'email' && typeof value === 'string') return maskEmail(value)
  if (strategy === 'phone' && typeof value === 'string') return maskPhone(value)
  return FULL_MASK
}

/** glob → RegExp：仅 `*`（跨层级任意串），其余字符按字面量转义 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`)
}

interface CompiledRule {
  re: RegExp
  strategy: MaskStrategy
}

/** 递归走 JSON 树：命中规则的叶子打码，未命中继续下钻 */
function maskNode(node: unknown, rules: readonly CompiledRule[], path: string): unknown {
  if (Array.isArray(node)) return node.map((v) => maskNode(v, rules, path))
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      const keyPath = path ? `${path}.${key}` : key
      const hit = rules.find((r) => r.re.test(keyPath))
      out[key] = hit ? maskLeaf(hit.strategy, value) : maskNode(value, rules, keyPath)
    }
    return out
  }
  return node
}

/** 非 JSON 正文（含截断残片）的字符串级兜底：email 地址 + 11 位手机号 */
function maskPlainText(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m))
    .replace(/\b\d{11}\b/g, (m) => maskPhone(m))
}

/**
 * 对单条 responsePreview 施加隐私策略，返回落库值。
 * masked：JSON 可解析 → 结构化按键路径打码后重序列化；否则字符串级兜底。
 * raw：原样透传（仍保证 ≤500 上限）。none：null（不落库）。
 */
export function maskResponsePreview(preview: string, cfg?: PrivacyConfig): string | null {
  const mode = cfg?.responseValues?.mode ?? 'masked'
  if (mode === 'none') return null
  if (mode === 'raw') return preview.slice(0, 500)
  const ruleSource = cfg?.mask?.length ? cfg.mask : DEFAULT_MASK_RULES
  const rules: CompiledRule[] = ruleSource.map((r) => ({ re: globToRegExp(r.pattern), strategy: r.strategy }))
  let masked: string
  try {
    const parsed: unknown = JSON.parse(preview)
    masked = JSON.stringify(maskNode(parsed, rules, ''))
  } catch {
    masked = maskPlainText(preview)
  }
  return masked.slice(0, 500)
}
