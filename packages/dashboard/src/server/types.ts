/** 路由上下文：路由模块只依赖这个窄接口（Task 4 的 register*Routes 消费） */
export interface RouteContext {
  /** .nx-mk 目录（绝对或相对 cwd）——server 全程只读 */
  nxMkDir: string
  /** SQLite busy_timeout（测试注入小值加速 503 用例）；缺省 2000ms */
  busyTimeoutMs?: number
  /** 用户主配置文件绝对路径（start 命令发现后透传；缺省 = 写回 API 以 409 诚实降级） */
  configPath?: string
  /** C3（§10）：replay 安全规则（start 命令从 config `replay:` 段透传；缺省 = 内置默认） */
  replayRules?: import('./replay.js').ReplayRules
}
