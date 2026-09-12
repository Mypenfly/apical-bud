# 文档组织规范

这份规范被 `scripts/gate.mjs` 逐条检查。**标题与字段名是契约**：写错一个字（例如用半角括号）门禁就判缺失。规则不多的原因是每条都得能被机器验证；不能被验证的规范只会变成装饰。

## 1. 讨论根

固定在仓库顶层的 `design/<slug>/`，`<slug>` 用 ASCII kebab-case（例：`paper-ink-ui`）。一次讨论一个目录；同名目录再次讨论就换 slug。创建命令（把 `<skill>` 换成本 skill 所在目录）：

```bash
mkdir -p design/<slug>/{seed,layers,derivation,concept,tech,questions,decisions,rounds,audit}
cp <skill>/templates/state.json design/<slug>/state.json
cp <skill>/templates/README.md design/<slug>/README.md   # 然后改 topic / slug
```

`state.json` 的 `slug` 必须等于目录名，`topic` 必须非空——这是门禁的第一步检查。

```
design/<slug>/
  README.md                  人读入口：一句话现状 + 这棵树的状态（每轮更新）
  state.json                 机读状态：阶段/轮次/门禁记录/裁决（唯一进度真相）
  glossary.md                术语表（[确认]/[提案]，S1 起必备）
  seed/
    R-000-original.md        用户原话，永不修改
    real-need.md             ★ 种子：一句话真实需求 + 被否的表述 + 非目标
  layers/
    L-00N-<slug>.md          需求层（根系）
  derivation/
    N-00N-<slug>.md          推演节点（主干）；淘汰的节点保留
  concept/
    concept.md               ★ 顶芽：核心理念
    extensions.md            ★ 侧枝：延伸
  tech/
    criteria.md              S6：判据（先锁版）
    options.md               S6：候选方案
    selection.md             ★ 果实：选型定稿
    probes/                  E2 实测原型（一次性取证产物）
  questions/                 Q-00N 待决问题
  decisions/                 D-00N 决策
  rounds/                    round-001.md …（编号连续）
  audit/
    challenges.md            异议记录（含被驳回的）
    verdict.md               项目裁决：继续/转向/终止
    gates.log                门禁运行日志（工具追加，不要手写）
```

**按需创建**：某个阶段用不到的文件不要建空壳。门禁只检查当前阶段出口所需的文件。

## 2. ID 体系

| 前缀 | 含义 | 位置 | 说明 |
|---|---|---|---|
| `R-000` | 用户原话 | `seed/` | 固定编号，只有一个 |
| `L-` | 需求层 | `layers/` | 每个一个文件，`parent` 指向 `seed` 或另一个 `L-` |
| `N-` | 推演节点 | `derivation/` | 每个一个文件，`from` 指向层或节点 |
| `D-` | 决策 | `decisions/` | 每个一个文件 |
| `Q-` | 待决问题 | `questions/` | 每个一个文件，`blocking` 指向阶段 |
| `E-` | 延伸（侧枝） | `concept/extensions.md` | 文件内 `##` 小节 |
| `K-` | 选型判据 | `tech/criteria.md` | 文件内小节 |
| `O-` | 候选方案 | `tech/options.md` | 文件内小节 |
| `X-` | 异议 | `audit/challenges.md` | 文件内小节 |
| `V-` | 裁决 | `audit/verdict.md` | 文件内小节 |

规则：ID 全局唯一（门禁检查跨目录重复）；**不复用已删除的编号**；三位数字递增。

## 2.5 落盘时机（先讨论，再留痕）

| 时机 | 允许写什么 |
|---|---|
| 用户答复之前 | **什么都不要写**（讨论根尚未建立时的 `state.json`/`README.md` 引导，以及 `seed/R-000-original.md` 的原话记录除外） |
| 拿到用户答复之后 | 本轮谈定的内容：层、推演节点、决策、术语，以及对应的轮次纪要 |
| 用户明确要求出文档 | 按用户说的写 |
| 补机械记录 | 轮次纪要、`state.json`、`audit/`（账本类，任何时候都可写） |

判据：**如果用户必须打开某个文件才能回答我的问题，就是违规。** 提案与选项的正文属于对话，不属于文件。DSH preset 的写守卫会拒绝「答复之前新建讨论文件」的写入。

