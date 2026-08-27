/**
 * doctor 子命令 —— 4 步环境体检
 *
 * 依次检查：①Node >= 20 ②nx-mk.config.yml 存在 ③.nx-mk/ 目录可写
 * ④配置声明的插件可加载（实际跑一次 doctor 生命周期）。
 * 逐项打印 ✔/✖ 结果；任一项失败以退出码 2 结束，适合放进 CI 做前置校验。
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { createKernel, makeRunId, type LogLevel } from '@nx-mk/kernel'

// doctor 入参：configPath 可为 undefined（配置缺失时仍可体检其余项）
export interface RunDoctorOptions {
  configPath: string | undefined
  runId: string
  cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
}

// 单项检查结果：名称 + 是否通过 + 可选补充说明
interface Check {
  name: string
  ok: boolean
  detail?: string
}

export async function runDoctor(opts: RunDoctorOptions): Promise<void> {
  // 体检结果收集器：全部检查跑完后统一输出
  const checks: Check[] = []

  // 1. Node version
  // 中文：检查 ① 主版本号 >= 20（内核用了较新的 node:fs / 动态 import 特性）
  const nodeVer = process.versions.node
  const major = parseInt(nodeVer.split('.')[0] ?? '0', 10)
  checks.push({
    name: 'Node.js >= 20',
    ok: major >= 20,
    detail: major >= 20 ? `current: ${nodeVer}` : `current: ${nodeVer} (need >= 20)`,
  })

  // 2. config file
  // 中文：检查 ② 配置文件存在；缺失时提示先跑 init 脚手架
  if (opts.configPath) {
    checks.push({
      name: 'nx-mk.config.yml',
      ok: existsSync(opts.configPath),
      detail: opts.configPath,
    })
  } else {
    checks.push({
      name: 'nx-mk.config.yml',
      ok: false,
      detail: 'not found; run `npx nx-mk init` to scaffold',
    })
  }

  // 3. .nx-mk/ writable
  // 中文：检查 ③ 运行目录可写——写入再删除探针文件 .doctor-test
  try {
    mkdirSync('.nx-mk', { recursive: true })
    writeFileSync('.nx-mk/.doctor-test', 'ok')
    unlinkSync('.nx-mk/.doctor-test')
    checks.push({ name: '.nx-mk/ writable', ok: true })
  } catch (err) {
    checks.push({ name: '.nx-mk/ writable', ok: false, detail: (err as Error).message })
  }

  // 4. plugins loadable
  // 中文：检查 ④ 实际跑一次 doctor 生命周期验证插件可加载（含动态 import 与校验链路）
  if (opts.configPath) {
    try {
      const kernel = createKernel({
        configPath: opts.configPath,
        runId: makeRunId(opts.runId),
        subcommand: 'doctor',
        cwd: process.cwd(),
      })
      await kernel.run()
      checks.push({ name: 'plugins loadable', ok: true })
    } catch (err) {
      checks.push({
        name: 'plugins loadable',
        ok: false,
        detail: (err as Error).message,
      })
    }
  }

  // 汇总输出：每项一行 ✔/✖ + 说明；任一项失败则以退出码 2 结束（CI 可感知）
  for (const c of checks) {
    const mark = c.ok ? '✔' : '✖'
    const tail = c.detail ? ` — ${c.detail}` : ''
    console.log(`${mark} ${c.name}${tail}`)
  }
  const allOk = checks.every((c) => c.ok)
  if (!allOk) {
    process.exit(2)
  }
  void dirname
  // 中文：void dirname 同 loader.ts 的做法，抑制未使用导入告警
}
