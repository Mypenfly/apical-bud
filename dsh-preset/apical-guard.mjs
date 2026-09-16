/**
 * apical-guard — the two mechanisms that keep the session inside a discussion,
 * plus the one line of state it should never have to remember.
 *
 * 1. WRITE GUARD (the only hard rule left): a monotonic `ctx.tools.guard()`
 *    that permits `write`/`edit` inside a discussion root only — `design/<slug>/…`
 *    by default, so a loose `design/notes.md` belongs to no tree and is refused
 *    too. `config.base` moves the base directory and `allowPaths` whitelists
 *    extra prefixes. "Discussion does not implement" used to be one of several
 *    guard duties; with the light method it is the whole point — everything else
 *    about the tree is a record convention, checked by `scripts/check.mjs`, not
 *    enforced here.
 * 2. APPEND-ONLY USER WORDS: `seed.md`'s `## 用户原话` section may only grow.
 *    Rewriting it would silently rewrite what the user actually said, so a
 *    `write` or `edit` that changes or drops any of those lines is denied. The
 *    rest of `seed.md` (一句话需求 / 核心问题 / 被否的表述 …) stays editable:
 *    those are the discussion's conclusions, not its history.
 * 3. STATE BANNER: one short injected line per user turn (and whenever the tree
 *    changes) with the core question, the derivation-point counts, the fact
 *    count, the model and selection status, and the last `apical_check` result.
 *    A long discussion compacts; state the model has to remember is state it
 *    will eventually get wrong, so it is read off the files each turn.
 *
 * DELETED from the previous version, with the method: the "discussion-first"
 * guard (creating a new document before the user answered), the `state.json`
 * invariants, and the session→tree binding. Files are now the RECORD of a
 * derivation, not the medium of the discussion, so writing one is never by
 * itself a violation; a project with several roots is handled by naming the root
 * (`apical_check root=…`), not by binding a session to one.
 *
 * Escape hatches, deliberately explicit: `DSH_APICAL_UNLOCK=1` in the host
 * environment disables the write guard entirely (for the user, not the model),
 * and `allowPaths` in the row's config whitelists extra prefixes.
 */

import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  DEFAULT_BASE,
  discoverRoot,
  hasContent,
  isInside,
  lastCheck,
  listRoots,
  pulseKey,
  relPath,
  sectionOf,
  treePulse,
} from './lib/apical-tree.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'apical-guard'

/** The tool registry must exist before a guard can be registered. */
export const inject = ['tools']

/** Injected message sources that must not count as user turns. */
const INJECTED_SOURCES = new Set(['apical-banner', 'instruction-hint', 'skill-invocation', 'skill-catalog'])

/** The section of `seed.md` that records what the user actually said. */
const USER_WORDS = '用户原话'

