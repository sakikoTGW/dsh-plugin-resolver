# Brand assets

README 用的视觉资产，全部是矢量或可重生成文件，随仓库一起版本化。

| File | What it is | Where it is used |
|---|---|---|
| `logo.svg` | 图标 + 字标（浅色/深色背景都可读） | 其他物料、图标导出 |
| `logo-dark.svg` | 字标为浅色的版本，给纯深色背景用 | 深色海报 |
| `icon.svg` / `icon.png` | 64×64 应用图标（PNG 为 512×512） | 插件图标、社交头像 |
| `banner.svg` / `banner.png` | 1280×400 横幅：定位句 + 三个数字 + 真实调用终端卡片 | **README 首屏**、发布帖、幻灯片 |
| `social-preview.svg` / `social-preview.png` | 1280×640 社交预览图 | GitHub **Settings → Social preview** 上传 |
| `flow.svg` | 五阶段流程图：检索 → 解析 → 安装 → 校验 → 上报，含两条失败路径 | README「怎么工作」 |
| `architecture.svg` | 稳定壳 + 热加载逻辑的两层结构 | README「结构」 |
| `benchmark.svg` | 手工路径 vs 插件的四组基准条形图 | README「效果与证据」 |
| `flow.png` / `architecture.png` / `benchmark.png` | 上面三张图的 1:1 PNG 渲染 | 发布帖 / 不支持 SVG 的平台 |
| `demo.gif` | 真实 `npm test` 输出（34 项检查）的终端演示 | README 首屏 |
| `demo-resolve.gif` | 真实 `plugin_resolve` 调用的终端演示 | README「快速开始」 |
| `tool-search.png` / `tool-resolve.png` | 真实工具输出截屏（本地 harness 捕获） | README「四个工具」 |
| `market-dsso.png` / `market-dshbase.png` | dsh.so 与 dshbase 收录页截屏（2026-10-27） | README「市场收录」 |
| `market-dsh-gui.png` | DSH 桌面版 → 插件 → 发现（自定义索引源）截屏 | README「市场收录」 |
| `market-dsh-market.png` | DSH 设置 → 插件市场 → 发现（搜索 plugin-resolve）截屏 | README「市场收录」 |
| `icons/*.svg` | 四个工具的小图标（search / resolve / install / status） | README 工具表 |

> `demo.gif`、`demo-resolve.gif`、`tool-*.png` 都是从真实运行输出渲染的，不含手写的假数据；宿主版本与捕获日期写在 README 的图注里。

## 重新生成

PNG 由同名 SVG 渲染（`icon.png` 放大到 512×512；字体用系统 UI 字体与 Consolas）。`demo.gif` 用 [VHS](https://github.com/charmbracelet/vhs) 重录：

```sh
vhs demo/demo.tape
```

## 颜色

| Token | Value | Use |
|---|---|---|
| Brand blue | `#4D6BFE` | 图标渐变、字标、徽章 |
| Deep blue | `#2A3FD0` | 渐变末端 |
| Ink | `#0B1020` | 深色背景 |
| Green | `#2FBF71` | 成功 / checks 徽章 |
