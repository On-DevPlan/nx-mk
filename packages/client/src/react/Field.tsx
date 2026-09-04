/**
 * @nx-mk/client/react —— UI Evidence 组件（X1-A / §20）
 *
 * 用法：
 *   <Field field="user.profile.name">{user.name}</Field>
 *
 * 生产模式：纯 children 透传，零字节分析逻辑
 * 分析模式：渲染 data-mk-field="<field>" 属性 + 触发 collector
 *
 * 真实集成（Phase 2）：从 ctx.collector.hit() 写入事件总线
 * Phase 1.5 占位：仅渲染 data-mk-field 属性（Collector 通过 DOM scanner 抓）
 */

import type { ReactNode } from 'react'

export interface FieldProps {
  field: string
  children: ReactNode
  className?: string
}

export function Field({ field, children, className }: FieldProps) {
  return (
    <span data-mk-field={field} className={className}>
      {children}
    </span>
  )
}
