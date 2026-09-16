/**
 * Shared readers for the `apical-bud` preset plugins.
 *
 * WHY synchronous and dependency-free: the write guard is a monotonic tool
 * guard — it decides before a tool body runs, so everything it needs must be
 * readable without awaiting. The banner runs once per user turn and must cost a
 * few small file reads, not a validation pass.
 *
 * WHY this file does not import `scripts/check.mjs`: the check module is the
 * skill's, resolved at runtime from wherever the skill actually lives (see
 * `apical-check.mjs`); the guard must keep working when that resolution fails.
 * What lives here is only what a banner needs: which discussion roots exist,
 * the seed's core question, how many derivation points are open/closed/paused,
 * how many facts, whether the model has settled, which build files exist.
 *
 * The discussion root is documents, not data: nothing here writes, and there is
 * no state file.
 *
 * One piece of process-local memory lives here on purpose: `recordCheck` /
 * `lastCheck`. `apical-check.mjs` and `apical-guard.mjs` are two rows of one
 * preset and both import THIS module, so the check tool can hand its last result
 * to the banner without inventing a state file the method does not have. A
 * session that never ran a check simply shows "体检: 未运行".
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

/** Default base directory under the session cwd that holds discussion roots. */
export const DEFAULT_BASE = 'design'

/** Directory names that mark an apical-bud v1 tree (kept readable, never migrated). */
export const LEGACY_MARKERS = ['state.json', 'layers', 'concept', 'seed', 'tech', 'rounds']

const RE_HEADING = /^##\s+(.+?)\s*$/
const HEAD_FACT = /^F-\d{3}\b/

