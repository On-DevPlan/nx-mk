/**
 * @nx-mk/client/codegen —— Phase 1.5 SDK Facade 代码生成器
 *
 * SDK-CG1（session 生成）+ SDK-CG2（编译期 codegen）落地。
 * 运行时不在 analysis tracker 范围内（tracker 留待 Phase 2）；
 * 本包仅产出 typed SDK，业务代码 `import { api } from './generated-sdk'`。
 */

export { generateSdk, type GenerateSdkOptions } from './generate-sdk.js'
export { emitNamedTypes, emitType } from './emit-types.js'
export {
  emitEndpoint,
  deriveMethodName,
  deriveNamespace,
  pathToFetchPath,
  type MethodSignature,
} from './emit-endpoint.js'
