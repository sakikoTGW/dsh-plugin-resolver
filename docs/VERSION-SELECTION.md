# 版本选择规则

1. 运行时版本取 `pluginManager.listBundles()` 里 `@deepseek-ai/dsh-base` 的版本。
2. 声明了 `engines.dsh` 的版本只看它，与宿主 `dsh-app-boot` 的预检一致，peer 不再参与。
3. 未声明 `engines.dsh` 时，所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer 都必须满足，含 optional；`workspace:^`、`workspace:~`、`workspace:*` 视作当前宿主。`@deepseek-ai/cordis`、`@deepseek-ai/schemastery` 这类同命名空间但不同版本线的库不算运行时约束；误把兄弟库当内核线曾把 4/8 个包误判成“无兼容版本”，见 [ABLATION](../ABLATION.md)。
4. 取第一个通过者。全不通过时列出最近版本的拒绝原因；显式给 `version` 时跳过求解。
