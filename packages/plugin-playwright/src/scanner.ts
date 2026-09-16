/**
 * scanner —— 注入浏览器的 DOM 扫描脚本 + 评估结果防御性解析（spec §3.4）
 *
 * PAGE_SCAN_SCRIPT 是在浏览器 page.evaluate 执行的字面脚本字符串（必须是
 * 可序列化、无闭包依赖的纯表达式），产出 DomFieldDescriptor 原始数组；
 * toDescriptors 在 Node 侧对 evaluate 输出做防御性解析：非数组 or 畸形条目
 * 静默过滤，保证 scanDom 的输入契约。
 */

// 注入脚本：逐项读 data-mk-field 属性、可见性与视口相交性。
// 注意脚本内不能引用模块变量 —— 全部走 document/window。
export const PAGE_SCAN_SCRIPT = `(() => {
  const els = Array.from(document.querySelectorAll('[data-mk-field]'))
  const mkVisible = (el) => {
    const style = window.getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const mkInViewport = (el) => {
    const rect = el.getBoundingClientRect()
    // 相交语义（spec §3.4）：rect 与视口有重叠即算，不要求完全包含
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
      rect.left < (window.innerWidth || document.documentElement.clientWidth)
    )
  }
  return els.map((el) => ({
    dataMkField: el.getAttribute('data-mk-field') || '',
    visible: mkVisible(el),
    inViewport: mkInViewport(el),
  }))
})()`

/** page.evaluate 输出的原始描述符形状（全部可选 —— 信任边界外的数据） */
interface RawDescriptor {
  dataMkField?: unknown
  visible?: unknown
  inViewport?: unknown
}

export interface ParsedDescriptor {
  dataMkField: string
  visible: boolean
  inViewport: boolean
}

/**
 * toDescriptors —— 防御性解析 page.evaluate 产物：
 * 非数组输入返回 []；缺字段/类型不符的条目整条过滤（dataMkField 必须 string）。
 */
export function toDescriptors(raw: unknown): ParsedDescriptor[] {
  if (!Array.isArray(raw)) return []
  const out: ParsedDescriptor[] = []
  for (const item of raw as unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const d = item as RawDescriptor
    if (typeof d.dataMkField !== 'string') continue
    out.push({
      dataMkField: d.dataMkField,
      visible: d.visible === true,
      inViewport: d.inViewport === true,
    })
  }
  return out
}
