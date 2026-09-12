# apical-bud（顶芽）

[English](README.en.md) | 中文

**开发前的理念推演方法论**：从一句可能模糊的需求（种子）出发，把它分层（根系），逐层推演（主干），收敛到**唯一一个核心理念**（顶芽）及其延伸（侧枝）；理念定稿之后，再据需求、扩展性、应用场景推出技术方案（果实）。

```
种子 ──► 根系 ──► 主干 ──► 顶芽 ──► 侧枝 ──► 果实
需求      分层      推演      核心理念    延伸      技术方案
```

调研是**肥料**：供给前提与佐证，不代替生长。问答是**生命力**：树每长一节，都要经过一轮问答。全程文件驱动——没有落盘的决定不算决定。

它是一个 skill（`SKILL.md` + `references/` + `templates/` + `scripts/`），也是一个 DSH agent preset（`apical-bud`）的方法论内核。五个不常见的主张：

1. **对话是介质，文件是留痕。** 提案、选项、推演链都先说在对话里——你不必打开任何文件就能回答；文件只记录已经发生的事。讨论一旦退化成「它写、我读、我挑错」，就是因为这条被违反（DSH preset 里有写守卫兜底）。
2. **推演，不是头脑风暴。** 每个概念节点都必须写清它从哪个父节点推出来，祖先链必须能走到种子。门禁会拒绝孤儿节点——凭空的灵感可以讨论，但不能冒充推演。
3. **分层也是一种解读。** 同一个需求至少有几种分法；只写一种，就等于用我的措辞替换了你的需求。所以每层必须保留「其他解读（被否）」，并由你确认。
4. **顶芽只有一个，剪掉的枝留着。** 收敛意味着选一个核心理念，并把竞争节点连同淘汰理由留在树上——半年后这是"为什么不选另一条路"的唯一答案。
5. **术语不能堆成墙。** 一轮最多引入一个新词，未确认的词同时最多一个，定义必须是人话且不能用未定义的词解释自己；**你可以改写任何问题与术语**，我负责全局替换并记下曾用名。

## 安装

**DSH（DeepSeek Harness）**：

```bash
git clone git@github.com:Mypenfly/apical-bud.git ~/.dsh/skills/apical-bud

# 可选：装上会话装配层（常驻身份、写守卫、apical_gate 工具、状态横幅）
~/.dsh/skills/apical-bud/dsh-preset/install.sh
```

`dsh-preset/` 里的预设会把三条承重规则变成机制：`write`/`edit` 只能写讨论根、用户原话与既有轮次纪要只追加、`state.json.stage` 只能由 `apical_gate` 在出口条件通过后推进。只装 skill 也能用：模型会在需要时加载它，或你用 `/apical-bud` 手动调用。细节见 [`dsh-preset/README.md`](dsh-preset/README.md)。

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
seed/          种子：原话 + 一句话真实需求 + 被否的表述 + 非目标
layers/        根系：需求分层（L-00N）
derivation/    主干：推演节点（N-00N），淘汰的枝保留
concept/       顶芽 concept.md ★ + 侧枝 extensions.md ★
tech/          果实：criteria.md（先锁版）→ options.md → selection.md ★
questions/     待决问题（Q-00N）        decisions/  决策记录（D-00N）
glossary.md    术语表（[确认] / [提案]）  audit/      异议、裁决、门禁日志
```

完整的目录、ID、frontmatter 与门禁契约见 `references/doc-conventions.md`。

## 门禁

```bash
node scripts/gate.mjs --root design/<slug>            # 人类可读报告
node scripts/gate.mjs --root design/<slug> --json      # 机器可读
node scripts/gate.mjs --cwd .                          # 自动发现唯一的讨论根
node scripts/gate.mjs --root design/<slug> --stage S5  # 用别的阶段视角检查
```

退出码 0 = 通过，1 = 有缺失项。它同时是模块，宿主插件可以 `import { validate } from './scripts/gate.mjs'` 直接调用。

它检查的是**结构与可追溯性**：无孤儿节点、每层有确认与判据、顶芽一句话 ≤100 字、关键名词都是已确认术语、推演链逐跳不断、判据先于方案锁定、候选方案挂在保留节点上。它**保证不了理念好不好**——那是红队复核和你自己的判断。

## 目录结构

```
SKILL.md                       方法论主干（常驻）
references/protocol.md         每轮循环、提问纪律、用户改写、反模式
references/seed-and-layering.md S0–S1 种子对齐与需求分层
references/derivation.md       S2 推演规则、调研的用法、回退时机
references/apical.md           S3–S5 收敛、侧枝、定稿与红队复核
references/tech-selection.md   S6–S7 判据、证据分级、退出成本
references/doc-conventions.md  文档规范（门禁契约）
templates/                     17 份文档模板
scripts/gate.mjs               零依赖门禁校验器（模块 + CLI）
dsh-preset/                    DSH 会话装配层：persona、写守卫、apical_gate 工具、状态横幅、install.sh、自检
README.md / README.en.md       中文 / English
```

## 出处与许可

提问纪律（一次一问、给具体选项、能从文件查到的不问人）改编自 [grill-me](https://github.com/RobMitt/grill-me-skill) 的思路；在其上补了四件它没有的东西：**推演树的可追溯性、分层确认、阶段门禁、以及质疑/否决权**。

**许可：保留所有权利（All rights reserved）。** 本仓库未附开源许可证，GitHub 会显示 `No license`：可以阅读，但没有授予使用、复制、修改或再发布的许可。若希望他人能直接使用与再发布，需要另附一份许可证（MIT、Apache-2.0 等）。
