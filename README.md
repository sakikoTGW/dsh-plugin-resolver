# dsh-plugin-resolver

DSH 插件安装助手（host-only 插件，给模型加 4 个工具）。把"帮我装个插件"从翻目录、试版本、装坏了再修的循环，收敛成一次确定的解析 + 安装 + 校验。

## 它解决的具体问题

| 反复踩的坑 | 这个插件怎么处理 |
| --- | --- |
| 市场里有 6 个同名 `dsh-browser` | `plugin_search` / `plugin_resolve` 保留全部同名候选并标 owner，不猜 |
| npm `latest` 与宿主内核不兼容（如 `0.28.0` 要 `^0.2.1-rc.1`，宿主只有 `0.2.0-rc.2`） | 读宿主 `@deepseek-ai/dsh-base` 版本，按插件 `@deepseek-ai/dsh*` peer 与 `engines.dsh` 选**最高兼容版本** |
| caret 跨 minor 的 prerelease 陷阱 | 内置 semver 子集按宿主的 `includePrerelease` 语义求值（`^0.1.7-rc.1` 不会接受 `0.2.0-rc.2`） |
| 直连 npmjs 几十 KB/s，装到 90s 超时 | 优先用 Host 的 `pluginRegistryProbe.fastest()` / 配置的镜像，并显式传给安装器 |
| GitHub-only 插件仓库不提交 `lib/`，装上也是空的 | 自动检出源码（支持 GitHub 代理）→ `pnpm install` → `pnpm run build` → 再以 `link:` 注册 |
| 装完不知道有没有生效 | 安装后回读 loader entry / bundle / manifest，报 `fiberPhase` 与是否需要刷新或重启 |

## 结构：稳定壳 + 可热加载逻辑

```
index.js           宿主入口（挂载工具，稳定）
host/register.js   工具 schema + pluginManager 桥接（稳定，改动需重启）
logic/             目录/版本/兼容/安装编排（每次调用按 mtime 重新 import）
```

`host/register.js` 每次工具调用都会算一遍 `logic/` 下所有文件的 mtime，并以
`import('./logic/api.js?v=<mtime>')` 的形式导入逻辑入口；逻辑模块之间也用同一个
`?v=` 传递依赖。Node 的 ESM 缓存按完整 URL 计，所以：

- **改 `logic/` 里的任何文件 → 下一次工具调用立即生效，不用重启宿主**
- 只有改 `index.js` / `host/register.js`（工具定义、返回结构）才需要重启

这是为打包桌面版设计的：它拿不到真 HMR 所需的 Node 内部模块加载器，但对
"重新 import 一个带新 query 的模块"完全没问题。

## 工具

| 工具 | 作用 |
| --- | --- |
| `plugin_search` | 搜社区目录（npm 承载的目录包优先，避免慢速 GitHub Pages），排序并标同名歧义 |
| `plugin_resolve` | 只解析不安装：目录条目、兼容版本、registry、是否需要源码构建 |
| `plugin_install` | 完整安装：选版本 → 安装/构建 → 校验 → 给出下一步动作 |
| `plugin_status` | 列出本 profile 的第三方 bundle 与 loader entry 状态 |

## 安装

```sh
# 从 GitHub 安装（纯 JS，无需构建）
dsh plugin --profile web add github:sakikoTGW/dsh-plugin-resolver

# 发布到 registry 后
dsh plugin --profile web add dsh-plugin-resolver

# 本地开发
dsh plugin --profile web add link:/abs/path/to/dsh-plugin-resolver
```

host-only，没有 client 半，装完**不需要**刷新浏览器即可让工具生效（宿主重启后最稳）。

## 版本选择规则

1. 运行时版本 = `pluginManager.listBundles()` 里 `@deepseek-ai/dsh-base`（退化到 `dsh-web-app` / `dsh`）的版本。
2. 逐版本从高到低检查：
   - 非可选的 `@deepseek-ai/dsh*` peer 范围必须满足运行时版本；
   - 若声明了 `engines.dsh`，也要满足；
   - `@deepseek-ai/cordis`、`@deepseek-ai/schemastery` 等**同命名空间但不同版本线**的库不算运行时约束。
3. 取第一个通过的版本；全部不通过时报出最近几个版本的拒绝原因（"需要 0.2.1-rc.1，宿主是 0.2.0-rc.2"）。
4. 用户显式给 `version` 时跳过兼容计算，直接安装。

## 安装路径

- **registry 包**：`pluginManager.installBundle(name@resolvedVersion, { registry })`，profile 文件、lockfile、激活生命周期全部交给插件管理器。
- **GitHub-only**：仓库检出到 `$DSH_HOME/plugin-sources/<owner>__<repo>`；若包声明的 `main` 不存在且声明了 `build` 脚本，则 `pnpm install` + `pnpm run build`，随后 `installBundle('link:<pkgDir>')`。已经构建过的检出会直接复用。
- **显式 spec**（`github:` / `link:` / `file:` / `http(s)`）：原样交给插件管理器。

## 目录缓存

- 位置：`$DSH_HOME/cache/plugin-resolver/catalog.json`
- 默认 TTL 12 小时，`refresh: true` 强制刷新
- 来源优先级：npm 包 `dsh-plugin-catalog`（`dist.tarball` 跟着镜像走）→ 配置的 `catalogUrl` → `awesome-dsh-plugin.com/plugins.json`

## 配置（可选）

挂载行上可写：

```yaml
- id: plugin-resolver
  name: 'dsh-plugin-resolver'
  config:
    registry: 'https://registry.npmmirror.com'   # 安装/元数据默认 registry
    catalogUrl: 'https://awesome-dsh-plugin.com/plugins.json'
    catalogTtlMs: 43200000
    githubProxy: 'https://gh-proxy.com'           # 直连 codeload 失败时的前缀代理
```

## 测试

```sh
node test/selftest.mjs   # semver 子集 / 版本选择 / spec 解析 / 目录检索（离线）
node test/harness.mjs    # 用假 Cordis ctx + 假 pluginManager 驱动真实工具体（含一次联网解析）
```

## 已知限制

- 兼容性判断依据 npm 元数据里的 peer/engines；宿主启动预检若还看别的字段，仍以宿主为准。
- GitHub 源码构建依赖本机 `pnpm`（优先 `$DSH_HOME/.desktop-bin/pnpm*`）与 `tar`；大仓库首次构建较慢。
- 目录是社区维护的第三方列表，条目质量不齐；`plugin_install` 只保证"按声明的来源装对版本"，不做安全审计。
- 没有客户端 UI：同名消歧通过 `owner` 参数或完整 spec 表达。
