/**
 * apical-guard — three mechanisms that make the tree's rules true in a running
 * session instead of requested in prose.
 *
 * 1. WRITE GUARD: a monotonic `ctx.tools.guard()` that denies `write`/`edit`
 *    outside the discussion root, so a discussion session never quietly starts
 *    editing production code.
 * 2. DISCUSSION-FIRST GUARD: creating a NEW discussion document is refused until
 *    the user has answered something in this turn. The first version of this
 *    preset let the model materialise proposals into files and then ask "please
 *    review L-001" — the user had to open a file to take part, and the Q&A flow
 *    broke. Files are the LEDGER of a discussion, never its medium: proposals,
 *    options, derivation chains and counterexamples belong in the conversation,
 *    and land on disk only once the user has answered. Record-shaped files
 *    (verbatim seed, round minutes, state, audit) and explicit user
 *    instructions to write are exempt.
 * 3. APPEND-ONLY GUARD: the same guard refuses to rewrite `seed/R-000-original.md`
 *    or an existing `rounds/round-NNN.md`. The verbatim seed and the round
 *    minutes are the tree's history; editing them would silently rewrite what
 *    was actually said.
 * 4. STATE INVARIANTS: `state.json` is whole-file only, and its `stage` and
 *    `verdict` fields belong to `apical_gate` — the one actor that can only move
 *    them after the exit criteria pass.
 * 5. STATE BANNER: one short injected message per user turn (and whenever the
 *    recorded state changes) carrying the real stage, round, tree size, pending
 *    terminology and last gate result. State the model has to remember is state
 *    it will eventually get wrong — after compaction especially — so the session
 *    reads it from the filesystem each turn.
 *
 * MULTIPLE TREES: a project legitimately holds several trees — one per need or
 * phase, sometimes related. A session binds to one of them (`apical_gate
 * action=bind`), and the guard then scopes writes to that tree while allowing
 * new trees to be created; before a binding exists it permits writes inside any
 * existing tree instead of refusing everything, and the banner asks for the
 * binding. See `activeTree()`.
 *
 * Escape hatches, deliberately explicit: `DSH_APICAL_UNLOCK=1` in the host
 * environment disables the guard entirely (for the user, not the model), and
 * `allowPaths` in the row's config whitelists extra prefixes.
 */

import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import {
  DEFAULT_BASE,
  discoverRoot,
  isInside,
  listRoots,
  openQuestions,
  readFocusSlug,
  readState,
  relPath,
  treeCounts,
  treeSummary,
} from './lib/apical-state.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'apical-guard'

/** The tool registry must exist before a guard can be registered. */
export const inject = ['tools']

/** Injected message sources that must not count as user turns. */
const INJECTED_SOURCES = new Set(['apical-banner', 'apical-focus', 'instruction-hint', 'skill-invocation', 'skill-catalog'])

