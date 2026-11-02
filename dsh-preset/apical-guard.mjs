/**
 * apical-guard — the write guard and the one-line state banner.
 *
 * Two mechanisms; both are anti-slip, not a security boundary.
 *
 * 1. WRITE GUARD. A monotonic `ctx.tools.guard()` allows `write`/`edit` inside
 *    a discussion root only — `design/<slug>/…` by default, so a loose
 *    `design/notes.md` belongs to no tree and is refused too. `config.base`
 *    moves the base directory and `allowPaths` whitelists extra cwd-relative
 *    prefixes. This is what keeps derivation from quietly turning into
 *    implementation drift; an in-session implementation lifts it with
 *    `DSH_APICAL_UNLOCK=1` (for the user, not for the model).
 * 2. USER WORDS. `seed.md`'s `## 用户原话` may only grow. Rewriting it would
 *    rewrite what the user actually said. The rest of `seed.md` stays editable:
 *    those sections are the record's conclusions, not its history.
 * 3. STATE BANNER. One short injected line per user turn (and whenever the two
 *    anchor files change): the core question, where the tree stopped, how many
 *    gaps are open, whether the three boundary answers are filled. A long
 *    discussion compacts; state the model has to remember is state it will
 *    eventually get wrong, so it is read off `seed.md` and `flow.md` each turn.
 *
 * v2 deliberately carries no check engine and no generated `map.md`: the
 * method's hard items are four and can be read by eye.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'apical-guard'

/** The tool registry must exist before a guard can be registered. */
export const inject = ['tools']

/** Injected message sources that must not count as user turns. */
const INJECTED_SOURCES = new Set(['apical-banner', 'instruction-hint', 'skill-invocation', 'skill-catalog'])

/** The section of `seed.md` that records what the user actually said. */
const USER_WORDS = '用户原话'

/** The three mandatory boundary answers in `seed.md`. */
const BOUNDARIES = ['不做什么', '做不到什么', '只适配什么场景']

const DEFAULT_BASE = 'design'

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

  /** Per-session injection bookkeeping: user-turn cursor, last injected picture. */
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

// ── write guard ─────────────────────────────────────────────────────────────

/**
 * Decide whether one tool call lands inside a discussion root.
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

  // Two levels minimum: `design/<slug>/…`. A root that does not exist yet is
  // fine — `design/<slug>/seed.md` is exactly how a project gains a tree.
  if (!isInside(target, baseDir) || parts.length < 2) {
    return outsideMessage(base, baseDir, target, cwd, allowPaths)
  }

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
    + '如果原话本身记错了：追加一条更正并写明「更正：」，不要动已记下的行；\n'
    + '如果是这一轮的新话：追加进「## 用户原话」；\n'
    + '如果是想修「核心问题」「主链」「边界」这些小节，直接改它们——那些是结论，不是历史。'
}

/** Denial text for a write that does not land inside a discussion root. */
function outsideMessage(base, baseDir, target, cwd, allowPaths) {
  const scope = `${relPath(cwd, baseDir)}/<slug>/`
  const note = relPath(cwd, baseDir) === base
    ? 'base 与 allowPaths 可在 apical-guard 行里改'
    : `${base}/<slug>/；base 与 allowPaths 可在 apical-guard 行里改`
  const extra = allowPaths.length > 0 ? `（allowPaths 里已放行 ${allowPaths.join('、')}）` : ''
  const loose = isInside(target, baseDir)
    ? `${relPath(cwd, baseDir)}/ 顶层的散文件不属于任何讨论根——记录只长在某一棵树里。\n`
    : ''
  return `本会话是「顶芽模式」：write/edit 只允许写讨论根 ${scope} 以内（${note}）${extra}，当前目标是 ${relPath(cwd, target)}。\n`
    + loose
    + '推演不写生产代码。要同会话实现，由用户在宿主环境设 DSH_APICAL_UNLOCK=1（或在 apical-guard 的 allowPaths 里放行项目目录）；要换实现会话，就用标准模式新开一个。'
}

// ── state banner ────────────────────────────────────────────────────────────

/** Stable picture of the anchor files, so the banner only speaks on change. */
function projectHash(cwd, base) {
  const roots = listRoots(cwd, base)
  let hash = 5381
  const feed = (text) => {
    for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0
  }
  for (const root of roots) {
    feed(root)
    feed(readText(join(root, 'seed.md')) ?? '')
    feed(readText(join(root, 'flow.md')) ?? '')
  }
  return `${roots.length}:${hash.toString(16)}`
}

