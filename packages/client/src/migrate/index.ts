/**
 * @nx-mk/client/migrate —— SDK-CG3 静态迁移引擎（spec §3.4）
 *
 * 纯函数：文件 IO 留给 CLI（nx-ce 式薄适配分层）。业务代码不直接消费本模块。
 */

export {
  migrateCodemod,
  type MigrateCodemodInput,
  type MigrateCodemodResult,
  type MigrateReport,
} from './engine.js'