/** Register the guards and the per-turn state banner. */
export function apply(ctx, config) {
  const base = typeof config.base === 'string' && config.base.trim() !== '' ? config.base : DEFAULT_BASE
  const allowPaths = Array.isArray(config.allowPaths)
    ? config.allowPaths.filter((value) => typeof value === 'string' && value.trim() !== '')
    : []
  const bannerEnabled = config.banner !== false
  const unlocked = process.env.DSH_APICAL_UNLOCK === '1'

  if (!unlocked) {
    ctx.tools.guard((execution) => {
      try {
        return guardReason(execution, base, allowPaths)
      } catch {
        // A guard bug must never brick the session: fall through to "allowed".
        return undefined
      }
    })
  }

  if (!bannerEnabled) return

  /** Per-session injection bookkeeping: turn cursor + last injected state. */
  const marks = new Map()

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    try {
      if (agent?.parentAgent !== undefined) return decision
      const session = agent?.session
      if (session === undefined) return decision

      const mark = marks.get(session.id) ?? { cursor: 0, turns: 0, lastTurns: -1, hash: '', seq: 0 }
      const events = Array.isArray(session.events) ? session.events : []
      for (let index = mark.cursor; index < events.length; index += 1) {
        const event = events[index]
        if (event?.type !== 'user/message') continue
        const source = event.data?.source?.kind
        if (typeof source === 'string' && INJECTED_SOURCES.has(source)) continue
        mark.turns += 1
      }
      mark.cursor = events.length

      const cwd = session.header?.cwd ?? process.cwd()
      const active = activeTree(cwd, base, agent)
      const stateRead = active.root !== undefined ? readState(active.root) : { ok: false }
      const hash = active.root !== undefined && stateRead.ok
        ? `${active.kind}:${active.root}|${String(stateRead.state.stage)}|${String(stateRead.state.round)}|${String(stateRead.state.verdict?.status ?? 'continue')}`
        : `${active.kind}:${(active.roots ?? []).map((root) => basename(root)).join(',')}`

      const newTurn = mark.turns !== mark.lastTurns
      const changed = hash !== mark.hash
      mark.lastTurns = mark.turns
      mark.hash = hash
      marks.set(session.id, mark)
      if (!newTurn && !changed) return decision

      const text = bannerText(cwd, base, active, stateRead)
      if (text === '') return decision
      mark.seq += 1
      void signal
      return {
        ...decision,
        messages: [
          ...(decision.messages ?? []),
          {
            id: `apical-banner-${session.id}-${mark.seq}`,
            role: 'user',
            content: [{ type: 'text', text }],
            source: { kind: 'apical-banner', form: 'hint' },
          },
        ],
      }
    } catch {
      return decision
    }
  })
}

/**
 * Decide whether one tool call violates the discussion session's mandate.
 * @param execution - the identity-protected call from the tools pipeline.
 * @param base - base directory holding discussion roots.
 * @param allowPaths - extra cwd-relative prefixes the user whitelisted.
 * @returns a denial reason, or undefined to leave the call alone.
 */
function guardReason(execution, base, allowPaths) {
  const toolName = execution.name
  if (toolName !== 'write' && toolName !== 'edit') return undefined
  const args = execution.arguments
  const raw = args !== null && typeof args === 'object' && typeof args.file_path === 'string' ? args.file_path : undefined
  if (raw === undefined || raw.trim() === '') return undefined

  const cwd = execution.agent?.session?.header?.cwd ?? process.cwd()
  const target = resolve(cwd, raw)
  for (const allowed of allowPaths) {
    if (isInside(target, resolve(cwd, allowed))) return undefined
  }

  const baseDir = resolve(cwd, base)
  const active = activeTree(cwd, base, execution.agent)
  const scopeRoot = active.kind === 'bound' || active.kind === 'single' ? active.root : resolve(baseDir, '<slug>')

  // Outside the discussion base entirely: never allowed in this mode.
  if (!isInside(target, baseDir)) return outsideMessage(cwd, scopeRoot, target)

  const parts = relative(baseDir, target).split(/[\\/]/).filter((part) => part !== '')
  if (parts.length < 2) return outsideMessage(cwd, scopeRoot, target)
  const slug = parts[0]
  const targetRoot = resolve(baseDir, slug)

  // A tree that does not exist yet is being bootstrapped: that is exactly how a
  // project gains its second, third, … tree, so it is allowed — but the
  // discussion-first rule still applies, so only ledger-shaped files (state,
  // verbatim seed, round minutes) may appear before the user has answered.
  if (!existsSync(join(targetRoot, 'state.json'))) {
    if (toolName === 'write' && !existsSync(target)) {
      const bootstrap = discussionFirstReason(target, cwd, targetRoot, execution.agent)
      if (bootstrap !== undefined) return bootstrap
    }
    return undefined
  }

  // Bound sessions work on one tree; switching is one tool call, and keeping it
  // explicit is what stops a session from editing two trees by accident.
  if ((active.kind === 'bound' || active.kind === 'single') && active.slug !== slug) {
    return `本会话当前在讨论树 ${active.slug} 上，不能直接改 ${slug}。`
      + `要切换：apical_gate action=bind slug=${slug}；要看全部：action=trees。`
  }

  if (dirname(target) === targetRoot && basename(target) === 'state.json') {
    return stateInvariant(toolName, args, targetRoot)
  }
  const history = historyInvariant(toolName, target, targetRoot)
  if (history !== undefined) return history
  if (toolName === 'write' && !existsSync(target)) {
    const discussion = discussionFirstReason(target, cwd, targetRoot, execution.agent)
    if (discussion !== undefined) return discussion
  }
  return undefined
}

