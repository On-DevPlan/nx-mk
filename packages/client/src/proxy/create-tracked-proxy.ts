/**
 * createTrackedProxy —— Plan §19 字段级 Proxy（spec §3.1 逐字）
 * get 拦截 → hit 上报 → 值可代理则递归包裹（basePath 推进）。
 * WeakMap 缓存保证引用稳定（§19.4）；探针纪律：collector 异常吞掉（spec §4）。
 * TODO(Phase 4): 原型方法名白名单可扩展（isBlockedProp 名单按需追加）。
 */
import { normalizeProxyFieldPath } from './path-normalizer.js'

export interface ProxyCollector {
  hit(hit: {
    requestId: string
    endpointId: string
    fieldPath: string
    normalizedPath: string
    type: 'get'
    timestamp: number
  }): void
}

export interface TrackedProxyOptions {
  requestId: string
  endpointId: string
  basePath: string
  collector: ProxyCollector
}

/** Promise/JSON 序列化触发的伪字段名（anti-cheat #3，spec §3.4）—— 恒透传不 hit 不包裹 */
export const METHOD_NAME_BLOCKLIST: ReadonlySet<string> = new Set([
  'then', 'catch', 'finally', 'toJSON', 'valueOf', 'toString', 'hasOwnProperty',
  'join', 'map', 'filter', 'reduce', 'forEach', 'keys', 'values', 'entries', 'size',
])
/** 仅 Array target 生效的名单（plain object 的 length 等可能是真实业务字段） */
export const ARRAY_ONLY_NAMES: ReadonlySet<string> = new Set([
  'length', 'indexOf', 'includes', 'slice', 'concat',
])

export function isBlockedProp(target: object, key: string): boolean {
  if (METHOD_NAME_BLOCKLIST.has(key)) return true
  if (ARRAY_ONLY_NAMES.has(key) && Array.isArray(target)) return true
  return false
}

// §19.4 模块级缓存
const proxyCache = new WeakMap<object, unknown>()

// §19.3 native class 一律透传
const NON_PROXY_TAGS = new Set([
  '[object Date]', '[object File]', '[object Blob]', '[object Map]', '[object Set]',
  '[object WeakMap]', '[object WeakSet]', '[object Promise]', '[object Error]',
  '[object RegExp]', '[object URL]', '[object FormData]', '[object ArrayBuffer]',
])

export function createTrackedProxy<T extends object>(target: T, options: TrackedProxyOptions): T {
  if (!isProxyable(target)) return target
  const cached = proxyCache.get(target)
  if (cached !== undefined) return cached as T

  const proxy = new Proxy(target, {
    get(obj: object, prop: string | symbol, receiver: unknown): unknown {
      if (typeof prop === 'symbol') return Reflect.get(obj, prop, receiver)
      const key = typeof prop === 'string' ? prop : ''
      if (key !== '' && isBlockedProp(obj, key)) {
        return Reflect.get(obj, prop, receiver) // 白名单透传：不 collector.hit、不递归包裹
      }
      const value = Reflect.get(obj, prop, receiver)
      // 数组下标 prop 也是合法 fieldPath 段（'data.0'），归一化负责转 []
      const fieldPath = `${options.basePath}.${prop}`
      const normalizedPath = normalizeProxyFieldPath(options.basePath, prop)
      try {
        options.collector.hit({
          requestId: options.requestId,
          endpointId: options.endpointId,
          fieldPath,
          normalizedPath,
          type: 'get',
          timestamp: Date.now(),
        })
      } catch {
        // 探针纪律：异常不传播（spec §4）
      }
      if (isProxyable(value)) {
        return createTrackedProxy(value as object, { ...options, basePath: normalizedPath })
      }
      return value
    },
  })

  proxyCache.set(target, proxy)
  return proxy as T
}

/** §19.3：plain object / array 可代理；native class 不可 */
function isProxyable(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return true
  if (NON_PROXY_TAGS.has(Object.prototype.toString.call(v))) return false
  const ctor = (v as { constructor?: unknown }).constructor
  return ctor === Object || ctor === Array
}
