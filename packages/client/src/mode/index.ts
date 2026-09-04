/**
 * Mode selector —— 决定 fetch client 走 production 薄壳还是 analysis tracker
 *
 * Phase 1.5 占位实现：当前默认 production。
 * Phase 2 集成 mk runtime 后，mk analysis session 启动时会注入 `__MK_ANALYSIS__=true`
 * → createFetchClient 自动切到 analysis 分支。
 */

export type RuntimeMode = 'production' | 'analysis'

declare const __MK_ANALYSIS__: boolean | undefined

export function detectMode(): RuntimeMode {
  // 编译期注入：mk vite plugin 在 analysis 模式替换为 true
  if (typeof __MK_ANALYSIS__ !== 'undefined' && __MK_ANALYSIS__) return 'analysis'
  // 运行期 fallback：mk runtime 启动时设 process.env
  if (typeof process !== 'undefined' && process.env?.__MK_ANALYSIS__ === 'true') return 'analysis'
  return 'production'
}
