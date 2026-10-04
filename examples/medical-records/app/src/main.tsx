import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HomePage } from './HomePage.js'
import { PatientDetail } from './PatientDetail.js'
import { VisitHistory } from './VisitHistory.js'

/**
 * S2：场景 DSL 无 click/fill，页面必须自驱动 —— 单页聚合渲染全部视图，
 * 进入即自动请求并渲染所有数据。S4：整页导航重置 collector 缓冲，故场景只能 goto 一次，
 * 不能靠多路由分别 goto —— 全部数据必须在同一页内呈现。
 *
 * 两个患者都渲染（S4 的直接推论）：p_002 带 nullable 与空数组两个验证点
 * （server/src/index.ts 的 notes: null、medications: []），单页自驱动必须一次覆盖，
 * 否则这两个分支在运行时永远走不到，A1/A2 防护只能靠构造正确性成立、无法被观测。
 * 同一路径渲染两次是安全的：analyzer 按 normalizedPath 索引并取最差质量
 * （coverage-analyzer.ts:57-63），两个实例都是 valid。
 *
 * Task 3 会新增 NewPatientForm（POST 201 回显 data.createdAt）。当前刻意不 import 它 ——
 * 那个文件还不存在，import 会让 vite dev 对 /src/main.tsx 返 500、整页所有 Field 不可达。
 */
function App() {
  return (
    <div data-page="medical-records">
      <HomePage />
      <PatientDetail patientId="p_001" />
      <PatientDetail patientId="p_002" />
      <VisitHistory patientId="p_001" />
      <VisitHistory patientId="p_002" />
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
