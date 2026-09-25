/**
 * @nx-mk/config 公共 API 入口 —— 重导出配置 schema 与加载器
 */
export { ConfigSchema, GoalConfigSchema, LogLevelSchema, PluginEntrySchema, type PluginEntry, PluginNameSchema, normalizePluginEntries, CollectConfigSchema, type CollectConfig, CoverageConfigSchema, type CoverageConfig, CoverageRuleSchema, type CoverageRule, DashboardConfigSchema, type DashboardConfig, ReplayConfigSchema, type ReplayConfig, AgentProviderConfigSchema, type AgentProviderConfig, AgentLoopConfigSchema, type AgentLoopConfig, AgentConfigSchema, type AgentConfig, ScenarioConfigSchema, type ScenarioConfig, PrivacyConfigSchema, type PrivacyConfig } from './schema'
export { findConfigFile, loadConfig, type LoadConfigInput } from './loader'
export { ConfigWriteError, previewConfigWrite, applyConfigWrite, naiveLineDiff, sha256Text, type ConfigWritePreview, type ConfigWriteApplyResult, type ConfigWriteErrorCode } from './writeback'
