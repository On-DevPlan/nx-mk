/** 路由上下文：路由模块只依赖这个窄接口（Task 4 的 register*Routes 消费） */
export interface RouteContext {
  /** .nx-mk 目录（绝对或相对 cwd）——server 全程只读 */
  nxMkDir: string
  /** SQLite busy_timeout（测试注入小值加速 503 用例）；缺省 2000ms */
  busyTimeoutMs?: number
}
