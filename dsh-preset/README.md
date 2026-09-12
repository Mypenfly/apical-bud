# apical-bud · DSH agent preset

这是 [apical-bud](../SKILL.md) 方法论的**会话装配层**：让"讨论不实现""阶段不可自证""状态不靠记忆"从提示词里的请求变成机制。它只对 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）有效；方法论本体是上面那层 skill，在 Claude Code 等宿主里只装 skill 即可。

## 这一层多给了什么

| 文件 | 作用 |
|---|---|
| `agent.cordis.yml` | 常驻 persona（三条承重规则、阶段机、调研的从属地位、术语纪律、质疑与否决条款）+ 裁剪过的工具集 + 本 preset 的本地插件行 |
| `apical-gate.mjs` | 注册 `apical_gate` 工具：`status` / `check` / `advance` / `verdict`。它是 `state.json.stage` 的**唯一合法写入者**，出口条件不通过就拒绝推进（含从种子到顶芽的推演链回溯） |
| `apical-guard.mjs` | 单调写守卫 + 每轮状态横幅：`write`/`edit` 只允许写讨论根；**答复之前不许新建讨论文件**（对话是介质、文件是留痕）；用户原话与既有轮次纪要只追加；`state.json.stage`/`verdict` 不许手改；横幅每条用户消息注入一次真实进度（阶段、树规模、待确认术语、门禁结果） |
| `lib/apical-state.mjs` | 两个插件共用的同步状态读取（守卫必须在工具执行前同步判定） |
| `selftest.mjs` | 零依赖自检：mock Cordis 上下文挂载两个插件，跑 45 项断言（含 S0→S7 全程推进、孤儿节点、断链、术语墙、append-only） |

安全边界说明：它是**防手滑**，不是安全沙箱——`bash` 仍可写文件（persona 禁止，沙箱策略兜底）。要更严就同时禁 `bash` 或收紧宿主沙箱。

## 安装

```bash
# 1) 装 skill（若还没装）
git clone git@github.com:Mypenfly/apical-bud.git ~/.dsh/skills/apical-bud

# 2) 装 preset（本目录）
~/.dsh/skills/apical-bud/dsh-preset/install.sh
```

`install.sh` 会把本目录复制到 `$DSH_HOME/.agent-presets/apical-bud/`。名单**不跟随符号链接**，所以这里装的是真实副本；`git pull` 之后重新跑一次即可刷新。

装好后新开会话，在 preset 选择器里选「顶芽模式」。自检：

```bash
node ~/.dsh/.agent-presets/apical-bud/selftest.mjs
```

## 旋钮

| 位置 | 作用 |
|---|---|
| `agent.cordis.yml` → `apical-guard.config.base` | 讨论根所在目录（默认 `design`） |
| `agent.cordis.yml` → `apical-guard.config.allowPaths` | 放行额外可写路径前缀 |
| `agent.cordis.yml` → `apical-gate.config.gateScript` | 显式指定 skill 门禁脚本路径 |
| 环境变量 `APICAL_GATE_SCRIPT` | 同上，但不用改配置文件 |

门禁脚本的解析顺序：`gateScript` → `APICAL_GATE_SCRIPT` → 技能注册表给出的 skill 目录 → `$DSH_HOME/skills/<name>` → `$DSH_AGENTS_HOME/skills/<name>` → 仓库布局的上级目录 → 已安装布局的 `../../skills/<name>` → 会话工作目录下的 `.dsh/skills` 与 `.agents/skills`。全都命中不了时，工具会**逐条列出试过的路径与注册表的答复**，而不是只说一句「找不到」。
| 环境变量 `DSH_APICAL_UNLOCK=1` | 临时解除写守卫（给用户用的，不是给模型用的） |
