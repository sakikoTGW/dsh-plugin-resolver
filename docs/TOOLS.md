# 四个工具

| 工具 | 作用 | 是否改动环境 |
|---|---|---|
| `plugin_search` | 搜社区目录，npm 载体优先，排序并标出同名歧义 | 只读 |
| `plugin_resolve` | 只解析不装：目录条目、兼容版本、registry、是否需要源码构建 | 只读 |
| `plugin_install` | 完整安装：选版本、安装或构建、回读校验、给下一步 | 写 profile |
| `plugin_status` | 已装 bundle、loader entry、fiberPhase 盘点 | 只读 |

只有 `plugin_install` 会写环境。同名歧义会返回全部候选，由调用方给 `owner=` 或完整 spec。
