# apical-bud · DSH agent preset（顶芽模式）

这是 [apical-bud](../SKILL.md) 方法在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）上的会话装配层。方法本体是 skill：它规定怎么推、怎么记、怎么实现。这一层只做三件事：

1. 让"推演不写生产代码"成为机制（写守卫），不靠提示词请求；
2. 让历史不被改写（`seed.md` 的 `## 用户原话` 只追加）；
3. 让进度不用靠记忆（每轮一行状态，内容从 `seed.md` 与 `flow.md` 读出来）。

它只对 DSH 有效；在 Claude Code 等宿主里只装 skill 即可。

## 这一层有什么

| 文件 | 作用 |
|---|---|
| `agent.cordis.yml` | persona：只放每轮都必须记得的——六层优先级各一行、开工读 `SKILL.md`、每轮只推一个动作或一个缺口、没认下的不写、压缩后先复述现状。方法本体在 skill，这里不抄第二份 |
| `apical-guard.mjs` | 写守卫 + 每轮一行状态横幅：守卫只放行讨论根 `design/<slug>/`（顶层散文件同样拒绝），`seed.md` 的「用户原话」只追加；横幅给核心问题、现状一行、缺口数、边界三问是否填齐 |
| `smoke.mjs` | 零依赖自检：挂一个假 Cordis 上下文，测守卫边界、`allowPaths`、`DSH_APICAL_UNLOCK`、用户原话只追加、横幅内容与变化检测、无树时的入口提示 |
| `install.sh` | 装到 `$DSH_HOME/.agent-presets/apical-bud/`（真实副本，名单不跟随符号链接） |
| `preset.yml` | 名单里的名字与描述 |

**v2 删掉了什么**：`apical_check` 工具与它调用的 66 KB 体检脚本、47 KB 自检、工具生成的 `map.md`。方法的硬项只剩四条——种子有主链恰一条、flow 有一条完整路径、边界三问填齐、现状是新的——肉眼可验。检查器的维护与误报成本超过它抓到的问题。

## 安装

```bash
# 1) 装 skill（若还没装）
git clone git@github.com:Mypenfly/apical-bud.git ~/.dsh/skills/apical-bud

# 2) 装 preset（本目录）
~/.dsh/skills/apical-bud/dsh-preset/install.sh
```

装好后新开会话，在 preset 选择器里选「顶芽模式」。自检：

```bash
node ~/.dsh/.agent-presets/apical-bud/smoke.mjs
```

## 旋钮

| 位置 | 作用 |
|---|---|
| `agent.cordis.yml` → `apical-guard.config.base` | 讨论根所在的基目录（默认 `design`） |
| `agent.cordis.yml` → `apical-guard.config.allowPaths` | 额外放行的可写路径前缀（cwd 相对），长期放行项目目录用 |
| `agent.cordis.yml` → `apical-guard.config.banner` | 设为 `false` 关掉每轮状态横幅 |

## 同会话实现

推演的终点是"按动作链切的最小实现"。工程量小的（切片 ≤2、零新增依赖、一次写完能看见）可以在推演会话里直接做，工程量大的换标准模式会话按切片清单做。

同会话实现时，写守卫默认还拦 `design/` 之外。两种做法任选：

- 在宿主环境设 `DSH_APICAL_UNLOCK=1`（只对那次会话生效，一次性）；
- 或在 `allowPaths` 里长期放行项目目录。

选哪条记进 `flow.md` 的现状一行。

## 安全边界

它是**防手滑**，是安全沙箱的补充——`bash` 仍可写文件（persona 禁止，沙箱策略兜底）。要更严就同时收紧宿主沙箱。