/** Read a file, or '' when it is missing or unreadable. */
export function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** Frontmatter keys as flat strings; tolerant on purpose (the banner only reads). */
export function frontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(raw ?? ''))
  if (match === null) return {}
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([^\s:#][^:]*?)\s*:\s*(.*)$/.exec(line.trim())
    if (field === null) continue
    // Values may carry a trailing comment (`status: draft  # draft | settled`),
    // exactly as `scripts/check.mjs` reads them — the templates ship that way.
    data[field[1]] = field[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')
  }
  return data
}

/**
 * Text of one `## title` section.
 * @returns `undefined` when the section is absent, `''` when it exists but is empty.
 */
export function sectionOf(text, title) {
  if (typeof text !== 'string') return undefined
  const out = []
  let inside = false
  for (const line of String(text).split(/\r?\n/)) {
    const heading = RE_HEADING.exec(line)
    if (heading !== null) {
      if (inside) break
      inside = heading[1].trim() === title
      continue
    }
    if (inside) out.push(line)
  }
  return inside ? out.join('\n').trim() : undefined
}

/** Whether a section body says anything (mirrors `scripts/check.mjs`). */
export function hasContent(text) {
  if (text === undefined || text === null) return false
  return String(text).replace(/<!--[\s\S]*?-->/g, '').replace(/[\s>*_`-]/g, '').length > 0
}

/** New shape / v1 shape / nothing yet. */
export function treeKind(root) {
  const dir = resolve(root)
  if (existsSync(join(dir, 'seed.md'))) return 'new'
  if (LEGACY_MARKERS.some((name) => existsSync(join(dir, name)))) return 'legacy'
  return 'empty'
}

/**
 * Every `base/<slug>/` that is a discussion root of either shape.
 * @param cwd - session working directory (or the project directory).
 * @param base - base directory name (default `design`).
 * @returns absolute root paths, sorted.
 */
export function listRoots(cwd, base = DEFAULT_BASE) {
  const dir = resolve(cwd, base)
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && treeKind(join(dir, entry.name)) !== 'empty')
    .map((entry) => join(dir, entry.name))
    .sort()
}

/**
 * Resolve the discussion root for one project directory.
 * Deliberately does NOT guess between several roots: with two trees, the caller
 * (model or user) names the one it means.
 * @returns `{kind:'one', root, slug}` · `{kind:'none'}` · `{kind:'ambiguous', roots}`.
 */
export function discoverRoot(cwd, base = DEFAULT_BASE) {
  const roots = listRoots(cwd, base)
  if (roots.length === 0) return { kind: 'none' }
  if (roots.length === 1) return { kind: 'one', root: roots[0], slug: basename(roots[0]) }
  return { kind: 'ambiguous', roots }
}

/** First non-empty line with leading bullet markers stripped. */
export function oneLine(text, limit = 0) {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .map((row) => row.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)[0] ?? ''
  if (limit > 0 && line.length > limit) return `${line.slice(0, limit)}…`
  return line
}

/** The seed's headline facts, or undefined when there is no `seed.md`. */
export function readSeed(root) {
  const file = join(resolve(root), 'seed.md')
  if (!existsSync(file)) return undefined
  const raw = readText(file)
  const data = frontmatter(raw)
  return {
    file,
    raw,
    data,
    statement: String(data.statement ?? '').trim(),
    status: String(data.status ?? '').trim(),
    coreQuestion: oneLine(sectionOf(raw, '核心问题') ?? ''),
    userWords: sectionOf(raw, '用户原话'),
  }
}

/** `derivation/*.md` in file-name order — the file order IS the derivation order. */
export function readPoints(root) {
  const dir = join(resolve(root), 'derivation')
  let names
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
  } catch {
    return []
  }
  return names.map((name) => {
    const data = frontmatter(readText(join(dir, name)))
    return {
      name,
      order: /^(\d{2})-/.exec(name)?.[1] ?? '',
      title: String(data.title ?? '').trim(),
      status: String(data.status ?? '').trim() || '?',
    }
  })
}

/** Point counts for the banner: total plus how many are open / closed / paused. */
export function pointCounts(root) {
  const points = readPoints(root)
  const count = (status) => points.filter((point) => point.status === status).length
  return { total: points.length, open: count('open'), closed: count('closed'), paused: count('paused'), points }
}

/** How many `## F-001 …` facts the tree carries. */
export function countFacts(root) {
  const raw = readText(join(resolve(root), 'facts.md'))
  if (raw === '') return 0
  let total = 0
  for (const line of raw.split(/\r?\n/)) if (HEAD_FACT.test((RE_HEADING.exec(line)?.[1] ?? '').trim())) total += 1
  return total
}

/**
 * 需求线的推进情况：种子里拆出几条线，其中几条已经有推演点认领。
 * 一条线一个点都没有，是最该在横幅上看见的事——树偏了它最先知道。
 */
export function demandLinePulse(root) {
  const dir = resolve(root)
  const section = sectionOf(readText(join(dir, 'seed.md')), '需求线') ?? ''
  const declared = []
  for (const line of section.split(/\r?\n/)) {
    const id = /\bR-\d{2}\b/.exec(line.split('|')[1] ?? '')?.[0] ?? /\bR-\d{2}\b/.exec(line)?.[0]
    if (id && !declared.includes(id)) declared.push(id)
  }
  const owned = new Set()
  for (const point of readPoints(root)) {
    const id = /\bR-\d{2}\b/.exec(String(frontmatter(readText(join(dir, 'derivation', point.name))).line ?? ''))?.[0]
    if (id) owned.add(id)
  }
  return { declared: declared.length, idle: declared.filter((id) => !owned.has(id)) }
}

/** The apical concept model's name and status, or undefined when there is none. */
export function readModel(root) {
  const file = join(resolve(root), 'model.md')
  if (!existsSync(file)) return undefined
  const raw = readText(file)
  const data = frontmatter(raw)
  return {
    file,
    raw,
    name: String(data.name ?? '').trim(),
    status: String(data.status ?? '').trim() || 'draft',
    oneLine: oneLine(sectionOf(raw, '一句话') ?? ''),
  }
}

/** Which of the selection documents exist: `判据·方案·选型·交接`, or `未开始`. */
export function buildStage(root) {
  const dir = resolve(root)
  const there = [
    ['build/01-判据.md', '判据'],
    ['build/02-方案.md', '方案'],
    ['build/03-选型.md', '选型'],
    ['handoff.md', '交接'],
  ]
    .filter(([file]) => existsSync(join(dir, file)))
    .map(([, label]) => label)
  return there.length === 0 ? '未开始' : there.join('·')
}

/** One compact picture of a tree: what the banner and the `trees` action print. */
export function treePulse(root) {
  const dir = resolve(root)
  const kind = treeKind(dir)
  const seed = kind === 'new' ? readSeed(dir) : undefined
  const model = kind === 'new' ? readModel(dir) : undefined
  return {
    slug: basename(dir),
    root: dir,
    kind,
    statement: seed?.statement ?? '',
    coreQuestion: seed?.coreQuestion ?? '',
    points: pointCounts(dir),
    facts: countFacts(dir),
    demand: demandLinePulse(dir),
    model: model === undefined
      ? '未成形'
      : `${model.status}${model.name === '' ? '' : `「${model.name}」`}`,
    build: kind === 'new' ? buildStage(dir) : '—',
  }
}

/** Stable one-line key of a tree's pulse, for "did anything change" checks. */
export function pulseKey(root) {
  const pulse = treePulse(root)
  return [
    pulse.kind,
    pulse.slug,
    `${pulse.points.total}/${pulse.points.open}/${pulse.points.closed}/${pulse.points.paused}`,
    pulse.facts,
    pulse.model,
    pulse.build,
  ].join(':')
}

// ── last check result (process-local; see the file header) ──────────────────

const checks = new Map()

/** Remember one `apical_check action=check` result so the banner can show it. */
export function recordCheck(root, summary) {
  checks.set(resolve(root), {
    ok: summary.ok === true,
    blockers: Array.isArray(summary.blockers) ? summary.blockers.map(String) : [],
    warnings: Array.isArray(summary.warnings) ? summary.warnings.map(String) : [],
    at: typeof summary.at === 'string' && summary.at !== '' ? summary.at : stamp(),
  })
}

/** The last recorded check result for this root, or undefined. */
export function lastCheck(root) {
  return checks.get(resolve(root))
}

// ── paths and time (used by messages and the banner hash) ───────────────────

/** Whether `child` is `parent` itself or lies below it. */
export function isInside(child, parent) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel))
}

/** One-line description of a path relative to a cwd, for messages. */
export function relPath(cwd, path) {
  const rel = relative(cwd, path)
  return rel === '' ? '.' : rel
}

/** Local `YYYY-MM-DD HH:MM`. */
export function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
