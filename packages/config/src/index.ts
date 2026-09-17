/**
 * @nx-mk/config 公共 API 入口 —— 重导出配置 schema 与加载器
 */
export { ConfigSchema, GoalConfigSchema, LogLevelSchema, PluginNameSchema, CollectConfigSchema, type CollectConfig, CoverageConfigSchema, type CoverageConfig, DashboardConfigSchema, type DashboardConfig } from './schema'
export { findConfigFile, loadConfig, type LoadConfigInput } from './loader'
