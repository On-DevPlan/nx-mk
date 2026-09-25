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
    /** C1（§23.2/§24 对齐）：字段级值通道 —— 只出分类与单向散列，不出原文 */
    valueState?: 'present' | 'null' | 'undefined' | 'empty'
    valueType?: string
    valueHash?: string
  }): void
}

export interface TrackedProxyOptions {
  requestId: string
  endpointId: string
  basePath: string
  collector: ProxyCollector
}

/**
 * Promise/JSON 序列化触发的伪字段名（anti-cheat #3，spec §3.4）—— 恒透传不 hit 不包裹。
 * B4 守则（4.5 备忘落码）：本名单按 prop 名字符串判定，不问 own-property —— 原型链上的
 * 同名方法（如自定义 toString）同样被拦。若未来收窄为 own-property 判定，必须先重跑
 * anti-cheat noise-guard 三测试（packages/coverage/__tests__/anti-cheat.test.ts B3）。
 */
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
          // C1：字段级值通道（§23.2 valueState/valueType/valueHash）——
          // 散列在浏览器内对完整值计算（C11：不经 500 字符截断，无精度损失）；
          // 单向 FNV-1a，原文不出浏览器（隐私设计强于 trace 级 masked preview）
          valueState: valueStateOf(value),
          valueType: valueTypeOf(value),
          valueHash: valueHashOf(value),
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

// —— C1 字段级值通道（§23.2）：纯函数，随 get 拦截就地计算 ——

/** 值状态四态（absent 由请求/响应层判定，代理侧 prop 读取缺省即 undefined） */
function valueStateOf(v: unknown): 'present' | 'null' | 'undefined' | 'empty' {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'string' && v === '') return 'empty'
  if (Array.isArray(v) && v.length === 0) return 'empty'
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) return 'empty'
  return 'present'
}

/** 值类型：null / array / typeof（与 §23.2 valueType 语义对齐的最小实现） */
function valueTypeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

/** FNV-1a 32bit → 8 位十六进制（零依赖单向散列；仅用于「同值异源」比对，非安全用途） */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8)
}

/** 值散列：标量对 String(v)；对象/数组对 JSON 序列化；undefined/null 不产散列。失败静默缺席 */
function valueHashOf(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'object') {
    try {
      return fnv1a(JSON.stringify(v) ?? '')
    } catch {
      return undefined
    }
  }
  return fnv1a(String(v))
}
