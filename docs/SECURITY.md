# 反馈与安全

- 一般问题、功能建议：https://github.com/sakikoTGW/dsh-plugin-resolver/issues
- 安全问题：走 GitHub Security → Advisories → Report a vulnerability，私密报告，不要开公开 Issue。
- 发布流程与清单：见 [PUBLISHING.md](../PUBLISHING.md)。

## 边界

- 读取：仓库内文件、`git status/log/tag`。
- 写入：仅在 `plugin_install` 时改 profile、lockfile 和 plugin-sources。
- 网络：社区目录、npm registry、GitHub 源码。
- 第三方目录由社区维护，插件保证按声明来源装对版本，不做安全审计。
