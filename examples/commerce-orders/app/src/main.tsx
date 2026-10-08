import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HomePage } from './HomePage.js'
import { ProductList } from './ProductList.js'
import { OrderList } from './OrderList.js'
import { CheckoutForm } from './CheckoutForm.js'

/**
 * S2：场景 DSL 无 click/fill，页面必须自驱动 —— 单页聚合渲染全部视图，
 * 进入即自动请求并渲染所有数据。S4：整页导航重置 collector 缓冲，故场景只能
 * goto 一次 —— 全部数据必须在同一页内呈现。
 *
 * 两个订单都覆盖（S4 的直接推论，两处落点）：
 *   - 列表区：listOrders 返回全部 fixture 订单，.map 逐条渲染 —— ord_002 的
 *     双 nullable（shipping.address.line2=null、payment.paidAt=null）由它承载；
 *   - 详情区：OrderList 内的 DETAIL_ORDER_IDS 对每个 fixture 订单各取一次
 *     getOrder —— data.note 恒为 null 的分支在运行时真实走到。
 * 若页面过滤掉 ord_002，覆盖分母不会变红（同路径由 ord_001 的非空值给出
 * evidence），但 nullable 分支在运行时永远走不到 —— A1/A2 防护退化为
 * 「构造正确但无法观测」。verify-pages.mjs 的挂载断言逐 fixture id 核对详情请求。
 *
 * CheckoutForm（POST 201 回显）无需 props：mount 即提交。它的 data.id /
 * data.status 与 OrderList 详情区共享 normalizedPath（A4 跨 endpoint 取最差），
 * 两处 children 均为 valid，无相互拖累。
 */
function App() {
  return (
    <div data-page="commerce-orders">
      <HomePage />
      <ProductList />
      <OrderList />
      <CheckoutForm />
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
