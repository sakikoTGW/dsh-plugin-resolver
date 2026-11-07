# 已知限制

- 兼容性判定对齐宿主 `dsh-app-boot` 的预检规则：声明了 `engines.dsh` 只看它，否则所有 `@deepseek-ai/dsh*` peer 都算，含 optional；`workspace:^|~|*` 视作当前宿主。宿主精确版本豁免 `allow-version` 仍然优先。
- 替换已加载插件仍需要重启宿主（loader 模块缓存 + 打包宿主无 Node 内部 loader）。新增 bundle 只看管理器的应用结果：管理器就地应用（HMR 重组合）时不再报 `restart-required`，只有它自己要求重启时才报；带 client 半的新插件会额外提示刷新 GUI。
- 同名歧义不猜，需要调用方给 `owner=` 或完整 spec。
- 目录是社区维护的第三方列表，插件只保证按声明来源装对版本，不做安全审计。
- GitHub 源码构建需要 `pnpm` 与 `tar`：先找 `DSH_PNPM_PATH`（本插件约定，不是宿主契约），再找 PATH；宿主自带的 pnpm 未导出到 PATH，没有全局 pnpm 的机器需要先安装。大仓库首次构建较慢。
