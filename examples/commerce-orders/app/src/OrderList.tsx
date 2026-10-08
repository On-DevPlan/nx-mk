/**
 * 订单列表 —— 覆盖 GET /orders 的全部 21 个 manifest 路径（列表区）与
 * GET /orders/{orderId} 的 4 个路径（详情区），共 25 条本文件渲染。
 *
 * 三处形状差异的落点（与 medical-records 对比）：
 *   - 三层数组：data[].items[].*（数组 → 行项数组）与 ProductList 的
 *     data.items[].tags[]（envelope → 元素 → 标签数组）互补。
 *   - 数组→对象→对象：data[].shipping.address.* —— shipping 与 address 各产一条
 *     对象级父描述符（plain object 属性，schema-walker 会产父节点），两条都在
 *     分母里，必须各渲染一个叶子摘要 Field。
 *   - 双 nullable：ord_002 的 shipping.address.line2 与 payment.paidAt 均为 null
 *     （server fixture，generateSdk 丢了可空性、TS 不会提醒），全部过 || DASH 兜底。
 *
 * 详情区（brief Step 6 警示的落实）：GET /orders/{orderId} 的四个字段
 * （data.id / data.status / data.customerName / data.note）若无页面请求该 endpoint，
 * 运行期零 evidence → 断言 B/C 必失败。DETAIL_ORDER_IDS 镜像 server 的 ORDERS
 * fixture（verify-pages.mjs 的挂载断言逐 id 核对，fixture 增删会立即变红）——
 * 两个订单都取详情，data.note 恒为 null 的分支（server getOrder 对找到的订单也回
 * note: null）在运行时真实走到。
 *
 * A4（跨 endpoint 共享最差质量）：data.id 与 data.status 同时是 getOrder 与
 * createOrder（201 回显）的 manifest 字段，analyzer 按 normalizedPath 索引取最差
 * —— 本文件详情区与 CheckoutForm 的渲染质量互相绑定，两处 children 均 valid。
 *
 * A1/A2：字符串 || DASH、数值 String(x ?? DASH)（quantity/unitPrice/lineTotal 的
 * 0 是合法值）；A3：status/method/currency 映射中文标签，局部变量带 Text 后缀。
 * 空行项兜底：items 为空时五个行项字段各自渲染占位（只兜一个会让其余四条
 * 无 evidence → missing，同 medical-records medications 的教训）。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type Order, type OrderDetail } from './generated-sdk.js'

const DASH = '—'
const STATUS_LABEL: Record<string, string> = {
  pending: '待付款', paid: '已付款', shipped: '已发货', completed: '已完成', cancelled: '已取消',
}
const PAY_METHOD_LABEL: Record<string, string> = { alipay: '支付宝', wechat: '微信支付', card: '银行卡' }
const CURRENCY_LABEL: Record<string, string> = { CNY: '人民币', USD: '美元', EUR: '欧元' }

/** 镜像 server ORDERS fixture 的订单 id —— 挂载断言（verify-pages.mjs）逐个核对 */
const DETAIL_ORDER_IDS = ['ord_001', 'ord_002']

