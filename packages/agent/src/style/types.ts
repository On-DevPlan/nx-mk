/**
 * 风格模板类型（spec 2026-10-02 §2.2）—— StyleTemplate 是 prompt 注入与 G5 guard 的共享契约。
 * StyleConfigInput 与 @nx-mk/config AgentStyleConfigSchema 逐字同构（PLN-3 镜像约定，
 * agent 包不依赖 config 包，两处独立定义须人工保持一致）。
 */
export interface StyleTemplate {
  id: string
  source: 'built-in' | 'custom'
  classNameWhitelist?: string[]   // 缺省 = auto-detect 语义（G5 宿主扫描兜底）
  description: string
  rules: string[]
}

export interface StyleConfigInput {
  id?: string
  path?: string
  overrides?: Record<string, string>
}
