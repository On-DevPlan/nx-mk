/**
 * @nx-mk/manifest-schema — Manifest Definition 角色（M4 拆分）
 *
 * 本包是 Capability Seam 的"Definition"角色：
 *   - 声明 Manifest 数据结构（types）
 *   - 提供通用 schema 处理工具（field-id / normalizer / schema-walker）
 *
 * 任何具体的 Provider（OpenAPI / Postman / GraphQL）都依赖本包，
 * 而本包不依赖任何具体 Provider。这保证了多源支持的扩展性。
 *
 * 配套 Provider：
 *   - @nx-mk/manifest（OpenAPI Provider）
 *
 * 详细设计见 [`docx/plan/2026-08-28-foundation-modification-plan.md`](../../docx/plan/2026-08-28-foundation-modification-plan.md) M4 章节。
 */

// 类型：所有 Manifest 数据模型 + Walker 上下文
export type {
  HttpMethod,
  ApiField,
  ApiEndpoint,
  ApiSchema,
  ApiManifest,
  SchemaRef,
  ParseOptions,
  FieldIdInput,
  WalkContext,
  SchemaNode,
} from './types'

// 函数：稳定字段 ID + 路径归一化 + Schema 递归展开
export { stableFieldId } from './field-id'
export { normalizePath } from './normalizer'
export { walkSchema } from './schema-walker'
