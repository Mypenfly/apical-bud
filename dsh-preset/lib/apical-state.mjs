/**
 * Shared helpers for the `apical-bud` preset plugins.
 *
 * Dependency-free and synchronous on purpose: the write guard is a monotonic
 * tool guard, evaluated synchronously before a tool body, so every fact it needs
 * (which discussion root exists, what the current stage is, how big the tree is)
 * must be readable without awaiting. The discussion root is documents, not data.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

/** Default base directory under the session cwd that holds discussion roots. */
export const DEFAULT_BASE = 'design'

/**
 * Every `design/<slug>/` that already has a state file.
 * @param cwd - session working directory.
 * @param base - base directory name (default `design`).
 * @returns absolute root paths.
 */
export function listRoots(cwd, base = DEFAULT_BASE) {
  const baseDir = resolve(cwd, base)
  let entries
  try {
    entries = readdirSync(baseDir, { withFileTypes: true })
  } catch {
    return []
  }
  const roots = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(baseDir, entry.name)
    if (existsSync(join(candidate, 'state.json'))) roots.push(candidate)
  }
  return roots.sort()
}

/**
 * Resolve the discussion root for one session directory.
 * @returns `{kind:'one', root, slug}` · `{kind:'none'}` · `{kind:'ambiguous', roots}`.
 */
export function discoverRoot(cwd, base = DEFAULT_BASE) {
  const roots = listRoots(cwd, base)
  if (roots.length === 0) return { kind: 'none' }
  if (roots.length === 1) return { kind: 'one', root: roots[0], slug: basename(roots[0]) }
  return { kind: 'ambiguous', roots }
}

/** Read `state.json`; never throws. */
export function readState(root) {
  try {
    const state = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'))
    return { ok: true, state }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

/** Write `state.json` through a temp file so a crash cannot truncate it. */
export function writeState(root, state) {
  const target = join(root, 'state.json')
  const temp = join(root, `.state.json.${process.pid}.tmp`)
  writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8')
  renameSync(temp, target)
}

/** Append one line to `audit/gates.log`, creating the directory when needed. */
export function appendLog(root, line) {
  try {
    const dir = join(root, 'audit')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'gates.log'), `${line}\n`, 'utf8')
  } catch {
    // Logging must never break a session.
  }
}

/**
 * Source kind of the durable session→tree binding marker.
 *
 * A project may hold several trees at once (one per need or phase), so a session
 * has to say which one it is working on. The binding lives as an injected
 * session event rather than a file: two sessions can then work on two trees of
 * the same project without fighting over a shared marker, and the binding
 * survives context compaction because session events are durable.
 */
export const FOCUS_SOURCE = 'apical-focus'

