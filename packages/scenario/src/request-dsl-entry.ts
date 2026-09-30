/**
 * request-dsl 子入口 —— 纯 Request DSL（C9 §26.2）专用出口。
 *
 * 不 re-export runner/playwright-driver/scenario-replay（其链路引 playwright-core）；
 * 供任意消费方（dashboard UI 等浏览器端 bundle）安全导入 Request DSL 纯函数，
 * 不把 playwright-core（原生依赖 kerberos 等）拖进 bundle。
 * 单一事实来源不变：symbols 与 ./index 同源，仅隔离副作用。
 */
export {
  RequestDeclSchema,
  RequestDeclFileSchema,
  RequestExpectFieldSchema,
  classifyFieldState,
  getFieldByPath,
  type RequestDecl,
  type RequestDeclFile,
  type RequestExpectField,
} from './request-dsl.js'
export {
  verifyRequest,
  verifyRequests,
  matchesTrace,
  type RequestTraceLike,
  type RequestVerification,
  type RequestFieldAssertionResult,
} from './verify-requests.js'
export {
  generateRequestDslFromTraces,
  renderRequestDslYaml,
  type GeneratedRequest,
} from './generate-request-dsl.js'