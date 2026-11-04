/**
 * smoke.mjs — a zero-dependency check that the guard and the banner still work.
 *
 * It mounts `apical-guard` against a fake Cordis context and asserts the
 * behaviours the preset leans on: the write scope, the append-only 用户原话,
 * the boundary escape hatches, and the one-line banner. Run it after editing the
 * plugin; it takes under a second and needs nothing but node.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from './apical-guard.mjs'

let failures = 0
const ok = (condition, label) => {
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    failures += 1
    console.log(`  ✗ ${label}`)
  }
}

/** Mount the plugin against a fake context; return the pieces it registered. */
function mount(config = { base: 'design', banner: true, allowPaths: [] }) {
  const guards = []
  const handlers = new Map()
  const ctx = {
    get: () => undefined,
    tools: { guard: (fn) => guards.push(fn), register: () => {} },
    on: (event, handler) => handlers.set(event, handler),
  }
  apply(ctx, config)
  return { guards, handlers }
}

const seedText = `# 种子：记一笔

## 用户原话

> 我想在最顺手的地方记一笔

## 核心问题

下班路上怎么用最少的动作记下一件事

## 主链（核心，恰好一条）

- 场景：下班路上想起要买的东西
- 起点动作：点输入框
- 终点用户看见：列表里多了一条
- 放弃：分类
- 代价：东西多了只能搜

## 边界

- 不做什么：不做多设备同步。越界后果：换手机看不到
- 做不到什么：不做离线冲突合并。越界后果：断网时只留本地
- 只适配什么场景：手机浏览器。越界后果：桌面不保证
`

const flowText = `# 数据流：记一笔

## 现状

- 主链：记一笔（点输入框 → 列表多一条）
- 停在：A-02 点「存」的失败出口
- 下一步：补空内容的失败提示

## 状态

- S-00 启动：空列表
- S-01 输入中：输入框有字

## 动作

- A-01 点输入框：S-00 → S-01；读：无；写：空记录；看见：光标；失败：存储不可用
- A-02 点「存」：S-01 → S-00；读：输入框；写：列表；看见：新条目；失败：空内容 → 抖动

## 缺口

- G-01 记录存哪：查本地存储容量后定
- G-02 删除怎么撤销：先不做，写进边界
`

/** Build an execution object the guard can judge. */
const call = (cwd, file, extra = {}) => ({ name: 'write', arguments: { file_path: file, ...extra }, agent: { session: { header: { cwd } } } })

/** Fire one user turn through the captured pre-step handler. */
async function turn(handler, cwd, turns = 1) {
  const events = Array.from({ length: turns }, () => ({ type: 'user/message', data: { source: { kind: 'user' } } }))
  const agent = { session: { id: 's1', header: { cwd }, events } }
  const decision = await handler({ agent, signal: undefined }, async () => ({ messages: [] }))
  return decision.messages ?? []
}

