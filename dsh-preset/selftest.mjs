/**
 * selftest — end-to-end smoke test for the `apical-bud` preset rows.
 *
 * It mounts both preset plugins against a mock Cordis context (no host needed),
 * then drives a complete S0 → S7 tree through the real gate tool while asserting
 * the write guard, the append-only guard, the state invariants and the state
 * banner. Run it after editing the plugins, the composition, or the skill's gate
 * script:
 *
 *   node .agent-presets/apical-bud/selftest.mjs
 *
 * The fixture is written under `./.selftest/` and removed on success.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Locate the skill bundle these plugins belong to, so the gate tool mounts
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
    if (existsSync(join(candidate, 'scripts', 'gate.mjs'))) return candidate
  }
  return installed
}

const skillDir = resolveSkillDir()
if (!existsSync(join(skillDir, 'scripts', 'gate.mjs'))) {
  process.stdout.write(`警告：未找到 skill 门禁脚本（${skillDir}/scripts/gate.mjs）；门禁相关用例会失败，其余仍会运行。\n`)
}
const sandbox = join(here, '.selftest')
const cwd = sandbox
const root = join(cwd, 'design', 'paper-ink')

let failures = 0
const ok = (label, condition, detail = '') => {
  if (condition) {
    process.stdout.write(`  ✓ ${label}\n`)
    return
  }
  failures += 1
  process.stdout.write(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}\n`)
}

const w = (rel, content) => {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}
const del = (rel) => rmSync(join(root, rel), { force: true })
const state = () => JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'))
const writeState = (value) => writeFileSync(join(root, 'state.json'), JSON.stringify(value, null, 2), 'utf8')

/**
 * Mock Cordis context.
 *
 * `registry` selects how the skills service is exposed, and the default is the
 * one that matters: real cordis THROWS
 * `cannot get property "skills" without inject` when a plugin reads an
 * uninjected service through the property proxy. The first version of
 * `apical-gate.mjs` swallowed that throw and reported "找不到门禁脚本" while the
 * skill was installed — so the faithful mode is the default here, and the
 * `absent` mode exercises the filesystem fallbacks.
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
    // Same failure the host produced: property access throws, `ctx.get` answers.
    Object.defineProperty(ctx, 'skills', {
      get() {
        throw new Error('cannot get property "skills" without inject')
      },
    })
  }
  return { ctx, tools, guards, listeners }
}

/**
 * Copy the gate plugin to a directory whose filesystem fallbacks cannot hit a
 * real skill, so a resolver test can prove WHICH route resolved the module.
 */
function isolatedPresetDir(label) {
  const dir = join(sandbox, `.plugin-${label}`)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'apical-gate.mjs'), readFileSync(join(here, 'apical-gate.mjs'), 'utf8'))
  writeFileSync(join(dir, 'lib', 'apical-state.mjs'), readFileSync(join(here, 'lib', 'apical-state.mjs'), 'utf8'))
  return dir
}

const fakeAgent = (parent = undefined) => {
  const events = []
  const session = { id: 'session-test', header: { cwd }, events }
  return { agent: { session, parentAgent: parent }, session, events }
}

/** Write the seed + a layer + node skeleton. */
function writeSeed() {
  writeState({ schema: 1, topic: '演示：纸墨前端', slug: 'paper-ink', stage: 'S0', round: 0, gates: {}, verdict: { status: 'continue', at: null, note: '' } })
  w('seed/R-000-original.md', `---\nid: R-000\ntitle: 用户原话\nstatus: accepted\nstage: S0\nsources: []\nassumption: false\nupdated: 2026-01-01\n---\n\n> 我想要一个看着舒服的前端，别那么刺眼。\n`)
  w('seed/real-need.md', `---\nkind: seed\nstatus: confirmed\nstatement: 让长时间读代码的人眼睛不累、注意力不被打断\nupdated: 2026-01-01\n---\n\n## 这句话是什么意思\n\n"不累"指视觉层的持续阅读负担，"不被打断"指注意力不被装饰性元素夺走。\n\n## 被否的表述\n\n- "做一个好看的界面" —— 为什么否：好看无法检验，且指向装饰而非负担。\n\n## 非目标\n\n- 不做主题市场 —— 理由：与"不被打断"无关。\n\n## 判定对齐的信号\n\n- **成立**：连续读 30 分钟不酸 —— **不成立**：读十分钟就想调亮度\n- **成立**：页面上没有东西在动 —— **不成立**：用户说"老有东西闪"\n`)
}

/** Advance the recorded round so `rounds.sequence` stays satisfied. */
function round(k, stage) {
  w(`rounds/round-${String(k).padStart(3, '0')}.md`, `---\nround: ${k}\nstage: ${stage}\ndate: 2026-01-0${Math.min(k, 9)}\n---\n\n## 我问了什么\n\n> 演示问题\n\n## 用户答了什么\n\n> 演示答复\n`)
  const value = state()
  value.round = k
  writeState(value)
}

/**
 * One recheck record. Entering S3/S5/S6/S7 is gated on a full re-judgement of
 * everything the tree has discarded, so the fixture writes one per boundary —
 * with one section per discarded item.
 */
const recheck = (stage, ids) => `# 全量重判 · ${stage}\n\n`
  + ids.map((id) => `## ${id} <被淘汰的东西>\n\n- 来源: ${id}\n- 当时的理由: 当时的推断（演示）\n- 现在的判断: 没变\n- 结论: 维持\n- 理由: 演示用例里条件没有变化\n`).join('\n')
  + `\n## 本次重判的净结果\n\n- 维持 ${ids.length} 条 · 复活 0 条\n`

