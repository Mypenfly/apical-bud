# 文档组织规范

这份规范被 `scripts/gate.mjs` 逐条检查。**标题与字段名是契约**：写错一个字（例如用半角括号）门禁就判缺失。规则不多的原因是每条都得能被机器验证；不能被验证的规范只会变成装饰。

## 1. 讨论根

讨论树固定在仓库顶层的 `design/<slug>/`，`<slug>` 用 ASCII kebab-case（例：`paper-ink-ui`）。

**一个项目可以有多棵树**——不同需求、不同阶段各一棵，这很正常：

- **一个会话绑定一棵树**：`apical_gate action=bind slug=<slug>`。项目里只有一棵树时自动推断；有多棵且未绑定时，工具与横幅会先让你绑定，而不是猜。
- **一棵树结束就开新树**：S7 定稿或裁决终止之后，不要在旧树上长新需求——新建 `design/<新-slug>/`，并用 `state.json` 的 `dependsOn` 与 `relation` 记录两棵树的关联（也见下方「与已有树的关系」）。
- **切换**用 `bind`；`apical_gate action=trees` 列出全部树及其生命周期（进行中 / 已到 S7 定稿 / 已终止）。
- 同一个 slug 不要用来开第二次讨论——历史要被读得懂，就别覆盖它。

创建命令（把 `<skill>` 换成本 skill 所在目录）：

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
    L-00N-<slug>.md          需求层（根系）：一个词的哪一项，由用户认领
  derivation/
    N-00N-<slug>.md          推演节点（主干）：kind: 候选 | 定论；淘汰的节点保留
  concept/
    need.md                  ★ 需求定稿：第一跳的产物，用户能指着说"就是这个"
    concept.md               ★ 顶芽：唯一的理念概念（气质/姿态，可解释、能生成）
    extensions.md            ★ 侧枝：M- 机制命题（可证伪，落为选型限制）+ E- 概念延伸（档位）
  tech/
    criteria.md              S6：判据（先锁版；来源含 M-00N）
    options.md               S6：候选方案
    selection.md             ★ 果实：选型定稿
    probes/                  E2 实测原型与结果（一次性取证产物）
    handoff-<主题>.md        交给用户的实验交接（含可直接复制的提示词）
  questions/                 Q-00N 待决问题
  decisions/                 D-00N 决策
  rounds/                    round-001.md …（编号连续）
  audit/
    challenges.md            异议记录（含被驳回的）
    verdict.md               项目裁决：继续/转向/终止
    recheck-<S3|S5|S6|S7>.md 全量重判记录（推进到该阶段之前必做）
    gates.log                门禁运行日志（工具追加，不要手写）
```

**按需创建**：某个阶段用不到的文件不要建空壳。门禁只检查当前阶段出口所需的文件。

## 2. ID 体系

| 前缀 | 含义 | 位置 | 说明 |
|---|---|---|---|
| `R-000` | 用户原话 | `seed/` | 固定编号，只有一个 |
| `L-` | 需求层 | `layers/` | 每个一个文件，`parent` 指向 `seed` 或另一个 `L-` |
| `N-` | 推演节点 | `derivation/` | 每个一个文件，`from` 指向层或节点 |
| `M-` | 机制命题 | `concept/extensions.md` | 文件内小节；可证伪、带反例，`服务: 第 N 条 ← N-00N` 挂到概念与节点上，是选型判据的来源 |
| `D-` | 决策 | `decisions/` | 每个一个文件 |
| `Q-` | 待决问题 | `questions/` | 每个一个文件，`blocking` 指向阶段 |
| `E-` | 概念延伸（侧枝） | `concept/extensions.md` | 文件内 `##` 小节，带档位 |
| `K-` | 选型判据 | `tech/criteria.md` | 文件内小节，`来源:` 可为 `M-` |
| `O-` | 候选方案 | `tech/options.md` | 文件内小节 |
| `X-` | 异议 | `audit/challenges.md` | 文件内小节 |
| `V-` | 裁决 | `audit/verdict.md` | 文件内小节 |

