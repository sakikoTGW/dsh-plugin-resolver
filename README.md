<p align="center">
  <img src="assets/hero-promo.png" alt="DSH Plugin Resolver — install the right plugin in one call" width="100%">
</p>

<p align="center">
  <b>简体中文</b> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-plugin-resolver"><img alt="npm" src="https://img.shields.io/npm/v/dsh-plugin-resolver?style=flat-square&color=4D6BFE&logo=npm&logoColor=white"></a>
  <a href="https://github.com/sakikoTGW/dsh-plugin-resolver/actions/workflows/test.yml"><img alt="test" src="https://img.shields.io/github/actions/workflow/status/sakikoTGW/dsh-plugin-resolver/test.yml?style=flat-square&label=test&color=2FBF71"></a>
  <img alt="45 checks" src="https://img.shields.io/badge/checks-45%20passing-2FBF71?style=flat-square">
  <img alt="downloads" src="https://img.shields.io/npm/dm/dsh-plugin-resolver?style=flat-square&color=4D6BFE">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-263146?style=flat-square"></a>
  <img alt="DSH" src="https://img.shields.io/badge/DSH-0.2.0--rc.2%2B-4D6BFE?style=flat-square">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white">
</p>

<p align="center"><sub><b>45 项检查</b> · <b>dsh.so L5 运行已验证</b> · <b>dshbase Verified</b> · MIT · DSH ≥0.2.0-rc.2 &lt;0.3.0 · Node ≥20</sub></p>

## 展示效果

<p align="center">
  <img src="assets/effect-agent.gif" alt="真实 DSH 会话：agent 用 resolver 完成搜索、解析、安装、校验" width="100%">
</p>

<p align="center"><sub>真实 DSH 会话：一条指令 → <code>plugin_search</code> → <code>plugin_resolve</code> → <code>plugin_install</code> → <code>plugin_status</code>。本次装的是 <code>dsh-ws-recency@0.26.0</code>，状态回读为 enabled / active。</sub></p>

<p align="center"><b>45 → 6</b> 工具调用 · <b>0</b> 失败重试 · <b>20+ 分钟 → 约 3 分钟</b> · <b>1.9 s</b> 决策链（9 次调用）</p>

消融逐项移走目录缓存、同名消歧、兼容版本求解、装后校验，得到的是错版本、错来源、装完不加载、静默失败；数据在 [ABLATION](ABLATION.md)，对比在 [BENCHMARK](BENCHMARK.md)。

## 安装

| 插件市场（真实 UI） | npm（真实终端） |
|---|---|
| <img src="assets/install-market.gif" alt="在 DSH 插件市场搜索并安装 dsh-plugin-resolver" width="100%"> | <img src="assets/install-npm.gif" alt="在真实终端安装 dsh-plugin-resolver" width="100%"> |
| 搜索 → 确认 → 安装 → 已安装（需重启生效） | `npm install dsh-plugin-resolver` → added 1 package in 8s |

把这句话交给你的 agent：

```text
安装 dsh-plugin-resolver，然后用它安装 dsh-browser。
```

<details>
<summary>手动路径</summary>

市场索引源：

```text
https://sakikoTGW.github.io/dsh-plugin-resolver/market/index.json
```

npm / DSH 宿主：

```sh
dsh plugin --profile <profile> add dsh-plugin-resolver
```

GitHub 源码或 tarball：

```sh
dsh plugin --profile <profile> add github:sakikoTGW/dsh-plugin-resolver#<commit>
```

</details>

## 怎么工作

| 阶段 | 工具 | 输出 |
|---|---|---|
| 搜索 | `plugin_search` | 目录命中、owner、星数、npm 名、同名标记 |
| 解析 | `plugin_resolve` | package、install spec、registry、源码构建需求 |
| 安装 | `plugin_install` | profile / lockfile / plugin-sources 的变更 |
| 校验 | `plugin_status` | bundle、loader entry、fiberPhase |
| 上报 | 返回值 | 应用状态、restart 判定、下一步 |

`plugin_install` 写环境；其余三个工具只读。

## 生态

- [dsh-plugins](https://github.com/sakikoTGW/dsh-plugins) — 插件集
- [dsh.so](https://www.dsh.so/zh/artifact/dsh-plugin-resolver/) — L5 运行已验证
- [dshbase](https://dshbase.com/plugins/dsh-plugin-resolver/) — Verified
- [dshmarket](https://dshmarket.com) — 市场收录
- 市场索引源：`https://sakikoTGW.github.io/dsh-plugin-resolver/market/index.json`

## 能力矩阵

| 能力 | npm | GitHub-only | 显式 spec |
|---|---|---|---|
| 同名消歧 | ✓ | ✓ | ✓ |
| 兼容版本 | ✓ | ✓ | 用户给定 |
| 源码构建 | — | ✓ | 按 spec |
| 装后校验 | ✓ | ✓ | ✓ |
| 重启判定 | ✓ | ✓ | ✓ |

## 能力（Features）

- **同名消歧** — `plugin_search` 返回全部候选：owner、星数、npm 名、安装命令；调用方给 `owner=` 或完整 spec。
- **兼容版本** — `plugin_resolve` 按 `engines.dsh` 与同命名空间 peer 求解，返回可复核的 install spec。
- **GitHub 源码** — 缺构建产物时执行 `pnpm install` / `pnpm run build`，再以 `link:` 安装。
- **装后校验** — `plugin_status` 回读 bundle、loader entry 与 fiberPhase；restart 判定由插件管理器的应用结果决定。

<p align="center">
  <img src="assets/feature-table.png" alt="真实会话里的安装结果表：搜索、解析、安装、校验四步" width="100%">
</p>

## 验证

```sh
npm test   # 45 passing: 35 logic + 10 harness
```

机器可读的验证入口在 [`agent.json`](agent.json) 的 `validation`；CI 入口在 [test.yml](https://github.com/sakikoTGW/dsh-plugin-resolver/actions/workflows/test.yml)。

## Agent contract

```json
{
  "tools": ["plugin_search (readOnly)", "plugin_resolve (readOnly)", "plugin_install (writes profile)", "plugin_status (readOnly)"],
  "versionRule": "engines.dsh authoritative; otherwise same-namespace @deepseek-ai/dsh peers",
  "ambiguity": "owner= or a full spec",
  "writes": ["profile", "lockfile", "plugin-sources"],
  "restart": "plugin manager result is authoritative"
}
```

完整契约：[`agent.json`](agent.json)。

## 结语

一次工具调用，把插件装对。

[npm](https://www.npmjs.com/package/dsh-plugin-resolver) · [GitHub](https://github.com/sakikoTGW/dsh-plugin-resolver) · [Issues](https://github.com/sakikoTGW/dsh-plugin-resolver/issues) · [dsh-plugins](https://github.com/sakikoTGW/dsh-plugins)

<p align="center"><sub>Built for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> · MIT · <a href="#">回到顶部 ↑</a></sub></p>

