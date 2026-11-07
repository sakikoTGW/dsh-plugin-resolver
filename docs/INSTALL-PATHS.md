# 安装路径与重启判定

- registry 包：`pluginManager.installBundle(name@resolved, { registry })`，profile、lockfile 和激活生命周期都交给插件管理器。
- GitHub-only：检出到 `$DSH_HOME/plugin-sources/<owner>__<repo>`，缺构建产物且声明了 `build` 时执行 `pnpm install` + `pnpm run build`，随后 `installBundle('link:<pkgDir>')`；已构建的检出直接复用。
- 显式 spec（`github:` / `link:` / `file:` / `https:`）：原样交给插件管理器。

`plugin_install` 比较安装前后的 `listBundles()` 集合与运行时文件 hash（排除 README、docs、版本号），新增 bundle 以管理器的应用结果为准。

| 变化 | 结果 |
|---|---|
| 无变化 / 仅版本号 / 管理器就地应用（含新增 bundle 的 HMR 重组合） | `restart: not required` |
| 管理器要求重启（bundle 新增、运行时代码变化、client 半变化） | `restart: required — <原因>` |
| 带 client 半的新插件 | 额外提示刷新 GUI |
