/**
 * Evidence Quality v0（plan §29.1/§29.2 三类机检，spec §3.4）：
 * hidden DOM（visible=false）→ suspicious；空标记（空文本/占位=字段名）→ weak；
 * 其余 → valid；'invalid' v0 不产（console.log 源检测后置）。
 * 全部判定来自已采集数据，零新增运行时探针（D3）。
 */
export type EvidenceQuality = 'valid' | 'weak' | 'suspicious' | 'invalid'

export interface ClassifiableEvidence {
  visible?: boolean
  textSample?: string
  fieldPath: string
}

export function classifyEvidence(ev: ClassifiableEvidence): EvidenceQuality {
  if (ev.visible === false) return 'suspicious'
  // textSample 缺省 = 旧采集数据 —— 按 valid 处理（spec §4 向后兼容行）
  if (ev.textSample === undefined) return 'valid'
  const t = ev.textSample.trim()
  if (t === '') return 'weak'
  const last = ev.fieldPath.split('.').pop() ?? ''
  if (last !== '' && t === last) return 'weak'
  return 'valid'
}
