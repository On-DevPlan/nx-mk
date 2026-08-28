/**
 * Schema 校验错误 —— 聚合 standard-schema issues 并展示路径
 *
 * 校验失败时抛 ValidationError，message 形如：
 *   invalid config:
 *     - openapi.servers[0].url: must be a URL
 *     - openapi.info.title: required
 *
 * 与 dsh 的 ValidationError 设计对齐（见 vendor/cordis/src/fiber.ts）。
 */
import type { StandardSchemaV1 } from '@standard-schema/spec'

/** 校验错误聚合（来自 standard-schema） */
export class ValidationError extends TypeError {
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>

  constructor(issues: ReadonlyArray<StandardSchemaV1.Issue>) {
    const formatted = issues
      .map((issue) => {
        if (issue.path && issue.path.length > 0) {
          return `  - ${issue.message} (at ${issue.path.join('.')})`
        }
        return `  - ${issue.message}`
      })
      .join('\n')
    super(`invalid config:\n${formatted}`)
    this.name = 'ValidationError'
    this.issues = issues
  }
}
