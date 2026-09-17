/**
 * 有限通配匹配（spec §3.2 / plan §21.5 示例语义）：按 '.' 分段。
 * '*' 匹配恰好一段；'**' 匹配零或多段；其余段字面全等。
 * 自实现而非 minimatch：规则面只有路径段通配（D4），全语义 glob 为过度引入。
 */
export function matchGlob(pattern: string, path: string): boolean {
  const p = pattern.split('.').filter(Boolean)
  const s = path.split('.').filter(Boolean)
  let i = 0
  let j = 0
  let starIdx = -1 // 最近一个 '**' 的 pattern 下标
  let restoreJ = 0 // 回溯时 path 的位置（'**' 吞掉的下一段起点）
  while (j < s.length) {
    if (i < p.length && (p[i] === s[j] || p[i] === '*')) {
      i++
      j++
    } else if (i < p.length && p[i] === '**') {
      starIdx = i
      restoreJ = j
      i++
    } else if (starIdx !== -1) {
      // 回溯：让 '**' 多吞一段
      i = starIdx + 1
      restoreJ++
      j = restoreJ
    } else {
      return false
    }
  }
  // path 耗尽后，pattern 剩余只允许 '**'（匹配零段）
  while (i < p.length && p[i] === '**') i++
  return i === p.length
}