规则：ID 全局唯一（门禁检查跨目录重复）；**不复用已删除的编号**；三位数字递增。

两个不带编号的合法父节点：`seed`（种子）与 `need`（需求定稿 `concept/need.md`）。它们出现在 `from:`、`来源:` 与 `## 推演链` 里，写法就是这两个词本身。

### 反悔（取代、不删除）

| 字段 | 写在哪 | 含义 |
|---|---|---|
| `supersedes:` | 新条目（层/节点/决策/机制/判据） | 它取代了哪个旧 ID |
| `superseded-by:` | 旧条目 | 谁取代了它；**旧内容保持原样** |
| `stale: true` | 受波及的判据/机制/层 | 因上游被撤回而待重判；重判后去掉或改写 |

**树不删枝**：被取代的条目留在原处，加上 `superseded-by:` 一行。半年后"为什么当时不选它"的答案就在这里。

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
superseded-by:        # 被反悔时填取代它的 ID
updated: YYYY-MM-DD
```

### 推演节点 `derivation/N-00N-*.md`

```yaml
id: N-001
title: <推出来的主张>
kind: 定论            # 候选 | 定论（见下）
stage: S2             # S2 = 第一跳（把需求说定） | S3 = 第二跳（定理念）
from: [L-001]         # 一个或多个：L-00N / N-00N / need，必须存在
status: kept          # kept | dropped
evidence: 无           # E1 | E2 | E3 | 无
supersedes:           # 反悔时：它取代了哪个旧 ID
superseded-by:        # 被反悔时：谁取代了它
updated: YYYY-MM-DD
```

两档的区别（门禁分别检查）：

| | `kind: 候选` | `kind: 定论` |
|---|---|---|
| 必填小节 | `## 对立面`、`## 放弃了什么` | `## 推演`、`## 反例` |
| `## 推演` | 不要求（还没有论证，这正是它叫候选的原因） | 必填 |
| 祖先链 | 只要求 `from` 指向存在的 ID | 必须一路走到种子 |

### 需求定稿 `concept/need.md`

```yaml
kind: settled-need
status: settled       # draft | settled
stage: S2
updated: YYYY-MM-DD
```

必填小节：`## 定稿`（一句话，≤120 字）、`## 每一项来自哪一条`（逐条 `- <定稿里的成分> ← N-00N`，门禁要求覆盖第一跳全部 `kept` 的定论节点）。

正文里引用它时写成 `need`（与 `seed` 同级），例：`from: [need]`、推演链里的 `… → N-003 → need → N-005 → …`。

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
sources: [L-001]      # accepted 时必须有来源（R-000/need/L-/N-），否则 assumption: true
assumption: false
dissent: false        # true = 我反对过、用户坚持
supersedes:
```

决策正文必须有一节 `## 错了的代价`：如果这个决定是错的，代价是什么、什么时候会发现。**说不出代价的决定，多半是我顺着用户写的**，不是真的权衡过的。

### 其他文档

`concept.md`：`kind: apical` + `status: draft|final` + `stage`。
`extensions.md`：条目级字段 `类型:`（机制命题 / 概念延伸）、`服务:`（`M-` 必填，写成 `第 N 条 ← N-00N`：指向概念「它生成的主张」里的第 N 条与生出它的推演节点）、`档位:`（`E-` 必填）、`来源:`、`status:`（`kept|dropped`）、`supersedes:` / `superseded-by:`。
`criteria.md`：`status: draft|locked` + `locked_at: "YYYY-MM-DD HH:MM"`；条目可带 `stale: true`。
`options.md`：`created: "YYYY-MM-DD HH:MM"`（必须晚于 `criteria.md` 的 `locked_at`）。
`selection.md`：`status: draft|final`。
`audit/recheck-*.md`：每条待盘点项一个小节，带 `结论: 维持|复活`。
`challenges.md` / `verdict.md` / `glossary.md`：无强制 frontmatter。

