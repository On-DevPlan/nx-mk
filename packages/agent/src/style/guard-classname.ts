/**
 * G5 className guard 纯函数（spec 2026-10-02 §2.5）。
 * 判定序：模板白名单（尾部通配）命中 **或** 宿主类集合命中 → 放行；两者皆未命中 → violation。
 * 动态 className（styles.foo、模板字符串）跳过 —— 宁可漏检不误杀合法 patch。
 * review.ts 集成：仅 ctx.style 存在时运行；未配置不产生任何 check 条目（DS3 兼容）。
 */
import type { StyleTemplate } from './types.js'

// class="..." / className="..." / className={'...'} 三种静态形态；属性名前缀 \b 防误吃 data-classname 之类
const CLASS_ATTR = /(?:^|[^\w-])(?:className|class)=("([^"]*)"|\{(['"])([^'"]*)['"]\})/g

// 单 diff 行 → class token 列表；动态表达式（{styles.x}、模板字符串）返回 []
export function extractClassTokens(line: string): string[] {
  const clean = line.replace(/\r$/, '')
  const tokens: string[] = []
  for (const m of clean.matchAll(CLASS_ATTR)) {
    const raw = m[2] ?? m[4] ?? ''
    if (raw.includes('${')) continue // 模板字符串字面量形态，跳过
    for (const t of raw.split(/\s+/)) if (t) tokens.push(t)
  }
  return tokens
}

// 'px-*' → 前缀通配；其余全词相等
export function whitelistMatches(token: string, whitelist: string[]): boolean {
  return whitelist.some((w) => (w.endsWith('*') ? token.startsWith(w.slice(0, -1)) : token === w))
}

// 违规 token（去重保序）。宿主零命中提示由调用方依 hostClasses.size 拼进 detail（spec §3 末行）
export function checkClassNames(tokens: string[], template: StyleTemplate, hostClasses: Set<string>): string[] {
  const wl = template.classNameWhitelist
  const seen = new Set<string>()
  const violations: string[] = []
  for (const t of tokens) {
    if (seen.has(t)) continue
    seen.add(t)
    const ok = (wl !== undefined && whitelistMatches(t, wl)) || hostClasses.has(t)
    if (!ok) violations.push(t)
  }
  return violations
}
