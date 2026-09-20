# coverage policy 口径

plan 对应：§21 Coverage Policy（含 §21.3 四态与优先级）+ §22 Returned but ignored + §28 三指标 + §29 Evidence Quality 反作弊。

## 主干

- glob 语义 `*`（单段）/ `**`（跨段）/ 字面，与 manifest-schema normalizer 同语义——见 [[nx-mk-manifest-pipeline]] [[manifest-walk]]
- §22: returned-but-ignored = 后端返回且被页面读取、但 config 显式忽略——internalRiskScore 无 accessHit 即不进该集合（demo 实证）
- 三指标（§28）：requiredCoverage=1 是 goal 硬指标；raw backend 视页面读取比例（demo ≈36% 是预期不是 bug）
- anti-cheat v0（§29）：hidden DOM → suspicious、空 Field → weak；loophole 严禁堵在 client 拦截层以外（如手改指标）

## demo 基准值（校准参照）

- 22 response 字段，页面读 /users/{id} 相关约 8/22 → raw backend ≈36%
- coverage.ignored 实配 7 条（校准产物）；§3.6 示例 `['**.metadata.**','data.internalRiskScore']` 仅示意

## 易错

- 三指标互证是 §1.4.1/spec §3.6 指定的验收方式——动口径必须先重读 §28 再动代码
- suspicious/wscribed 集合是 anti-cheat 输入，不要在 analyzer 里二次判定