## 4. 门禁要求的标题与字段（逐字）

| 文件 | 必须存在 | 必须有的字段行 |
|---|---|---|
| `seed/real-need.md` | `## 被否的表述`、`## 非目标`、`## 判定对齐的信号`；S1 起还需 `## 拆词与认领` | `statement`（≤80 字）、`status: confirmed`；前三节各 ≥1 条，拆词节 ≥1 条 |
| `layers/L-00N-*.md` | `## 用户认领`、`## 分解理由`、`## 其他解读（被否）`、`## 判据`、`## 承接的信号`、`## 用户确认` | `parent`、`confirmed: true`、`status: confirmed`；解读与判据各 ≥1 |
| `derivation/N-00N-*.md` | `kind: 候选` 需 `## 对立面`、`## 放弃了什么`；`kind: 定论` 需 `## 推演`，保留的还需 `## 反例`；淘汰的需 `## 淘汰理由` | `from`、`kind`、`stage`、`status`、`evidence` |
| `concept/need.md` | `## 定稿`（≤120 字）、`## 每一项来自哪一条` | `kind: settled-need`、`status: settled`；来源条目覆盖第一跳全部 `kept` 定论节点 |
| `concept/concept.md` | `## 核心概念（一句话）`、`## 这意味着什么`、`## 这不意味着什么`、`## 它生成的主张`（≥3）、`## 关键名词`、`## 边界`、`## 非目标`、`## 反例与失败边界`、`## 从需求定稿来的哪一句`、`## 承接了哪些层的什么`、`## 淘汰的竞争概念`；S5 还需 `## 推演链`、`## 已知反对与回应` | 一句话 ≤60 字；关键名词 1–3 个且均为已确认术语；推演链从 `seed` 开始、经过 `need`、逐跳合法、以 `N-` 收尾（允许多条） |
| `concept/extensions.md` | `## M-00N <机制名>`（带 `服务:`、`## 机制`、`## 反例`）、`## E-00N <延伸名>`（≥3 条） | `类型:`（机制命题/概念延伸）；`E-` 的 `- 档位:`（必然/需求/猜测）；需求档 `- 来源:` |
| `audit/recheck-S3|S5|S6|S7.md` | 每条待盘点项（dropped 节点、被淘汰的主张、未验证假设、`stale` 文档）一条结论 | 结论词为「维持」或「复活」 |
| `tech/criteria.md` | `## K-00N <名>`（≥5 个） | `- 权重:`、`- 硬约束:`（是/否）、`- 来源:`（存在的 ID，含 `M-00N`）；≥1 条硬约束 |
| `tech/options.md` | `## O-00N <名>`（≥2 个） | `- 证据:`（E1/E2/E3）、`- 推演来源:`（采纳/备选项必须是**保留**的 N- 或 M-，淘汰项可以是任何存在的 N-/M-）；淘汰者 `- 拒绝理由:` 与 `- 复活条件:` |
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

## 6. 四条不变量

1. **append-only**：`seed/R-000-original.md` 与 `rounds/*` 只追加。改写它们等于篡改讨论史。
2. **决策只可取代、不可改写**：已 `accepted` 的决策要改内容，只能新建一个决策 `superseded` 它，并填 `supersedes:`。
3. **树不删枝**：淘汰的推演节点保留（`status: dropped` + 淘汰理由 + 复活条件）；被否的分层解读保留在层文件的「其他解读（被否）」里。半年后，这些是"为什么不选另一条路"的唯一答案。
4. **撤回走取代，不走改写**：用户反悔时，新建条目填 `supersedes:`，旧条目标 `superseded-by:`，内容保持原样；受波及的判据点标 `stale: true`，由全量重判结算。**偷偷改旧文档来实现反悔，等于篡改讨论史。**

## 7. state.json