export function OrderList() {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [details, setDetails] = useState<OrderDetail[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    api.orders.listOrders({}).then(setOrders).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  // 详情区：S2 自驱动 —— mount 即对每个 fixture 订单取详情（不依赖列表先回来）
  useEffect(() => {
    Promise.all(DETAIL_ORDER_IDS.map((orderId) => api.orders.getOrder({ orderId })))
      .then(setDetails)
      .catch((e: unknown) => setDetailError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) return <section data-page="orders-error">加载失败：{error}</section>
  if (!orders) return <section data-page="orders-loading">加载中…</section>

  return (
    <section data-page="order-list">
      <h2>订单列表（{orders.length} 笔）</h2>
      <ol>
        {orders.map((o) => {
          // 局部变量带 Text 后缀，不取字段末段同名（A3 静态检查的前提）
          const recipientText = o.shipping?.recipient || DASH
          const line1Text = o.shipping?.address?.line1 || DASH
          // nullable 1：ord_002.line2 为 null → DASH 兜底（A1/A2；generateSdk 丢了可空性）
          const line2Text = o.shipping?.address?.line2 || DASH
          const cityText = o.shipping?.address?.city || DASH
          const postalCodeText = o.shipping?.address?.postalCode || DASH
          const countryText = o.shipping?.address?.country || DASH
          // 标签映射刻意写成「索引 || DASH」而非三元套 ??：payment 汇总模板的插值
          // 走 verify-pages 的 isNonEmptyValue 直判（模板插值不享受字面量旁路），
          // 括号三元在 AST 上是 ParenthesizedExpression、判不了非空 —— 右操作数
          // DASH 自证，运行时等价（method 缺失 → 索引 '' → undefined → DASH）。
          const payMethodText = PAY_METHOD_LABEL[o.payment?.method ?? ''] || DASH
          // nullable 2：ord_002.paidAt 为 null → DASH 兜底（A1/A2）
          const paidAtText = o.payment?.paidAt || DASH
          return (
            <li key={o.id}>
              <div>
                {/* A3：渲染订单 id 值本身（'ord_001'），不等于末段 'id' */}
                <Field field="data[].id">{o.id || DASH}</Field>
                {' · '}
                <Field field="data[].status">
                  {o.status ? (STATUS_LABEL[o.status] ?? o.status) : DASH}
                </Field>
                {' · '}
                <Field field="data[].placedAt">{o.placedAt || DASH}</Field>
              </div>
              <div>
                总额 <Field field="data[].totalAmount">{String(o.totalAmount ?? DASH)}</Field>{' '}
                <Field field="data[].currency">
                  {o.currency ? (CURRENCY_LABEL[o.currency] ?? o.currency) : DASH}
                </Field>
              </div>
              <div>
                商品：
                {o.items && o.items.length > 0 ? (
                  <ul>
                    {o.items.map((it) => (
                      <li key={it.sku}>
                        <Field field="data[].items[].sku">{it.sku || DASH}</Field>{' '}
                        <Field field="data[].items[].name">{it.name || DASH}</Field>{' × '}
                        <Field field="data[].items[].quantity">{String(it.quantity ?? DASH)}</Field>
                        {' 单价 '}
                        <Field field="data[].items[].unitPrice">{String(it.unitPrice ?? DASH)}</Field>
                        {' 小计 '}
                        <Field field="data[].items[].lineTotal">{String(it.lineTotal ?? DASH)}</Field>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <>
                    <Field field="data[].items[].sku">{DASH}</Field>{' '}
                    <Field field="data[].items[].name">{DASH}</Field>{' × '}
                    <Field field="data[].items[].quantity">{DASH}</Field>{' 单价 '}
                    <Field field="data[].items[].unitPrice">{DASH}</Field>{' 小计 '}
                    <Field field="data[].items[].lineTotal">{DASH}</Field>
                  </>
                )}
              </div>
              <div>
                收货人 <Field field="data[].shipping.recipient">{recipientText}</Field>
                {' · '}
                <Field field="data[].shipping.address.line1">{line1Text}</Field>
                {' · '}
                <Field field="data[].shipping.address.line2">{line2Text}</Field>
                {' · '}
                <Field field="data[].shipping.address.city">{cityText}</Field>
                {' · '}
                <Field field="data[].shipping.address.postalCode">{postalCodeText}</Field>
                {' · '}
                <Field field="data[].shipping.address.country">{countryText}</Field>
              </div>
              {/* 对象级：data[].shipping 与 data[].shipping.address（数组→对象→对象，
                  两层各产一条父描述符，均在分母里）—— 叶子摘要，恒非空且 ≠ 末段 */}
              <div>
                收货信息汇总：
                <Field field="data[].shipping">{`（${recipientText} · ${line1Text}）`}</Field>
                {' / '}
                <Field field="data[].shipping.address">
                  {`（${line1Text} · ${line2Text} · ${cityText}）`}
                </Field>
              </div>
              <div>
                支付：
                <Field field="data[].payment.method">{payMethodText}</Field>
                {' · '}
                <Field field="data[].payment.paidAt">{paidAtText}</Field>
              </div>
              {/* 对象级：data[].payment —— 同上，父描述符在分母里 */}
              <div>
                支付汇总：
                <Field field="data[].payment">{`（${payMethodText} · ${paidAtText}）`}</Field>
              </div>
            </li>
          )
        })}
      </ol>

      {/* ─── 详情区：GET /orders/{orderId} 的四个路径，独立 DOM 区域 ─── */}
      {detailError && <p data-page="order-detail-error">详情加载失败：{detailError}</p>}
      {details && details.length > 0 && (
        <div data-testid="order-detail">
          <h3>订单详情</h3>
          {details.map((d) => (
            <div key={d.id}>
              <Field field="data.id">{d.id || DASH}</Field>
              {' · '}
              <Field field="data.status">
                {d.status ? (STATUS_LABEL[d.status] ?? d.status) : DASH}
              </Field>
              {' · 客户 '}
              <Field field="data.customerName">{d.customerName || DASH}</Field>
              {' · 备注 '}
              {/* nullable 3：getOrder 的 note 恒为 null → DASH 兜底（A1/A2） */}
              <Field field="data.note">{d.note || DASH}</Field>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
