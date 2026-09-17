/**
 * dom scanner —— evidence 结构组装/校验（spec §3.4 / §6）
 * 纯函数：输入来自浏览器侧 page.evaluate 的描述列表（plugin-playwright 产出），
 * 本函数做空值过滤 + selector 生成 + UiEvidenceCore 结构组装（不做浏览器 IO）。
 */
import type { UiEvidenceCore } from '@nx-mk/client/collector'

export interface DomFieldDescriptor {
  dataMkField: string          // data-mk-field 属性值（空 = 过滤）
  visible: boolean
  inViewport: boolean
  /** anti-cheat 空标记判定样本（spec §3.4；可选 —— 旧调用方兼容） */
  text?: string
}

export function scanDom(descs: DomFieldDescriptor[]): UiEvidenceCore[] {
  return descs
    .filter((d) => d.dataMkField !== '')
    .map((d) => ({
      requestId: undefined,
      fieldId: undefined,
      fieldPath: d.dataMkField,
      evidenceType: 'text' as const,
      selector: `[data-mk-field="${d.dataMkField}"]`,
      visible: d.visible,
      inViewport: d.inViewport,
      route: undefined,
      textSample: d.text,
    }))
}
