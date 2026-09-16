/**
 * @nx-mk/client/proxy —— Plan §19 字段级 Proxy（Phase 2 spec §3.1）
 * 内部子模块：由 mode/analysis 组装后经 runtime 间接生效；production 不 import（零开销）。
 */
export { createTrackedProxy, type TrackedProxyOptions, type ProxyCollector } from './create-tracked-proxy.js'
export { normalizeProxyFieldPath } from './path-normalizer.js'