/** Text of one injected `user/message` event. */
function eventText(event) {
  const content = event?.data?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (block !== null && typeof block === 'object' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
}

/**
 * The slug this session is bound to, from the newest durable focus marker.
 * @param events - the session's event array.
 * @returns the slug, or undefined when the session has not bound a tree yet.
 */
export function readFocusSlug(events) {
  if (!Array.isArray(events)) return undefined
  let slug
  for (const event of events) {
    if (event?.type !== 'user/message') continue
    if (event.data?.source?.kind !== FOCUS_SOURCE) continue
    const match = /slug=([a-z0-9][a-z0-9-]*)/.exec(eventText(event))
    if (match !== null) slug = match[1]
  }
  return slug
}

/**
 * One tree's headline facts, for listing several trees side by side.
 * @param root - absolute path of `design/<slug>/`.
 * @returns `{ slug, root, ok, topic, stage, round, verdict, dependsOn, relation, status, ...counts }`.
 */
export function treeSummary(root) {
  const slug = basename(root)
  const read = readState(root)
  const counts = treeCounts(root)
  const state = read.ok ? read.state : {}
  const gates = state?.gates ?? {}
  const done = state?.stage === 'S7' && gates?.S7?.state === 'pass'
  const stopped = state?.verdict?.status === 'stop'
  return {
    slug,
    root,
    ok: read.ok,
    topic: typeof state?.topic === 'string' ? state.topic : '',
    stage: typeof state?.stage === 'string' ? state.stage : '?',
    round: Number.isInteger(state?.round) ? state.round : 0,
    verdict: typeof state?.verdict?.status === 'string' ? state.verdict.status : 'continue',
    dependsOn: Array.isArray(state?.dependsOn) ? state.dependsOn.map(String) : [],
    relation: typeof state?.relation === 'string' ? state.relation : '',
    status: stopped ? 'stopped' : done ? 'done' : 'open',
    ...counts,
  }
}

/** Count of trees in the project (including this one). */
export function siblingCount(root) {
  return listRoots(dirname(root)).length
}

/** Local `YYYY-MM-DD HH:MM`, the format the criteria/options ordering check compares. */
export function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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

/** Directory a `state.json` path belongs to, or undefined when it is nested deeper. */
export function stateRootOf(cwd, target, base = DEFAULT_BASE) {
  const baseDir = resolve(cwd, base)
  if (basename(target) !== 'state.json') return undefined
  const dir = dirname(target)
  if (dirname(dir) !== baseDir) return undefined
  return dir
}

/** Read one frontmatter-ish field with a tolerant regex (banner only, never validation). */
function fieldOf(text, key) {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`, 'm').exec(text)
  return match === null ? undefined : match[1].trim()
}

/** Markdown files directly inside one directory of a root. */
function mdFiles(root, dir) {
  try {
    return readdirSync(join(root, dir), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(root, dir, entry.name))
  } catch {
    return []
  }
}

/**
 * Open questions that block one stage, read straight from `questions/*.md`.
 * Regex-based on purpose: the banner runs once per user turn and should cost one
 * small directory read, not a full gate validation.
 * @returns `{ blocking: number, ids: string[] }`.
 */
export function openQuestions(root, stage) {
  const ids = []
  for (const file of mdFiles(root, 'questions')) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (fieldOf(text, 'status') !== 'open') continue
    if (fieldOf(text, 'blocking') !== stage) continue
    ids.push(fieldOf(text, 'id') ?? basename(file))
  }
  return { blocking: ids.length, ids }
}

/**
 * A compact picture of the tree for the banner: how many layers, how many
 * derivation nodes are kept versus thrown away, how many mechanism propositions
 * the crown carries, and what still awaits the user's confirmation.
 *
 * `dropped` matters because a drop is a conditional judgment: the banner shows
 * it every turn so the count is hard to forget when a recheck comes due.
 */
export function treeCounts(root) {
  const layers = mdFiles(root, 'layers')
  const nodes = mdFiles(root, 'derivation')
  let layersConfirmed = 0
  let kept = 0
  let dropped = 0
  let candidates = 0
  const read = (file) => {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return ''
    }
  }
  for (const file of layers) if (fieldOf(read(file), 'confirmed') === 'true') layersConfirmed += 1
  for (const file of nodes) {
    const text = read(file)
    const status = fieldOf(text, 'status')
    if (fieldOf(text, 'kind') === '候选') candidates += 1
    if (status === 'kept') kept += 1
    else if (status === 'dropped') dropped += 1
  }
  // Mechanism propositions live as `## M-00N` items inside the extensions file.
  let mechanisms = 0
  for (const line of read(join(root, 'concept/extensions.md')).split('\n')) {
    if (/^##\s+M-\d{3}/.test(line)) mechanisms += 1
  }
  let terms = 0
  let pending = 0
  try {
    const glossary = readFileSync(join(root, 'glossary.md'), 'utf8')
    for (const line of glossary.split('\n')) {
      if (!/^\s*[-*]\s+\*\*.+\*\*\s*\[/.test(line)) continue
      terms += 1
      if (line.includes('[提案]')) pending += 1
    }
  } catch {
    // No glossary yet.
  }
  return { layers: layers.length, layersConfirmed, nodes: nodes.length, candidates, kept, dropped, mechanisms, terms, pending }
}
