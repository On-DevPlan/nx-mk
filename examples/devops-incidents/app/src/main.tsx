import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HomePage } from './HomePage.js'
import { ServiceList } from './ServiceList.js'
import { IncidentList } from './IncidentList.js'
import { HealthChecker } from './HealthChecker.js'

/**
 * S2：场景 DSL 无 click/fill，页面必须自驱动 —— 单页聚合渲染全部视图，
 * 进入即自动请求并渲染所有数据。S4：整页导航重置 collector 缓冲，故场景只能
 * goto 一次 —— 全部数据必须在同一页内呈现。
 *
 * 三页覆盖（与 commerce-orders / medical-records 同 spirit）：
 *   - ServiceList     → listServices（7 路径）
 *   - IncidentList    → listServiceIncidents（13 路径）+ createIncidentNote（2 路径）
 *   - HealthChecker   → getServiceHealth 200（5 路径）+ getServiceHealth 503（4 路径，C2 绕行）
 * 503 错误卡与 200 正常分支同时存在同一页（mount 即双请求），单次 goto 即覆盖双状态码。
 *
 * Incidents 列表区天然全量渲染（listServiceIncidents 返回全部 fixture 事件，
 * .map 逐条渲染）—— inc_001 的 nullable（resolvedAt=null）分支由它承载。
 * 备注回显（201）由 IncidentList 的第二个 useEffect 触发 —— 拿到 201 后渲染进独立
 * DOM 区 <div data-testid="incident-note">。
 *
 * A4（跨 endpoint 共享最差质量）：data[].id 同时是 listServiceIncidents 与（如果未来
 * 加）createIncidentNote 回显的 manifest 字段 —— analyzer 按 normalizedPath 索引
 * 取最差。本项目里 listServiceIncidents 与 createIncidentNote 不共享路径（前者是
 * data[].body / createdAt 不存在），故无相互拖累。
 */
function App() {
  return (
    <div data-page="devops-incidents">
      <HomePage />
      <ServiceList />
      <IncidentList />
      <HealthChecker />
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