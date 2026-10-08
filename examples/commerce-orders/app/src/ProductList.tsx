/**
 * 商品分页列表 —— 覆盖 GET /products 的全部 15 个 manifest 路径。
 *
 * 分区要点（spec §9，本项目与 medical-records 的第一处形状差异）：envelope 四个
 * 标量（total/page/pageSize/hasNext）的路径是 data.*，数组元素字段的路径是
 * data.items[].x —— 两者必须渲染在**不同的 DOM 区域**。把标量字段挂进数组循环
 * 会产出 data.items[].total —— 与 manifest 的 data.total 不匹配 → 该标量 missing、
 * 数组元素侧还多出一个无主路径（verify-manifest 双向断言立即变红）。
 *
 * 对象级字段（data.items[].supplier）—— schema-walker 对 plain object 属性产父
 * 描述符（对 array-of-object 不产），故 supplier 这条 required 路径在分母里。
 * 不渲染 → requiredCoverage 到不了 1。渲染成叶子摘要（同 medical-records 的
 * data.contact），摘要与叶子共用同一个已兜底的局部变量。
 *
 * P1：query 参数 page/pageSize 不进分母（manifest 只收响应字段），但必须传
 * 才能拿到分页数据 —— 故 listProducts({ page: '1', pageSize: '10' }) 刻意传参，
 * 而不为它们渲染任何 data-mk-field。
 *
 * A1/A2（空 span → suspicious / 空 textSample → weak）：每个值过兜底。字符串用 ||、
 * 数值用 ??（price=0 是合法价格，|| 会把 0 吞成 '—' 失真）。
 * A3（text === 末段 → weak）：currency 映射中文标签、hasNext 渲染'还有更多/已到末页'、
 * tags 渲染 join 结果 —— 均不等于字段末段。局部变量带 Text 后缀（supplierIdText
 * 而非 supplierId），让 verify-pages.mjs 的 A3 静态检查真正成立。
 *
 * tags 的兜底写法（与 brief 的一处刻意偏离）：brief 写
 * `(p.tags ?? []).length > 0 ? p.tags.join(' / ') : DASH` —— 三元 whenTrue 是
 * join() 调用，verify-pages 的 AST 判定无法证明其非空（宁可误报的守卫会拦下），
 * 改写为 `(p.tags ?? []).join(' / ') || DASH`：运行时等价（空数组 join 得 '' →
 * 回落 DASH），且右操作数 DASH 自证非空。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type ProductPage } from './generated-sdk.js'

const DASH = '—'
const CURRENCY_LABEL: Record<string, string> = { CNY: '人民币', USD: '美元', EUR: '欧元' }

export function ProductList() {
  const [page, setPage] = useState<ProductPage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // P1：query 参数不进分母，但必须传才能拿到分页数据
    api.products.listProducts({ page: '1', pageSize: '10' }).then(setPage).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  if (error) return <section data-page="products-error">加载失败：{error}</section>
  if (!page) return <section data-page="products-loading">加载中…</section>

  return (
    <section data-page="product-list">
      <h2>商品列表</h2>

      {/* envelope 标量区 —— 路径 data.*，不在数组循环内（spec §9 分区） */}
      <div data-testid="page-summary">
        共 <Field field="data.total">{String(page.total)}</Field> 件商品 ·
        第 <Field field="data.page">{String(page.page)}</Field> 页 ·
        每页 <Field field="data.pageSize">{String(page.pageSize)}</Field> 条 ·
        {/* A3：渲染'还有更多/已到末页'而非 'hasNext' */}
        <Field field="data.hasNext">{page.hasNext ? '还有更多' : '已到末页'}</Field>
      </div>

      <ul>
        {page.items.map((p) => {
          // 局部变量带 Text 后缀，不取字段末段同名（A3 静态检查的前提）
          const supplierIdText = p.supplier?.id || DASH
          const supplierNameText = p.supplier?.name || DASH
          const supplierRegionText = p.supplier?.region || DASH
          const tagsText = (p.tags ?? []).join(' / ') || DASH
          return (
            <li key={p.id}>
              <div>
                <Field field="data.items[].name">{p.name || DASH}</Field>
                {' · '}
                {/* A3：渲染完整 sku 值（'SKU-8842'），不等于末段 'sku' */}
                <Field field="data.items[].sku">{p.sku || DASH}</Field>
                {' · '}
                <Field field="data.items[].id">{p.id || DASH}</Field>
              </div>
              <div>
                {/* A1：price 可能为 0 → 用 ?? 而非 ||（String(0)='0' 非空） */}
                单价 <Field field="data.items[].price">{String(p.price ?? DASH)}</Field>{' '}
                <Field field="data.items[].currency">
                  {p.currency ? (CURRENCY_LABEL[p.currency] ?? p.currency) : DASH}
                </Field>
              </div>
              <div>
                分类 <Field field="data.items[].category">{p.category || DASH}</Field>
                {' · 标签 '}
                {/* 三层数组叶：data.items[].tags[]（array-of-primitive 的归一化形态） */}
                <Field field="data.items[].tags[]">{tagsText}</Field>
              </div>
              <div>
                供应商：
                <Field field="data.items[].supplier.id">{supplierIdText}</Field>{' '}
                <Field field="data.items[].supplier.name">{supplierNameText}</Field>{' '}
                <Field field="data.items[].supplier.region">{supplierRegionText}</Field>
              </div>
              {/* 对象级：data.items[].supplier。摘要恒非空且 ≠ 'supplier'（叶子摘要，非空 span） */}
              <div>
                供应商汇总：
                <Field field="data.items[].supplier">
                  {`（${supplierIdText} · ${supplierNameText} · ${supplierRegionText}）`}
                </Field>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
