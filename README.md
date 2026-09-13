# apical-bud（顶芽）

[English](README.en.md) | 中文

**开发前的理念推演方法论**：从一句可能模糊的需求（种子）出发，把它分层（根系），逐层推演（主干），收敛到**唯一一个理念概念**（顶芽），把"靠什么保证它"写成机制命题与延伸（侧枝），理念定稿之后再据判据推出技术方案（果实）。

```
种子 ──► 根系 ──► 主干 ──► 顶芽 ──► 侧枝 ──► 果实
需求      分层      推演      理念概念   机制+延伸   技术方案
```

**气质在顶芽，保证在侧枝**：顶芽回答"这一屏是什么气质"（可解释、能生成，不要求可证伪）；`M-` 机制命题回答"靠什么保证"（可证伪、带反例），它们是技术选型的限制条件——判据的 `来源:` 里必须有 `M-`，否则选型就退化成"市面上有什么"的盘点。

调研是**肥料**：供给前提与佐证，不代替生长。问答是**生命力**：树每长一节，都要经过一轮问答。全程文件驱动——没有落盘的决定不算决定。

它是一个 skill（`SKILL.md` + `references/` + `templates/` + `scripts/`），也是一个 DSH agent preset（`apical-bud`）的方法论内核。五个不常见的主张：

1. **对话是介质，文件是留痕。** 提案、选项、推演链都先说在对话里——你不必打开任何文件就能回答；文件只记录已经发生的事。讨论一旦退化成「它写、我读、我挑错」，就是因为这条被违反（DSH preset 里有写守卫兜底）。
2. **推演，不是头脑风暴。** 每个概念节点都必须写清它从哪个父节点推出来，祖先链必须能走到种子。门禁会拒绝孤儿节点——凭空的灵感可以讨论，但不能冒充推演。
3. **分层也是一种解读。** 同一个需求至少有几种分法；只写一种，就等于用我的措辞替换了你的需求。所以每层必须保留「其他解读（被否）」，并由你确认。
4. **顶芽只有一个，机制可以有好几个，剪掉的枝留着。** 理念概念唯一；机制命题允许竞争、允许复活。淘汰要写成有条件的判断（淘汰理由 + **复活条件**），并在进入 S3/S5/S6/S7 之前**全量重判**一次——淘汰是当时的推断，推断变了结论就作废。
5. **实验由你执行，但"要不要做"由我判断。** 依赖"某个程序到底怎么表现"的推演，先读源码（写不出出处就是没读）；真机实测交给用户时，给**交接文档 + 一段可直接复制的提示词 + 通过/不通过标准**。读一次源码能得到答案的，不许让用户重启机器。
6. **术语不能堆成墙。** 一轮最多引入一个新词，未确认的词同时最多一个，定义必须是人话且不能用未定义的词解释自己；**你可以改写任何问题与术语，也可以反悔任何已定的东西**（不需要理由），我负责全局替换、记下曾用名，并把旧内容标成被取代（不删除）。

## 安装

**DSH（DeepSeek Harness）**：

```bash
git clone git@github.com:Mypenfly/apical-bud.git ~/.dsh/skills/apical-bud

# 可选：装上会话装配层（常驻身份、写守卫、apical_gate 工具、状态横幅）
~/.dsh/skills/apical-bud/dsh-preset/install.sh
```

`dsh-preset/` 里的预设会把三条承重规则变成机制：`write`/`edit` 只能写讨论根、用户原话与既有轮次纪要只追加、`state.json.stage` 只能由 `apical_gate` 在出口条件通过后推进。只装 skill 也能用：模型会在需要时加载它，或你用 `/apical-bud` 手动调用。细节见 [`dsh-preset/README.md`](dsh-preset/README.md)。

改完 skill 或 preset 之后记得跑一次 `install.sh`，并**新开一个会话**：persona 与 SKILL.md 在会话开始时就注入了，已经在跑的会话不会中途换规矩。

**Claude Code / 其他兼容 SKILL.md 的宿主**：

```bash
git clone git@github.com:Mypenfly/apical-bud.git ~/.claude/skills/apical-bud
```

