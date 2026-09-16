# apical-bud · DSH agent preset（顶芽模式）

这是 [apical-bud](../SKILL.md) 方法论在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）上的**会话装配层**。方法论本体是上面那层 skill：它只规定两件事——文件怎么组织、词怎么用，没有阶段也没有门禁。这一层因此也很薄，只做三件事：

1. 让"讨论不实现"成为机制（写守卫），而不是提示词里的请求；
2. 让体检随手可达（`apical_check` 调用 skill 的 `scripts/check.mjs`）；
3. 让进度不用靠记忆（每轮一行的状态横幅，内容从文件读出来）。

它只对 DSH 有效；在 Claude Code 等宿主里只装 skill 即可。

## 这一层多给了什么

| 文件 | 作用 |
|---|---|
| `agent.cordis.yml` | persona（≈42 行：身份、**对话是介质/文件是留痕**、**推演纪律**（每一步都由上一步生出来；不要请用户吐槽现有系统）、八样文件与机器生成的 `map.md`（`facts.md` **只收外部信息**）、一个推演点录什么、用语、提问形态（不做用户体验调查；问不到人时给候选继续推）、开工先读 `map.md`）+ 原样的工具集 + 本 preset 的本地插件行 |
| `apical-check.mjs` | 注册 `apical_check`：`check`（跑 skill 的 `scripts/check.mjs`，把缺件与警告念给模型）/ `map`（生成并回显 `map.md`）/ `trees`（列出项目里的全部讨论根，含旧形状）。它不判阶段、不推进、不拦讨论 |
| `apical-guard.mjs` | 单调写守卫 + 每轮一行状态横幅：`write`/`edit` 只放行讨论根（`design/<slug>/` 以内；`design/` 顶层的散文件不属于任何树，同样拒绝）；`seed.md` 的 `## 用户原话` 只追加（改写＝篡改讨论史）；横幅给出核心问题、推演点计数（进行中/已结/悬置）、事实数、顶芽状态、选型状态、上一次体检结果 |
| `lib/apical-tree.mjs` | 两个插件共用的同步读取：守卫必须在工具执行前同步判定，横幅每轮只读几个小文件；`scripts/check.mjs` 只由工具按运行时解析到的路径加载，这一层不复制它的逻辑 |
| `selftest.mjs` | 零依赖自检：mock Cordis 上下文挂载两个插件，73 项断言，覆盖守卫边界（含 `design/` 顶层散文件被拒、`allowPaths` 放行）、用户原话只追加、UNLOCK、横幅内容、`check`/`map`/`trees`、旧形状不崩不拦、体检脚本解析的各条回退 |

**删掉了什么**（与旧流程一起删的）：阶段机与 `apical_gate`（`advance` / `verdict` / `bind` / `status`）、`state.json` 及其不变量、"答复之前不许新建讨论文件"守卫、轮次纪要与全量重判。文件回到"推演与论证的记录"的位置：写早写晚都不再是违规；哪一步推到哪儿，由 `map.md` 读出来。

安全边界说明：它是**防手滑**，不是安全沙箱——`bash` 仍可写文件（persona 禁止，沙箱策略兜底）。要更严就同时禁 `bash` 或收紧宿主沙箱。

## 安装

```bash
# 1) 装 skill（若还没装）
git clone git@github.com:Mypenfly/apical-bud.git ~/.dsh/skills/apical-bud

# 2) 装 preset（本目录）
~/.dsh/skills/apical-bud/dsh-preset/install.sh
```

`install.sh` 会把本目录复制到 `$DSH_HOME/.agent-presets/apical-bud/`。名单**不跟随符号链接**，所以这里装的是真实副本；`git pull` 之后重新跑一次即可刷新。

装好后新开会话，在 preset 选择器里选「顶芽模式」。自检（不需要 PATH 上有 node 之外的任何东西）：

```bash
node ~/.dsh/.agent-presets/apical-bud/selftest.mjs
```

## 旋钮

| 位置 | 作用 |
|---|---|
| `agent.cordis.yml` → `apical-guard.config.base` | 讨论根所在的基目录（默认 `design`）：写守卫只放行 `<base>/<slug>/` 以内的路径 |
| `agent.cordis.yml` → `apical-guard.config.allowPaths` | 额外放行的可写路径前缀（cwd 相对） |
| `agent.cordis.yml` → `apical-guard.config.banner` | 设为 `false` 关掉每轮的状态横幅 |
| `agent.cordis.yml` → `apical-check.config.checkScript` | 显式指定 skill 的 `scripts/check.mjs` |
| 环境变量 `APICAL_CHECK_SCRIPT` | 同上，不用改配置文件（旧名 `APICAL_GATE_SCRIPT` 仍作回退） |

体检脚本的解析顺序：`checkScript` → `APICAL_CHECK_SCRIPT` → `APICAL_GATE_SCRIPT`（旧名回退）→ 技能注册表给出的 skill 目录 → `$DSH_HOME/skills/<name>` → `$DSH_AGENTS_HOME/skills/<name>` → 仓库布局的上级目录 → 已安装布局的 `../../skills/<name>` → 会话工作目录下的 `.dsh/skills` 与 `.agents/skills`。全都命中不了时，工具会**逐条列出试过的路径与注册表的答复**，而不是只说一句「找不到」；守卫与横幅不受影响，照常工作。

## 逃生阀

| 方式 | 作用 |
|---|---|
| 环境变量 `DSH_APICAL_UNLOCK=1` | 临时解除写守卫（给用户用的，不是给模型用的）：整个会话的 `write`/`edit` 不再受讨论根限制 |
| `apical-guard.config.allowPaths` | 长期放行某些路径前缀，例如 `["notes/"]`（不受"必须在 `<base>/<slug>/` 里"这条约束） |

`seed.md` 的 `## 用户原话` 只追加这条规则同样受 `DSH_APICAL_UNLOCK=1` 影响；关掉守卫时它一并解除。

写守卫放行的是**讨论根内部**：`design/notes.md` 这种 `design/` 顶层的散文件不属于任何讨论根，也会被拒。新建一棵树的入口（`design/<slug>/seed.md`，目录还不存在也算）与 `apical_check map` 写的 `design/<slug>/map.md` 都在讨论根里，不受影响。
