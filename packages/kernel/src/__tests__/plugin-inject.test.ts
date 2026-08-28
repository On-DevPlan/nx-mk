/**
 * 声明式 inject 依赖检查测试 (M3)
 *
 * 验证：
 * - Plugin.provide 声明的服务被收集
 * - Plugin.inject 检查所有声明的依赖都满足
 * - 缺失依赖抛 PLUGIN_DEPENDENCY_MISSING 错误
 * - 不声明 inject 的旧插件继续工作（向后兼容）
 * - inject/provide 顺序无关（拓扑无关，只检查存在性）
 */
import { describe, it, expect } from 'vitest'
import { resolveDependencies } from '../plugin-registry'
import type { Plugin } from '../plugin'
import { KernelError } from '../errors'

function makePlugin(name: string, opts: { inject?: string[]; provide?: string[] } = {}): Plugin {
  return {
    name,
    version: '1.0.0',
    hooks: {},
    ...(opts.inject ? { inject: opts.inject } : {}),
    ...(opts.provide ? { provide: opts.provide } : {}),
  }
}

describe('M3: resolveDependencies', () => {
  it('passes when all injects are satisfied by other plugins\' provides', () => {
    const plugins: Plugin[] = [
      makePlugin('@nx-mk/provider-a', { provide: ['service-a'] }),
      makePlugin('@nx-mk/provider-b', { provide: ['service-b'] }),
      makePlugin('@nx-mk/consumer', { inject: ['service-a', 'service-b'] }),
    ]
    expect(() => resolveDependencies(plugins)).not.toThrow()
  })

  it('throws PLUGIN_DEPENDENCY_MISSING when inject is not satisfied', () => {
    const plugins: Plugin[] = [
      makePlugin('@nx-mk/consumer', { inject: ['nonexistent-service'] }),
    ]
    try {
      resolveDependencies(plugins)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(KernelError)
      const kErr = err as KernelError
      expect(kErr.code).toBe('PLUGIN_DEPENDENCY_MISSING')
      expect(kErr.message).toContain('nonexistent-service')
      expect(kErr.message).toContain('@nx-mk/consumer')
    }
  })

  it('passes when no plugins declare inject or provide (backward compat)', () => {
    const plugins: Plugin[] = [
      makePlugin('@nx-mk/legacy-1'),
      makePlugin('@nx-mk/legacy-2'),
    ]
    expect(() => resolveDependencies(plugins)).not.toThrow()
  })

  it('partially fails: lists which inject items are missing', () => {
    const plugins: Plugin[] = [
      makePlugin('@nx-mk/provider', { provide: ['foo'] }),
      makePlugin('@nx-mk/consumer', { inject: ['foo', 'bar', 'baz'] }),
    ]
    try {
      resolveDependencies(plugins)
      expect.fail('should have thrown')
    } catch (err) {
      const kErr = err as KernelError
      expect(kErr.code).toBe('PLUGIN_DEPENDENCY_MISSING')
      expect(kErr.message).toContain('bar')
      expect(kErr.message).toContain('baz')
      expect(kErr.message).not.toContain('foo')  // foo 满足，不应出现在缺失列表
    }
  })

  it('detects self-inject as missing (plugin cannot depend on its own provide)', () => {
    // 注意：plugin 的 provide 在 resolveDependencies 时不包含自身
    // 所以 inject 自己的 provide 名仍算缺失
    const plugins: Plugin[] = [
      makePlugin('@nx-mk/self', { inject: ['service-x'], provide: ['service-x'] }),
    ]
    try {
      resolveDependencies(plugins)
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as KernelError).code).toBe('PLUGIN_DEPENDENCY_MISSING')
    }
  })

  it('treats empty plugin list as trivially satisfied', () => {
    expect(() => resolveDependencies([])).not.toThrow()
  })
})
