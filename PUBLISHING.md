# 发布清单（对齐 DSH 官方文档）

依据官方仓库 `deepseek-ai/deepseek-harness`：

- [`docs/user/develop/basic/publish.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md) —— 打包与安装插件（bundle manifest、engines.dsh、git 安装的 `prepare` 坎）
- [`docs/user/guide/plugin-market.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.zh.md) —— 官方插件市场索引格式

## 一、官方硬性要求 vs 本仓库

| 要求 | 官方要点 | 本仓库状态 |
|---|---|---|
| 声明 `dsh.bundle.patch` | 没有 `dsh.bundle` 仍可安装，但只作为普通依赖、**会被警告且不激活任何层** | ✅ `package.json` + `cordis.patch.yml` |
| patch 用**包名**引用自身 | 行里写相对源码路径的话，Node 解析找不到已安装的代码 | ✅ `name: 'dsh-plugin-resolver'` |
| 声明 `engines.dsh` | 安装与 profile 启动会**拒绝**不满足范围的组合包；缺省时退回检查 `@deepseek-ai/dsh*` peer 范围 | ✅ `>=0.2.0-rc.2 <0.3.0` |
| 与宿主共享实例的 dsh 包要同时进 `peerDependencies` + `devDependencies` | 保证运行时用宿主那份 | ✅ 本插件不 import 任何宿主包（只用 `ctx.get()` 动态取服务），无需 peer |
| npm 发布应带**预构建产物** | 用户装到的是发布产物，不是源码 | ✅ 纯 ESM，无构建步骤 |
| git 安装必须提供 `prepare` 脚本 | git 安装拉的是**源码**，不会跑 build；TS 包会没有 `lib/` 而加载失败 | ✅ 不适用（无构建）；因此用户也**不需要** `allowBuilds` 授权 |
| 版本标签 | 官方市场生成器按 `vX.Y.Z` / `X.Y.Z` / `<name>@X.Y.Z` 识别版本 | ✅ `v0.1.0` |
| 市场索引的 `engines.dsh` 与包一致 | 索引版本字段应等于包声明；不一致会被安装时再次拒绝 | ✅ 一致 |
| 安全边界 | `allowBuilds` = 允许该包代码在安装时于本机执行；git 安装应锁 commit；`http:` 索引可被中间人改 | 本插件无 install/prepare 脚本，风险面最小；建议始终锁 commit |

## 二、发布方式（三选一）

1. **npm（官方推荐）—— ✅ 已发布 `dsh-plugin-resolver@0.1.0`（2026-10-18 01:51 +08，`latest` 已指向 0.1.0）**
   ```sh
   dsh plugin --profile <profile> add dsh-plugin-resolver
   ```
   注意：npm 已 GA **staged publishing**（npm CLI ≥ 11.15 才有 `npm stage`）。首次发布时 registry 先出现 `0.0.0-stage` 占位版本，0.1.0 处理完成后自动变成 `latest`；后续发版建议升级 npm 并用 `npm stage publish` + `npm stage approve`（approve 需要人工 2FA）。

2. **GitHub 源码安装**（本仓库无构建步骤，所以不需要 `prepare`，也不需要用户授权构建）
   ```sh
   dsh plugin --profile <profile> add github:sakikoTGW/dsh-plugin-resolver#<40位commit>
   ```
   建议锁 commit（官方安全建议：避免后续 push 悄悄改变实际运行内容）。

3. **Tarball**（不需要任何构建权限）
   ```sh
   npm pack
   dsh plugin --profile <profile> add ./dsh-plugin-resolver-0.1.0.tgz
   ```

## 三、进官方插件市场（可选）

DSH **没有中心索引**：市场是一个自托管的 JSON 索引文件，用户在 `插件 → 发现 → 添加索引源` 里填 URL（需先打开实验性的**自定义插件市场**组合包）。本仓库提供了 [`market/index.json`](market/index.json)，并已：

- ✅ 用官方校验器 `@deepseek-ai/dsh-plugin-market-index@0.2.1-alpha.4` 的 `parseMarketIndex` 校验通过
- ✅ 用官方 `marketInstallTarget` 复核安装 spec：`dsh-plugin-resolver@0.1.0`（npm 源）
- ✅ 通过 GitHub Pages 托管：**https://sakikoTGW.github.io/dsh-plugin-resolver/market/index.json**（页面 200，直出 JSON）

索引规则要点（违反任意一条会**整个索引被拒**，并显示违规值的 JSON 路径）：

- `format: 1`；`plugins[]` 必填，`name` 在索引内唯一
- `versions[]` 至少一个，每项必填 `version`（精确 SemVer）、`publishTimestamp`（Unix 秒）、`source`
- `source` 为 `{ "type": "npm", "registry"?: url }` 或 `{ "type": "git", "url": https-url, "commit": 40位SHA, "path"?: 目录 }`
- 版本可选 `engines.dsh`，应与包自身一致
- 图标可选：内联 `data:` URL（≤32 KiB）或 URL；标题/描述/作者/主页/repository 都可选
- DSH 只校验**格式**，不验证市场声明；`http:` 索引可被网络中间人修改，建议 `https:`

把 `market/` 目录放到任意静态主机（GitHub Pages / GitLab Pages / 对象存储）即可，相对图标相对索引 URL 解析。

## 四、收录状态

| 渠道 | 机制 | 状态 |
|---|---|---|
| **[dsh.so](https://www.dsh.so/submit/)** | 网页表单：拉取 → 格式校验 → 安全扫描 → 生成 registry 条目 → 提交审核 | ✅ **已提交**（2026-10-18 02:25 +08）：格式校验全 Pass（public repo / README / MIT / `dsh` manifest / id 合法），页面显示 `✓ Submitted` |
| **[dshbase](https://dshbase.com/)** | 提 issue → 人工审核收录；自动路径只收 topic 中 ★≥100 的仓库 | ✅ 已提交 [ylwl1997/dshbase#161](https://github.com/ylwl1997/dshbase/issues/161)，待审核 |
| **[awesome-dsh-plugin](https://github.com/billLiao/awesome-dsh-plugin)** | 脚本按 GitHub topic 自动收集 + 生成分类；也接受 PR | ✅ PR [billLiao/awesome-dsh-plugin#20](https://github.com/billLiao/awesome-dsh-plugin/pull/20)（另：topic 自动同步也会收录） |
| **dshfind / dshplugin.store / DSH Plugin Radar** | 每日同步 GitHub topic `dsh-plugin`，无需提交 | ✅ 条件已满足（公开仓库 + topic + `dsh.bundle` + LICENSE），一天内自动出现 |
| **官方插件市场** | 自托管 JSON 索引（format 1） | ✅ 本仓库 `market/index.json`（GitHub Pages 托管，官方校验器通过） |

## 五、当前待办

- [x] 索引格式 1 通过官方校验器；GitHub Pages 已托管 `market/index.json`
- [x] `v0.1.0` 标签已打（官方市场生成器按 `vX.Y.Z` 识别版本）
- [x] npm 发布 `dsh-plugin-resolver@0.1.0`（`latest` = 0.1.0）
- [x] 市场索引已切到 npm 源（官方推荐）
- [x] dsh.so 提交（格式校验 Pass，`✓ Submitted`）
- [x] dshbase issue、awesome-dsh-plugin PR 已提交
- [ ] 等 dsh.so / dshbase 审核与 awesome PR 合并（自动渠道 1 天内自行收录）
