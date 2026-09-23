/**
 * selftest — zero-dependency smoke test for the `apical-bud` preset rows.
 *
 * It mounts both preset plugins against a mock Cordis context (no host needed)
 * and drives the real `scripts/check.mjs` through them, asserting:
 *
 *   · the write guard: refuse outside a discussion root (`design/<slug>/`), allow inside;
 *   · `seed.md`'s `## 用户原话`: append-only, never rewritten;
 *   · `DSH_APICAL_UNLOCK=1` lifts the guard;
 *   · the one-line banner: core question, point counts, facts, model, selection,
 *     last check result — injected once per user turn;
 *   · `apical_check`: check / map / trees, blockers vs warnings, several roots,
 *     and a v1-shaped tree that is neither checked nor blocked;
 *   · check.mjs itself: one hard blocker and one warning;
 *   · script resolution regressions (uninjected service, env fallbacks, and the
 *     "list every path tried" failure).
 *
 * Run it after editing the plugins, the composition, or the skill's check script:
 *
 *   node dsh-preset/selftest.mjs
 *
 * The fixture is written under the repo's `.selftest/preset/` (gitignored) and
 * removed on success; a sibling `.selftest/fixtures/` is left alone.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Locate the skill bundle these plugins belong to, so `apical_check` mounts
 * exactly as it does in a real session. Three layouts are supported, in order:
 * an explicit `APICAL_SKILL_DIR`, the published repo (`dsh-preset/` beside
 * `scripts/`), and an installed preset (`$DSH_HOME/.agent-presets/<id>/` beside
 * `$DSH_HOME/skills/<name>/`).
 */
function resolveSkillDir() {
  const explicit = process.env.APICAL_SKILL_DIR
  if (explicit !== undefined && explicit !== '') return explicit
  const installed = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'skills', 'apical-bud')
  for (const candidate of [resolve(here, '..'), installed]) {
    if (existsSync(join(candidate, 'scripts', 'check.mjs'))) return candidate
  }
  return installed
}

const skillDir = resolveSkillDir()
const checkScript = join(skillDir, 'scripts', 'check.mjs')
if (!existsSync(checkScript)) {
  process.stdout.write(`警告：未找到 skill 体检脚本（${checkScript}）；体检相关用例会失败，其余仍会运行。\n`)
}

/** Fixture root: the repo's `.selftest/preset/`, or this folder when installed. */
const repoRoot = existsSync(join(here, '..', 'scripts', 'check.mjs')) ? resolve(here, '..') : undefined
const sandbox = repoRoot === undefined ? join(here, '.selftest') : join(repoRoot, '.selftest', 'preset')
const single = join(sandbox, 'single')
const project = join(sandbox, 'project')
const goodRoot = join(single, 'design', 'paper-ink')
const goodRootCopy = join(project, 'design', 'paper-ink')
const thinRoot = join(project, 'design', 'paper-ink-thin')
const oldRoot = join(project, 'design', 'old-tree')

