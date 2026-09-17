/**
 * UI 产物目录定位：dist/server/*.js → 包根/dist-ui（vite build 产物，Task 8 生成）。
 * CLI 的 start 命令经主导出消费，避免在 cli 侧拼接跨包相对路径。
 */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export function resolveUiDistDir(): string {
  const here = fileURLToPath(import.meta.url) // …/packages/dashboard/dist/server/index.js
  const pkgRoot = join(here, '..', '..', '..')
  return join(pkgRoot, 'dist-ui')
}
