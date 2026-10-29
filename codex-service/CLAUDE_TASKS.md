# 国内 Claude Code 任务

任务中心顶部的执行引擎可选择 `Codex · 美国 VPS` 或 `Claude Code · 国内 VPS`。
直接入口是 `#claude-tasks`、`#claude-api` 和 `#claude-info`。两个引擎分别保存窗口、
草稿和原生会话，沿用同一任务中心访问密钥。关闭浏览器不会停止服务器上的任务。

国内任务使用官方 Claude Code 稳定版 2.1.308 和官方 Python Agent SDK 0.2.163。
客户端二进制与官方 `manifest.json` 中的 linux-x64 SHA256 一致：
`356733f185fa988e6bf3aa9a555269fdd167982a2e2a80d3c8a78037bb92ad58`。
使用原版 `claude_code` 系统提示、完整默认工具和 user/project/local 配置加载，
没有 `--bare`、工具裁剪或聊天专用提示注入。原生记录按任务窗口独立保存。

供应商地址与 API 密钥由美国现有 Codex 配置只读同步到国内，国内独立加密保存。
在 Codex API 页面管理共用供应商；在 Claude Code API 页面单独保存 Claude 模型、
推理强度和默认供应商。修改 Claude 选项不会修改 Codex 的模型或任何订阅凭据。
Any 默认选择 `claude-opus-5-5[1m]`，选择其 Opus 5.5 时会保留用户要求的百万上下文选项。
模型列表读取供应商公布的名称，可手动填写其支持的完整模型名和 `[1m]` 上下文选项；
列出模型不代表上游当前有可用容量。

国内终端可由 `ckcodex` 用户运行 `claude-any`，进入同一个官方原版客户端。
它使用 Any API 配置和独立终端会话目录，任务工作目录为 `/home/ckcodex/workspace`。
此 API 入口不执行官方账号登录或客户端自行升级，版本由独立安装维护。

追加指令先排队，在当前回复结束后沿用同一原生会话处理。停止会取消原生客户端和
正在执行的工具，保留原生上下文；关闭/重新打开保留会话，删除同时移除该窗口的
面板记录和原生会话。服务重启标记正在执行的任务为中断，不重放可能已完成的操作。
定时任务使用已有持久队列；等待回答时保留问题，面板回答后继续。

## 部署位置

- 国内 `ck-api-proxy.service`：`127.0.0.1:19009`，仅连接既有美国 REALITY 节点。
  使用应用代理，无 TUN、全局路由或 DNS 改动，无直连后备线路。
- 国内 `ck-claude-tasks.service`：`127.0.0.1:19010`，状态在 `/var/lib/ck-claude-tasks`。
  Caddy 的 `/claude-tasks/*` 转发到此服务，公开地址为 `https://123.57.175.84:18443/claude-tasks`。
- 美国 `ck-claude-provider-sync.service`：每 5 秒检查共用供应商配置，变更通过既有 SSH
  标准输入发送。同步状态在 `/var/lib/ck-claude-provider-sync/status.json`，不记录密钥。

这些进程独立于国内聊天 bridge、美国 Codex 后端及美国订阅服务。
美国订阅的固定 IPv4 出口与防火墙保护必须始终保留；本任务服务不使用订阅账号。

## 验证与维护

`python3 -B tests/claude-tasks.test.py` 验证配置同步、独立模型设置、幂等任务和问题协议。
`tests/claude-native.test.py` 连接本地模拟 API；应在仅含回环网卡的网络命名空间中运行，
使用独立临时状态，不调用真实供应商。它验证实际原生工具执行、续接、追加、提问、
停止和模型列表过滤。`tests/claude-ui.test.js` 使用本地模拟端点验证双引擎交互。

安装或升级仅替换 `/opt/ck-claude-tasks` 的对应文件，并在任务空闲时重启新任务服务。
不要用这套任务程序覆盖已有 `/opt/ck-claude` 聊天接入层，也不要重启美国订阅或 Codex。
备份只留发起任务的 VPS，一个任务单元；代码和官方二进制保留 Git/发布校验引用，
配置只备份受影响片段。