/**
 * Which tree this session is working on.
 *
 * Resolution order: the session's durable binding, then the single discovered
 * tree, then "several, unbound" (writes are permitted inside any of them so a
 * conversation is never hard-blocked, and the banner asks for a binding).
 * @returns `{kind:'bound'|'single'|'multi'|'none', root?, slug?, roots?, missingBinding?}`.
 */
function activeTree(cwd, base, agent) {
  const found = discoverRoot(cwd, base)
  const bound = readFocusSlug(agent?.session?.events)
  if (bound !== undefined) {
    const root = resolve(cwd, base, bound)
    if (existsSync(join(root, 'state.json'))) return { kind: 'bound', root, slug: bound }
    // The binding outlived its tree: fall back and say so.
    return { ...fallbackTree(found), missingBinding: bound }
  }
  return fallbackTree(found)
}

/** Map a discovery result onto the active-tree vocabulary. */
function fallbackTree(found) {
  if (found.kind === 'one') return { kind: 'single', root: found.root, slug: found.slug }
  if (found.kind === 'ambiguous') return { kind: 'multi', roots: found.roots }
  return { kind: 'none' }
}

/** Denial text for a write outside the discussion root. */
function outsideMessage(cwd, root, target) {
  return `本会话是「顶芽模式」：write/edit 只允许写讨论根 ${relPath(cwd, root)}/ 以内的文件，当前目标是 ${relPath(cwd, target)}。`
    + '要改实现请用「标准模式」新开一个会话；若这件事与讨论有关，把它写成讨论根里的文档（seed/ layers/ derivation/ questions/ decisions/）而不是代码。'
}

/**
 * The tree's history is append-only: the verbatim seed may be created once, and
 * each round file may be created once. Everything else in the root is editable.
 * @returns a denial reason, or undefined when the write is fine.
 */
function historyInvariant(toolName, target, root) {
  const rel = relative(root, target).split(/[\\/]/).join('/')
  const isSeedOriginal = rel === 'seed/R-000-original.md'
  const isRound = /^rounds\/round-\d{3}\.md$/.test(rel)
  if (!isSeedOriginal && !isRound) return undefined
  if (toolName === 'edit') {
    return `${rel} 是 append-only 的讨论史：只能首次创建，之后不得修改。要修正理解，请写进 seed/real-need.md（种子）或新开一轮 round-NNN.md。`
  }
  if (existsSync(target)) {
    return `${rel} 已存在，禁止整文件覆写（append-only）。新的一轮请写新的 round-NNN.md；用户原话永远保持原样。`
  }
  return undefined
}