## 3. frontmatter

只支持扁平键值（`key: value`、`[a, b]` 内联数组、`true/false`、数字、引号字符串）。嵌套结构不支持——一份文档只做一件事。

### 种子 `seed/real-need.md`

```yaml
kind: seed
status: confirmed     # draft | confirmed
statement: <≤80 字的一句话真实需求>
updated: YYYY-MM-DD
```

### 层 `layers/L-00N-*.md`

```yaml
id: L-001
title: <这一层问什么>
parent: seed          # seed | R-000 | L-00N（必须存在）
status: confirmed     # draft | confirmed
confirmed: true       # 用户是否确认过这一层
updated: YYYY-MM-DD
```

### 推演节点 `derivation/N-00N-*.md`

```yaml
id: N-001
title: <推出来的主张>
from: [L-001]         # 一个或多个：L-00N / N-00N，必须存在
status: kept          # kept | dropped
evidence: 无           # E1 | E2 | E3 | 无
updated: YYYY-MM-DD
```

### 问题 / 决策

```yaml
# questions/Q-00N-*.md
id: Q-001
title: <疑问句>
status: open          # open | closed
blocking: S1          # S0..S7

# decisions/D-00N-*.md
id: D-001
title: <陈述句>
status: proposed      # proposed | accepted | rejected | superseded
sources: [L-001]      # accepted 时必须有来源（R-000/L-/N-），否则 assumption: true
assumption: false
dissent: false        # true = 我反对过、用户坚持
supersedes:
```

### 其他文档

`concept.md`：`kind: apical` + `status: draft|final` + `stage`。
`criteria.md`：`status: draft|locked` + `locked_at: "YYYY-MM-DD HH:MM"`。
`options.md`：`created: "YYYY-MM-DD HH:MM"`（必须晚于 `criteria.md` 的 `locked_at`）。
`selection.md`：`status: draft|final`。
`extensions.md` / `challenges.md` / `verdict.md` / `glossary.md`：无强制 frontmatter。

## 4. 门禁要求的标题与字段（逐字）

| 文件 | 必须存在 | 必须有的字段行 |
|---|---|---|
| `seed/real-need.md` | `## 被否的表述`、`## 非目标` | `statement`（≤80 字）、`status: confirmed`；两节各 ≥1 条 |
| `layers/L-00N-*.md` | `## 分解理由`、`## 其他解读（被否）`、`## 判据`、`## 用户确认` | `parent`、`confirmed: true`、`status: confirmed`；解读与判据各 ≥1 |
| `derivation/N-00N-*.md` | `## 推演`；保留节点还需 `## 反例`；淘汰节点还需 `## 淘汰理由` | `from`、`status`、`evidence` |
| `concept/concept.md` | `## 核心概念（一句话）`、`## 关键名词`、`## 判据`、`## 边界`、`## 非目标`、`## 反例与失败边界`、`## 分层覆盖`、`## 淘汰的竞争节点`；S5 还需 `## 推演链`、`## 已知反对与回应` | 一句话 ≤100 字；关键名词 1–5 个且均为已确认术语；推演链从 `seed` 开始、逐跳合法、以 `N-` 收尾 |
| `concept/extensions.md` | `## E-00N <名>`（≥3 个） | `- 档位:`（必然/需求/猜测）；需求档 `- 来源:` |
| `tech/criteria.md` | `## K-00N <名>`（≥5 个） | `- 权重:`、`- 硬约束:`（是/否）、`- 来源:`（存在的 ID）；≥1 条硬约束 |
| `tech/options.md` | `## O-00N <名>`（≥2 个） | `- 证据:`（E1/E2/E3）、`- 推演来源:`（采纳/备选项必须是**保留**的 N-，淘汰项可以是任何存在的 N-）；淘汰者 `- 拒绝理由:` |
| `tech/selection.md` | `## 选定方案`、`## 判据对照`、`## 拒绝理由汇总`、`## 退出成本与迁移`、`## 未验证假设` | 五节均非空 |
| `audit/challenges.md` | `## X-00N <题>` | 每条 `- 结论:` |
| `glossary.md` | —— | `- **术语** [确认\|提案]：人话定义`；`[提案]` ≤1 个 |

