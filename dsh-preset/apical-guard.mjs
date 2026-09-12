/**
 * apical-guard — three mechanisms that make the tree's rules true in a running
 * session instead of requested in prose.
 *
 * 1. WRITE GUARD: a monotonic `ctx.tools.guard()` that denies `write`/`edit`
 *    outside the discussion root, so a discussion session never quietly starts
 *    editing production code.
 * 2. APPEND-ONLY GUARD: the same guard refuses to rewrite `seed/R-000-original.md`
 *    or an existing `rounds/round-NNN.md`. The verbatim seed and the round
 *    minutes are the tree's history; editing them would silently rewrite what
 *    was actually said.
 * 3. STATE INVARIANTS: `state.json` is whole-file only, and its `stage` and
 *    `verdict` fields belong to `apical_gate` — the one actor that can only move
 *    them after the exit criteria pass.
 * 4. STATE BANNER: one short injected message per user turn (and whenever the
 *    recorded state changes) carrying the real stage, round, tree size, pending
 *    terminology and last gate result. State the model has to remember is state
 *    it will eventually get wrong — after compaction especially — so the session
 *    reads it from the filesystem each turn.
 *
 * Escape hatches, deliberately explicit: `DSH_APICAL_UNLOCK=1` in the host
 * environment disables the guard entirely (for the user, not the model), and
 * `allowPaths` in the row's config whitelists extra prefixes.
 */

import { existsSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import {
  DEFAULT_BASE,
  discoverRoot,
  isInside,
  openQuestions,
  readState,
  relPath,
  treeCounts,
} from './lib/apical-state.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'apical-guard'

/** The tool registry must exist before a guard can be registered. */
export const inject = ['tools']

/** Injected message sources that must not count as user turns. */
const INJECTED_SOURCES = new Set(['apical-banner', 'instruction-hint', 'skill-invocation', 'skill-catalog'])

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
      const found = discoverRoot(cwd, base)
      const stateRead = found.kind === 'one' ? readState(found.root) : { ok: false }
      const hash = found.kind === 'one' && stateRead.ok
        ? `${found.root}|${String(stateRead.state.stage)}|${String(stateRead.state.round)}|${String(stateRead.state.verdict?.status ?? 'continue')}`
        : `none:${found.kind}`

      const newTurn = mark.turns !== mark.lastTurns
      const changed = hash !== mark.hash
      mark.lastTurns = mark.turns
      mark.hash = hash
      marks.set(session.id, mark)
      if (!newTurn && !changed) return decision

      const text = bannerText(cwd, base, found, stateRead)
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

  const found = discoverRoot(cwd, base)
  if (found.kind === 'ambiguous') {
    return `本会话是「顶芽模式」，但 ${base}/ 下有多个讨论根，无法判断写入是否越界：${found.roots.map((root) => relPath(cwd, root)).join(' / ')}。先与用户确认本次讨论的讨论根，把多余的移走或删除。`
  }

  if (found.kind === 'one') {
    if (!isInside(target, found.root)) return outsideMessage(cwd, found.root, target)
    if (dirname(target) === found.root && basename(target) === 'state.json') {
      return stateInvariant(toolName, args, found.root)
    }
    const history = historyInvariant(toolName, target, found.root)
    if (history !== undefined) return history
    return undefined
  }

  // No discussion root yet: allow creating one (`<base>/<slug>/…`), nothing else.
  const baseDir = resolve(cwd, base)
  if (!isInside(target, baseDir)) return outsideMessage(cwd, resolve(baseDir, '<slug>'), target)
  const parts = relative(baseDir, target).split(/[\\/]/).filter((part) => part !== '')
  if (parts.length < 2) return outsideMessage(cwd, resolve(baseDir, '<slug>'), target)
  return undefined
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
function bannerText(cwd, base, found, stateRead) {
  if (found.kind === 'none') {
    return `[apical-bud] 还没有讨论根：按 skill apical-bud 进入 S0（种子）—— 建 ${base}/<slug>/ 并写入 state.json（topic / slug 必填），再把用户原话存进 seed/R-000-original.md。`
  }
  if (found.kind === 'ambiguous') {
    return `[apical-bud] 发现多个讨论根，先与用户确认本次讨论用哪个：${found.roots.map((root) => relPath(cwd, root)).join(' / ')}`
  }
  const state = stateRead.ok ? stateRead.state : undefined
  const stage = typeof state?.stage === 'string' ? state.stage : 'S0'
  const round = Number.isInteger(state?.round) ? state.round : 0
  const gate = state?.gates?.[stage]
  const questions = openQuestions(found.root, stage)
  const counts = treeCounts(found.root)
  const verdict = typeof state?.verdict?.status === 'string' && state.verdict.status !== 'continue' ? ` · 裁决=${state.verdict.status}` : ''
  const gateText = gate === undefined
    ? '门禁: 未运行（有改动后先 apical_gate action=check）'
    : gate.state === 'pass'
      ? '门禁: 上次 check PASS（有改动需重跑）'
      : `门禁: 上次 check FAIL（缺 ${Array.isArray(gate.missing) ? gate.missing.length : 0} 项）`
  const questionText = questions.blocking === 0 ? '阻塞本阶段问题 0' : `阻塞本阶段问题 ${questions.blocking}（${questions.ids.join(', ')}）`
  const tree = `树: 层 ${counts.layers}(确认 ${counts.layersConfirmed}) · 节点 ${counts.nodes}(留 ${counts.kept}/汰 ${counts.dropped}) · 术语 ${counts.terms}(待确认 ${counts.pending})`
  return `[apical-bud] 阶段 ${stage} · 第 ${round} 轮 · ${tree} · ${questionText} · ${gateText}${verdict}\n`
    + `[apical-bud] 只写 ${relPath(cwd, found.root)}/；推进阶段用 apical_gate（check → advance）；一次一问；seed 与 rounds 只追加；细则见 skill apical-bud`
}
