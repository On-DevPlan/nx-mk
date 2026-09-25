/**
 * manifest 单测（原 Ruling 8 落地）：读 manifest 容错降级、normalizedPath
 * 校验集构造、__MK_MANIFEST__ 注入脚本字面量。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readManifest, buildFieldPathSet, buildManifestShimScript } from '../manifest.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-mk-manifest-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const writeManifest = (content: string): void => {
  mkdirSync(join(dir, '.nx-mk'), { recursive: true })
  writeFileSync(join(dir, '.nx-mk', 'manifest.json'), content)
}

describe('readManifest', () => {
  it('缺席 → null（不抛）', () => {
    expect(readManifest(dir)).toBeNull()
  })

  it('坏 JSON / 非对象 / 缺 fields → null（不抛）', () => {
    writeManifest('{ not json')
    expect(readManifest(dir)).toBeNull()
    writeManifest('"string"')
    expect(readManifest(dir)).toBeNull()
    writeManifest('{"version":"1"}')
    expect(readManifest(dir)).toBeNull()
  })

  it('合法 manifest → 结构化返回', () => {
    writeManifest(JSON.stringify({
      version: '1',
      fields: [{ normalizedPath: 'data.id' }],
    }))
    const m = readManifest(dir)
    expect(m).not.toBeNull()
    expect(m!.fields).toHaveLength(1)
  })
})

describe('buildFieldPathSet', () => {
  it('收集非空 normalizedPath；空串/缺失跳过', () => {
    const set = buildFieldPathSet({
      fields: [
        { normalizedPath: 'data.id' },
        { normalizedPath: 'data.address.zip' },
        { normalizedPath: '' },
        {},
      ],
    } as never)
    expect(set).toEqual(new Set(['data.id', 'data.address.zip']))
  })
})

describe('buildManifestShimScript', () => {
  it('产出 window.__MK_MANIFEST__ 赋值字面量，可 eval 还原', () => {
    const manifest = { version: '1', fields: [{ normalizedPath: 'data.id' }] }
    const script = buildManifestShimScript(manifest as never)
    expect(script.startsWith('window.__MK_MANIFEST__ = ')).toBe(true)
    // eval 还原 —— 注入脚本在浏览器即按此语义执行
    const window = {} as { __MK_MANIFEST__?: unknown }
    new Function('window', script)(window)
    expect(window.__MK_MANIFEST__).toEqual(manifest)
  })

  it('manifest 含 U+2028/2029 时不产生裸行分隔符', () => {
    const manifest = { fields: [{ normalizedPath: 'dataid' }] }
    const script = buildManifestShimScript(manifest as never)
    // 字面量内不得出现真实行分隔符（会断脚本），只能以转义形式存在
    expect(script.includes(String.fromCharCode(0x2028))).toBe(false)
    expect(script.includes(String.fromCharCode(0x2029))).toBe(false)
  })
})
