/**
 * manifest —— .nx-mk/manifest.json 读取与浏览器注入脚本构造（原 Ruling 8 落地）
 *
 * 纯 Node 无 playwright 依赖（scanner.ts 同款可测性分层）：
 * - readManifest：与 kernel initial-coverage 同路径语义（join(cwd, '.nx-mk', 'manifest.json')）；
 *   任何失败（缺席 / 坏 JSON / 非对象）-> null，调用方降级为 warn 一次 + 不校验直报
 * - buildFieldPathSet：非空 normalizedPath 集 —— DOM dataMkField 直报的校验键域。
 *   initial-coverage（spec §3.1 id-space 对齐）missing 项 fieldId = normalizedPath，
 *   本集合同域：Goal Loop 的 field-hit 匹配由此保证不落空
 * - buildManifestShimScript：window.__MK_MANIFEST__ 注入字面量（COLLECTOR_SHIM_SCRIPT
 *   同风格：可序列化、无模块依赖）；demo SDK（@nx-mk/client runtime getBrowserManifest
 *   -> matchEndpoint）据此在浏览器侧解析真实 endpointId，trace/hit 不再落 'unknown'
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiManifest } from '@nx-mk/manifest-schema'

/** 读 manifest.json；缺席/损坏一律 null（不抛 —— 校验与注入都是增强，缺失可降级） */
export function readManifest(cwd: string): ApiManifest | null {
  const manifestPath = join(cwd, '.nx-mk', 'manifest.json')
  try {
    if (!existsSync(manifestPath)) return null
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as ApiManifest).fields)) {
      return null
    }
    return parsed as ApiManifest
  } catch {
    return null
  }
}

/** 非空 normalizedPath 集（DOM dataMkField 直报的校验键域） */
export function buildFieldPathSet(manifest: ApiManifest): Set<string> {
  const out = new Set<string>()
  for (const f of manifest.fields ?? []) {
    if (typeof f.normalizedPath === 'string' && f.normalizedPath !== '') out.add(f.normalizedPath)
  }
  return out
}

/** window.__MK_MANIFEST__ 注入脚本（U+2028/2029 转义防字面量断行） */
export function buildManifestShimScript(manifest: ApiManifest): string {
  // 经 String.fromCharCode 构造行分隔符 —— 源码不含 U+2028/2029 字面量（它们本身就会断 JS 行）
  const LS = String.fromCharCode(0x2028)
  const PS = String.fromCharCode(0x2029)
  const json = JSON.stringify(manifest).split(LS).join('\\u2028').split(PS).join('\\u2029')
  return `window.__MK_MANIFEST__ = ${json}`
}
