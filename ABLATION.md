# 消融测试（Ablation）

把插件的每项能力单独"拆掉"，换成没有它时最自然的那种朴素做法，测量代价。全部是**真跑**：真目录、真 npm registry、真运行版逻辑；脚本无副作用（不安装、不改 profile）。

```sh
node test/ablation.mjs          # 人类可读报告
node test/ablation.mjs --json   # 机器可读
```

运行环境：DSH 0.2.x（本仓库开发所对的宿主版本线）；日期 2026-10-18。网络类数字随线路波动，量级结论稳定。

## 汇总

| 拆掉的能力 | 朴素做法 | 实测代价 | 本插件 |
|---|---|---|---|
| 同名消歧 | 取第一个/星数最高命中 | 目录 287 组同名，其中 **51 组**星数最高的是 GitHub-only、同组却有 npm 包 → naive 会装到另一条来源 | 显式列出 owner/星数/来源，要求 `owner=` 或完整 spec |
| 版本兼容解析 | 直接装 `latest` | 8 个样本中 **2 个 latest 与宿主不兼容**；本插件为挑兼容版本**累计跨过 12 个更新版本** | 逐版本检查 `@deepseek-ai/dsh*` peer + `engines.dsh`，并给出拒绝原因 |
| peer 作用域（只认 dsh*） | 把所有 `@deepseek-ai/*` 当内核版本 | 曾经的实现 bug：**4 / 8 个包被误判为"无兼容版本"**（把 cordis `^4.x`、schemastery `~3.x` 当成内核版本） | 只把 `@deepseek-ai/dsh*` 与 `engines.dsh` 当运行时约束 |
| registry 选择 | 直连 `registry.npmjs.org` | 同一份元数据：**784 ms vs 镜像 13 ms（60.3×）**；会话实测安装面：npmjs 两次 90 s 超时，镜像 13.4 s 装完 170 包 | 优先 `pluginRegistryProbe.fastest()` / 配置镜像 |
| GitHub-only 源码构建 | `dsh plugin add github:…` 后直接用 | 样本仓库 `lib/index.js` 探针 **404**：包声明的入口不在仓库 → 插件无法加载（`src/` 才是源码） | 自动检出 → `pnpm install` → `build` → `link:` 注册 |
| 安装后校验 | 相信安装器返回的 `applied` | 模拟"安装器报成功但进程里没有 entry"：无校验会把**静默失败报成安装成功** | 同一调用内回读 loader entry / bundle / client 半，报 `restart` 或刷新提示 |
| 逻辑热加载 | 改代码 → 重启宿主 | 重启 **约 30–40 s** 且中断进行中的回合（开发本插件时为此重启 3 次） | cache-busted 重新 `import`：**3 ms** |

## 分项细节

### A1 同名消歧

- 目录 5,065 条，`base name` 相同的有 **287 组**
- 其中 **51 组**：星数最高的是 GitHub-only，同组却有 npm 发布版 → "按第一个命中/最高星"的选择会装到**不同来源的另一个插件**
- `dsh-browser` 一条就有 6 个 owner；没有 owner 维度时无法判断你要哪个

### A2 版本兼容

样本 8 个真实 npm 包，逐个拉一次 registry 元数据：

| 包 | latest | latest 兼容? | 本插件选择 | 跳过版本数 | naive（放大 peer） |
|---|---|---|---|---|---|
| dsh-better-sidebar | 0.28.0 | ❌ | **0.26.1** | 2 | 无（误判） |
| dsh-builtin-browser | 0.4.13 | ✅ | 0.4.13 | 0 | 无（误判） |
| dshmarket | 1.66.36 | ✅ | 1.66.36 | 0 | 无（误判） |
| dsh-find-plugin | 0.4.0 | ❌ | 无（该包要求更高内核） | 10 | 无 |
| dsh-plugin-subscriptions | 0.9.9 | ✅ | 0.9.9 | 0 | 无（误判） |
| @anweat/dsh-browser | 0.2.1 | ✅ | 0.2.1 | 0 | 0.2.1 |
| dsh-config-manager | 0.1.76 | ✅ | 0.1.76 | 0 | 0.1.76 |
| @noob-stupid/dsh-plugin-console | 0.5.59 | ✅ | 0.5.59 | 0 | 0.5.59 |

要点：**"直接装 latest" 在 2/8 的样本上会装坏**；而"把所有 `@deepseek-ai/*` 都当内核约束"这个更隐蔽的错误会让 **4/8 的包看起来完全装不了**——这正是本仓库开发过程中真实踩到的坑（已用单测钉住）。

### A3 registry

同一份 `dsh-better-sidebar` 元数据单次读取：`registry.npmjs.org` **784 ms**，`registry.npmmirror.com` **13 ms**（60.3×）。
安装面更悬殊：会话实测 npmjs **两次 90 s 超时**（90,103 ms / 90,145 ms），镜像 **13.4 s** 装完 170 个包。

### A4 GitHub-only 源码构建

对 `omdsh-dev/dsh-browser` 的桥接子包做仓库探针：

- `lib/index.js` → **404**（构建产物不在仓库）
- `src/index.ts` → 200（只有源码）
- `package.json` → 200

结论：不构建就注册，等于装了一个 `main` 指向不存在文件的包——**装上了也永远不会加载**。

### A5 安装后校验

模拟"安装器返回 `applied`，但当前进程里没有该 loader entry"：

- 无校验：向用户报告"安装成功"
- 本插件：同一调用内报出 `loader entry: not found`，并按 client 半情况给出刷新/重启提示

### A6 逻辑热加载

带新 `?v=` 重新 import 逻辑模块：**3 ms**，两次加载是不同模块实例。
对照：重启宿主约 **30–40 s**，且会中断进行中的回合；开发本插件期间为此重启了 3 次。

## 结论

每项能力拆掉后，失败方式都不是"慢一点"，而是**装错版本 / 装错来源 / 装完不加载 / 静默失败**——这些恰好是这次真实装机时全部踩过一遍的坑。消融结果与 [BENCHMARK.md](BENCHMARK.md) 的端到端对比互相印证：插件省下的主要是**判断与验证**，不是下载和编译的物理时间。
