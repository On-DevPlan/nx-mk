/**
 * 配置 Schema —— nx-mk.config.yml 的 Zod 校验规则
 *
 * 定义 plugins / logLevel / outputDir / openapi / goal 五个字段及各自默认值；
 * passthrough 允许保留未声明的字段，为后续 Phase 扩展留余地。
 */
import { z } from 'zod'

// 日志级别的合法取值（与内核 LogLevel 一致）
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent'])

// 插件名必须是合法 npm 包名（可含 @scope/ 前缀）
export const PluginNameSchema = z.string().regex(
  /^@?[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/,
  'plugin name must be a valid npm package name',
)

// v1（W1/W3）：插件条目联合类型 —— 裸包名字符串向后兼容；对象条目开 per-plugin 配置命名空间。
// 裸 string 条目的 config 语义上视为 {}（由 normalizePluginEntries 归一化）。
export const PluginEntrySchema = z.union([
  PluginNameSchema,
  z.object({
    name: PluginNameSchema,
    config: z.record(z.unknown()).default({}),
  }),
])
export type PluginEntry = z.infer<typeof PluginEntrySchema>

/** 裸 string → { name, config: {} }（W3）；kernel 侧有一份结构镜像实现（WP7，避免硬依赖） */
export function normalizePluginEntries(
  entries: ReadonlyArray<string | PluginEntry>,
): Array<{ name: string; config: Record<string, unknown> }> {
  return entries.map((e) => (typeof e === 'string' ? { name: e, config: {} } : { name: e.name, config: e.config }))
}

// M14：Goal Loop 配置 schema（与内核 GoalConfig 字段一一对应）
export const GoalConfigSchema = z.object({
  targetRatio: z.number().min(0).max(1).default(1.0),
  maxTurns: z.number().int().positive().default(100),
  idleTurnsLimit: z.number().int().positive().default(3),
  absoluteTimeoutMs: z.number().int().positive().default(600_000),
}).optional()

// Phase 2（spec §3.6）：采集段配置 —— url 必填（http/https 语义由 run 装配层校验），
// waitForSelector / maxTurns 可选。类型经 z.infer 导出，供 plugin/cli 以 schema 为
// 单一事实来源消费（Task 6 审查 M3：替换 plugin-playwright 的本地宽松声明）。
export const CollectConfigSchema = z.object({
  url: z.string(),
  waitForSelector: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
})
export type CollectConfig = z.infer<typeof CollectConfigSchema>

// C3（§10/§23 对齐）：replay 段 —— 请求回放安全规则可配。
// allowMethods=免确认安全方法（默认 GET/HEAD）；requireConfirmation=需确认方法（默认 POST/PUT/PATCH/DELETE）；
// block=路径 glob 黑名单（/payment/**/ 等，命中即 403）。缺省项回退内置默认，整体缺省 = 既有硬编码行为。
export const ReplayBlockRuleSchema = z.object({ pattern: z.string().min(1) })
export type ReplayBlockRule = z.infer<typeof ReplayBlockRuleSchema>

export const ReplayConfigSchema = z.object({
  allowMethods: z.array(z.string().min(1)).optional(),
  requireConfirmation: z.array(z.string().min(1)).optional(),
  block: z.array(ReplayBlockRuleSchema).optional(),
})
export type ReplayConfig = z.infer<typeof ReplayConfigSchema>

// C2（§10/§16 对齐）：coverage policy 段（spec §2.2/§3.2）—— 三个 glob 列表，缺省空。
// C2（§10/§16 对齐）：条目升级为 string | {pattern, reason} 联合 —— reason 随
// policy-engine matchedRule 透出（报告/落库消费）；纯 string 保持向后兼容。
export const CoverageRuleSchema = z.union([
  z.string().min(1),
  z.object({ pattern: z.string().min(1), reason: z.string().min(1) }),
])
export type CoverageRule = z.infer<typeof CoverageRuleSchema>

export const CoverageConfigSchema = z.object({
  required: z.array(CoverageRuleSchema).optional(),
  optional: z.array(CoverageRuleSchema).optional(),
  ignored: z.array(CoverageRuleSchema).optional(),
})
export type CoverageConfig = z.infer<typeof CoverageConfigSchema>

// Phase 4（spec §2.2/§3.6）：dashboard 段 —— start 命令消费的最小集（spec D10：defaultView 不收）
export const DashboardConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).optional(),
  open: z.boolean().optional(),
})
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>

