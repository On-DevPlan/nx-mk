/**
 * @nx-mk/manifest — OpenAPI Manifest Provider (M4 拆分)
 *
 * 本包是 Capability Seam 的"Provider"角色：
 *   - 实现具体的 OpenAPI 文档 → ApiManifest 解析逻辑
 *   - 依赖 @nx-mk/manifest-schema 提供的通用类型与 schema 工具
 *
 * 向后兼容：本文件从 @nx-mk/manifest-schema 重新导出所有类型与工具函数，
 * 旧代码 `import { ApiManifest } from '@nx-mk/manifest'` 继续工作。
 *
 * 推荐迁移：新代码应直接 import from '@nx-mk/manifest-schema' 拿类型，
 * 从 '@nx-mk/manifest' 拿 OpenAPI 解析能力。
 *
 * 详细设计见 [`docx/plan/2026-08-28-foundation-modification-plan.md`](../../docx/plan/2026-08-28-foundation-modification-plan.md) M4 章节。
 */

// 向后兼容：类型与工具函数从 schema 包重新导出
// 旧代码 `import { ApiManifest, stableFieldId, normalizePath } from '@nx-mk/manifest'` 继续工作
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
} from '@nx-mk/manifest-schema'

export { stableFieldId, normalizePath, walkSchema } from '@nx-mk/manifest-schema'

// OpenAPI Provider 主入口
export { parseOpenApi } from './parser'