const root = mkdtempSync(join(tmpdir(), 'apical-smoke-'))
try {
  const design = join(root, 'design', 'demo')
  mkdirSync(design, { recursive: true })
  writeFileSync(join(design, 'seed.md'), seedText)
  writeFileSync(join(design, 'flow.md'), flowText)

  console.log('[1] 写守卫：只放行讨论根')
  {
    delete process.env.DSH_APICAL_UNLOCK
    const { guards } = mount()
    const guard = guards[0]
    ok(guards.length === 1, '注册了一个守卫')
    ok(guard(call(root, 'notes.txt')) !== undefined, 'denies a file at the project root')
    ok(guard(call(root, 'design/notes.md')) !== undefined, 'denies a loose file under design/')
    ok(guard(call(root, join('design', 'demo', 'flow.md'))) === undefined, 'allows a file inside a root')
    ok(guard(call(root, join('design', 'newtree', 'seed.md'))) === undefined, 'allows creating a new root')
    ok(guard({ name: 'read', arguments: { file_path: 'notes.txt' }, agent: { session: { header: { cwd: root } } } }) === undefined, 'leaves read alone')
  }

  console.log('[2] 用户原话：只追加')
  {
    const { guards } = mount()
    const guard = guards[0]
    const seed = join(root, 'design', 'demo', 'seed.md')
    ok(guard(call(root, seed, { content: seedText.replace('我想在最顺手的地方记一笔', '我想记两笔') })) !== undefined, 'denies rewriting the recorded words')
    ok(guard(call(root, seed, { content: `${seedText}\n> 再加一条原话\n` })) === undefined, 'allows appending a new line')
    ok(guard({ name: 'edit', arguments: { file_path: seed, old_string: '下班路上怎么用最少的动作记下一件事', new_string: '记一件事最少的动作是什么' }, agent: { session: { header: { cwd: root } } } }) === undefined, 'allows editing the conclusions')
  }

  console.log('[3] 逃生阀')
  {
    const { guards } = mount({ base: 'design', banner: true, allowPaths: ['src/'] })
    const guard = guards[0]
    ok(guard(call(root, 'src/app.js')) === undefined, 'allowPaths lets a project dir through')
    ok(guard(call(root, 'notes.txt')) !== undefined, 'allowPaths does not widen the rest')
    process.env.DSH_APICAL_UNLOCK = '1'
    const unlocked = mount()
    ok(unlocked.guards.length === 0, 'DSH_APICAL_UNLOCK=1 registers no guard')
    delete process.env.DSH_APICAL_UNLOCK
  }

  console.log('[4] 横幅：一行现状')
  {
    const { handlers } = mount()
    const handler = handlers.get('agent/pre-step')
    const first = await turn(handler, root)
    ok(first.length === 1, 'injects one line on the first turn')
    const text = first[0]?.content?.[0]?.text ?? ''
    ok(text.includes('demo'), 'names the tree')
    ok(text.includes('下班路上'), 'carries the core question')
    ok(text.includes('A-02'), 'carries the current state')
    ok(text.includes('缺口 2'), 'counts the open gaps')
    ok(text.includes('边界 齐'), 'reports the boundary answers')
    const again = await turn(handler, root, 0)
    ok(again.length === 0, 'stays quiet when nothing changed')
    writeFileSync(join(design, 'flow.md'), `${flowText.replace('停在：A-02 点「存」的失败出口', '停在：G-01 记录存哪')}\n`)
    const changed = await turn(handler, root, 0)
    ok(changed.length === 1 && String(changed[0]?.content?.[0]?.text ?? '').includes('G-01'), 'speaks again when the anchor files change')
  }

  console.log('[5] 没有树时给入口')
  {
    const empty = mkdtempSync(join(tmpdir(), 'apical-smoke-empty-'))
    try {
      const { handlers } = mount()
      const messages = await turn(handlers.get('agent/pre-step'), empty)
      const text = messages[0]?.content?.[0]?.text ?? ''
      ok(text.includes('templates/seed.md'), 'points at the seed template')
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  }
  console.log('[6] 配置不带模板变量')
  {
    // dsh 0.2.1-rc.3 registers only the prompt variables a plugin publishes
    // (provider/model); the working directory is literal context, not a variable.
    // An unregistered placeholder in the persona fails the whole prompt
    // assembly, so keep template syntax out of this preset's non-comment lines.
    const preset = readFileSync(new URL('./agent.cordis.yml', import.meta.url), 'utf8')
    const offending = preset
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .filter((line) => line.includes('{{'))
    ok(offending.length === 0, `agent.cordis.yml has no template variables (found ${offending.length})`)
  }

  console.log('[7] 旧树只读')
  {
    const legacyRoot = join(root, 'design', 'legacy')
    mkdirSync(legacyRoot, { recursive: true })
    writeFileSync(join(legacyRoot, 'seed.md'), '# 种子：旧树\n\n## 核心问题\n旧的\n')
    writeFileSync(join(legacyRoot, 'facts.md'), '# 事实\n')
    const { handlers } = mount()
    const messages = await turn(handlers.get('agent/pre-step'), root)
    const text = messages[0]?.content?.[0]?.text ?? ''
    ok(text.includes('旧树'), 'marks a v1 tree read-only')
  }

  console.log('[8] 压力卡：三处载体对齐')
  {
    // The rule has one body (references/flow.md) and three carriers: the scene
    // section, the need-line table, and the L1 line. If one of them stops
    // mentioning the pressure card, the method silently loses it at whichever
    // layer the model happens to read first — so assert all three.
    const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
    const flow = read('../references/flow.md')
    const seedTemplate = read('../templates/seed.md')
    const skill = read('../SKILL.md')
    ok(flow.includes('### 压力卡') && flow.includes('| 升为需求线 |'), 'flow.md: 场景卡节有压力卡与分流表')
    ok(['不要求通过', '边界三问', '作废'].every((k) => flow.includes(k)), 'flow.md: 三出口与「不要求通过」都在')
    ok(flow.includes('攒成一摞'), 'flow.md: 偏离表能抓到「堆卡」')
    ok(seedTemplate.includes('| 出自 |'), 'seed 模板: 需求线表有「出自」列')
    ok(skill.includes('压力卡'), 'SKILL.md: L1 提到压力卡')
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.log(`\n${failures} 项失败`)
  process.exit(1)
}
console.log('\n全部通过 ✓')
