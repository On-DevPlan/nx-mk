/**
 * 宿主既有 class 集合扫描（spec 2026-10-02 §2.5 G5 兜底）—— node:fs 递归，无新 glob 依赖。
 * 模块级按 projectRoot 缓存：一次 loop 多 task 复用；测试经 review.ts inject.hostClasses 注入替身。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SCANNABLE = new Set(['.css', '.scss', '.tsx', '.jsx'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-ui', 'build', '.nx-mk', 'coverage'])
// CSS 侧取 .class 选择器；代码侧取 class/className="..." 字符串字面量
const CSS_CLASS = /\.([a-zA-Z_-][\w-]*)/g
const ATTR_CLASS = /(?:className|class)=["']([^"']+)["']/g

const cache = new Map<string, Set<string>>()

function walkFiles(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return // 不可读目录静默跳过（G5 是辅助 guard，不因扫描失败炸 loop）
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walkFiles(p, out)
    else if (SCANNABLE.has(name.slice(name.lastIndexOf('.')).toLowerCase())) out.push(p)
  }
}

export function collectHostClasses(projectRoot: string): Set<string> {
  const hit = cache.get(projectRoot)
  if (hit) return hit
  const files: string[] = []
  walkFiles(projectRoot, files)
  const classes = new Set<string>()
  for (const f of files) {
    let text: string
    try {
      text = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    const isStyle = /\.(css|scss)$/.test(f)
    for (const m of text.matchAll(isStyle ? CSS_CLASS : ATTR_CLASS)) {
      const raw = m[1] ?? ''
      for (const t of raw.split(/\s+/)) if (t) classes.add(t)
    }
  }
  cache.set(projectRoot, classes)
  return classes
}