/** Register the write guard and the per-turn state banner. */
export function apply(ctx, config) {
  const base = typeof config.base === 'string' && config.base.trim() !== '' ? config.base : DEFAULT_BASE
  const allowPaths = Array.isArray(config.allowPaths)
    ? config.allowPaths.filter((value) => typeof value === 'string' && value.trim() !== '')
    : []
  const bannerEnabled = config.banner !== false

  if (process.env.DSH_APICAL_UNLOCK !== '1') {
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

  /** Per-session injection bookkeeping: turn cursor + last injected picture. */
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
      const hash = projectHash(cwd, base)
      const newTurn = mark.turns !== mark.lastTurns
      const changed = hash !== mark.hash
      mark.lastTurns = mark.turns
      mark.hash = hash
      marks.set(session.id, mark)
      if (!newTurn && !changed) return decision

      const text = bannerText(cwd, base)
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
 * Decide whether one tool call lands inside a discussion root.
 * @param execution - the identity-protected call from the tools pipeline.
 * @param base - base directory holding discussion roots.
 * @param allowPaths - extra cwd-relative prefixes the user whitelisted.
 * @returns a denial reason, or undefined to leave the call alone.
 */
function guardReason(execution, base, allowPaths) {
  if (process.env.DSH_APICAL_UNLOCK === '1') return undefined
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
  const parts = relative(baseDir, target).split(/[\\/]/).filter((part) => part !== '')

  // Everything this method records grows INSIDE a discussion root, so the whole
  // `design/` area is not enough: `design/notes.md` belongs to no tree and would
  // be the first gap in "the files are organized this way". Two levels minimum:
  // `design/<slug>/…`. A root that does not exist yet is fine — `design/<slug>/seed.md`
  // is exactly how a project gains its first (or next) tree.
  if (!isInside(target, baseDir) || parts.length < 2) {
    return outsideMessage(base, baseDir, target, cwd, allowPaths)
  }

  // The only append-only document left: the verbatim words of the user.
  if (parts.length === 2 && parts[1] === 'seed.md') {
    const reason = userWordsInvariant(toolName, args, target)
    if (reason !== undefined) return reason
  }
  return undefined
}

/** The text a `write`/`edit` would leave behind, or undefined when unknowable. */
function resultingText(toolName, args, before) {
  if (args === null || typeof args !== 'object') return undefined
  if (toolName === 'write') {
    return typeof args.content === 'string' ? args.content : undefined
  }
  const oldString = typeof args.old_string === 'string' ? args.old_string : undefined
  const newString = typeof args.new_string === 'string' ? args.new_string : undefined
  if (oldString === undefined || oldString === '' || newString === undefined) return undefined
  if (!before.includes(oldString)) return undefined
  const all = args.replace_all === true || args.replaceAll === true
  return all ? before.split(oldString).join(newString) : before.replace(oldString, newString)
}

/**
 * `## 用户原话` is history: it may grow, never change.
 * @returns a denial reason, or undefined when the write is fine.
 */
function userWordsInvariant(toolName, args, target) {
  if (!existsSync(target)) return undefined
  let before
  try {
    before = readFileSync(target, 'utf8')
  } catch {
    return undefined
  }
  const after = resultingText(toolName, args, before)
  if (after === undefined) return undefined
  const previous = sectionOf(before, USER_WORDS)
  if (!hasContent(previous)) return undefined
  const next = sectionOf(after, USER_WORDS)
  const trim = (text) => String(text ?? '').replace(/\s+$/, '')
  if (next !== undefined && trim(next).startsWith(trim(previous))) return undefined
  return `seed.md 的「## ${USER_WORDS}」是讨论史，只能追加、不能改写（要改的是你以为用户说了什么，不是用户说过什么）。\n`
    + '如果原话本身记错了：追加一条更正并写明"更正："，不要动已记下的行；\n'
    + '如果是这一轮的新话：追加进「## 用户原话」；\n'
    + '如果是想修"一句话需求"「核心问题」「被否的表述」这些小节，直接改它们——那些是推演的结论，不是历史。'
}

/** Denial text for a write that does not land inside a discussion root. */
function outsideMessage(base, baseDir, target, cwd, allowPaths) {
  const scope = `${relPath(cwd, baseDir)}/<slug>/`
  const note = relPath(cwd, baseDir) === base
    ? 'base 与 allowPaths 可在 apical-guard 行里改'
    : `${base}/<slug>/；base 与 allowPaths 可在 apical-guard 行里改`
  const extra = allowPaths.length > 0 ? `（allowPaths 里已放行 ${allowPaths.join('、')}）` : ''
  const loose = isInside(target, baseDir)
    ? `${relPath(cwd, baseDir)}/ 顶层的散文件不属于任何讨论根——这套方法的记录都长在某一棵树里（种子、事实、推演点、模型、选型、交接件、术语、map.md）。\n`
    : ''
  return `本会话是「顶芽模式」：write/edit 只允许写讨论根 ${scope} 以内（${note}）${extra}，当前目标是 ${relPath(cwd, target)}。\n`
    + loose
    + '推演只写记录，不改仓库实现——要改实现请用「标准模式」新开一个会话。'
    + `若确实需要在本会话写别处：由用户在宿主环境设 DSH_APICAL_UNLOCK=1，或在 apical-guard 行的 allowPaths 里放行该前缀。`
}

/** Stable picture of every discussion root, so the banner only speaks on change. */
function projectHash(cwd, base) {
  const roots = listRoots(cwd, base)
  if (roots.length === 0) return `none:${resolve(cwd, base)}`
  return roots
    .map((root) => {
      const check = lastCheck(root)
      const tail = check === undefined ? '' : `#${check.ok ? 'ok' : 'no'}:${check.blockers.join(',')}:${check.warnings.length}`
      return `${pulseKey(root)}${tail}`
    })
    .join('|')
}

/** One line: the core question, the derivation counters, the last check result. */
function bannerText(cwd, base) {
  const found = discoverRoot(cwd, base)
  if (found.kind === 'none') {
    return `[apical-bud] 还没有讨论根：照 templates/seed.md 建 ${base}/<slug>/seed.md（先写「## 用户原话」与「## 核心问题」）；`
      + '开工先读 map.md，没有就跑 apical_check action=map。'
      + `写守卫只放行 ${base}/<slug>/ 以内。`
  }
  const roots = found.kind === 'ambiguous' ? found.roots : [found.root]
  const shown = roots.slice(0, 3)
  const parts = shown.map((root) => {
    const pulse = treePulse(root)
    if (pulse.kind === 'legacy') return `${pulse.slug}（旧形状：不检查、不拦）`
    const check = lastCheck(root)
    const checkText = check === undefined
      ? '体检: 未运行（apical_check action=check）'
      : check.ok
        ? `体检: 齐 ✓${check.warnings.length > 0 ? `（${check.warnings.length} 警告）` : ''}`
        : `体检: 缺 ${check.blockers.length} 件（${check.blockers.slice(0, 2).join('、')}）`
    const question = pulse.coreQuestion === '' ? '（seed.md 里还没写）' : pulse.coreQuestion
    const demand = pulse.demand && pulse.demand.declared > 0
      ? ` · 需求线 ${pulse.demand.declared}${pulse.demand.idle.length > 0 ? `（${pulse.demand.idle.join('、')} 未动）` : '（都有人推）'}`
      : ''
    return `${pulse.slug} · 核心问题: ${question.length > 40 ? `${question.slice(0, 40)}…` : question}`
      + ` · 推演点 ${pulse.points.total}（进行中 ${pulse.points.open}/已结 ${pulse.points.closed}/悬置 ${pulse.points.paused}）`
      + ` · 事实 ${pulse.facts}${demand} · 顶芽 ${pulse.model} · 选型 ${pulse.build} · ${checkText}`
  })
  const head = found.kind === 'ambiguous' ? `[apical-bud] ${roots.length} 个讨论根` : '[apical-bud]'
  const more = roots.length > shown.length ? ` …还有 ${roots.length - shown.length} 个（apical_check action=trees）` : ''
  return `${head} ${parts.join(' ｜ ')}${more} · 写范围 ${base}/<slug>/（推演不实现）`
}