门禁脚本是零依赖 Node ESM，任何宿主里都能跑：

```bash
node scripts/gate.mjs --root design/<slug>
```

## 用法

说"我们聊聊这个想法""帮我理清需求""这个概念该怎么设计""这个方向值得做吗"，或直接 `/apical-bud`。讨论会在你的仓库顶层建 `design/<slug>/`：

```
seed/          种子：原话 + 一句话真实需求 + 被否的表述 + 非目标 + 判定对齐的信号
layers/        根系：需求分层（L-00N），每层认领它承接的信号
derivation/    主干：推演节点（N-00N），淘汰的枝保留（含复活条件）
concept/       顶芽 concept.md ★（理念概念）+ 侧枝 extensions.md ★（M- 机制命题 / E- 概念延伸）
tech/          果实：criteria.md（先锁版）→ options.md → selection.md ★
questions/     待决问题（Q-00N）        decisions/  决策记录（D-00N）
glossary.md    术语表（[确认] / [提案]）  audit/      异议、裁决、全量重判、门禁日志
```

**一个项目可以有多棵树。** 不同需求、不同阶段各一棵，树与树之间还能声明关联（`state.json` 的 `dependsOn` / `relation`，正文里用 `<slug>#L-003` 互相引用）。一个会话绑定一棵树：

```bash
apical_gate action=trees                 # 列出项目里的全部树与生命周期状态
apical_gate action=bind slug=<slug>      # 绑定本会话要推进的那一棵
```

一棵树走完 S7（或裁决终止）之后不要在它上面长新需求——新建一棵树，并在种子里写「与已有树的关系」：继承了什么、推翻了什么。

完整的目录、ID、frontmatter 与门禁契约见 `references/doc-conventions.md`。

## 门禁

```bash
node scripts/gate.mjs --root design/<slug>            # 人类可读报告
node scripts/gate.mjs --root design/<slug> --json      # 机器可读
node scripts/gate.mjs --cwd .                          # 自动发现唯一的讨论根
node scripts/gate.mjs --root design/<slug> --stage S5  # 用别的阶段视角检查
```

退出码 0 = 通过，1 = 有缺失项。它同时是模块，宿主插件可以 `import { validate } from './scripts/gate.mjs'` 直接调用。

它检查的是**结构与可追溯性**：无孤儿节点、每层有确认与判据、顶芽一句话 ≤60 字、关键名词都是已确认术语、推演链逐跳不断且覆盖每一个保留节点、机制命题带 `服务:` 与反例、判据先于方案锁定且至少一条来源指向 `M-`、候选方案挂在保留的节点或机制上、进 S3/S5/S6/S7 之前有全量重判记录。它**保证不了理念好不好**——那是红队复核和你自己的判断。

## 目录结构

```
SKILL.md                       方法论主干（常驻）
references/protocol.md         每轮循环、提问与选项纪律、反悔、全量重判、反模式
references/seed-and-layering.md S0–S1 种子对齐、信号追踪与需求分层
references/derivation.md       S2 推演规则、实验三选一、清单来源、回退时机
references/apical.md           S3–S5 理念概念、机制命题与延伸、定稿与红队复核
references/tech-selection.md   S6–S7 判据（来源含 M-）、证据分级、退出成本
references/doc-conventions.md  文档规范（门禁契约）
templates/                     19 份文档模板（含 handoff / recheck）
scripts/gate.mjs               零依赖门禁校验器（模块 + CLI）
dsh-preset/                    DSH 会话装配层：persona、写守卫、apical_gate 工具、状态横幅、install.sh、自检
README.md / README.en.md       中文 / English
```

## 出处与许可

提问纪律（一次一问、给具体选项、能从文件查到的不问人）改编自 [grill-me](https://github.com/RobMitt/grill-me-skill) 的思路；在其上补了四件它没有的东西：**推演树的可追溯性、分层确认、阶段门禁、以及质疑/否决权**。

**许可：[MIT](LICENSE)。** 随便用、改、再发布，保留版权声明即可。方法论的价值在于被用起来——想要更严的专利与署名条款，可以换成 Apache-2.0；本仓库选了摩擦最小的那个。
