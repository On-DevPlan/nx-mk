# nx-mk 风格模板指南（agent.style）

`agent.style` 让 api-ui-agent 产出的前端补丁遵循确定风格：模板注入 prompt，review guard
G5 按 className 白名单校验。不配置 = 现网行为（无风格段、G5 关闭）。

## 配置

```yaml
agent:
  style:
    id: tailwind-lite            # 内置：tailwind-lite / semantic-css / mui-style / unstyled / auto-detect
    # path: ./styles/my-corp.md  # 自定义模板（相对 nx-mk.config.yml；与 id 同给时 path 优先）
    # overrides:
    #   color: 蓝                # description 里 {{color}} 占位符插值
```

配置错误（未知 id、path 不存在、模板契约缺段）在 `nx-mk loop` 启动即失败（进程级
fail-fast）——不烧 LLM 轮次、不落任何 run 产物。

## 模板格式（三段式契约）

```md
---
id: my-corp-style                          # 可选；缺省取文件名 stem
classNameWhitelist: ["flex", "px-*"]       # 可选；G5 白名单，* 为尾部通配
---
风格概述（1-3 句，原样进 prompt；支持 {{key}} 占位符）。

## Hard rules                              # 必需；每条列表项原样进 prompt
- 规则一
- 规则二
```

缺 frontmatter / 缺 `## Hard rules` / 描述为空 → 启动即失败并给出修复示例
（config 语义错误不烧 LLM 轮次）。

## G5 判定序

1. 模板带 `classNameWhitelist` → patch 新增行里的 class token 按白名单匹配（`px-*` 前缀通配）；
2. 未带白名单（或显式 auto-detect）→ 扫描宿主项目 css/scss/tsx/jsx 的既有 class，命中即放行；
3. 均未命中 → patch 进 `.nx-mk/patches/<runId>/rejected/`，detail 列出违规 token。

动态 className（`styles.foo`、模板字符串）不参与判定。宿主零命中场景 guard 会给出可读提示
（全新项目或扫描路径有误）。

## 内置模板一览

| id | 定位 | 白名单 |
|---|---|---|
| tailwind-lite | utility-first，禁自定义 CSS | 有（尾部通配集合） |
| semantic-css | 复用宿主语义 class | 无（宿主扫描） |
| mui-style | MUI 组件 + sx prop | 无（宿主扫描） |
| unstyled | 纯结构渲染 | 无（宿主扫描） |
| auto-detect | 默认兜底，不渲染 prompt 段 | 无（宿主扫描） |