/** One line: core question, current state, open gaps, boundary answers. */
function bannerText(cwd, base) {
  const roots = listRoots(cwd, base)
  if (roots.length === 0) {
    return `[顶芽] 还没有讨论根：照 templates/seed.md 建 ${base}/<slug>/seed.md（先写用户原话、核心问题、主链、边界），再照 templates/flow.md 建 flow.md。`
      + `新会话先读现状再开口。写守卫只放行 ${base}/<slug>/ 以内。`
  }
  const shown = roots.slice(0, 2).map((root) => {
    const pulse = treePulse(root)
    if (pulse.kind === 'empty') return `${pulse.slug}（空目录）`
    if (pulse.kind === 'legacy') return `${pulse.slug}（旧树：v1，只读，不迁移）`
    if (pulse.kind === 'partial') return `${pulse.slug}（缺 seed.md 或 flow.md）`
    const boundary = pulse.boundary.ok ? '齐' : `缺${pulse.boundary.missing.join('、')}`
    return `${pulse.slug} · 核心问题: ${pulse.question} · 现状: ${pulse.state} · 缺口 ${pulse.gaps} · 边界 ${boundary}`
  })
  const more = roots.length > shown.length ? ` …还有 ${roots.length - shown.length} 个` : ''
  const head = roots.length > 1 ? `[顶芽] ${roots.length} 个树` : '[顶芽]'
  return `${head} ${shown.join(' ｜ ')}${more} · 写范围 ${base}/<slug>/（推演不实现）`
}

/** A discussion root's one-line pulse, read off its two anchor files. */
function treePulse(root) {
  const slug = basename(root)
  const seed = readText(join(root, 'seed.md'))
  const flow = readText(join(root, 'flow.md'))
  if (seed === undefined && flow === undefined) return { slug, kind: 'empty' }
  if (seed === undefined) return { slug, kind: 'partial' }
  if (flow === undefined) {
    // A v1 tree has a seed and other v1 files but no flow.md; it is read-only.
    const legacy = existsSync(join(root, 'facts.md')) || existsSync(join(root, 'derivation')) || existsSync(join(root, 'model.md'))
    return { slug, kind: legacy ? 'legacy' : 'partial' }
  }
  const question = oneLine(sectionOf(seed, '核心问题') ?? '', 44) || '（还没写核心问题）'
  const state = pickState(sectionOf(flow ?? '', '现状') ?? '') || '（还没有现状）'
  return {
    slug,
    kind: 'v2',
    question,
    state,
    gaps: countGaps(sectionOf(flow ?? '', '缺口') ?? ''),
    boundary: boundaryStatus(sectionOf(seed, '边界') ?? ''),
  }
}

/** The `停在` line if present, else the first content line of 现状. */
function pickState(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')
  const stopped = lines.find((line) => line.includes('停在')) ?? lines[0]
  return stopped === undefined ? '' : oneLine(stopped, 48)
}

/** Open gaps = non-empty bullets in the 缺口 section. */
function countGaps(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line))
    .filter((line) => hasContent(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '')))
    .length
}

/** Whether all three boundary answers carry content. */
function boundaryStatus(text) {
  const missing = []
  for (const key of BOUNDARIES) {
    const line = text.split(/\r?\n/).find((candidate) => candidate.includes(key))
    if (line === undefined) {
      missing.push(key)
      continue
    }
    const rest = line.slice(line.indexOf(key) + key.length).replace(/^[：:\s*\-]+/, '').replace(/<!--[\s\S]*?-->/g, '')
    const meaningful = rest.replace(/[。；;，,：:|\s*\-]/g, '')
    if (meaningful.length < 2 || /^<.*>$/.test(meaningful)) missing.push(key)
  }
  return { ok: missing.length === 0, missing }
}

// ── small shared readers ────────────────────────────────────────────────────

function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** Bodies of `## <title>`, up to the next heading. */
function sectionOf(text, title) {
  if (typeof text !== 'string') return undefined
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^##\s+(.+?)\s*$/.exec(lines[index])
    if (match === null) continue
    if (start === -1) {
      if (match[1].trim() === title) start = index + 1
      continue
    }
    return lines.slice(start, index).join('\n')
  }
  return start === -1 ? undefined : lines.slice(start).join('\n')
}

function hasContent(text) {
  if (typeof text !== 'string') return false
  const flat = text.replace(/<!--[\s\S]*?-->/g, '').replace(/[\s>*#`\-|]/g, '')
  return flat.length > 0 && !/^<.*>$/.test(flat)
}

/** First non-empty line, markdown markers stripped, truncated. */
function oneLine(text, limit) {
  const line = text.split(/\r?\n/).map((item) => item.trim()).find((item) => item !== '')
  if (line === undefined) return ''
  const clean = line.replace(/^(?:[-*]|\d+\.)\s+/, '').replace(/^>\s*/, '').replace(/^#+\s*/, '').trim()
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean
}

function listRoots(cwd, base) {
  const baseDir = resolve(cwd, base)
  let entries
  try {
    entries = readdirSync(baseDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => join(baseDir, entry.name))
    .sort()
}

function isInside(child, parent) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function relPath(cwd, target) {
  const rel = relative(cwd, target)
  return rel === '' ? '.' : rel
}