```json
{
  "schema": 1,
  "topic": "本次讨论主题",
  "slug": "paper-ink-ui",
  "stage": "S2",
  "round": 9,
  "dependsOn": ["paper-ink"],
  "relation": "沿用 paper-ink 的视觉结论，只重做交互层",
  "gates": { "S1": { "state": "pass", "at": "2026-09-12 10:31", "missing": [] } },
  "verdict": { "status": "continue", "at": null, "note": "" }
}
```

`dependsOn` 与 `relation` 是可选的，只在树与树有关联时写：

| 字段 | 说明 | 门禁 |
|---|---|---|
| `dependsOn` | 上游树的目录名数组 | 引用的树不存在 → 告警（树被移动/删除不阻塞） |
| `relation` | 一句话说明关联 | 声明了 `dependsOn` 时，`seed/real-need.md` 必须有 `## 与已有树的关系`（阻塞） |
| 正文里的跨树引用 | 写成 `<slug>#L-003`（层/节点/需求 ID 都可以） | 引用了不存在的树 → 告警 |

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
| `tree.connected` 报错 | 有定论节点的祖先链没通到种子——它是插进来的灵感，不是推演。注意：`kind: 候选` 不查这条（摊候选时还没有论证） |
| `tree.parents` 报错 | `from` / `parent` 指向了不存在的 ID，或写成了 `L-1`（必须三位：`L-001`）。`need` 与 `seed` 一样是允许的父节点 |
| `stage.S1.layers` 报"未经用户确认" | 忘了 `confirmed: true` 与 `status: confirmed` 一起改 |
| `stage.S1.words` 报"没有拆词记录" | 种子里缺 `## 拆词与认领`——拆词与认领没发生过，层是我自己切的 |
| `stage.S1.layers` 报"缺少用户认领" | 层文件里没写它来自哪个词的哪一项 |
| `stage.S1.layers` 报"缺少其他解读" | 只写了一种分法——分层也是解读，必须保留被否的那种 |
| `stage.S1.layers` 报"缺少承接的信号" | 种子「判定对齐的信号」里有一条没被任何层认领，也没写进非目标 |
| `stage.S2.nodes` 报"没有对立面" | 候选只写了一条，或几条候选没有互相指认 `## 对立面` |
| `stage.S2.need` 报错 | `concept/need.md` 缺失、不是 `status: settled`，或 `## 每一项来自哪一条` 漏了第一跳的定论节点 |
| `stage.S3.nodes` 报错 | 第二跳一条候选都没有——直接从需求定稿跳到理念，摊开这一步被跳过了 |
| `stage.S3.apical` 报"关键名词在术语表里不存在" | 一句话里用了自造词，但没进术语表或还是 `[提案]` |
| `stage.S3.apical` 报"这些层未被承接" | 每个 `L-` 层要么在「承接了哪些层的什么」里，要么在「非目标」里 |
| `stage.S4.extensions` 报"M- 缺少 服务" | 机制命题没说清它服务概念里的哪一句——它可能放错了位置，或者概念还没收好 |
| `recheck.*` 报错 | 目标阶段是 S3/S5/S6/S7，但 `audit/recheck-<该阶段>.md` 缺失或漏了待盘点项：先全量重判再推进 |
| `glossary.pending` 报错 | `[提案]` 术语超过 1 个：先和用户逐个确认或删掉 |
| `stage.S5.final` 报"推演链断裂" | 「推演链」里的相邻两个节点，在文件里并不是父子关系，或第一跳没有经过 `need` |
| `rounds.sequence` 报错 | 轮次文件跳号（例如从 round-003 直接到 round-005） |
| `! rounds.state-sync` 告警 | `state.round` 与轮次文件数不一致——机械记账，`apical_gate action=check` 会自动同步，不必手改，也不阻塞阶段 |
| `stage.S7.selection` 报"推演来源" | 候选方案的 `推演来源` 不是保留状态的 `N-` 或 `M-` |