/** Text of one `user/message` event, concatenated. */
function userTextOf(event) {
  const content = event?.data?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (block !== null && typeof block === 'object' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
}

/** User wording that already instructs a write, so recording needs no new question. */
const WRITE_CUES = /写|记|录|落盘|留痕|文档|改|更新|补充|加|删|整理|保存|导出|调整|应该|修正/

/**
 * Files that ARE the discussion's ledger rather than a proposal: the verbatim
 * seed, round minutes, the machine state file, and the audit trail. Creating
 * these never waits for an answer — they record what already happened.
 */
function isLedgerPath(rel) {
  return rel === 'state.json'
    || rel === 'README.md'
    || rel === 'seed/R-000-original.md'
    || /^rounds\/round-\d{3}\.md$/.test(rel)
    || rel.startsWith('audit/')
}

/**
 * What this turn has done so far: has the user answered anything since the model
 * last touched the discussion root?
 * @returns `{ sawUser, answeredAfterWrite, userText }`.
 */
function turnState(events, cwd, root) {
  let lastUser = -1
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const kind = event.data?.source?.kind
    if (typeof kind === 'string' && INJECTED_SOURCES.has(kind)) continue
    lastUser = index
  }
  if (lastUser < 0) return { sawUser: false, answeredAfterWrite: false, userText: '' }
  const asked = new Set()
  let lastAnswer = -1
  let lastWrite = -1
  for (let index = lastUser + 1; index < events.length; index += 1) {
    const event = events[index]
    const data = event?.data
    if (event?.type === 'tool/call') {
      if (data?.name === 'ask_user_question') asked.add(data.callId)
      else if (data?.name === 'write' || data?.name === 'edit') {
        const raw = data.arguments !== null && typeof data.arguments === 'object' && typeof data.arguments.file_path === 'string'
          ? data.arguments.file_path
          : undefined
        if (raw !== undefined && isInside(resolve(cwd, raw), root)) lastWrite = index
      }
    } else if (event?.type === 'tool/result') {
      const callId = typeof data?.message?.source?.callId === 'string' ? data.message.source.callId : data?.callId
      if (typeof callId === 'string' && asked.has(callId)) lastAnswer = index
    }
  }
  return { sawUser: true, answeredAfterWrite: lastAnswer > lastWrite, userText: userTextOf(events[lastUser]) }
}

/**
 * Refuse to create a discussion document before the user has answered.
 * @returns a denial reason, or undefined when the write may proceed.
 */
function discussionFirstReason(target, cwd, root, agent) {
  const rel = relative(root, target).split(/[\\/]/).join('/')
  if (isLedgerPath(rel)) return undefined
  const events = agent?.session?.events
  if (!Array.isArray(events)) return undefined
  const turn = turnState(events, cwd, root)
  if (!turn.sawUser) return undefined
  if (turn.answeredAfterWrite) return undefined
  if (WRITE_CUES.test(turn.userText)) return undefined
  return `先讨论，再落盘：${rel} 是本轮要新建的文件，但本轮还没有拿到你的答复。\n`
    + '把提案、选项、推演链、代价、反例完整说在对话里，用 ask_user_question 提问；拿到答复之后再写文件留痕。\n'
    + '（文件是讨论的留痕，不是讨论的介质。用户明确要求记录、或用户在指出错误/给出修正时，这条限制自动放行。）'
}

/** Invariants that keep `stage` and `verdict` owned by the gate tool. */
function stateInvariant(toolName, args, root) {
  if (toolName === 'edit') {
    return 'state.json 只接受整文件 write（便于门禁校验），且 stage / verdict 只能由 apical_gate 改动。'
  }
  const content = args !== null && typeof args === 'object' && typeof args.content === 'string' ? args.content : undefined
  if (content === undefined) return 'state.json 必须用 write 整文件写入。'
  let next
  try {
    next = JSON.parse(content)
  } catch {
    return 'state.json 必须是合法 JSON（模板见 skill apical-bud 的 templates/state.json）。'
  }
  if (next === null || typeof next !== 'object' || Array.isArray(next)) return 'state.json 顶层必须是 JSON 对象。'
  if (next.schema !== 1) return 'state.json 必须保留 schema: 1。'
  const before = readState(root)
  if (!before.ok) return undefined
  const currentStage = before.state?.stage
  if (typeof currentStage === 'string' && next.stage !== currentStage) {
    return `stage 只能由 apical_gate 推进（当前 ${currentStage}，你写的是 ${String(next.stage)}）：先 action=check 通过，再 action=advance。`
  }
  const currentVerdict = before.state?.verdict?.status
  if (typeof currentVerdict === 'string' && next.verdict?.status !== currentVerdict) {
    return `verdict 只能由 apical_gate action=verdict 记录（当前 ${currentVerdict}）。裁决要留理由与证据，不能改字段了事。`
  }
  return undefined
}

