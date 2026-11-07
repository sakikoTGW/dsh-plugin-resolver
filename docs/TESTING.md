# 测试与 CI

```sh
npm test        # 35 条离线逻辑检查 + 10 条宿主无关 harness = 45 项
npm run bench   # 插件路径基准（真实目录 + registry）
npm run ablate  # 消融测试（无副作用）
```

- `test/selftest.mjs`：semver 子集、版本选择、spec 解析、目录检索（离线）。
- `test/harness.mjs`：假 Cordis ctx + 假 pluginManager 驱动真实工具体。
- `test/benchmark.mjs` / `test/ablation.mjs`：真实目录 + 真实 registry 的测量脚本。
- CI：每次 push/PR 跑 `test`（Node 24）；`ablation` 走手动或每周定时任务。

沙箱或 CI 里默认缓存目录不可写时，用 `DSH_HOME` 指到临时目录：`DSH_HOME=/tmp/dsh npm test`。
