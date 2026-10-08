// 断言 manifest 的 normalizedPath 集合 —— 页面里每个 field="..." 字面量都必须落在这个集合内。
// 这条脚本同时是 Review Focus #4（数组路径写错）的自动化出口。
//
// 双向断言（set equality，不是单向子集）：
//   1. REQUIRED ⊆ paths  —— 页面将要用到的每个路径都必须在 manifest 里（漏字段 → 页面渲染了但分母没有）
//   2. paths ⊆ REQUIRED  —— manifest 里不该出现 REQUIRED 未预期的路径（多余字段 → 真 100% 永远达不到）
// 只做单向断言会让"13 条正确 + 500 条垃圾"静默通过，故两个方向都必须成立。
//
// ⚠️ REQUIRED 的来源纪律（controller 裁定，Task 5）：**从实际生成的 manifest 推导**，
// 不抄 brief。brief 的列表有两处缺陷，均已按实际 manifest 修正（42 条唯一路径）：
//   - 含不存在的 data.createdAt —— CreatedOrderSchema 是 { id, status, totalAmount,
//     placedAt } 四键（createdAt 是 medical-records 的 CreatedPatient 串场笔误）；
//   - 漏了四个对象级父描述符 —— schema-walker 对 plain object 属性产父节点
//     （data.items[].supplier / data[].shipping / data[].shipping.address /
//     data[].payment），对 array-of-object 不产（data.items 与 data[].items 均
//     不在分母里）。
// 集合与 swagger/openapi.json 的实际产出逐条对齐，改 server schema 时本脚本会立即变红。
import { readFileSync } from 'node:fs'
const m = JSON.parse(readFileSync(new URL('./.nx-mk/manifest.json', import.meta.url), 'utf8'))
const paths = [...new Set(m.fields.map((f) => f.normalizedPath))].sort()
const REQUIRED = [
  // ─── envelope 标量（4）：GET /products 200 → ProductPage 的分页元信息（spec §9 分区）───
  'data.total', 'data.page', 'data.pageSize', 'data.hasNext',
  // ─── 商品数组元素（11 = 7 叶子 + supplier 父 + 3 供应商叶子）───
  // 注意：data.items 本身不进 manifest —— walkSchema 对 array-of-object 不产描述符，
  // 只透传元素字段（packages/manifest-schema/src/schema-walker.ts 的透传分支）。
  // tags 是 array-of-primitive → 叶子路径带 []（data.items[].tags[]）。
  'data.items[].id', 'data.items[].sku', 'data.items[].name', 'data.items[].price',
  'data.items[].currency', 'data.items[].category', 'data.items[].tags[]',
  // supplier 是 plain object → 产父描述符（在分母里，必须渲染）+ 三个叶子
  'data.items[].supplier',
  'data.items[].supplier.id', 'data.items[].supplier.name', 'data.items[].supplier.region',
  // ─── 订单数组元素（21）：GET /orders 200 → Order[] ───
  // 5 个标量叶子
  'data[].id', 'data[].status', 'data[].placedAt', 'data[].totalAmount', 'data[].currency',
  // 行项数组（array-of-object，不产数组描述符）的 5 个叶子
  'data[].items[].sku', 'data[].items[].name', 'data[].items[].quantity',
  'data[].items[].unitPrice', 'data[].items[].lineTotal',
  // shipping（plain object 父）→ recipient 叶子 + address（再一层 plain object 父）→ 5 个叶子
  'data[].shipping', 'data[].shipping.recipient',
  'data[].shipping.address',
  'data[].shipping.address.line1', 'data[].shipping.address.line2',
  'data[].shipping.address.city', 'data[].shipping.address.postalCode', 'data[].shipping.address.country',
  // payment（plain object 父）→ 2 个叶子
  'data[].payment', 'data[].payment.method', 'data[].payment.paidAt',
  // ─── 回显 + 详情（6 唯一路径 / 8 个 fieldId）───
  // POST /orders 201 → CreatedOrder：data.id / data.status / data.totalAmount / data.placedAt
  // GET /orders/{orderId} → OrderDetail：data.id / data.status / data.customerName / data.note
  // data.id 与 data.status 双归属（A4 跨 endpoint 共享最差质量），故 4+4=8 fieldId → 6 唯一路径。
  // ⚠️ 没有 data.createdAt —— 见文件头「来源纪律」。
  'data.id', 'data.status', 'data.totalAmount', 'data.placedAt',
  'data.customerName', 'data.note',
]
const REQUIRED_SORTED = [...REQUIRED].sort()

// 方向 1：REQUIRED ⊆ paths（缺字段 —— 页面渲染了但 manifest 分母里没有）
const missing = REQUIRED_SORTED.filter((p) => !paths.includes(p))
// 方向 2：paths ⊆ REQUIRED（多余字段 —— 真 100% 永远达不到）
const unexpected = paths.filter((p) => !REQUIRED_SORTED.includes(p))

if (missing.length || unexpected.length) {
  if (missing.length) {
    console.error(`manifest 缺少预期字段路径（${missing.length}）:\n  ` + missing.join('\n  '))
  }
  if (unexpected.length) {
    console.error(`manifest 出现预期外的字段路径（${unexpected.length}）:\n  ` + unexpected.join('\n  '))
  }
  console.error(`实际集合（共 ${paths.length}）:\n  ` + paths.join('\n  '))
  process.exit(1)
}
console.log(
  `[verify-manifest] ${REQUIRED_SORTED.length} 个预期字段路径双向命中` +
  `（对象族 ${REQUIRED.filter((p) => !p.includes('[]')).length} + 数组族 ${REQUIRED.filter((p) => p.includes('[]')).length}）` +
  `，共 ${paths.length} 个唯一路径，无缺失无多余`,
)