/** Two-line state banner, or '' when there is nothing worth saying. */
/** Human label for a tree's lifecycle state. */
const STATUS_LABEL = { open: '进行中', done: '已完成', stopped: '已终止' }

function bannerText(cwd, base, active, stateRead) {
  if (active.kind === 'none') {
    return `[apical-bud] 还没有讨论根：按 skill apical-bud 进入 S0（种子）—— 建 ${base}/<slug>/ 并写入 state.json（topic / slug 必填），再把用户原话存进 seed/R-000-original.md。`
  }
  if (active.kind === 'multi') {
    const listed = active.roots.map((root) => {
      const summary = treeSummary(root)
      return `${summary.slug}(${STATUS_LABEL[summary.status] ?? summary.status} ${summary.stage})`
    })
    return `[apical-bud] 项目里有 ${active.roots.length} 棵树，本会话尚未绑定：${listed.join(' · ')}\n`
      + `[apical-bud] 先用 apical_gate action=bind slug=<slug> 绑定本会话要推进的那一棵（绑定后写入范围随之确定）；action=trees 可看全部树的状态`
  }
  const root = active.root
  const state = stateRead.ok ? stateRead.state : undefined
  const stage = typeof state?.stage === 'string' ? state.stage : 'S0'
  const round = Number.isInteger(state?.round) ? state.round : 0
  const gate = state?.gates?.[stage]
  const questions = openQuestions(root, stage)
  const counts = treeCounts(root)
  const verdict = typeof state?.verdict?.status === 'string' && state.verdict.status !== 'continue' ? ` · 裁决=${state.verdict.status}` : ''
  const gateText = gate === undefined
    ? '门禁: 未运行（有改动后先 apical_gate action=check）'
    : gate.state === 'pass'
      ? '门禁: 上次 check PASS（有改动需重跑）'
      : `门禁: 上次 check FAIL（缺 ${Array.isArray(gate.missing) ? gate.missing.length : 0} 项）`
  const questionText = questions.blocking === 0 ? '阻塞本阶段问题 0' : `阻塞本阶段问题 ${questions.blocking}（${questions.ids.join(', ')}）`
  const mechanisms = counts.mechanisms > 0 ? ` · 机制 ${counts.mechanisms}` : ''
  const tree = `层 ${counts.layers}(确认 ${counts.layersConfirmed}) · 节点 ${counts.nodes}(留 ${counts.kept}/汰 ${counts.dropped})${mechanisms} · 术语 ${counts.terms}(待确认 ${counts.pending})`
  const siblings = listRoots(cwd, base)
  const bound = active.kind === 'bound' ? '' : '（按唯一树推断，未显式绑定）'
  const stale = active.missingBinding === undefined ? '' : ` · 原绑定 ${active.missingBinding} 已不存在`
  const scope = siblings.length > 1
    ? `写范围 ${relPath(cwd, root)}/${bound} · 本项目共 ${siblings.length} 棵树：${siblings.map((item) => basename(item)).join(', ')}（切换用 apical_gate action=bind）`
    : `写范围 ${relPath(cwd, root)}/${bound}`
  return `[apical-bud] 树 ${basename(root)} · 阶段 ${stage} · 第 ${round} 轮 · ${tree} · ${questionText} · ${gateText}${verdict}${stale}\n`
    + `[apical-bud] ${scope} · 阶段推进 apical_gate(check→advance) · 对话先行：提案与选项先说在对话里（不看文件也能判断），拿到答复再落盘；答复前新建讨论文件会被守卫拦下`
}
