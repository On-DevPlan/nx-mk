/**
 * @nx-mk/config 公共 API 入口 —— 重导出配置 schema 与加载器
 */
export { ConfigSchema, GoalConfigSchema, LogLevelSchema, PluginEntrySchema, type PluginEntry, PluginNameSchema, normalizePluginEntries, CollectConfigSchema, type CollectConfig, CoverageConfigSchema, type CoverageConfig, DashboardConfigSchema, type DashboardConfig, AgentProviderConfigSchema, type AgentProviderConfig, AgentLoopConfigSchema, type AgentLoopConfig, AgentConfigSchema, type AgentConfig } from './schema'
export { findConfigFile, loadConfig, type LoadConfigInput } from './loader'