let failures = 0
const ok = (label, condition, detail = '') => {
  if (condition) {
    process.stdout.write(`  ✓ ${label}\n`)
    return
  }
  failures += 1
  process.stdout.write(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}\n`)
}

const w = (root, rel, content) => {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

// ── fixtures ────────────────────────────────────────────────────────────────

const SEED = `---
kind: seed
status: confirmed
statement: 同一批活的总花费不高于单 agent 基线，效果不下降
needs_probe: no
---
# 种子：低成本 agent 系统

## 用户原话
> 我想做一个低成本的 agent 系统。模型的定价是缓存命中输入 / 非命中输入 / 输出三类。

## 一句话需求
同一批活的总花费不高于单 agent 基线，效果不下降。

## 核心问题
上下文里哪些部分在花钱、哪些部分在影响效果，系统该在哪一头动手？

## 需求线

| 编号 | 需求里的词 | 拆出来的项（客观问题） | 角色（核心／检验条件／非目标） | 用户认领与放弃代价 |
|---|---|---|---|---|
| R-01 | 低成本 | 上下文里的钱花在哪几块？ | 核心 | token 花费 = 核心；其余不算 |
| R-02 | 效果 | 什么在影响输出质量？ | 检验条件 | 破了输出质量就跌破基线 · 用户认领 · 节点 02 验 |

## 核心与放弃代价
- 核心：R-01 低成本。
- 放弃：R-02 效果当担保，不当核心——失去的是"效果更好"，只担保"不更差"。
- 为什么这么选：用户说钱是这个项目存在的理由。

## 非目标
- 不改模型本身（不做推理加速、不训模型）。

## 什么叫成了
- 成立：同一批活的总花费不高于单 agent 基线。
- 不成立：协调开销吃掉全部节省。

## 被否的表述
- "做一个省钱的多 agent 框架"——否：这是形态清单，不是需求。
`

const FACTS = `# 事实与调研

## F-001 模型计价分三类
- 出处：《DeepSeek API 定价页》2026-09
- 等级：E1
- 用途：支撑推演节点 01

## F-002 劣质片段的浅层特征
- 出处：《上下文工程实践》第 4 节（2026-08）
- 等级：E3
- 用途：支撑推演节点 02

## 没查的
- 没查任何多 agent 系统的真实账单数据："协调开销有多大"目前只有位置、没有数字。
`

const GLOSSARY = `# 术语

- **信息密度**：上下文中起引导作用的 token 占全部 token 的比例。
`

const POINT_1 = `---
point: 01
title: 成本组成
status: closed           # open | closed | paused
step: 论证
what: 成本的构成
line: R-01
undecided: 1
---
## 问题
Q-01.1 上下文里的钱都花在哪几块？

## 已知
- [事实 F-001] 计价分缓存命中输入、非命中输入、输出三类。
- [用户] 前两类是成本大头，同时决定输出质量。

## 推论
- 命中输入便宜但总量大，非命中输入单价高，两者都由上下文长度决定。
- 因此"上下文的量与质"是唯一同时影响成本与效果的杠杆；这条排除了"只优化输出长度"。

## 结论
D-01.1 成本的杠杆在上下文的量与质，不在输出长度。 type: 推论

## 反过来
- 若某类任务的输出 token 远大于输入，这条不成立。

## 生出的问题
Q-01.2 量与质，先动哪一个？（去向：由推演节点 02 回答）

## 用户
> "前两者是成本的大头，同时也是预期成果（输出）的重要影响因素。"
`

const POINT_2 = `---
point: 02
title: 该减少劣质还是增加优质
status: open
step: 命名
what: 优质 / 劣质 token
line: R-02
undecided: 1
answers: [Q-01.2]
from: [D-01.1]
---
## 问题
Q-02.1 提高上下文密度，该从减少劣质片段入手，还是从增加优质片段入手？

## 已知
- [结论 D-01.1] 杠杆在上下文的量与质。
- [事实 F-002] 能一眼认出的劣质特征只有浅层那几类。
- [用户] 低成本的抓手是上下文，不是输出长度。

## 推论
- 减少劣质片段要求先认出它，而识别本身比原问题更难。
- 增加优质片段不需要识别坏内容，只需在错误将要固化时注入判断。

## 结论
D-02.1 只做"增加优质"这一侧。 type: 推论

## 反过来
- 若注入总是晚于错误固化，这条不成立。

## 生出的问题
Q-02.2 谁来判断"将要固化"？（去向：悬置——需要一次真实会话的账单与错误样本才能解开）

## 用户
> "减少已经在上下文中的劣质 token 是不现实的，而增加优质 token 是可行的。"
`

const MODEL = `---
kind: model
name: 主脑系统
status: settled          # draft | settled
---
# 主脑系统

## 一句话
一个专管判断的副脑，只在错误将要固化时注入基于事实的判断。

## 概念图
上下文里的钱花在哪几块（Q-01.1）→ D-01.1 → Q-02.1 → D-02.1 → 主脑系统；悬置 Q-02.2

## 它由什么组成
- 主脑：干活的那个 agent。
- 副脑：只读上下文与工具结果，不干活。

## 接缝与边界
- 副脑只拿异常点附近的片段，不拿全文。

## 确定了什么
- D-01.1 杠杆在上下文的量与质。
- D-02.1 只做"增加优质"这一侧。

## 还没确定什么
- Q-02.2 谁判断"将要固化"（解锁条件：一次真实会话的账单与错误样本）。

## 反过来
- 若副脑自己的上下文先劣化，这个模型不成立。

## 反转：什么情况下这棵树不成立
- 没有出现：副脑的介入点还没被实测撞过。

## 要落地必须先定的事
- 副脑的触发条件与信息配额。
`

const CRITERIA = `---
写于: 2026-09-16 10:00
---
# 判据

## K-01 副脑不写生产代码
- 要满足：副脑只读，不产生代码改动
- 来源：D-02.1
- 硬约束：是

## K-02 触发点可观测
- 要满足：每次介入都能被日志看见
- 来源：D-01.1
- 硬约束：否
`

const OPTIONS = `---
写于: 2026-09-16 11:00
---
# 方案

## O-01 单副脑 + 全量上下文
- 组合：一个只读子 agent，读全文
- 证据：E3
- 满足：K-02
- 拒绝理由：K-01 要求信息配额，而它读全文
- 复活条件：若片段裁剪的准确率低于 X

## O-02 双副脑分工
- 组合：一个看工具结果，一个看推理
- 证据：E3
- 满足：K-01、K-02

## 什么都不做 / 最小方案
- 不做副脑，只在超限时由人看一眼
`

const SELECTION = `---
写于: 2026-09-16 12:00
---
# 选型

## 选定方案
- O-02

## 判据对照
- K-01 满足（依据：O-02 只读）
- K-02 满足（依据：触发点写日志）

## 拒绝理由汇总
- O-01：与 K-01 冲突（读全文）

## 实验与证伪
- 不需要实验：这是一棵选择性问题（副脑放在哪一侧），外部信息已足够，判据可纸面对照。

## 退出成本与迁移
- 换掉副脑要重写触发条件，其余不动。

## 未验证假设
- 片段裁剪的准确率还没有实测。
`

const HANDOFF = `---
kind: handoff
status: draft
---
# 交接：主脑系统

## 一句话
一个专管判断的副脑。

## 概念模型
主脑干活，副脑只读判断：只在错误将要固化时，拿异常点附近的片段注入基于事实的判断。

## 选定组合
O-02（双副脑分工）。

## 判据
K-01 副脑不写生产代码；K-02 触发点可观测。

## 明确不做
不做模型训练，不做全量上下文注入。

## 验收
同一批活的总花费不高于单 agent 基线，且错误不再无声地往下走。

## 第一件事
把副脑的触发条件写成一页纸，先跑一次真实会话。

## 给接收会话的提示词
读 model.md 的接缝与边界，先写触发条件，再谈实现。
`

/** A complete new-shape tree: every component present, no warnings expected. */
function writeGoodTree(root) {
  w(root, 'seed.md', SEED)
  w(root, 'facts.md', FACTS)
  w(root, 'glossary.md', GLOSSARY)
  w(root, 'derivation/01-成本组成.md', POINT_1)
  w(root, 'derivation/02-该减少劣质还是增加优质.md', POINT_2)
  w(root, 'model.md', MODEL)
  w(root, 'build/01-判据.md', CRITERIA)
  w(root, 'build/02-方案.md', OPTIONS)
  w(root, 'build/04-选型.md', SELECTION)
  w(root, 'handoff.md', HANDOFF)
}

/** One hard blocker (no facts.md) plus warnings (long statement, thin point). */
function writeThinTree(root) {
  w(root, 'seed.md', `---
kind: seed
status: draft
statement: 这是一个故意写得很长的一句话需求，长到超过八十个字，用来触发那条"一句话需求要能被你一眼认出来"的警告，好让自检同时覆盖硬拦与警告两条路径，而不是只测硬拦这一条。
---
# 种子：故意缺件

## 用户原话
> 我想要一个演示用的讨论根。

## 一句话需求
演示。

## 核心问题
演示一个缺件的讨论根会怎样？

## 需求线

| 编号 | 需求里的词 | 拆出来的项（客观问题） | 用户认领 |
|---|---|---|---|
| R-01 | 演示 | 缺件会被拦吗？ | 都算 |
`)
  w(root, 'glossary.md', GLOSSARY)
  w(root, 'derivation/01-演示点.md', `---
point: 01
title: 演示点
status: open
what: 缺件与硬拦
---
## 问题
Q-01.1 缺件会被拦吗？

## 结论
D-01.1 缺 facts.md 会被拦，其余只是警告。 type: 判断
`)
}

/** An apical-bud v1 tree: must stay readable, unchecked and unblocked. */
function writeOldTree(root) {
  w(root, 'state.json', JSON.stringify({ schema: 1, topic: '旧形状演示', slug: 'old-tree', stage: 'S2', round: 3, gates: {}, verdict: { status: 'continue' } }, null, 2))
  w(root, 'layers/L-001-旧层.md', '---\nid: L-001\ntitle: 旧层\n---\n\n## 层的内容\n\n旧形状的层。\n')
  w(root, 'concept/concept.md', '# 旧顶芽\n\n## 核心概念（一句话）\n\n旧形状的概念。\n')
  w(root, 'seed/R-000-original.md', '> 旧形状里的用户原话。\n')
}

// ── mock Cordis context ─────────────────────────────────────────────────────

/**
 * `registry` selects how the skills service is exposed. The default is the one
 * that matters: real cordis THROWS `cannot get property "skills" without
 * inject` when a plugin reads an uninjected service through the property proxy,
 * and an earlier version of the gate row swallowed that throw and reported
 * "找不到门禁脚本" while the skill was installed. `absent` exercises the
 * filesystem and environment fallbacks.
 */
function mockContext(options = {}) {
  const mode = options.registry ?? 'throwing'
  const registry = {
    async list() {
      return [{ name: 'apical-bud', description: '', invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'filesystem', resourceBase: { kind: 'directory', path: options.skillDir ?? skillDir } }]
    },
  }
  const tools = []
  const guards = []
  const listeners = new Map()
  const ctx = {
    logger: { warn: () => {}, info: () => {} },
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler])
      return () => {}
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {}
      },
      guard(fn) {
        guards.push(fn)
        return () => {}
      },
    },
    get(name) {
      return name === 'skills' && mode !== 'absent' ? registry : undefined
    },
  }
  if (mode === 'value') {
    ctx.skills = registry
  } else {
    Object.defineProperty(ctx, 'skills', {
      get() {
        throw new Error('cannot get property "skills" without inject')
      },
    })
  }
  return { ctx, tools, guards, listeners }
}

/**
 * Copy the check plugin to a directory whose filesystem fallbacks cannot hit a
 * real skill, so a resolver test can prove WHICH route resolved the module.
 */
function isolatedPresetDir(label) {
  const dir = join(sandbox, `.plugin-${label}`)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'apical-check.mjs'), readFileSync(join(here, 'apical-check.mjs'), 'utf8'))
  writeFileSync(join(dir, 'lib', 'apical-tree.mjs'), readFileSync(join(here, 'lib', 'apical-tree.mjs'), 'utf8'))
  return dir
}

let sessionSeq = 0
const fakeAgent = (cwd = sandbox) => {
  sessionSeq += 1
  const events = []
  const session = { id: `session-test-${sessionSeq}`, header: { cwd }, events }
  return { agent: { session, parentAgent: undefined }, session, events }
}

const userMsg = (text) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })

// ── the test run ────────────────────────────────────────────────────────────

async function main() {
  if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  writeGoodTree(goodRoot)
  writeGoodTree(goodRootCopy)
  writeThinTree(thinRoot)
  writeOldTree(oldRoot)

  const { ctx, tools, guards, listeners } = mockContext()
  const checkPlugin = await import(join(here, 'apical-check.mjs'))
  const guardPlugin = await import(join(here, 'apical-guard.mjs'))
  await checkPlugin.apply(ctx, { base: 'design', skillName: 'apical-bud' })
  await guardPlugin.apply(ctx, { base: 'design', banner: true, allowPaths: [] })

  const checkTool = tools.find((definition) => definition.name === 'apical_check')
  const singleAgent = fakeAgent(single).agent
  const projectAgent = fakeAgent(project).agent
  const call = (args, agent = singleAgent) => checkTool.execute(args, { agent, signal: new AbortController().signal })
  const guardCheck = (name, args, agent) => guards[0]({ name, arguments: args, agent, callId: 'c1', token: 't1', signal: new AbortController().signal })
  const banner = async (session) => {
    const decision = await listeners.get('agent/pre-step')[0]({ agent: { session, parentAgent: undefined }, signal: new AbortController().signal }, async () => ({ messages: [] }))
    return decision.messages
  }

  process.stdout.write('\n[1] 注册：工具、守卫与监听器\n')
  ok('apical_check 已注册', checkTool !== undefined)
  ok('旧的 apical_gate 不再注册', tools.every((definition) => definition.name !== 'apical_gate'))
  ok('写守卫已注册', guards.length === 1)
  ok('pre-step 监听器已注册', (listeners.get('agent/pre-step') ?? []).length === 1)

  process.stdout.write('\n[2] 写守卫：只有讨论根里可以写\n')
  ok('拒绝写生产代码 src/app.ts', typeof guardCheck('write', { file_path: 'src/app.ts', content: 'x' }, singleAgent) === 'string')
  ok('拒绝 edit 生产代码', typeof guardCheck('edit', { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' }, singleAgent) === 'string')
  ok('拒绝用 ../ 逃出讨论根', typeof guardCheck('write', { file_path: 'design/../src/app.ts', content: 'x' }, singleAgent) === 'string')
  ok('拒绝写项目根 README.md', typeof guardCheck('write', { file_path: 'README.md', content: 'x' }, singleAgent) === 'string')
  ok('拒绝写宿主配置 .dsh/config.yml', typeof guardCheck('write', { file_path: '.dsh/config.yml', content: 'x' }, singleAgent) === 'string')
  ok('拒绝 design/ 顶层的散文件（不属于任何讨论根）', typeof guardCheck('write', { file_path: 'design/notes.md', content: 'x' }, singleAgent) === 'string')
  ok('拒绝 design/ 顶层的散文件（edit 同样）', typeof guardCheck('edit', { file_path: 'design/notes.md', old_string: 'a', new_string: 'b' }, singleAgent) === 'string')
  const looseDenial = guardCheck('write', { file_path: 'design/notes.md', content: 'x' }, singleAgent) ?? ''
  ok('拒绝信息把写范围写成 <base>/<slug>/', looseDenial.includes('design/<slug>/'), looseDenial.split('\n')[0])
  ok('允许写讨论根内的新推演节点', guardCheck('write', { file_path: 'design/paper-ink/derivation/03-新一节点.md', content: 'x' }, singleAgent) === undefined)
  ok('允许写讨论根内的既有文件', guardCheck('write', { file_path: 'design/paper-ink/facts.md', content: 'x' }, singleAgent) === undefined)
  ok('允许 edit 讨论根内的文件', guardCheck('edit', { file_path: 'design/paper-ink/facts.md', old_string: 'a', new_string: 'b' }, singleAgent) === undefined)
  ok('允许新开一棵树：design/<slug>/seed.md（目录还不存在）', guardCheck('write', { file_path: 'design/another/seed.md', content: 'x' }, singleAgent) === undefined)
  ok('允许工具写的 design/<slug>/map.md', guardCheck('write', { file_path: 'design/paper-ink/map.md', content: 'x' }, singleAgent) === undefined)
  ok('旧形状目录不拦', guardCheck('write', { file_path: 'design/old-tree/layers/L-002-新层.md', content: 'x' }, projectAgent) === undefined)
  ok('旧形状目录里的深层文件也不拦', guardCheck('write', { file_path: 'design/old-tree/seed/R-001-original.md', content: 'x' }, projectAgent) === undefined)
  const denial = guardCheck('write', { file_path: 'src/app.ts', content: 'x' }, singleAgent) ?? ''
  ok('拒绝信息给出写范围、标准模式与逃生阀', denial.includes('design') && denial.includes('标准模式') && denial.includes('DSH_APICAL_UNLOCK'), denial.split('\n')[0])

  process.stdout.write('\n[3] seed.md 的「## 用户原话」只追加\n')
  const seedRaw = readFileSync(join(goodRoot, 'seed.md'), 'utf8')
  const seedArg = (content) => ({ file_path: 'design/paper-ink/seed.md', content })
  ok(
    '追加一行 → 放行',
    guardCheck('edit', {
      file_path: 'design/paper-ink/seed.md',
      old_string: '> 我想做一个低成本的 agent 系统。模型的定价是缓存命中输入 / 非命中输入 / 输出三类。',
      new_string: '> 我想做一个低成本的 agent 系统。模型的定价是缓存命中输入 / 非命中输入 / 输出三类。\n> 再补一句：缓存命中的便宜要真的用上。',
    }, singleAgent) === undefined,
  )
  ok(
    '改写原话里的字 → 拒绝',
    typeof guardCheck('edit', {
      file_path: 'design/paper-ink/seed.md',
      old_string: '模型的定价是缓存命中输入 / 非命中输入 / 输出三类',
      new_string: '模型有三种价格',
    }, singleAgent) === 'string',
  )
  ok('整文件覆写、改了原话 → 拒绝', typeof guardCheck('write', seedArg(seedRaw.split('低成本').join('低价')), singleAgent) === 'string')
  ok('删掉「## 用户原话」小节 → 拒绝', typeof guardCheck('write', seedArg(seedRaw.replace('## 用户原话', '## 用户说过')), singleAgent) === 'string')
  ok('改别的小节、原话不动 → 放行', guardCheck('write', seedArg(seedRaw.replace('- 不改模型本身（不做推理加速、不训模型）。', '- 不改模型本身。')), singleAgent) === undefined)
  ok('第一次创建 seed.md → 放行', guardCheck('write', { file_path: 'design/fresh/seed.md', content: '---\nkind: seed\n---\n\n## 用户原话\n> 新话。\n' }, singleAgent) === undefined)

  process.stdout.write('\n[4] 逃生阀：DSH_APICAL_UNLOCK=1\n')
  process.env.DSH_APICAL_UNLOCK = '1'
  const unlocked = mockContext()
  await (await import(join(here, 'apical-guard.mjs'))).apply(unlocked.ctx, { base: 'design', banner: false })
  ok('UNLOCK=1 时不注册写守卫', unlocked.guards.length === 0)
  delete process.env.DSH_APICAL_UNLOCK
  ok('去掉 UNLOCK 后守卫照旧', guards.length === 1)

  process.stdout.write('\n[4b] 旋钮：allowPaths 放行额外前缀\n')
  const allowCtx = mockContext()
  await (await import(join(here, 'apical-guard.mjs'))).apply(allowCtx.ctx, { base: 'design', banner: false, allowPaths: ['notes/'] })
  const allowCheck = (filePath) => allowCtx.guards[0]({ name: 'write', arguments: { file_path: filePath, content: 'x' }, agent: singleAgent, callId: 'c1', token: 't1', signal: new AbortController().signal })
  ok('allowPaths 里的前缀放行（哪怕不在讨论根里）', allowCheck('notes/scratch.md') === undefined)
  ok('allowPaths 之外照旧拒绝', typeof allowCheck('src/app.ts') === 'string')
  ok('allowPaths 之外照旧拒绝（design/ 顶层散文件）', typeof allowCheck('design/notes.md') === 'string')

  process.stdout.write('\n[5] 一行状态横幅\n')
  const fake = fakeAgent(single)
  const atStart = await banner(fake.session)
  ok('会话第一步注入一次', atStart.length === 1)
  const line = atStart[0]?.content[0].text ?? ''
  ok('横幅是一行', line !== '' && !line.includes('\n'), JSON.stringify(line.slice(0, 60)))
  ok('含核心问题', line.includes('上下文里哪些部分在花钱'))
  ok('含推演节点计数（进行中/已结/悬置）', line.includes('推演节点 2（进行中 1/已结 1/悬置 0）'))
  ok('含事实数', line.includes('事实 2'))
  ok('含需求线进度', line.includes('需求线 2（都有人推）'), line.slice(0, 120))
  ok('含顶芽状态', line.includes('顶芽 settled「主脑系统」'))
  ok('含选型状态', line.includes('选型 判据·方案·选型·交接'))
  ok('含上一次体检结果（未运行）', line.includes('体检: 未运行'))
  ok('同一轮不重复注入', (await banner(fake.session)).length === 0)
  fake.session.events.push(userMsg('继续'))
  ok('用户消息后再注入一次', (await banner(fake.session)).length === 1)
  fake.session.events.push({ type: 'user/message', data: { source: { kind: 'apical-banner' } } })
  ok('自注入的横幅不算用户轮次', (await banner(fake.session)).length === 0)
  const child = await listeners.get('agent/pre-step')[0](
    { agent: { session: { id: 'child', header: { cwd: single }, events: [] }, parentAgent: { session: fake.session } }, signal: new AbortController().signal },
    async () => ({ messages: [] }),
  )
  ok('子代理不注入横幅', child.messages.length === 0)

  process.stdout.write('\n[6] apical_check：check / map / trees\n')
  const good = await call({ action: 'check' })
  ok('check 省略 action 时走默认动作并报"齐"', good.text.includes('组成成分: 齐'), good.text.split('\n').slice(0, 3).join(' / '))
  ok('map.md 没生成过时只警告、不拦', good.text.includes('! map.missing') && !good.text.includes('✗ map.missing'))
  const afterCheck = await banner(fakeAgent(single).session)
  ok('check 之后横幅带体检结果', (afterCheck[0]?.content[0].text ?? '').includes('体检: 齐 ✓'), afterCheck[0]?.content[0].text?.slice(0, 80))

  const mapped = await call({ action: 'map' })
  const mapFile = join(goodRoot, 'map.md')
  ok('map 写出 map.md', existsSync(mapFile))
  ok('map 回显内容', mapped.text.includes('# 推演进度') && mapped.text.includes('核心问题'))
  ok('map 标注机器生成、不要手改', readFileSync(mapFile, 'utf8').includes('由 apical_check map 生成'))
  ok('map 列出推演节点与顶芽', mapped.text.includes('01 成本组成') && mapped.text.includes('主脑系统'))
  const goodAgain = await call({ action: 'check' })
  ok('补上 map.md 之后没有警告', goodAgain.text.includes('组成成分: 齐') && goodAgain.text.includes('警告: 无'), goodAgain.text.split('\n').filter((row) => row.includes('!')).join(' '))

  const thin = await call({ root: 'design/paper-ink-thin' }, projectAgent)
  ok('硬拦：缺 facts.md 被念出来', thin.text.includes('✗ core.facts'), thin.text.split('\n').filter((row) => row.includes('✗')).join(' '))
  ok('警告：statement 过长只是警告', thin.text.includes('! seed.statement-length'), thin.text.split('\n').filter((row) => row.includes('!')).join(' '))
  ok('缺件时不冒充"齐"', !thin.text.includes('组成成分: 齐'))

  ok('未知 action 有提示', (await call({ action: 'nope' })).text.includes('未知 action'))

  const trees = await call({ action: 'trees', cwd: project })
  ok('trees 列出全部讨论根', trees.text.includes('共 3 个讨论根'), trees.text.split('\n').slice(0, 2).join(' / '))
  ok('trees 区分新旧形状', trees.text.includes('[旧形状]') && trees.text.includes('[新形状]'))
  ok('trees 带上推演节点与顶芽计数', trees.text.includes('推演节点 2') && trees.text.includes('顶芽 settled「主脑系统」'))
  const ambiguous = await call({ action: 'check' }, projectAgent)
  ok('多个讨论根时不替模型猜', ambiguous.text.includes('不替你挑') && ambiguous.text.includes('paper-ink-thin'))

  const legacy = await call({ action: 'check', root: 'design/old-tree' }, projectAgent)
  ok('旧形状：提示而不检查、不拦', legacy.text.includes('旧形状') && !legacy.text.includes('✗'), legacy.text.split('\n').slice(0, 3).join(' / '))
  const empty = await call({ root: 'design/not-yet' }, projectAgent)
  ok('空目录：给建种子的指引', empty.text.includes('seed.md') && empty.text.includes('缺'))

  process.stdout.write('\n[7] check.mjs 本身：一条硬拦、一条警告\n')
  const checkModule = await import(pathToFileURL(checkScript).href)
  const goodReport = checkModule.check(goodRoot)
  ok('完整的树：无硬拦', goodReport.ok === true && goodReport.blockers.length === 0, goodReport.blockers.map((item) => item.id).join(','))
  ok('完整的树：无警告', goodReport.warnings.length === 0, goodReport.warnings.map((item) => item.id).join(','))
  ok('完整的树：组成成分计数对上', goodReport.stats.points === 2 && goodReport.stats.facts === 2 && goodReport.stats.closed === 1)
  const thinReport = checkModule.check(thinRoot)
  ok('缺件：core.facts 硬拦', thinReport.ok === false && thinReport.blockers.some((item) => item.id === 'core.facts'))
  ok('警告：seed.statement-length', thinReport.warnings.some((item) => item.id === 'seed.statement-length'))

  // facts.md 只收外部信息：出处写成"用户说……"时应当被点名（用户的话是需求与判断，不是事实）。
  const userSourcedRoot = join(sandbox, 'user-sourced')
  mkdirSync(join(userSourcedRoot, 'derivation'), { recursive: true })
  writeFileSync(join(userSourcedRoot, 'seed.md'), SEED, 'utf8')
  writeFileSync(join(userSourcedRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(userSourcedRoot, 'facts.md'), FACTS.replace('《上下文工程实践》第 4 节（2026-08）', '用户说他以前用过，感觉不行'), 'utf8')
  writeFileSync(join(userSourcedRoot, 'derivation', '01-成本组成.md'), POINT_1, 'utf8')
  const userSourcedReport = checkModule.check(userSourcedRoot)
  ok(
    '警告：facts.not-external（用户的体验不是事实）',
    userSourcedReport.ok === true && userSourcedReport.warnings.some((item) => item.id === 'facts.not-external'),
    userSourcedReport.warnings.map((item) => item.id).join(','),
  )

  // 推演纪律：第 2 个点若既没回答问题、也没把上一步的结论当前提，就是另起话题。
  const unanchoredRoot = join(sandbox, 'unanchored')
  mkdirSync(join(unanchoredRoot, 'derivation'), { recursive: true })
  writeFileSync(join(unanchoredRoot, 'seed.md'), SEED, 'utf8')
  writeFileSync(join(unanchoredRoot, 'facts.md'), FACTS, 'utf8')
  writeFileSync(join(unanchoredRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(unanchoredRoot, 'derivation', '01-成本组成.md'), POINT_1, 'utf8')
  writeFileSync(
    join(unanchoredRoot, 'derivation', '02-另起话题.md'),
    POINT_2.replace('answers: [Q-01.2]\nfrom: [D-01.1]\n', 'from: [seed]\n'),
    'utf8',
  )
  const unanchoredReport = checkModule.check(unanchoredRoot)
  ok(
    '警告：chain.sequence（第 2 个点与上一步无关）',
    unanchoredReport.warnings.some((item) => item.id === 'chain.sequence'),
    unanchoredReport.warnings.map((item) => item.id).join(','),
  )

  // 需求线：种子没拆词 → 硬拦；线偏了 / 卡住了 / 事实进了 from / 连着没有新概念 → 警告。
  const noLinesRoot = join(sandbox, 'no-lines')
  mkdirSync(join(noLinesRoot, 'derivation'), { recursive: true })
  writeFileSync(join(noLinesRoot, 'seed.md'), SEED.replace(/## 需求线[\s\S]*?\n\n## 非目标/, '## 非目标'), 'utf8')
  writeFileSync(join(noLinesRoot, 'facts.md'), FACTS, 'utf8')
  writeFileSync(join(noLinesRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(noLinesRoot, 'derivation', '01-成本组成.md'), POINT_1, 'utf8')
  const noLinesReport = checkModule.check(noLinesRoot)
  ok(
    '硬拦：种子没拆需求线（core.seed）',
    noLinesReport.ok === false
      && noLinesReport.blockers.some((item) => item.id === 'core.seed' && item.detail.includes('需求线')),
    noLinesReport.blockers.map((item) => item.id).join(','),
  )
  ok(
    '种子没拆词时不再逐个点报 line.missing（别叠噪音）',
    !noLinesReport.warnings.some((item) => item.id === 'line.missing'),
    noLinesReport.warnings.map((item) => item.id).join(','),
  )

  const driftRoot = join(sandbox, 'drift')
  mkdirSync(join(driftRoot, 'derivation'), { recursive: true })
  writeFileSync(join(driftRoot, 'seed.md'), SEED, 'utf8')
  writeFileSync(join(driftRoot, 'facts.md'), FACTS, 'utf8')
  writeFileSync(join(driftRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(driftRoot, 'derivation', '01-成本组成.md'), POINT_1, 'utf8')
  // 漂移：全部压在核心线 R-01 上、一条线吃掉整棵树；第 3 个节点标了两个循环位置；
  // 第 4 个节点把事实当前提；后面几个节点不再出现新概念。
  for (let index = 2; index <= 6; index += 1) {
    const order = String(index).padStart(2, '0')
    const body = POINT_2
      .replace('point: 02', `point: ${order}`)
      .replace('from: [D-01.1]', index === 4 ? 'from: [F-001]' : `from: [D-0${index - 1}.1]`)
      .replace('answers: [Q-01.2]\n', '')
      .replace('step: 命名', index === 3 ? 'step: 命名＋组成' : 'step: 命名')
      .replace('line: R-02', 'line: R-01')
      .replace('what: 优质 / 劣质 token', 'what: 成本的构成')
      .replace('Q-02.1', `Q-${order}.1`)
      .replace('Q-02.2', `Q-${order}.2`)
      .replace('D-02.1', `D-${order}.1`)
    writeFileSync(join(driftRoot, 'derivation', `${order}-漂移节点.md`), body, 'utf8')
  }
  const driftReport = checkModule.check(driftRoot)
  const driftIds = driftReport.warnings.map((item) => item.id)
  ok('警告：line.idle（一条线一个节点都没有）', driftIds.includes('line.idle'), driftIds.join(','))
  ok('警告：line.run（连着四个节点同一条线）', driftIds.includes('line.run'), driftIds.join(','))
  ok('警告：step.unknown（一个节点标两个位置）', driftIds.includes('step.unknown'), driftIds.join(','))
  ok('警告：point.fact-from（把事实当前提）', driftIds.includes('point.fact-from'), driftIds.join(','))
  ok('警告：concept.flat（连着五个节点没有新概念）', driftIds.includes('concept.flat'), driftIds.join(','))

  const thinReportIds = thinReport.warnings.map((item) => item.id)
  ok('警告：line.missing（节点没认领需求线）', thinReportIds.includes('line.missing'), thinReportIds.join(','))
  ok('不再警告 step.missing（这一版 step 可省）', !thinReportIds.includes('step.missing'), thinReportIds.join(','))

  // 节点没写 what:（这一步在谈哪个词）——旧树的 concept: 也算数。
  const namelessRoot = join(sandbox, 'nameless')
  mkdirSync(join(namelessRoot, 'derivation'), { recursive: true })
  writeFileSync(join(namelessRoot, 'seed.md'), SEED, 'utf8')
  writeFileSync(join(namelessRoot, 'facts.md'), FACTS, 'utf8')
  writeFileSync(join(namelessRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(namelessRoot, 'derivation', '01-成本组成.md'), POINT_1.replace('what: 成本的构成\n', ''), 'utf8')
  const namelessReport = checkModule.check(namelessRoot)
  ok('警告：what.missing（节点没写这一步在谈哪个词）', namelessReport.warnings.some((item) => item.id === 'what.missing'), namelessReport.warnings.map((item) => item.id).join(','))
  const legacyNamedReport = checkModule.check(namelessRoot)
  ok('旧树的 concept: 仍被当作命名', legacyNamedReport.warnings.some((item) => item.id === 'what.missing'))

  // ── v2 纪律：核心唯一、检验条件有人验、未定项不能一直涨、实验要能证伪 ──────
  process.stdout.write('\n[7b] 一个核心 · 未定项收敛 · 实验件\n')

  // 两个核心目标：硬拦。
  const twoCoreRoot = join(sandbox, 'two-core')
  mkdirSync(join(twoCoreRoot, 'derivation'), { recursive: true })
  writeFileSync(join(twoCoreRoot, 'seed.md'), SEED.replace(/^(\| R-02 .*?)\| 检验条件 \|/m, '$1| 核心 |'), 'utf8')
  writeFileSync(join(twoCoreRoot, 'facts.md'), FACTS, 'utf8')
  writeFileSync(join(twoCoreRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(twoCoreRoot, 'derivation', '01-成本组成.md'), POINT_1, 'utf8')
  const twoCoreReport = checkModule.check(twoCoreRoot)
  ok(
    '硬拦：需求线里标了两个核心',
    twoCoreReport.blockers.some((item) => item.id === 'core.seed' && item.detail.includes('核心恰好一条')),
    twoCoreReport.blockers.map((item) => item.id).join(','),
  )

  // 四条检验条件：只提醒"要的太多"，不拦。
  const manyCondRoot = join(sandbox, 'many-cond')
  mkdirSync(join(manyCondRoot, 'derivation'), { recursive: true })
  const extraConditions = [
    '| R-03 | 延迟 | 单次响应多慢算慢？ | 检验条件 | 峰值不超过 3 秒 |',
    '| R-04 | 稳定 | 波动多大算不稳？ | 检验条件 | 成功率不低于 99% |',
    '| R-05 | 可解释 | 怎么算可解释？ | 检验条件 | 每次介入有日志 |',
  ].join('\n')
  writeFileSync(join(manyCondRoot, 'seed.md'), SEED.replace(/^(\| R-02 .*)$/m, (row) => `${row}\n${extraConditions}`), 'utf8')
  writeFileSync(join(manyCondRoot, 'facts.md'), FACTS, 'utf8')
  writeFileSync(join(manyCondRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(manyCondRoot, 'derivation', '01-成本组成.md'), POINT_1, 'utf8')
  const manyCondReport = checkModule.check(manyCondRoot)
  const manyCondIds = manyCondReport.warnings.map((item) => item.id)
  ok('警告：检验条件超过 3 条（不拦）', manyCondIds.includes('seed.too-many-conditions') && manyCondReport.ok === true, manyCondIds.join(','))
  ok('警告：有检验条件没有节点在验它', manyCondIds.includes('line.condition-unverified'), manyCondIds.join(','))

  // 未定项一路涨：连着三个节点只增不减。
  const risingRoot = join(sandbox, 'rising')
  mkdirSync(join(risingRoot, 'derivation'), { recursive: true })
  writeFileSync(join(risingRoot, 'seed.md'), SEED, 'utf8')
  writeFileSync(join(risingRoot, 'facts.md'), FACTS, 'utf8')
  writeFileSync(join(risingRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(risingRoot, 'derivation', '01-成本组成.md'), POINT_1, 'utf8')
  for (let index = 2; index <= 5; index += 1) {
    const order = String(index).padStart(2, '0')
    const body = POINT_2
      .replace('point: 02', `point: ${order}`)
      .replace('from: [D-01.1]', `from: [D-0${index - 1}.1]`)
      .replace('answers: [Q-01.2]\n', '')
      .replace('undecided: 1', `undecided: ${index}`)
      .replace('Q-02.1', `Q-${order}.1`)
      .replace('Q-02.2', `Q-${order}.2`)
      .replace('D-02.1', `D-${order}.1`)
    writeFileSync(join(risingRoot, 'derivation', `${order}-未定项在涨.md`), body, 'utf8')
  }
  const risingReport = checkModule.check(risingRoot)
  ok(
    '警告：未定项连着几个节点只增不减',
    risingReport.warnings.some((item) => item.id === 'undecided.rising'),
    risingReport.warnings.map((item) => item.id).join(','),
  )

  // 记录的时差：两处条数不符、map.md 停在上一轮 —— 这两条是「进度会丢」的源头，但都只是警告。
  const recordRoot = join(sandbox, 'record-drift')
  mkdirSync(join(recordRoot, 'derivation'), { recursive: true })
  const driftPoint = `${POINT_1}\n## 未定项\n\n- 命中率的分母还没定；由推演节点 02 回答。\n`
  writeFileSync(join(recordRoot, 'seed.md'), SEED, 'utf8')
  writeFileSync(join(recordRoot, 'facts.md'), FACTS, 'utf8')
  writeFileSync(join(recordRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(recordRoot, 'derivation', '01-成本组成.md'), driftPoint, 'utf8')
  const driftAligned = checkModule.check(recordRoot)
  ok('两处一致时不报 undecided.drift', driftAligned.warnings.every((item) => item.id !== 'undecided.drift'), driftAligned.warnings.map((item) => item.id).join(','))
  writeFileSync(join(recordRoot, 'derivation', '01-成本组成.md'), driftPoint.replace('undecided: 1', 'undecided: 3'), 'utf8')
  const recordReport = checkModule.check(recordRoot)
  ok('警告：undecided 与「## 未定项」条数不符', recordReport.warnings.some((item) => item.id === 'undecided.drift'), recordReport.warnings.map((item) => item.id).join(','))
  ok('两处不符只是警告、不硬拦', recordReport.blockers.every((item) => item.id !== 'undecided.drift'))

  const staleMapRoot = join(sandbox, 'map-drift')
  writeGoodTree(staleMapRoot)
  const freshMap = checkModule.buildMap(staleMapRoot)
  ok('map 带「下一步」一行（压缩之后先接的就是它）', freshMap.includes('**下一步**：'), freshMap.split('\n').find((line) => line.startsWith('**下一步**')) ?? '')
  writeFileSync(join(staleMapRoot, 'map.md'), freshMap.replace('**现在停在**：', '**现在停在**：上一轮的事——'), 'utf8')
  const staleReport = checkModule.check(staleMapRoot)
  ok('警告：map.md 停在上一轮（内容级比对，mtime 测不出来）', staleReport.warnings.some((item) => item.id === 'map.drift'), staleReport.warnings.map((item) => item.id).join(','))

  // 实验件：有文件但没有杀判据 → 只是演示，报缺件。
  const probeRoot = join(sandbox, 'probe-bad')
  mkdirSync(join(probeRoot, 'derivation'), { recursive: true })
  mkdirSync(join(probeRoot, 'probe'), { recursive: true })
  writeFileSync(join(probeRoot, 'seed.md'), SEED.replace('needs_probe: no', 'needs_probe: yes'), 'utf8')
  writeFileSync(join(probeRoot, 'facts.md'), FACTS, 'utf8')
  writeFileSync(join(probeRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(probeRoot, 'derivation', '01-成本组成.md'), POINT_1, 'utf8')
  writeFileSync(join(probeRoot, 'probe', 'demo.md'), '---\nprobe: demo\n---\n\n## 怎么跑\n\nnode demo.mjs\n', 'utf8')
  const probeReport = checkModule.check(probeRoot)
  ok(
    '硬拦：实验件缺杀判据／要回答的问题',
    probeReport.blockers.some((item) => item.id === 'probe.shape'),
    probeReport.blockers.map((item) => item.id).join(','),
  )
  ok('警告：probe/ 下没有 README', probeReport.warnings.some((item) => item.id === 'probe.readme'), probeReport.warnings.map((item) => item.id).join(','))

  // needs_probe: yes 却一个实验件都没有。
  const noProbeRoot = join(sandbox, 'probe-missing')
  mkdirSync(join(noProbeRoot, 'derivation'), { recursive: true })
  writeFileSync(join(noProbeRoot, 'seed.md'), SEED.replace('needs_probe: no', 'needs_probe: yes'), 'utf8')
  writeFileSync(join(noProbeRoot, 'facts.md'), FACTS, 'utf8')
  writeFileSync(join(noProbeRoot, 'glossary.md'), GLOSSARY, 'utf8')
  writeFileSync(join(noProbeRoot, 'derivation', '01-成本组成.md'), POINT_1, 'utf8')
  const noProbeReport = checkModule.check(noProbeRoot)
  ok('警告：说了要实验却没有实验件', noProbeReport.warnings.some((item) => item.id === 'probe.missing'), noProbeReport.warnings.map((item) => item.id).join(','))

  const oldReport = checkModule.check(oldRoot)
  ok('旧形状被识别为 legacy 且不拦', oldReport.kind === 'legacy' && oldReport.ok === true)

  process.stdout.write('\n[8] 体检脚本解析（回归：cordis 未注入服务）\n')
  const isolated = isolatedPresetDir('isolated')
  const runIsolated = async (instance) => instance.tools
    .find((definition) => definition.name === 'apical_check')
    .execute({ action: 'check', root: goodRoot }, { agent: fakeAgent(single).agent, signal: new AbortController().signal })

  // A. 注册表可用、但 ctx.skills 属性访问抛错（线上故障的形态）。
  //    隔离目录里没有可用的文件系统回退路径，所以「成功」只可能来自 ctx.get('skills')。
  const resolvable = mockContext({ registry: 'throwing', skillDir })
  await (await import(pathToFileURL(join(isolated, 'apical-check.mjs')).href)).apply(resolvable.ctx, { base: 'design', skillName: 'apical-bud' })
  const reportA = await runIsolated(resolvable)
  ok('属性访问抛错时仍经 ctx.get 解析到脚本', reportA.text.includes('组成成分') && !reportA.text.includes('找不到体检脚本'), reportA.text.split('\n')[0])

  // B. 注册表完全不可用 → 环境变量回退仍应生效。
  process.env.APICAL_CHECK_SCRIPT = checkScript
  const envOnly = mockContext({ registry: 'absent' })
  await (await import(pathToFileURL(join(isolated, 'apical-check.mjs')).href)).apply(envOnly.ctx, { base: 'design', skillName: 'apical-bud' })
  const reportB = await runIsolated(envOnly)
  ok('注册表不可用时走 APICAL_CHECK_SCRIPT', reportB.text.includes('组成成分'), reportB.text.split('\n')[0])
  delete process.env.APICAL_CHECK_SCRIPT

  // B2. 旧环境变量名（门禁时代的 APICAL_GATE_SCRIPT）仍作回退。
  process.env.APICAL_GATE_SCRIPT = checkScript
  const envOld = mockContext({ registry: 'absent' })
  await (await import(pathToFileURL(join(isolated, 'apical-check.mjs')).href)).apply(envOld.ctx, { base: 'design', skillName: 'apical-bud' })
  const reportB2 = await runIsolated(envOld)
  ok('旧名 APICAL_GATE_SCRIPT 仍作回退', reportB2.text.includes('组成成分'), reportB2.text.split('\n')[0])
  delete process.env.APICAL_GATE_SCRIPT

  // C. 全都不可用 → 必须报出取证细节，而不是一句「找不到」。
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(sandbox, 'empty-home')
  const nothing = mockContext({ registry: 'absent' })
  await (await import(pathToFileURL(join(isolated, 'apical-check.mjs')).href)).apply(nothing.ctx, { base: 'design', skillName: 'apical-bud' })
  const reportC = await runIsolated(nothing)
  ok('失败时列出已尝试路径', reportC.text.includes('已尝试的路径都不存在') && reportC.text.includes('✗ '), reportC.text.split('\n')[0])
  ok('失败时说明注册表为何没给出路径', reportC.text.includes('技能注册表：'))
  ok('失败时给出三条修法', reportC.text.includes('checkScript') && reportC.text.includes('APICAL_CHECK_SCRIPT') && reportC.text.includes('skills/apical-bud'), reportC.text.split('\n').slice(-1)[0].slice(0, 60))
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome

  // ── 单一真相源：方法本体只在 skill 里，persona 不抄第二份 ────────────────────
  process.stdout.write('\n[9] 单一真相源：附录都被索引，persona 只带常驻契约\n')
  {
    const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    const personaRaw = readFileSync(join(here, 'agent.cordis.yml'), 'utf8')
    const refFiles = readdirSync(join(skillDir, 'references')).filter((name) => name.endsWith('.md'))
    ok('references/ 里有附录可查', refFiles.length > 0)
    for (const name of refFiles) {
      ok(`SKILL.md 的索引里有 references/${name}`, skillMd.includes(name), '新加了一份附录却没进 SKILL.md 顶部的索引')
    }
    for (const [label, text] of [['SKILL.md', skillMd], ['persona', personaRaw]]) {
      const pointed = [...new Set([...text.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)].map((m) => m[1]))]
      for (const name of pointed) {
        ok(`${label} 指向的 references/${name} 真的存在`, refFiles.includes(name), '指针悬空：改过名或删过文件')
      }
    }
    ok('persona 带「开工第一件事读 SKILL.md」', personaRaw.includes('开工第一件事'), 'persona 必须把模型推到方法本体那里')
    const prefix = personaRaw.match(/prefix: \|-\n([\s\S]*?)\n# /)
    const prefixBytes = prefix === null ? 0 : Buffer.byteLength(prefix[1], 'utf8')
    ok('persona 正文在 7 KB 预算内', prefixBytes > 0 && prefixBytes <= 7168, prefixBytes === 0 ? '取不到 prefix 段' : `现在 ${prefixBytes} 字节——超了先删旧话，别再往上叠`)
  }

  process.stdout.write(failures === 0 ? '\n全部通过 ✓\n' : `\n失败 ${failures} 项 ✗\n`)
  if (failures === 0) rmSync(sandbox, { recursive: true, force: true })
  else process.stdout.write(`保留现场以便排查: ${sandbox}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}

await main()