// Phase 5（spec §3.8）：agent 段 —— provider（唯一 claude-code，E3）+ loop 两小节；
// 全部 optional：默认值由 @nx-mk/agent runtime 回填（AGENT_DEFAULTS），config 层不设默认
export const AgentProviderConfigSchema = z.object({
  type: z.literal('claude-code'),
  timeoutMs: z.number().int().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
})
export type AgentProviderConfig = z.infer<typeof AgentProviderConfigSchema>

export const AgentLoopConfigSchema = z.object({
  maxIterations: z.number().int().positive().optional(),
  stopIfNoImprovementRounds: z.number().int().positive().optional(),
  maxTasksPerIteration: z.number().int().positive().optional(),
})
export type AgentLoopConfig = z.infer<typeof AgentLoopConfigSchema>

export const AgentConfigSchema = z.object({
  provider: AgentProviderConfigSchema.optional(),
  loop: AgentLoopConfigSchema.optional(),
})
export type AgentConfig = z.infer<typeof AgentConfigSchema>

// §26：可选 scenarios 段（spec S1/S10 —— include 非空激活套件模式；concurrency 默认 3 上限 10）
export const ScenarioConfigSchema = z.object({
  include: z.array(z.string().min(1)).optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
})
export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>

// §24（响应值展示与隐私）：privacy 段 —— responseValues.mode 三态 + mask 规则列表。
// 整段缺失时消费方 @nx-mk/coverage 按安全默认回填（masked + 内置规则表），
// config 层不设默认（与 agent 段同约定：默认值归消费方）。
export const PrivacyMaskRuleSchema = z.object({
  pattern: z.string().min(1),
  strategy: z.enum(['email', 'phone', 'full']),
})
export type PrivacyMaskRule = z.infer<typeof PrivacyMaskRuleSchema>

export const PrivacyConfigSchema = z.object({
  responseValues: z
    .object({ mode: z.enum(['masked', 'raw', 'none']).optional() })
    .optional(),
  mask: z.array(PrivacyMaskRuleSchema).optional(),
})
export type PrivacyConfig = z.infer<typeof PrivacyConfigSchema>

// 顶层配置 schema：插件列表上限 20，输出目录必须是相对路径
export const ConfigSchema = z
  .object({
    plugins: z.array(PluginEntrySchema).max(20, 'max 20 plugins').default([]),
    logLevel: LogLevelSchema.default('info'),
    outputDir: z
      .string()
      .regex(/^\.{1,2}(\/|\w)/, 'must be a relative path')
      .default('.nx-mk/runs'),
    // openapi: 指向 OpenAPI 3.x 文档的相对/绝对路径（Phase 1，可空）
    openapi: z.string().optional(),
    // M14：可选 Goal Loop 配置（不设置则使用 push-based beforeRun/afterRun）
    goal: GoalConfigSchema,
    // Phase 2：可选采集段（spec §3.6 —— run 装配层据此建 coverage.db 并接采集插件）
    collect: CollectConfigSchema.optional(),
    // Phase 3：可选覆盖策略段（spec §3.2 —— analyzer 消费为 PolicyDecision）
    coverage: CoverageConfigSchema.optional(),
    // Phase 4：可选 dashboard 段（spec §3.6 —— start 命令消费 port/open）
    dashboard: DashboardConfigSchema.optional(),
    // Phase 5：可选 agent 段（spec §3.8 —— loop 命令消费 provider/loop 两小节）
    agent: AgentConfigSchema.optional(),
    // §26：可选 scenarios 段（spec S6 —— 套件模式入口）
    scenarios: ScenarioConfigSchema.optional(),
    // C3（§10 对齐）：可选 replay 段 —— 请求回放安全规则（缺省 = 内置默认行为）
    replay: ReplayConfigSchema.optional(),
    // §24：可选隐私段（响应值脱敏策略；缺省由 coverage 层安全默认 masked）
    privacy: PrivacyConfigSchema.optional(),
  })
  .passthrough()
