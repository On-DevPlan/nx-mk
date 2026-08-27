/**
 * 路径归一化 —— 把实例路径中的数组下标替换为 []（Plan §17 / spec §6.4）
 *
 * 作用：运行时采集到的字段路径带真实下标（如 orders.0.items.2.skuName），
 * 而 Manifest schema 里的路径用 [] 占位（orders[].items[].skuName）。
 * 归一化让两者能对齐 —— Phase 2 的 collector 会给真实响应数据用同一个函数。
 *
 * 规则：
 *   orders.0.items.2.skuName → orders[].items[].skuName
 *   data.0.user.id            → data[].user.id
 *   data.user.name            → data.user.name（不动）
 *   data                      → data（不动）
 *   数字段标记"前一段是数组"：[] 作为后缀挂到前一段；顶层数组（首段即数字）产生独立 []
 */

// 把形如 'a.0.b.2.c' 的路径归一化为 'a[].b[].c'
export function normalizePath(p: string): string {
  if (p === '') return ''
  const out: string[] = []
  for (const seg of p.split('.')) {
    if (/^\d+$/.test(seg)) {
      if (out.length > 0) {
        // 后缀：把 [] 挂到数字下标前一段
        out[out.length - 1] += '[]'
      } else {
        // 顶层数组：数字是首段，产出独立 []
        out.push('[]')
      }
    } else {
      out.push(seg)
    }
  }
  return out.join('.')
}
