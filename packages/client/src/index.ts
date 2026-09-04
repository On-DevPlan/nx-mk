/**
 * @nx-mk/client —— SDK Facade 公共入口（Phase 1.5）
 *
 * 业务代码典型用法：
 *   import { api } from './generated-sdk'   // codegen 产物
 *   import { Field } from '@nx-mk/client/react'
 *
 * 直接用 runtime（不通过 codegen）：
 *   import { createFetchClient } from '@nx-mk/client'
 */

export { createFetchClient, type FetchClient, type FetchClientOptions } from './runtime/client.js'
export { detectMode, type RuntimeMode } from './mode/index.js'
export { Field, type FieldProps } from './react/Field.js'
