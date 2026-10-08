/**
 * 下单表单 —— 覆盖 POST /orders 201 回显的全部 4 个 manifest 路径
 * （data.id / data.status / data.totalAmount / data.placedAt）。
 *
 * ⚠️ 口径勘误（与 brief 的差异）：brief 的 REQUIRED 列表含 data.createdAt ——
 * 该路径在本项目**不存在**。CreatedOrderSchema 是 { id, status, totalAmount,
 * placedAt } 四键，`data.createdAt` 是从 medical-records（CreatedPatient.createdAt）
 * 串场过来的笔误。本组件与场景套件均以实际 manifest 为准（verify-manifest.mjs
 * 双向断言守这条）。
 *
 * P1（分母只算响应字段）：请求体 NewOrderSchema.sku / quantity 不进分母 ——
 * 页面渲染的是 201 回显对象而非表单输入（与 medical-records 的 NewPatientForm
 * 同一设计，差异在于本项目回显的是服务端派生值而非写入值原样回显）。
 *
 * S2（自驱动，DSL 无 click/fill）：mount 即提交固定表单，拿到 201 后渲染回显区。
 * StrictMode 双调用 effect → POST 实际发两次；server 无持久化（id 由 Date.now()
 * 派生），两次响应都 valid，analyzer 取最差后仍 valid。
 *
 * A1/A2：提交中与错误态不渲染任何 Field（空 span 比不渲染更糟）；四个值各过
 * 一次兜底 —— 字符串 || DASH、数值 String(x ?? DASH)。
 * A3：children 直接取 created.x || DASH，刻意不引入名为 id / status /
 * totalAmount / placedAt 的局部变量（静态近似无法区分字面量与同名标识符）；
 * status 映射中文标签，运行时取值 'ord_<ts>' / '待付款' / '798' / ISO 时间串，
 * 均不等于末段。
 * A4（跨 endpoint 共享最差质量）：data.id 与 data.status 同时是 getOrder（本页
 * OrderList 的详情区）的 manifest 字段 —— 两处渲染质量互相绑定，两处均 valid。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type CreatedOrder } from './generated-sdk.js'

/** 空值占位符 —— A1/A2：保证 Field 子节点永不为空串（空 span → suspicious / 空文本 → weak） */
const DASH = '—'
const STATUS_LABEL: Record<string, string> = {
  pending: '待付款', paid: '已付款', shipped: '已发货', completed: '已完成', cancelled: '已取消',
}

export function CheckoutForm() {
  const [created, setCreated] = useState<CreatedOrder | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // S2 自驱动：mount 即提交固定数据，场景无需 click/fill 即可覆盖写路径
    api.orders
      .createOrder({ body: { sku: 'SKU-8842', quantity: 2 } })
      .then(setCreated)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <section data-page="checkout">
      <h2>下单（201 回显验证）</h2>
      {error && <p data-page="checkout-error">提交失败：{error}</p>}
      {!created && !error && <p>提交中…</p>}
      {created && (
        <dl>
          {/* A4：data.id 与 OrderList 详情区共享 normalizedPath，两处都必须 valid */}
          <dt>订单编号</dt>
          <dd><Field field="data.id">{created.id || DASH}</Field></dd>

          <dt>订单状态</dt>
          <dd>
            <Field field="data.status">
              {created.status ? (STATUS_LABEL[created.status] ?? created.status) : DASH}
            </Field>
          </dd>

          <dt>订单总额</dt>
          <dd><Field field="data.totalAmount">{String(created.totalAmount ?? DASH)}</Field></dd>

          <dt>下单时间</dt>
          <dd><Field field="data.placedAt">{created.placedAt || DASH}</Field></dd>
        </dl>
      )}
    </section>
  )
}