async function main() {
  if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })

  const { ctx, tools, guards, listeners } = mockContext()
  const gate = await import(join(here, 'apical-gate.mjs'))
  const guard = await import(join(here, 'apical-guard.mjs'))
  await gate.apply(ctx, { base: 'design', skillName: 'apical-bud' })
  await guard.apply(ctx, { base: 'design', banner: true, allowPaths: [] })

  const gateTool = tools.find((definition) => definition.name === 'apical_gate')
  const call = (args) => gateTool.execute(args, { agent: fakeAgent().agent, signal: new AbortController().signal })
  const callWith = (args, agent) => gateTool.execute(args, { agent, signal: new AbortController().signal })
  /** A root agent whose `inject` records durable events, like the host does. */
  const agentWithInject = () => {
    const holder = fakeAgent()
    holder.agent.inject = (message) => {
      holder.session.events.push({ type: 'user/message', data: { id: message.id, role: message.role, content: message.content, source: message.source } })
    }
    return holder.agent
  }
  const guardCheck = (name, args, agent) => guards[0]({ name, arguments: args, agent: agent ?? fakeAgent().agent, callId: 'c1', token: 't1', signal: new AbortController().signal })
  const banner = async (session) => {
    const decision = await listeners.get('agent/pre-step')[0]({ agent: { session, parentAgent: undefined }, signal: new AbortController().signal }, async () => ({ messages: [] }))
    return decision.messages
  }

  process.stdout.write('\n[1] 工具、守卫与监听器注册\n')
  ok('apical_gate 已注册', gateTool !== undefined)
  ok('写守卫已注册', guards.length === 1)
  ok('pre-step 监听器已注册', (listeners.get('agent/pre-step') ?? []).length === 1)

  process.stdout.write('\n[2] S0 引导：还没有讨论根时\n')
  ok('允许建讨论根 design/<slug>/state.json', guardCheck('write', { file_path: 'design/photo-triage/state.json', content: '{}' }) === undefined)
  ok('拒绝写 design/ 顶层散文件', typeof guardCheck('write', { file_path: 'design/notes.md', content: 'x' }) === 'string')
  ok('拒绝写生产代码', typeof guardCheck('write', { file_path: 'src/app.ts', content: 'x' }) === 'string')
  const beforeRoot = await call({ action: 'status' })
  ok('无讨论根时 status 给出 S0 指引', beforeRoot.text.includes('还没有讨论根'))

  writeSeed()

  process.stdout.write('\n[3] 写守卫：越界、不变量与 append-only\n')
  ok('拒绝写生产代码 src/app.ts', typeof guardCheck('write', { file_path: 'src/app.ts', content: 'x' }) === 'string')
  // design/<新 slug>/ 是「开一棵新树」的入口，因此允许；直接的散文件仍被拒绝（见下一条）。
  ok('允许在 design/ 下开新树目录', guardCheck('write', { file_path: 'design/other/notes.md', content: 'x' }) === undefined)
  ok('拒绝 design/ 顶层的散文件', typeof guardCheck('write', { file_path: 'design/loose.md', content: 'x' }) === 'string')
  ok('允许写讨论根内的文档', guardCheck('write', { file_path: 'design/paper-ink/layers/L-001-a.md', content: 'x' }) === undefined)
  ok('允许 edit 讨论根内的文档', guardCheck('edit', { file_path: 'design/paper-ink/layers/L-001-a.md', old_string: 'a', new_string: 'b' }) === undefined)
  ok('拒绝直接 edit state.json', typeof guardCheck('edit', { file_path: 'design/paper-ink/state.json', old_string: 'a', new_string: 'b' }) === 'string')
  ok('拒绝手改 state.json.stage', typeof guardCheck('write', { file_path: 'design/paper-ink/state.json', content: JSON.stringify({ schema: 1, topic: 'x', slug: 'paper-ink', stage: 'S7', round: 0, gates: {}, verdict: { status: 'continue' } }) }) === 'string')
  ok('允许整文件写 state.json 且 stage 不变', guardCheck('write', { file_path: 'design/paper-ink/state.json', content: JSON.stringify({ schema: 1, topic: 'x', slug: 'paper-ink', stage: 'S0', round: 0, gates: {}, verdict: { status: 'continue' } }) }) === undefined)
  ok('拒绝把 verdict 直接改成 stop', typeof guardCheck('write', { file_path: 'design/paper-ink/state.json', content: JSON.stringify({ schema: 1, topic: 'x', slug: 'paper-ink', stage: 'S0', round: 0, gates: {}, verdict: { status: 'stop' } }) }) === 'string')
  ok('拒绝 edit 用户原话（append-only）', typeof guardCheck('edit', { file_path: 'design/paper-ink/seed/R-000-original.md', old_string: '刺眼', new_string: '不刺眼' }) === 'string')
  ok('拒绝覆写已存在的用户原话', typeof guardCheck('write', { file_path: 'design/paper-ink/seed/R-000-original.md', content: 'x' }) === 'string')
  round(1, 'S0')
  ok('拒绝覆写已存在的轮次纪要', typeof guardCheck('write', { file_path: 'design/paper-ink/rounds/round-001.md', content: 'x' }) === 'string')
  ok('允许新开一轮纪要', guardCheck('write', { file_path: 'design/paper-ink/rounds/round-002.md', content: 'x' }) === undefined)
  rmSync(join(root, 'rounds/round-002.md'), { force: true })

  process.stdout.write('\n[4] 状态横幅\n')
  const fake = fakeAgent()
  const atStart = await banner(fake.session)
  ok('会话第一步注入一次', atStart.length === 1)
  ok('横幅含树名、阶段与树规模', atStart[0]?.content[0].text.includes('树 paper-ink') && atStart[0].content[0].text.includes('阶段 S0') && atStart[0].content[0].text.includes('层 0(确认 0)'))
  ok('同一轮不重复注入', (await banner(fake.session)).length === 0)
  fake.session.events.push({ type: 'user/message', data: { source: { kind: 'user' } } })
  ok('用户消息后再注入一次', (await banner(fake.session)).length === 1)
  fake.session.events.push({ type: 'user/message', data: { source: { kind: 'apical-banner' } } })
  ok('自注入的横幅不算用户轮次', (await banner(fake.session)).length === 0)
  const childDecision = await listeners.get('agent/pre-step')[0]({ agent: { session: { id: 'child', header: { cwd }, events: [] }, parentAgent: { session: fake.session } }, signal: new AbortController().signal }, async () => ({ messages: [] }))
  ok('子代理不注入横幅', childDecision.messages.length === 0)

  process.stdout.write('\n[5] 门禁：S0 → S7 全程推进\n')
  let result = await call({ action: 'advance' })
  ok('S0 advance 成功', result.text.includes('S1'), result.text.split('\n')[0])

  w('glossary.md', `# 术语表\n\n- **纸墨感** [确认]：界面像纸与墨的关系，只有承载信息的墨色，没有装饰性的彩。\n`)
  w('layers/L-001-visual.md', `---\nid: L-001\ntitle: 视觉层的"不累"\nparent: seed\nstatus: confirmed\nconfirmed: true\nupdated: 2026-01-02\n---\n\n## 层的内容\n\n什么视觉条件让连续阅读不产生疲劳。\n\n## 分解理由\n\n种子的判据"眼睛不累"必须靠视觉条件回答，无法由其他层代替。\n\n## 其他解读（被否）\n\n- 把"不累"理解为低对比度 —— 被否理由：对比不足在强光下更难读。\n\n## 判据\n\n- 连续阅读 30 分钟后无视觉疲劳自述。\n\n## 承接的信号\n\n- 信号一「连续读 30 分钟不酸」 —— 检验：读完后自述不酸。\n\n## 用户确认\n\n用户确认："就是别让我盯一会儿就酸。"\n`)
  // Kept as a constant so the "stale" case below can restore it verbatim.
  const LAYER_ATTENTION = `---\nid: L-002\ntitle: 认知层的"不被打断"\nparent: seed\nstatus: confirmed\nconfirmed: true\nupdated: 2026-01-02\n---\n\n## 层的内容\n\n什么信息组织方式不让注意力被夺走。\n\n## 分解理由\n\n种子里的"注意力不被打断"只能由信息组织回答，与视觉层不重叠。\n\n## 其他解读（被否）\n\n- 把"不被打断"理解为减少功能 —— 被否理由：功能多少与注意力无关，是组织方式的问题。\n\n## 判据\n\n- 视线不被非承载信息的元素吸引。\n\n## 承接的信号\n\n- 信号二「页面上没有东西在动」 —— 检验：静态首屏无动效。\n\n## 用户确认\n\n用户确认："对，别老有东西在我眼前动。"\n`
  w('layers/L-002-attention.md', LAYER_ATTENTION)
  round(2, 'S1')
  result = await call({ action: 'advance' })
  ok('S1 advance 成功', result.text.includes('S2'), result.text.split('\n')[0])

  w('derivation/N-001-contrast.md', `---\nid: N-001\ntitle: 字面对比要够，色相对比要少\nfrom: [L-001]\nstatus: kept\nevidence: E2\nupdated: 2026-01-03\n---\n\n## 推演\n\n因为 L-001 要求长时间阅读不疲劳，所以需要足够的字面对比来降低识别成本；\n因为色相对比高会持续唤起注意，所以颜色应留给承载信息的少数元素。\n\n## 反例\n\n全灰配色在强光下反而更难读；因此边界是"字面对比不低于通行标准"。\n\n## 调研佐证\n\n- E1：对比度通行标准；E2：自测三种灰阶在 30 分钟阅读后的自述疲劳。\n`)
  w('derivation/N-002-decoration.md', `---\nid: N-002\ntitle: 装饰即干扰\nfrom: [L-002]\nstatus: kept\nevidence: 无\nupdated: 2026-01-03\n---\n\n## 推演\n\n因为 L-002 的判据是视线不被非承载信息吸引，所以任何非承载信息的元素都在消耗注意力预算。\n\n## 反例\n\n完全没有层级提示时定位成本上升，因此留白与字重必须承担层级职责。\n\n## 调研佐证\n\n无（纯推演）。\n`)
  w('derivation/N-003-paper-ink.md', `---\nid: N-003\ntitle: 纸墨：层级靠字重与留白，不靠色块与阴影\nfrom: [N-001, N-002]\nstatus: kept\nevidence: 无\nupdated: 2026-01-03\n---\n\n## 推演\n\nN-001 给出"颜色留给承载信息的元素"，N-002 给出"装饰即干扰"，两者合流：\n界面只保留纸与墨这一组关系——墨色承担信息，留白与字重承担层级。\n\n## 反例\n\n需要表达状态差异时（错误、警告）必须引入第三种颜色，此时"只有墨色"的边界被打破，需要显式例外。\n\n## 调研佐证\n\n无（纯推演）。\n`)
  w('derivation/N-004-neon.md', `---\nid: N-004\ntitle: 暗色霓虹主题\nfrom: [L-002]\nstatus: dropped\nevidence: E3\nupdated: 2026-01-03\n---\n\n## 推演\n\n从 L-002 出发，暗色背景可以减少亮度刺激。\n\n## 反例\n\n霓虹强调色的色相对比高，与 N-001 冲突。\n\n## 调研佐证\n\n- E3：多篇二手评价称暗色主题在白天环境下可读性下降。\n\n## 淘汰理由\n\n与 N-001 的"色相对比要少"直接冲突；且装饰性强，违反 N-002。\n`)
  round(3, 'S2')
  result = await call({ action: 'advance' })
  ok('S2 advance 成功', result.text.includes('S3'), result.text.split('\n')[0])

  const concept = (status, extra = '') => `---
kind: apical
status: ${status}
stage: S3
updated: 2026-01-04
---

# 纸墨

## 核心概念（一句话）

纸墨：墨色只承担信息，层级由字重与留白承担。

## 这意味着什么

- 颜色不是装饰手段，而是信息手段。
- 版面靠疏密说话，不靠框线与阴影。

## 这不意味着什么

- 不是"性冷淡风" —— 留白是层级工具，不是风格标签。
- 不是拒绝一切动效 —— 动效若要出现，必须承载状态变化。

## 它生成的主张

1. 除承载信息的元素外不出现第二种色相。
2. 层级由字重与间距表达，不用色块。
3. 状态提示是显式例外，且必须限定用途。

## 关键名词

- 纸墨感

## 边界

管到静态阅读界面为止；状态提示（错误、警告）是显式例外。

## 非目标

- 不做主题市场。

## 反例与失败边界

- 需要三态提示时只有墨色不够用 → 边界：允许一个语义色，且必须限定用途。

## 承接了哪些层的什么

| 层 | 由本概念的哪一句承接 |
|---|---|
| L-001 | "墨色只承担信息"，字面对比足、色相少 |
| L-002 | "层级由字重与留白承担"，装饰不参与表达 |

## 淘汰的竞争概念

| 概念 | 为什么它没有成为顶芽 | 复活条件 |
|---|---|---|
| 霓虹暗色 | 色相对比高，与 L-001 的判据冲突 | 若"不被打断"被重判为次要，它可重新竞争 |
${extra}`
  w('concept/concept.md', concept('draft'))
  round(4, 'S3')
  result = await call({ action: 'check' })
  ok('缺全量重判时拒绝进入 S3', !result.text.includes('PASS') && result.text.includes('recheck.exists'), result.text.split('\n').filter((line) => line.includes('recheck')).join(' '))
  w('audit/recheck-S3.md', recheck('S3', ['N-004']))
  result = await call({ action: 'advance' })
  ok('补上重判后 S3 advance 成功', result.text.includes('已推进') && result.text.includes('S2 → S3'), result.text.split('\n')[0])

  w('glossary.md', `# 术语表\n\n- **承载信息** [确认]：直接表达内容或层级的元素，不含装饰。\n- **纸墨感** [确认]：界面像纸与墨的关系，只有承载信息的墨色，没有装饰性的彩。\n- **可回退** [确认]：任何自动动作都能在撤销窗口内恢复。\n`)
  w('concept/extensions.md', `# 侧枝\n\n## M-001 只有一条色相通道\n\n- 类型: 机制命题\n- 服务: 第 1 条 ← N-001\n- 档位: 必然\n- status: kept\n\n### 机制\n\n界面只通过墨色与字重表达信息与层级：除承载信息的元素外不出现第二种色相。\n可证伪：出现第二种色相即不成立。\n\n### 反例\n\n状态提示（错误、警告）需要语义色；此时必须限定用途。\n\n### 边界\n\n只管静态阅读界面；不要求候选具备主题系统。\n\n## M-002 暗色霓虹\n\n- 类型: 机制命题\n- 服务: 第 1 条 ← N-001\n- 档位: 需求\n- 来源: L-002\n- status: dropped\n- 复活条件: 若"不被打断"被重判为次要判据，它可重新竞争\n\n### 机制\n\n用高色相对比在暗背景上突出层级。\n\n### 反例\n\n白天环境下可读性下降。\n\n### 淘汰理由\n\n与 M-001 的"只有一条色相通道"直接冲突；当时的推断见 N-004。\n\n## E-001 印刷排印规则\n\n- 档位: 必然\n- 内容: 字号阶梯与行距遵循排印惯例。\n\n## E-002 阅读时长自适应\n\n- 档位: 需求\n- 来源: L-001\n- 内容: 长阅读场景自动加大行距。\n\n## E-003 纸纹理\n\n- 档位: 猜测\n- 内容: 极淡的纸纹理可能降低屏感。\n- 何时验证: 用户反馈"太像屏幕"时再试。\n`)
  round(5, 'S4')
  result = await call({ action: 'check' })
  ok('S4 出口条件（含 M- 机制命题）通过', result.text.includes('PASS'), result.text.split('\n').filter((line) => line.includes('✗')).join(' '))
  result = await call({ action: 'advance' })
  ok('S4 advance 成功', result.text.includes('已推进') && result.text.includes('S3 → S4'), result.text.split('\n')[0])
  result = await call({ action: 'advance' })
  ok(
    '淘汰的机制命题也进 S5 的重判清单',
    result.text.includes('拒绝推进') && result.text.includes('M-002'),
    result.text.split('\n').filter((line) => line.includes('M-002')).join(' '),
  )
  w('audit/recheck-S5.md', recheck('S5', ['N-004', 'M-002']))
  result = await call({ action: 'check' })
  ok('补上 S5 重判后 S4 通过', result.text.includes('PASS'), result.text.split('\n').filter((line) => line.includes('✗')).join(' '))

  w('decisions/D-001-paper-ink.md', `---\nid: D-001\ntitle: 采用纸墨作为核心理念\nstatus: accepted\nstage: S3\nsources: [L-001, N-003]\nassumption: false\ndissent: false\nupdated: 2026-01-04\n---\n\n## 决定\n\n以 N-003 为顶芽。\n`)
  w('audit/challenges.md', `# 异议与反对记录\n\n## X-001 三态提示会被牺牲\n\n- 主张: 只有墨色时错误状态无法表达\n- 证据: L-002 的判据\n- 代价: 错误提示不可见\n- 替代方案: 允许一个语义色\n- 可证伪判据: 实际界面里出现第三种颜色的频率\n- 结论: 采纳（已在边界里加入显式例外）\n`)
  w('concept/concept.md', concept('final', `
## 推演链

seed → L-001 → N-001 → N-003
seed → L-002 → N-002 → N-003
seed → L-001 → N-001 → M-001

## 已知反对与回应

- X-001 三态提示会被牺牲 → 采纳：边界里允许一个语义色，但限定用途。
`))
  process.stdout.write('\n[8.5] 理念概念与机制命题的分工\n')
  // S4 is the stage that owes a recheck before S5, and it runs before
  // `tech/options.md` exists — which is exactly the window these cases need.
  const stage3 = state()
  stage3.stage = 'S3'
  writeState(stage3)
  const conceptFinal = readFileSync(join(root, 'concept', 'concept.md'), 'utf8')
  w('concept/concept.md', conceptFinal.replace('## 它生成的主张', '## 生成的东西'))
  result = await call({ action: 'check' })
  ok(
    '概念缺“它生成的主张”时不许进 S5',
    result.text.includes('stage.S3.apical') && result.text.includes('它生成的主张'),
    result.text.split('\n').filter((line) => line.includes('它生成的主张')).join(' '),
  )
  w('concept/concept.md', conceptFinal)
  const stage4 = state()
  stage4.stage = 'S4'
  writeState(stage4)

  const extensionsFinal = readFileSync(join(root, 'concept', 'extensions.md'), 'utf8')
  w('concept/extensions.md', extensionsFinal.replace('- 服务: 第 1 条 ← N-001\n', ''))
  result = await call({ action: 'check' })
  ok(
    '机制命题缺 服务: 时被拦下',
    result.text.includes('stage.S4.mechanisms') && result.text.includes('缺少 服务'),
    result.text.split('\n').filter((line) => line.includes('✗')).join(' '),
  )
  w('concept/extensions.md', extensionsFinal)

  w('layers/L-002-attention.md', readFileSync(join(root, 'layers', 'L-002-attention.md'), 'utf8').replace('confirmed: true', 'confirmed: true\nstale: true'))
  result = await call({ action: 'check' })
  ok(
    '上游被撤回波及（stale: true）时不许推进',
    result.text.includes('tree.stale') && result.text.includes('L-002'),
    result.text.split('\n').filter((line) => line.includes('stale')).join(' '),
  )
  w('layers/L-002-attention.md', LAYER_ATTENTION)

  process.stdout.write('\n[8.6] 重判不是盖章：维持也要写理由\n')
  w('audit/recheck-S5.md', recheck('S5', ['N-004', 'M-002']).replace('- 理由: 演示用例里条件没有变化\n', ''))
  result = await call({ action: 'check' })
  ok(
    '重判条目缺理由时不许推进',
    result.text.includes('recheck.S5') && result.text.includes('理由'),
    result.text.split('\n').filter((line) => line.includes('recheck')).join(' '),
  )
  w('audit/recheck-S5.md', recheck('S5', ['N-004', 'M-002']))

  round(6, 'S5')
  result = await call({ action: 'advance' })
  ok('S5 advance 成功', result.text.includes('已推进') && result.text.includes('S4 → S5'), result.text.split('\n')[0])

  w('tech/criteria.md', `---\nkind: criteria\nstatus: locked\nstage: S6\nlocked_at: "2026-01-05 09:00"\nupdated: 2026-01-05\n---\n\n# 判据\n\n## K-001 色相数量可控\n\n- 权重: 高\n- 硬约束: 是\n- 判据内容: 默认界面不需要第二种色相即可表达层级\n- 来源: M-001\n\n## K-002 字重与留白可控\n\n- 权重: 高\n- 硬约束: 否\n- 判据内容: 层级可由字重与间距表达\n- 来源: L-002\n\n## K-003 静态渲染\n\n- 权重: 中\n- 硬约束: 是\n- 判据内容: 首屏不依赖客户端脚本即可阅读\n- 来源: L-001\n\n## K-004 团队上手成本\n\n- 权重: 中\n- 硬约束: 否\n- 判据内容: 一周内可维护\n- 来源: R-000\n\n## K-005 生态寿命\n\n- 权重: 低\n- 硬约束: 否\n- 判据内容: 依赖仍在维护\n- 来源: N-001\n`)
  w('tech/options.md', `---\nkind: options\nstatus: draft\nstage: S6\ncreated: "2026-01-05 10:00"\nupdated: 2026-01-05\n---\n\n# 候选\n\n## 清单来源\n\n本机已有的框架与手写 CSS 两条路；没查：其他渲染目标的可行性。\n\n## O-001 语义化 HTML + 单色 CSS 变量\n\n- 判定: 采纳\n- 推演来源: N-003\n- 证据: E2\n- 证据来源: 30 行原型跑通两种字重层级\n- 满足判据: K-001 满足、K-002 满足\n\n## O-002 组件库主题 + 暗色模式\n\n- 判定: 淘汰\n- 推演来源: N-004\n- 证据: E1\n- 证据来源: 官方文档\n- 拒绝理由: K-001 硬约束要求默认界面不引入第二种色相，组件库默认主题自带强调色。\n- 复活条件: 若状态提示的语义色被提升为必需，它自带强调色反而成为优点。\n`)
  w('tech/selection.md', `---\nkind: selection\nstatus: final\nstage: S7\nupdated: 2026-01-06\n---\n\n# 选型定稿\n\n## 选定方案\n\n语义化 HTML + 单色 CSS 变量体系。\n\n## 判据对照\n\n| 判据 | 权重 | 结论 | 依据 |\n|---|---|---|---|\n| K-001 | 高 | 满足 | E2 原型 |\n\n## 拒绝理由汇总\n\n| 方案 | 失败判据 |\n|---|---|\n| O-002 | K-001 |\n\n## 退出成本与迁移\n\n换主题体系只需替换变量表，无需重写结构。\n\n## 未验证假设\n\n无\n`)
  w('audit/recheck-S7.md', recheck('S7', ['N-004', 'M-002', 'O-002']))
  round(7, 'S6')
  w('audit/recheck-S6.md', recheck('S6', ['N-004', 'M-002', 'O-002']))
  result = await call({ action: 'check' })
  ok('S6 出口条件通过', result.text.includes('PASS'), result.text.split('\n').filter((line) => line.includes('✗')).join(' '))
  result = await call({ action: 'advance' })
  ok('S6 advance 成功', result.text.includes('已推进') && result.text.includes('S5 → S6'), result.text.split('\n')[0])

  round(8, 'S7')
  result = await call({ action: 'check' })
  ok('S7 check 通过', result.text.includes('PASS'), result.text.split('\n').slice(0, 4).join(' / '))
  result = await call({ action: 'advance' })
  ok('S7 advance 成功', result.text.includes('已推进') && result.text.includes('S6 → S7'), result.text.split('\n')[0])
  result = await call({ action: 'advance' })
  ok('S7 是终态，拒绝推进', result.text.includes('终态'), result.text.split('\n')[0])
  w('audit/recheck-S7.md', recheck('S7', ['N-004', 'M-002', 'O-002']))
  result = await call({ action: 'check' })
  ok('S7 check 通过', result.text.includes('PASS'), result.text.split('\n').slice(0, 4).join(' / '))
  result = await call({ action: 'advance' })
  process.stdout.write('DEBUG-S7:\n' + result.text + '\n')
  ok('S7 是终态，拒绝推进', result.text.includes('终态'), result.text.split('\n')[0])

  process.stdout.write('\n[6] 门禁：孤儿节点与断链\n')
  const saved = state()
  saved.stage = 'S2'
  writeState(saved)
  w('derivation/N-005-cycle-a.md', `---\nid: N-005\ntitle: 环 A\nfrom: [N-006]\nstatus: kept\nevidence: 无\nupdated: 2026-01-07\n---\n\n## 推演\n\nA 从 B 推出。\n\n## 反例\n\n无。\n\n## 调研佐证\n\n无（纯推演）。\n`)
  w('derivation/N-006-cycle-b.md', `---\nid: N-006\ntitle: 环 B\nfrom: [N-005]\nstatus: kept\nevidence: 无\nupdated: 2026-01-07\n---\n\n## 推演\n\nB 从 A 推出。\n\n## 反例\n\n无。\n\n## 调研佐证\n\n无（纯推演）。\n`)
  result = await call({ action: 'advance' })
  ok('拒绝推进含孤儿/自环节点的树', result.text.includes('拒绝推进') && result.text.includes('tree.connected'), result.text.split('\n')[1])
  rmSync(join(root, 'derivation/N-005-cycle-a.md'), { force: true })
  rmSync(join(root, 'derivation/N-006-cycle-b.md'), { force: true })

  process.stdout.write('\n[7] 门禁：术语墙\n')
  w('glossary.md', `# 术语表\n\n- **承载信息** [确认]：直接表达内容或层级的元素，不含装饰。\n- **纸墨感** [确认]：界面像纸与墨的关系，只有承载信息的墨色，没有装饰性的彩。\n- **可回退** [确认]：任何自动动作都能在撤销窗口内恢复。\n- **呼吸感** [提案]：版面上让人不紧张的那种疏密。\n- **留白节奏** [提案]：空白分布形成的节拍。\n`)
  result = await call({ action: 'check' })
  ok('未确认术语超过 1 个时告警', result.text.includes('glossary.pending'), result.text.split('\n').filter((line) => line.includes('glossary')).join(' '))
  w('glossary.md', `# 术语表\n\n- **纸墨感** [确认]：界面像纸与墨的关系，只有承载信息的墨色，没有装饰性的彩。\n- **可回退** [确认]：任何自动动作都能在撤销窗口内恢复。\n- **承载信息** [提案]：直接表达内容或层级的元素，不含装饰。\n- **留白节奏** [确认]：留白节奏由字重与间距共同表达的一种层级感。\n`)
  result = await call({ action: 'check' })
  ok('用未定义的术语解释自己会被拒绝', result.text.includes('glossary.terms'), result.text.split('\n').filter((line) => line.includes('glossary.terms')).join(' '))

  process.stdout.write('\n[8] 门禁：推演链断链\n')
  saved.stage = 'S5'
  writeState(saved)
  w('glossary.md', `# 术语表\n\n- **承载信息** [确认]：直接表达内容或层级的元素，不含装饰。\n- **纸墨感** [确认]：界面像纸与墨的关系，只有承载信息的墨色，没有装饰性的彩。\n- **可回退** [确认]：任何自动动作都能在撤销窗口内恢复。\n`)
  w('concept/concept.md', concept('final', `
## 推演链

seed → L-002 → N-001 → N-003

## 已知反对与回应

- X-001 → 采纳。
`))
  result = await call({ action: 'advance' })
  ok('推演链与节点父子关系不符时拒绝定稿', result.text.includes('推演链断裂'), result.text.split('\n').filter((line) => line.includes('推演链')).join(' '))

  process.stdout.write('\n[9] 裁决：终止后停止推进\n')
  result = await call({ action: 'verdict', status: 'stop', reason: '演示：种子与层冲突（L-001 vs L-002）' })
  ok('裁决已记录', result.text.includes('V-001') && result.text.includes('终止'), result.text.split('\n')[0])
  ok('verdict.md 落盘', readFileSync(join(root, 'audit', 'verdict.md'), 'utf8').includes('## V-001 终止'))
  result = await call({ action: 'advance' })
  ok('终止后拒绝推进任何阶段', result.text.includes('终止'), result.text.split('\n')[0])
  ok('gates.log 有记录', readFileSync(join(root, 'audit', 'gates.log'), 'utf8').split('\n').length > 5)

  process.stdout.write('\n[10] 门禁脚本解析（回归：cordis 未注入服务）\n')
  const isolated = isolatedPresetDir('isolated')
  const statusCall = (instance) => instance.tools
    .find((definition) => definition.name === 'apical_gate')
    .execute({ action: 'status', root: join(root) }, { agent: fakeAgent().agent, signal: new AbortController().signal })

  // A. 注册表可用、但 ctx.skills 属性访问抛错（线上故障的形态）。
  //    隔离目录里没有任何文件系统回退路径，所以「成功」只可能来自 ctx.get('skills')。
  const resolvable = mockContext({ registry: 'throwing', skillDir })
  await (await import(pathToFileURL(join(isolated, 'apical-gate.mjs')).href)).apply(resolvable.ctx, { base: 'design', skillName: 'apical-bud' })
  const reportA = await statusCall(resolvable)
  ok('属性访问抛错时仍经 ctx.get 解析到脚本', reportA.text.includes('门禁:') && !reportA.text.includes('找不到门禁脚本'), reportA.text.split('\n').slice(0, 2).join(' / '))

  // B. 注册表完全不可用 → 环境变量回退仍应生效。
  process.env.APICAL_GATE_SCRIPT = join(skillDir, 'scripts', 'gate.mjs')
  const envOnly = mockContext({ registry: 'absent' })
  await (await import(pathToFileURL(join(isolated, 'apical-gate.mjs')).href)).apply(envOnly.ctx, { base: 'design', skillName: 'apical-bud' })
  const reportB = await statusCall(envOnly)
  ok('注册表不可用时走环境变量回退', reportB.text.includes('门禁:'), reportB.text.split('\n')[1])
  delete process.env.APICAL_GATE_SCRIPT

  // C. 全都不可用 → 必须报出取证细节，而不是一句「找不到」。
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(sandbox, 'empty-home')
  const nothing = mockContext({ registry: 'absent' })
  await (await import(pathToFileURL(join(isolated, 'apical-gate.mjs')).href)).apply(nothing.ctx, { base: 'design', skillName: 'apical-bud' })
  const reportC = await statusCall(nothing)
  ok('失败时列出已尝试路径', reportC.text.includes('已尝试的路径都不存在') && reportC.text.includes('✗ '), reportC.text.split('\n')[0])
  ok('失败时说明注册表为何没给出路径', reportC.text.includes('技能注册表：'), reportC.text.split('\n').filter((l) => l.includes('技能注册表')).join(' '))
  ok('失败时给出三条修法', reportC.text.includes('gateScript') && reportC.text.includes('APICAL_GATE_SCRIPT') && reportC.text.includes('skills/apical-bud'), reportC.text.split('\n').slice(-1)[0].slice(0, 80))
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome

  process.stdout.write('\n[11] 讨论先行：答复之前不得新建讨论文件\n')
  const sessionWith = (events) => {
    const holder = fakeAgent()
    holder.session.events.push(...events)
    return holder.agent
  }
  const userMsg = (text) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const askedCall = (callId) => ({ type: 'tool/call', data: { name: 'ask_user_question', callId, arguments: {} } })
  const answered = (callId) => ({ type: 'tool/result', data: { message: { source: { kind: 'tool', callId } } } })
  const wroteCall = (callId, path) => ({ type: 'tool/call', data: { name: 'write', callId, arguments: { file_path: path } } })
  const newLayer = { file_path: 'design/paper-ink/layers/L-009-new.md', content: 'x' }

  ok('答复之前新建层文件被拦下', typeof guardCheck('write', newLayer, sessionWith([userMsg('我想聊聊这个前端')])) === 'string')
  ok('提问但未答复时仍被拦下', typeof guardCheck('write', newLayer, sessionWith([userMsg('我想聊聊这个前端'), askedCall('q1')])) === 'string')
  ok('拿到答复后允许落盘', guardCheck('write', newLayer, sessionWith([userMsg('我想聊聊这个前端'), askedCall('q1'), answered('q1')])) === undefined)
  ok('上一轮答复后又写过 → 新提案仍被拦下', typeof guardCheck('write', newLayer, sessionWith([userMsg('继续'), askedCall('q1'), answered('q1'), wroteCall('w1', 'design/paper-ink/seed/real-need.md')])) === 'string')
  ok('用户明确要求记录时放行', guardCheck('write', newLayer, sessionWith([userMsg('把刚才说的这两层记录进文件')])) === undefined)
  ok('账本：轮次纪要不受限制', guardCheck('write', { file_path: 'design/paper-ink/rounds/round-009.md', content: 'x' }, sessionWith([userMsg('…')])) === undefined)
  // 用户原话已存在时会先撞上 append-only 规则，所以先挪开再测「首次创建」这条豁免。
  renameSync(join(root, 'seed/R-000-original.md'), join(root, 'seed/.R-000.bak'))
  ok('账本：用户原话首次创建不受限制', guardCheck('write', { file_path: 'design/paper-ink/seed/R-000-original.md', content: 'x' }, sessionWith([userMsg('…')])) === undefined)
  renameSync(join(root, 'seed/.R-000.bak'), join(root, 'seed/R-000-original.md'))
  ok('账本：audit/ 下的记录不受限制', guardCheck('write', { file_path: 'design/paper-ink/audit/notes.md', content: 'x' }, sessionWith([userMsg('…')])) === undefined)
  // state.json 的内容必须与盘上一致，否则先撞上 stage/verdict 不变量（那是另一条规则）。
  const currentState = readFileSync(join(root, 'state.json'), 'utf8')
  ok('账本：state.json 不受限制', guardCheck('write', { file_path: 'design/paper-ink/state.json', content: currentState }, sessionWith([userMsg('…')])) === undefined)
  ok('修正既有文件不受此规则限制', guardCheck('edit', { file_path: 'design/paper-ink/layers/L-001-visual.md', old_string: 'a', new_string: 'b' }, sessionWith([userMsg('第 2 条判据错了')])) === undefined)
  ok('横幅提醒对话先行', (await banner(fakeAgent().session)).some((message) => message.content[0].text.includes('对话先行')))

  process.stdout.write('\n[12] 机械记账：state.round 只提醒、且被自动同步\n')
  const drifted = state()
  drifted.stage = 'S1'
  drifted.round = 0
  writeState(drifted)
  const driftCheck = await call({ action: 'check' })
  ok('state.round 不一致不再阻塞阶段', driftCheck.text.includes('! rounds.state-sync') && !driftCheck.text.includes('✗ rounds.state-sync'), driftCheck.text.split('\n').filter((line) => line.includes('rounds')).join(' | '))
  ok('check 自动把 state.round 同步为轮次文件数', state().round === 8, `round=${state().round}`)
  ok('输出里说明同步动作', driftCheck.text.includes('机械记账已同步'), driftCheck.text.split('\n').filter((line) => line.includes('同步')).join(' '))

  process.stdout.write('\n[13] 一个项目多棵树\n')
  // 第二棵树：不同阶段的新需求，并与第一棵树声明关联。
  const second = join(sandbox, 'design', 'paper-ink-2')
  mkdirSync(join(second, 'seed'), { recursive: true })
  writeFileSync(join(second, 'state.json'), JSON.stringify({
    schema: 1, topic: '第二棵树：纸墨前端的下一个阶段', slug: 'paper-ink-2', stage: 'S0', round: 0,
    dependsOn: ['paper-ink'], relation: '沿用纸墨前端的视觉结论，只重做交互层', gates: {},
    verdict: { status: 'continue', at: null, note: '' },
  }, null, 2))
  writeFileSync(join(second, 'seed', 'R-000-original.md'), `---\nid: R-000\ntitle: 用户原话\nstatus: accepted\nstage: S0\nsources: []\nassumption: false\nupdated: 2026-01-08\n---\n\n> 交互也得像纸墨那样克制：不要装饰性动效，不要为了好看而动的元素。\n`)
  writeFileSync(join(second, 'seed', 'real-need.md'), `---\nkind: seed\nstatus: confirmed\nstatement: 交互层与纸墨视觉一致，不做装饰性动效\nupdated: 2026-01-08\n---\n\n## 被否的表述\n\n- "加点微交互" —— 为什么否：与"不被打断"冲突。\n\n## 非目标\n\n- 不做手势库 —— 理由：与视觉一致性无关。\n`)
  const multiAgent = fakeAgent().agent
  const inSecond = { file_path: 'design/paper-ink-2/layers/L-001-x.md', content: 'x' }
  const inFirst = { file_path: 'design/paper-ink/layers/L-001-y.md', content: 'x' }
  ok('未绑定时允许写任意已有树', guardCheck('write', inSecond, multiAgent) === undefined && guardCheck('write', inFirst, multiAgent) === undefined)
  ok('树之外仍然拒绝', typeof guardCheck('write', { file_path: 'src/app.ts', content: 'x' }, multiAgent) === 'string')
  ok('design/ 顶层散文件仍然拒绝', typeof guardCheck('write', { file_path: 'design/notes.md', content: 'x' }, multiAgent) === 'string')
  const multiBanner = await banner((() => { const holder = fakeAgent(); holder.session.events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] } }); return holder.session })())
  ok('未绑定时横幅列出全部树并要求绑定', multiBanner.some((message) => message.content[0].text.includes('尚未绑定') && message.content[0].text.includes('paper-ink-2')), (multiBanner[0]?.content[0].text ?? '').split('\n')[0])

  const treesReport = await call({ action: 'trees' })
  ok('trees 列出两棵树与生命周期', treesReport.text.includes('共 2 棵树') && treesReport.text.includes('paper-ink') && treesReport.text.includes('paper-ink-2'), treesReport.text.split('\n')[1])
  const bindAgent = agentWithInject()
  const bindReport = await callWith({ action: 'bind', slug: 'paper-ink-2' }, bindAgent)
  ok('bind 成功并给出新树状态', bindReport.text.includes('已绑定') && bindReport.text.includes('paper-ink-2'), bindReport.text.split('\n')[0])
  ok('绑定标记落进会话事件（可持久恢复）', bindAgent.session.events.some((event) => event?.data?.source?.kind === 'apical-focus' && event.data.source !== undefined))
  const statusAfterBind = await callWith({ action: 'status' }, bindAgent)
  ok('不传 root 也能解析到绑定的树', statusAfterBind.text.includes('paper-ink-2') && statusAfterBind.text.includes('阶段: S0'), statusAfterBind.text.split('\n')[0])
  ok('绑定后不能写别的树', typeof guardCheck('write', inFirst, bindAgent) === 'string')
  ok('绑定后可写本树', guardCheck('write', { file_path: 'design/paper-ink-2/seed/notes.md', content: 'x' }, bindAgent) === undefined)
  ok('绑定后仍可新建第三棵树', guardCheck('write', { file_path: 'design/paper-ink-3/state.json', content: '{}' }, bindAgent) === undefined)
  const bindGhost = await callWith({ action: 'bind', slug: 'ghost-tree' }, bindAgent)
  ok('bind 不存在的树给出可用列表', bindGhost.text.includes('没有找到') && bindGhost.text.includes('paper-ink-2'), bindGhost.text.split('\n')[0])

  process.stdout.write('\n[14] 树与树的关联\n')
  const missingRelation = await callWith({ action: 'check', root: 'design/paper-ink-2' }, fakeAgent().agent)
  ok('声明 dependsOn 却没写「与已有树的关系」→ 拒绝', missingRelation.text.includes('与已有树的关系'), missingRelation.text.split('\n').filter((line) => line.includes('关系')).join(' '))
  writeFileSync(join(second, 'seed', 'real-need.md'), `---\nkind: seed\nstatus: confirmed\nstatement: 交互层与纸墨视觉一致，不做装饰性动效\nupdated: 2026-01-08\n---\n\n## 被否的表述\n\n- "加点微交互" —— 为什么否：与"不被打断"冲突。\n\n## 非目标\n\n- 不做手势库。\n\n## 与已有树的关系\n\n- 继承 paper-ink#L-002 的"层级靠留白与字重"；推翻它的动效例外。\n`)
  const withRelation = await callWith({ action: 'check', root: 'design/paper-ink-2' }, fakeAgent().agent)
  ok('写了关系之后 S0 通过', withRelation.text.includes('PASS'), withRelation.text.split('\n').slice(2, 4).join(' / '))
  const ghostState = JSON.parse(readFileSync(join(second, 'state.json'), 'utf8'))
  ghostState.dependsOn = ['ghost-tree']
  writeFileSync(join(second, 'state.json'), JSON.stringify(ghostState, null, 2))
  const ghostReport = await callWith({ action: 'check', root: 'design/paper-ink-2' }, fakeAgent().agent)
  ok('依赖不存在的树只是提醒', ghostReport.text.includes('! trees.dependsOn') && !ghostReport.text.includes('✗ trees.dependsOn'), ghostReport.text.split('\n').filter((line) => line.includes('trees.')).join(' '))
  ghostState.dependsOn = ['paper-ink']
  writeFileSync(join(second, 'state.json'), JSON.stringify(ghostState, null, 2))

  process.stdout.write('\n[15] 已结束的树\n')
  const finished = JSON.parse(readFileSync(join(second, 'state.json'), 'utf8'))
  finished.verdict = { status: 'stop', at: '2026-01-09 10:00', note: '演示：终止' }
  writeFileSync(join(second, 'state.json'), JSON.stringify(finished, null, 2))
  const treesAgain = await call({ action: 'trees' })
  ok('trees 标出已终止的树并给出新建建议', treesAgain.text.includes('已终止') && treesAgain.text.includes('dependsOn'), treesAgain.text.split('\n').slice(-1)[0])
  const bindStopped = await callWith({ action: 'bind', slug: 'paper-ink-2' }, agentWithInject())
  ok('绑定已终止的树会给出重启提示', bindStopped.text.includes('终止') && bindStopped.text.includes('verdict'), bindStopped.text.split('\n').slice(-2)[0])

  process.stdout.write(failures === 0 ? '\n全部通过 ✓\n' : `\n失败 ${failures} 项 ✗\n`)
  if (failures === 0) rmSync(sandbox, { recursive: true, force: true })
  else process.stdout.write(`保留现场以便排查: ${sandbox}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}

await main()