括号用全角 `（）`，冒号全角半角均可，列表符号 `-` 或 `*` 均可。

## 5. 术语表规则（防"看不懂的术语墙"）

- 每个术语行：`- **术语** [确认]：一句人话定义`。定义少于 6 字视为没定义。
- **不能用未定义的术语解释自己**：定义里出现的其他术语，必须是术语表里**更靠前且已确认**的；否则改用平实说法。
- **`[提案]` 同时最多 1 个**（门禁阻塞项）：我提出、你还没确认的词不许堆积。
- **一轮最多引入 1 个新术语**（协议约束，非门禁）。
- **用户可以改写任何术语**：改写后全局替换，并在术语表的「曾用名」表里记一行。
- `concept.md` 的「关键名词」必须全部是已确认术语，最多 5 个。

## 6. 三条不变量

1. **append-only**：`seed/R-000-original.md` 与 `rounds/*` 只追加。改写它们等于篡改讨论史。
2. **决策只可取代、不可改写**：已 `accepted` 的决策要改内容，只能新建一个决策 `superseded` 它，并填 `supersedes:`。
3. **树不删枝**：淘汰的推演节点保留（`status: dropped` + 淘汰理由）；被否的分层解读保留在层文件的「其他解读（被否）」里。半年后，这些是"为什么不选另一条路"的唯一答案。

## 7. state.json

```json
{
  "schema": 1,
  "topic": "本次讨论主题",
  "slug": "paper-ink-ui",
  "stage": "S2",
  "round": 9,
  "gates": { "S1": { "state": "pass", "at": "2026-09-12 10:31", "missing": [] } },
  "verdict": { "status": "continue", "at": null, "note": "" }
}
```

- `round` 必须等于 `rounds/` 里的轮次文件数。
- `gates` 由门禁工具写；模型不手写。
- `stage` 与 `verdict.status` 只能通过 `apical_gate` 改动（写守卫会拒绝手改）。
- `verdict.status`：`continue | pivot | stop`；写 `stop` 后讨论停止推进阶段。

## 8. 手工跑门禁

```bash
node <skill>/scripts/gate.mjs --root design/<slug>            # 人类可读
node <skill>/scripts/gate.mjs --root design/<slug> --json      # 机器可读
node <skill>/scripts/gate.mjs --cwd .                          # 自动发现唯一的讨论根
node <skill>/scripts/gate.mjs --root design/<slug> --stage S5  # 用别的阶段视角检查
```

在 DSH 里更推荐用 `apical_gate` 工具（同一份逻辑，且是 `stage` 的唯一合法写入者）。

## 9. 常见错误

| 症状 | 原因 |
|---|---|
| `tree.connected` 报错 | 有保留节点的祖先链没通到种子——它是插进来的灵感，不是推演 |
| `tree.parents` 报错 | `from` / `parent` 指向了不存在的 ID，或写成了 `L-1`（必须三位：`L-001`） |
| `stage.S1.layers` 报"未经用户确认" | 忘了 `confirmed: true` 与 `status: confirmed` 一起改 |
| `stage.S1.layers` 报"缺少其他解读" | 只写了一种分法——分层也是解读，必须保留被否的那种 |
| `stage.S3.apical` 报"关键名词在术语表里不存在" | 一句话里用了自造词，但没进术语表或还是 `[提案]` |
| `stage.S3.apical` 报"这些层未被覆盖" | 每个 `L-` 层要么在「分层覆盖」里，要么在「非目标」里 |
| `glossary.pending` 报错 | `[提案]` 术语超过 1 个：先和用户逐个确认或删掉 |
| `stage.S5.final` 报"推演链断裂" | 「推演链」里的相邻两个节点，在文件里并不是父子关系 |
| `rounds.sequence` 报错 | 轮次文件跳号（例如从 round-003 直接到 round-005） |
| `! rounds.state-sync` 告警 | `state.round` 与轮次文件数不一致——机械记账，`apical_gate action=check` 会自动同步，不必手改，也不阻塞阶段 |
| `stage.S7.selection` 报"推演来源" | 候选方案的 `推演来源` 不是保留状态的 `N-` 节点 |
