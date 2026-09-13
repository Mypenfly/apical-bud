/**
 * apical-bud gate — zero-dependency structural and derivation validator for one
 * discussion root (`design/<slug>/`).
 *
 * WHY: a concept that only *claims* to have been derived is worthless. This
 * module turns the tree's rules into deterministic checks over the files:
 *
 *   - the seed is one confirmed sentence, with the rejected phrasings kept;
 *   - every layer of the need has a parent, a decomposition argument, the
 *     competing reading it beat, and the user's confirmation;
 *   - every concept node points at its parent layer or node, carries a
 *     counterexample, and every kept node's ancestry actually reaches the seed
 *     — no orphan ideas dressed up as derivations;
 *   - the apical concept is one sentence, its key nouns are user-confirmed
 *     terms, and its `推演链` walks from the seed without a missing link;
 *   - terminology cannot pile up: at most one unconfirmed term at a time, and
 *     no term may be defined using a term that is not already confirmed above
 *     it.
 *
 * It is intentionally ignorant of meaning: it can prove the tree is connected
 * and traceable, not that the apical concept is *good*. Semantic quality is the
 * red team's job, not the gate's.
 *
 * Pure Node builtins, synchronous IO (small files, and the DSH preset's tool
 * guard needs a synchronous answer), no configuration. Exported as a module so a
 * host plugin can call `validate()` in-process; also runs as a CLI:
 *
 *   node gate.mjs --root design/my-topic
 *   node gate.mjs --root design/my-topic --json
 *   node gate.mjs --cwd .                  # discover the single design/<slug>
 *
 * Exit code 0 = all block-level checks pass, 1 = something is missing.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The stage machine, in tree terms. Order is the contract: no stage may be skipped. */
export const STAGES = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']

/** Human titles for every message the model and the user see. */
export const STAGE_TITLES = {
  S0: '种子 · 需求对齐',
  S1: '根系 · 需求分层',
  S2: '推演 · 逐层生长',
  S3: '顶芽 · 理念概念',
  S4: '侧枝 · 机制与延伸',
  S5: '定型 · 理念定稿',
  S6: '果实 · 选型判据',
  S7: '果实 · 选型定稿',
}

/** What each stage must leave on disk before it may be left. */
export const STAGE_ARTIFACTS = {
  S0: ['seed/R-000-original.md（用户原话）', 'seed/real-need.md：一句话真实需求（status: confirmed）+ 被否的表述 ≥1 + 非目标 ≥1 + 判定对齐的信号 ≥1'],
  S1: ['layers/L-00N-*.md ≥2：parent、分解理由、其他解读（被否）≥1、判据 ≥1、承接的信号 ≥1、confirmed: true', '种子的每条「判定对齐的信号」都被某层认领或列入非目标'],
  S2: ['derivation/N-00N-*.md：每个层至少 1 个节点；kept 节点有 from 与反例；dropped 节点有淘汰理由；所有 kept 节点的祖先链通到种子'],
  S3: ['concept/concept.md：核心理念概念（一句话 ≤60 字）、这意味着什么/这不意味着什么（各 ≥2）、它生成的主张 ≥3、关键名词 ≤3（均为已确认术语）、边界、非目标、反例与失败边界、承接了哪些层的什么、淘汰的竞争概念'],
  S4: ['concept/extensions.md：≥3 条 E-（档位 必然|需求|猜测，需求档带来源）；M- 机制命题带 服务:/## 机制/## 反例', 'glossary.md ≥3 个术语'],
  S5: ['concept.md status: final', '## 推演链：从种子到顶芽无断链（允许多条分支）', 'audit/recheck-S5.md 覆盖全部待盘点项', '已知反对与回应 非空', 'audit/challenges.md 每条异议有结论', '无 proposed 决策'],
  S6: ['tech/criteria.md status: locked：≥5 条判据，各带权重、硬约束、来源（可为 M-00N）', 'options.md 不得早于判据锁定', 'audit/recheck-S6.md 覆盖全部待盘点项'],
  S7: ['tech/selection.md status: final（选定方案/判据对照/拒绝理由汇总/退出成本与迁移/未验证假设）', '每个候选带 证据 与 推演来源（指向保留的推演节点或机制命题）', 'audit/recheck-S7.md 覆盖全部待盘点项'],
}

const R_ID = /^R-\d{3}$/
const L_ID = /^L-\d{3}$/
const N_ID = /^N-\d{3}$/
const M_ID = /^M-\d{3}$/
const Q_ID = /^Q-\d{3}$/
const D_ID = /^D-\d{3}$/
const LAYER_STATUS = new Set(['draft', 'confirmed'])
const NODE_STATUS = new Set(['kept', 'dropped'])
const QUESTION_STATUS = new Set(['open', 'closed'])
const DECISION_STATUS = new Set(['proposed', 'accepted', 'rejected', 'superseded'])
const SEED_STATUS = new Set(['draft', 'confirmed'])
const TIERS = ['必然', '需求', '猜测']
const EVIDENCE = /E[123]/

/**
 * Stages that may only be entered after a full re-judgement of everything this
 * tree has thrown away. Dropping a branch is a *conditional* judgment; without
 * this step a decision made in round 5 quietly survives a change of premise in
 * round 10 (which is exactly what happened in the tree this preset grew out of).
 */
export const RECHECK_BEFORE = ['S3', 'S5', 'S6', 'S7']


/** The next stage, or undefined at the terminal stage. */
export function nextStage(stage) {
  const index = STAGES.indexOf(stage)
  if (index === -1 || index === STAGES.length - 1) return undefined
  return STAGES[index + 1]
}

/**
 * Find the discussion root under a workspace.
 * @param cwd - workspace directory to search.
 * @param base - base directory name under the workspace (default `design`).
 * @returns `{kind:'one', root, slug}` · `{kind:'none'}` · `{kind:'ambiguous', roots}`.
 */
export function discoverRoot(cwd, base = 'design') {
  const baseDir = resolve(cwd, base)
  let entries
  try {
    entries = readdirSync(baseDir, { withFileTypes: true })
  } catch {
    return { kind: 'none' }
  }
  const roots = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(baseDir, entry.name)
    if (existsSync(join(candidate, 'state.json'))) roots.push(candidate)
  }
  if (roots.length === 0) return { kind: 'none' }
  if (roots.length === 1) return { kind: 'one', root: roots[0], slug: basename(roots[0]) }
  return { kind: 'ambiguous', roots }
}

/**
 * Read and parse one markdown document.
 * @returns `{ text, data, body, hasFrontmatter, ok }`; `ok` is false when unreadable.
 */
export function readDoc(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { text: '', data: {}, body: '', hasFrontmatter: false, ok: false }
  }
  const { data, body, hasFrontmatter } = parseFrontmatter(text)
  return { text, data, body, hasFrontmatter, ok: true }
}

/**
 * Parse the YAML subset the templates use: flat `key: value` scalars, inline
 * `[a, b]` lists, booleans, numbers, quoted strings. Anything richer is rejected
 * by design — these documents are read by humans too, and a nested structure
 * would be a sign that one file is doing two jobs.
 */
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { data: {}, body: text, hasFrontmatter: false }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: text, hasFrontmatter: false }
  const data = {}
  for (const line of text.slice(3, end).split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line)
    if (match === null) continue
    data[match[1]] = parseScalar(match[2])
  }
  const bodyStart = text.indexOf('\n', end + 1)
  return { data, body: bodyStart === -1 ? '' : text.slice(bodyStart + 1), hasFrontmatter: true }
}

/** Parse one scalar of the supported YAML subset. */
function parseScalar(raw) {
  const value = raw.trim()
  if (value === '') return ''
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  if (/^-?\d+$/.test(value)) return Number(value)
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((part) => stripQuotes(part.trim()))
      .filter((part) => part !== '')
  }
  return stripQuotes(value)
}

/** Remove one layer of matching quotes. */
function stripQuotes(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

/** Split a markdown body into `## heading` -> text sections (first wins). */
/** Section bodies keyed by heading text, for `##` and `###` alike. */
export function sectionsOf(body) {
  const sections = new Map()
  let heading = null
  let buffer = []
  const flush = () => {
    if (heading !== null && !sections.has(heading)) sections.set(heading, buffer.join('\n').trim())
  }
  for (const line of body.split('\n')) {
    // `##` and `###` both start a section: the crown's file nests each mechanism
    // proposition's 机制 / 反例 under its own `## M-00N`, and the checks read them
    // by name regardless of depth.
    const match = /^#{2,3}\s+(.+?)\s*$/.exec(line)
    if (match !== null) {
      flush()
      heading = match[1]
      buffer = []
      continue
    }
    if (heading !== null) buffer.push(line)
  }
  flush()
  return sections
}

/** Non-empty content after whitespace removal. */
function hasContent(text) {
  return typeof text === 'string' && text.replace(/\s+/g, '').length > 0
}

/** Markdown bullets in a section. */
function bullets(text) {
  return (text ?? '')
    .split('\n')
    .map((line) => /^\s*[-*]\s+(.*)$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => match[1].trim())
    .filter((line) => line.length > 0)
}

/** Every file below a directory (recursive, real files only). */
function filesUnder(dir) {
  const out = []
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) out.push(path)
    }
  }
  walk(dir)
  return out.sort()
}

/**
 * Files that sit beside ID-bearing documents without being one. Everything else
 * in `layers/`, `derivation/`, `questions/` and `decisions/` must carry
 * frontmatter with a valid id, so a half-written node cannot drop out of the
 * id and status checks.
 */
const AUXILIARY_FILES = new Set(['README.md', 'index.md'])

/** Load every ID-bearing document in one directory. */
function docsIn(dir) {
  const out = []
  for (const file of filesUnder(dir)) {
    if (!file.endsWith('.md')) continue
    if (AUXILIARY_FILES.has(basename(file))) continue
    const doc = readDoc(file)
    if (!doc.ok) continue
    out.push({ ...doc, file, rel: file.slice(dir.length + 1) })
  }
  return out
}

/**
 * Parse the glossary.
 *
 * Terms are `- **name** [确认|提案]：definition`. The two rules this file
 * enforces are what keep a discussion readable: a term may only be defined
 * using terms confirmed *above* it (no jargon defining jargon), and at most one
 * term may be waiting for the user's confirmation.
 * @returns `{ terms, unconfirmed, problems }` where terms carry their index.
 */
export function readGlossary(root) {
  const doc = readDoc(join(root, 'glossary.md'))
  const terms = []
  for (const [index, line] of doc.body.split('\n').entries()) {
    const match = /^\s*[-*]\s+\*\*(.+?)\*\*\s*(\[[^\]]*\])?\s*[:：]\s*(.+)$/.exec(line)
    if (match === null) continue
    const status = (match[2] ?? '').replace(/[[\]]/g, '').trim()
    terms.push({
      index,
      name: match[1].trim(),
      status: status === '确认' ? 'confirmed' : status === '提案' ? 'proposed' : 'unknown',
      definition: match[3].trim(),
    })
  }
  const problems = []
  for (const term of terms) {
    if (term.status === 'unknown') problems.push(`术语「${term.name}」缺少 [确认] 或 [提案] 标记`)
    if (term.definition.replace(/\s+/g, '').length < 6) problems.push(`术语「${term.name}」的定义太短（需要一句人话，不是同义词）`)
    for (const other of terms) {
      if (other === term) continue
      if (!term.definition.includes(other.name)) continue
      if (other.index > term.index) problems.push(`术语「${term.name}」用排在它后面的「${other.name}」解释自己——把「${other.name}」的定义移到「${term.name}」之前，或改用平实说法。定义不能靠还没定义好的词`)
      else if (other.status !== 'confirmed') problems.push(`术语「${term.name}」引用了未确认的「${other.name}」`)
    }
  }
  return { terms, unconfirmed: terms.filter((term) => term.status === 'proposed'), problems, exists: doc.ok }
}

/**
 * Validate one discussion root.
 * @param root - the discussion root (`design/<slug>`).
 * @param options - `{ stage }` to check a stage other than the recorded one.
 * @returns a report: `{ ok, root, slug, stage, nextStage, checks, blockers, stats, errors }`.
 */
export function validate(root, options = {}) {
  const checks = []
  const rootDir = resolve(root)
  const slug = basename(rootDir)
  const add = (id, ok, detail, level = 'block') => {
    checks.push({ id, ok: ok === true, detail: detail ?? '', level })
    return ok === true
  }

  // ── state.json ───────────────────────────────────────────────────────────
  const statePath = join(rootDir, 'state.json')
  let state = null
  if (add('state.exists', existsSync(statePath), 'state.json 不存在：先创建讨论根与状态文件')) {
    try {
      state = JSON.parse(readFileSync(statePath, 'utf8'))
    } catch (error) {
      add('state.parses', false, `state.json 不是合法 JSON：${String(error.message ?? error)}`)
    }
  }
  const recordedStage = typeof state?.stage === 'string' ? state.stage : 'S0'
  const stage = options.stage ?? recordedStage
  if (state !== null) {
    const problems = []
    if (state.schema !== 1) problems.push('schema 必须为 1')
    if (typeof state.topic !== 'string' || state.topic.trim() === '') problems.push('topic 不能为空')
    if (typeof state.slug !== 'string' || state.slug !== slug) problems.push(`slug 必须等于目录名 "${slug}"`)
    if (!STAGES.includes(state.stage)) problems.push(`stage 必须是 ${STAGES.join('/')} 之一`)
    if (!Number.isInteger(state.round) || state.round < 0) problems.push('round 必须是非负整数')
    add('state.shape', problems.length === 0, problems.join('；'))
  }

  // ── the tree: layers, nodes, questions, decisions ────────────────────────
  const original = readDoc(join(rootDir, 'seed/R-000-original.md'))
  const seed = readDoc(join(rootDir, 'seed/real-need.md'))
  const layers = docsIn(join(rootDir, 'layers'))
  const nodes = docsIn(join(rootDir, 'derivation'))
  const questions = docsIn(join(rootDir, 'questions'))
  const decisions = docsIn(join(rootDir, 'decisions'))
  // The two branches of the crown live in one file: `M-` mechanism propositions
  // (how the concept is guaranteed — what technology selection must obey) and
  // `E-` extensions (what the concept entails).
  const extensionsDoc = readDoc(join(rootDir, 'concept/extensions.md'))
  const mechanisms = parseExtensionItems(extensionsDoc.body, /^M-\d{3}$/).map((item) => ({
    ...item,
    status: (fieldOf(item.body, 'status') ?? 'kept').trim(),
    supersededBy: (fieldOf(item.body, 'superseded-by') ?? '').trim(),
  }))
  const mechanismIds = new Set(mechanisms.map((item) => item.id))

  const malformed = []
  const seen = new Map()
  const register = (doc, pattern, label) => {
    const id = doc.data.id
    if (typeof id !== 'string' || !pattern.test(id)) {
      malformed.push(`${label}/${doc.rel}: id 缺失或格式错误（需要 ${label === 'layers' ? 'L' : label === 'derivation' ? 'N' : label === 'questions' ? 'Q' : 'D'}- 加三位数字）`)
      return
    }
    if (seen.has(id)) malformed.push(`${label}/${doc.rel}: id ${id} 与 ${seen.get(id)} 重复`)
    else seen.set(id, `${label}/${doc.rel}`)
  }
  for (const doc of layers) register(doc, L_ID, 'layers')
  for (const doc of nodes) register(doc, N_ID, 'derivation')
  for (const doc of questions) register(doc, Q_ID, 'questions')
  for (const doc of decisions) register(doc, D_ID, 'decisions')
  add('ids.unique', malformed.length === 0, malformed.join('；'))

  const badStatus = []
  for (const doc of layers) if (!LAYER_STATUS.has(doc.data.status)) badStatus.push(`layers/${doc.rel}: status=${String(doc.data.status)}`)
  for (const doc of nodes) if (!NODE_STATUS.has(doc.data.status)) badStatus.push(`derivation/${doc.rel}: status=${String(doc.data.status)}`)
  for (const doc of questions) if (!QUESTION_STATUS.has(doc.data.status)) badStatus.push(`questions/${doc.rel}: status=${String(doc.data.status)}`)
  for (const doc of decisions) if (!DECISION_STATUS.has(doc.data.status)) badStatus.push(`decisions/${doc.rel}: status=${String(doc.data.status)}`)
  add('docs.status', badStatus.length === 0, `状态词表外或缺失：${badStatus.join('；')}`)

  // Parent map over the tree: `seed` is the root of everything. A mechanism
  // proposition hangs off the concept line it serves, so its ancestry reaches the
  // seed through the nodes that produced that line.
  const parents = new Map()
  for (const doc of layers) {
    const parent = typeof doc.data.parent === 'string' ? doc.data.parent : ''
    parents.set(String(doc.data.id), [parent])
  }
  for (const doc of nodes) {
    const from = Array.isArray(doc.data.from) ? doc.data.from.map(String) : []
    parents.set(String(doc.data.id), from)
  }
  for (const item of mechanisms) {
    const served = fieldOf(item.body, '服务') ?? ''
    const from = [...served.matchAll(/(?:N|L)-\d{3}/g)].map((match) => match[0])
    parents.set(item.id, from.length > 0 ? from : ['seed'])
  }
  const knownIds = new Set(['seed', 'R-000', ...parents.keys()])
  const danglingParents = []
  for (const [id, list] of parents) {
    if (list.length === 0) danglingParents.push(`${id} 没有任何父节点`)
    for (const parent of list) if (!knownIds.has(parent)) danglingParents.push(`${id} -> ${parent || '（空）'}`)
  }
  add('tree.parents', danglingParents.length === 0, `父节点缺失或指向不存在的节点：${danglingParents.join('；')}`)

  /** Whether a node's ancestry reaches the seed (any one path is enough). */
  const reachesSeed = (id, seenSet = new Set()) => {
    if (id === 'seed' || id === 'R-000') return true
    if (seenSet.has(id)) return false
    seenSet.add(id)
    const list = parents.get(id)
    if (list === undefined) return false
    return list.some((parent) => reachesSeed(parent, new Set(seenSet)))
  }
  const orphans = [...nodes]
    .filter((doc) => doc.data.status === 'kept' && !reachesSeed(String(doc.data.id)))
    .map((doc) => String(doc.data.id))
  add('tree.connected', orphans.length === 0, `这些保留节点的祖先链没有通到种子（等于凭空的灵感，不是推演）：${orphans.join(', ')}`)

  // ── relations to other trees in the same project ─────────────────────────
  // A project legitimately holds several trees (one per need or phase) and they
  // are often related. Relations are declared in `state.json` (dependsOn +
  // relation) and may be cited in prose as `<slug>#L-003`.
  const parentDir = dirname(rootDir)
  let siblingSlugs = []
  try {
    siblingSlugs = readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(parentDir, entry.name, 'state.json')))
      .map((entry) => entry.name)
  } catch {
    siblingSlugs = []
  }
  let dependsOn = []
  if (state !== null && state.dependsOn !== undefined) {
    if (!Array.isArray(state.dependsOn)) {
      add('trees.dependsOn', false, 'state.json 的 dependsOn 必须是数组，例如 ["niri-to-denial"]')
    } else {
      dependsOn = state.dependsOn.map(String)
      const missing = dependsOn.filter((item) => !siblingSlugs.includes(item))
      add(
        'trees.dependsOn',
        missing.length === 0,
        `dependsOn 指向的树不在此项目里：${missing.join(', ')}（同级目录下没有对应 state.json；树被移动或删除只是提醒，不阻塞）`,
        'warn',
      )
    }
  }
  if (state !== null && state.relation !== undefined && typeof state.relation !== 'string') {
    add('trees.relation', false, 'state.json 的 relation 必须是一句话（字符串），说明与 dependsOn 里那棵树的关系')
  }
  const citedSlugs = new Set()
  for (const file of filesUnder(rootDir)) {
    if (!file.endsWith('.md')) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/([a-z0-9][a-z0-9-]{2,})#(?:R|L|N)-\d{3}/g)) citedSlugs.add(match[1])
  }
  const unknownCitations = [...citedSlugs].filter((item) => item !== slug && !siblingSlugs.includes(item))
  if (citedSlugs.size > 0) {
    add(
      'trees.citations',
      unknownCitations.length === 0,
      `引用了不存在的树：${unknownCitations.map((item) => `${item}#…`).join(', ')}（跨树引用写成 <slug>#L-003；同级目录下要有那棵树）`,
      'warn',
    )
  }

  // ── decisions stay traceable ─────────────────────────────────────────────
  const traceable = new Set([...knownIds])
  const untraceable = []
  const danglingSources = []
  for (const doc of decisions) {
    if (doc.data.status !== 'accepted') continue
    const sources = Array.isArray(doc.data.sources) ? doc.data.sources.map(String) : []
    if (sources.length === 0 && doc.data.assumption !== true) {
      untraceable.push(`decisions/${doc.rel}（需要 sources 或 assumption: true）`)
      continue
    }
    for (const source of sources) if (!traceable.has(source)) danglingSources.push(`decisions/${doc.rel} -> ${source}`)
  }
  add('decisions.traceable', untraceable.length === 0, `已接受决策缺少可追溯来源：${untraceable.join('；')}`)
  add('sources.resolve', danglingSources.length === 0, `引用了不存在的来源 ID：${danglingSources.join('；')}`)

  // ── rounds are append-only and contiguous ────────────────────────────────
  const roundFiles = filesUnder(join(rootDir, 'rounds'))
    .map((file) => /round-(\d{3})\.md$/.exec(basename(file)))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b)
  const roundGaps = roundFiles.some((value, index) => value !== index + 1)
  add('rounds.sequence', !roundGaps, `轮次文件必须从 round-001.md 连续编号（现在 ${roundFiles.length} 个文件）`)
  // `state.round` is derived bookkeeping, not a judgment about the discussion.
  // The first version made a mismatch a blocker, which turned a one-line slip
  // into a stuck stage; it is a warning now, and the gate tool re-syncs it.
  add(
    'rounds.state-sync',
    state === null || state.round === roundFiles.length,
    `state.round=${String(state?.round)} 与轮次文件数 ${roundFiles.length} 不一致（机械记账：check / advance 时会自动同步，不必手改）`,
    'warn',
  )

  // ── open questions decide whether this stage may be left ─────────────────
  const openQuestions = questions.filter((doc) => doc.data.status === 'open')
  const blockingNow = []
  const staleQuestions = []
  for (const doc of openQuestions) {
    const blocking = String(doc.data.blocking ?? '')
    if (!STAGES.includes(blocking)) {
      staleQuestions.push(`questions/${doc.rel}（blocking=${blocking || '缺失'}）`)
      continue
    }
    if (STAGES.indexOf(blocking) < STAGES.indexOf(stage)) staleQuestions.push(`questions/${doc.rel}（blocking=${blocking} 早于当前 ${stage}）`)
    if (blocking === stage) blockingNow.push(`${doc.data.id} ${doc.data.title ?? ''}`.trim())
  }
  add('questions.scope', staleQuestions.length === 0, `待决问题的 blocking 阶段无效或早于当前阶段：${staleQuestions.join('；')}`)
  add('questions.clear', blockingNow.length === 0, `阻塞 ${stage} 的未决问题：${blockingNow.join('；')}`)

  // ── full re-judgement before entering the convergent stages ──────────────
  // Everything this tree has discarded is re-examined before it is allowed to
  // converge: a drop is a conditional judgment, and the condition may have
  // changed. `advance` validates the stage being left, so the target stage is
  // what decides whether a recheck is owed.
  const targetStage = nextStage(stage)
  const recheckIds = [
    ...nodes.filter((doc) => doc.data.status === 'dropped').map((doc) => String(doc.data.id)),
    ...mechanisms.filter((item) => item.status === 'dropped').map((item) => item.id),
    ...itemsOf(readDoc(join(rootDir, 'tech/options.md')).body, /^O-\d{3}$/)
      .filter((item) => (fieldOf(item.body, '判定') ?? '').includes('淘汰'))
      .map((item) => item.id),
  ]
  const staleDocs = [
    ...layers, ...nodes, ...decisions,
  ].filter((doc) => doc.data.stale === true).map((doc) => String(doc.data.id))
  const recheckOwed = targetStage !== undefined && RECHECK_BEFORE.includes(targetStage)
  if (recheckOwed && recheckIds.length > 0) {
    const recheck = readDoc(join(rootDir, `audit/recheck-${targetStage}.md`))
    if (!recheck.ok) {
      add(
        'recheck.exists',
        false,
        `进入 ${targetStage} 之前必须做一次全量重判：把 ${recheckIds.join(', ')} 逐条重判，写 audit/recheck-${targetStage}.md`
        + `（${targetStage} 是收敛阶段，淘汰是有条件的判断，条件变了它就该复活）`,
      )
    } else {
      const problems = []
      for (const id of recheckIds) {
        const conclusion = recheckConclusion(recheck.body, id)
        if (conclusion.ok !== true) problems.push(`${id}：${conclusion.reason}`)
      }
      add(
        `recheck.${targetStage}`,
        problems.length === 0,
        `audit/recheck-${targetStage}.md 没有逐条结论：${problems.join('；')}（每条要写 结论: 维持|复活 与理由）`,
      )
    }
  }
  if (staleDocs.length > 0) {
    add(
      'tree.stale',
      false,
      `这些文档被上游撤回波及（stale: true），必须先重判再推进：${staleDocs.join(', ')}`
      + '——重判后去掉 stale，或在正文里写明新的结论并标 superseded-by',
    )
  }

  // ── terminology discipline ───────────────────────────────────────────────
  const glossary = readGlossary(rootDir)
  if (glossary.exists || STAGES.indexOf(stage) >= 1) {
    add('glossary.exists', glossary.exists, 'glossary.md 不存在：术语表是从 S1 起的必备文件（人话定义，不用概念解释概念）')
  }
  add('glossary.terms', glossary.problems.length === 0, glossary.problems.join('；'))
  add(
    'glossary.pending',
    glossary.unconfirmed.length <= 1,
    `未确认（[提案]）的术语不得超过 1 个，现在是 ${glossary.unconfirmed.length} 个：${glossary.unconfirmed.map((term) => term.name).join('、')}。先把它们逐个与用户确认或删掉。`,
  )

  // ── per-stage exit criteria ─────────────────────────────────────────────
  const conceptPath = join(rootDir, 'concept/concept.md')
  const stageChecks = {
    S0: () => {
      add('stage.S0.original', original.ok && original.body.replace(/\s+/g, '').length >= 20, 'seed/R-000-original.md 缺失或过短（需要用户原话，≥20 字）')
      const statement = typeof seed.data.statement === 'string' ? seed.data.statement.trim() : ''
      const problems = []
      if (!seed.ok) problems.push('seed/real-need.md 不存在')
      else {
        if (statement === '') problems.push('frontmatter 缺少 statement（一句话真实需求）')
        else if (statement.length > 80) problems.push(`一句需求 ${statement.length} 字 > 80 字（说不短就是还没对齐）`)
        if (!SEED_STATUS.has(seed.data.status)) problems.push('status 必须是 draft|confirmed')
        else if (seed.data.status !== 'confirmed') problems.push('status 还是 draft：需要用户确认这一句')
        const sections = sectionsOf(seed.body)
        if (bullets(sections.get('被否的表述')).length < 1) problems.push('缺少“## 被否的表述”或条目为空（没有它就无法证明对齐发生过）')
        if (bullets(sections.get('非目标')).length < 1) problems.push('缺少“## 非目标”或条目为空')
        if (Array.isArray(state?.dependsOn) && state.dependsOn.length > 0 && !hasContent(sections.get('与已有树的关系'))) {
          problems.push('state.json 声明了 dependsOn，因此这里必须写「## 与已有树的关系」：继承了哪棵树的什么、又推翻了什么（树与树有关联时，这条是唯一的追溯入口）')
        }
      }
      add('stage.S0.seed', problems.length === 0, problems.join('；'))
    },
    S1: () => {
      const problems = []
      if (layers.length < 2) problems.push(`层数 ${layers.length} < 2（只分一层等于没分层）`)
      for (const doc of layers) {
        const id = String(doc.data.id)
        const sections = sectionsOf(doc.body)
        if (typeof doc.data.parent !== 'string' || doc.data.parent === '') problems.push(`${id} 缺少 parent`)
        if (doc.data.confirmed !== true || doc.data.status !== 'confirmed') problems.push(`${id} 未经用户确认（confirmed: true + status: confirmed）`)
        if (!hasContent(sections.get('分解理由'))) problems.push(`${id} 缺少“## 分解理由”`)
        if (bullets(sections.get('其他解读（被否）')).length < 1) problems.push(`${id} 缺少“## 其他解读（被否）”条目（分层也是一种解读，必须保留被否的那种）`)
        if (bullets(sections.get('判据')).length < 1) problems.push(`${id} 缺少“## 判据”条目`)
        if (!reachesSeed(id)) problems.push(`${id} 的祖先链没有通到种子`)
      }
      add('stage.S1.layers', problems.length === 0, problems.join('；'))

      // Every signal the seed says would show alignment must be owned by a layer
      // or explicitly written off. Without this, a converged sentence quietly
      // drops the goals it compressed — and they are never discussed again.
      const signalCount = bullets(sectionsOf(seed.body).get('判定对齐的信号')).length
      if (signalCount > 0) {
        const owned = layers.reduce((total, doc) => total + bullets(sectionsOf(doc.body).get('承接的信号')).length, 0)
        add(
          'stage.S1.signals',
          owned >= signalCount,
          `种子有 ${signalCount} 条「判定对齐的信号」，但各层的「## 承接的信号」合计只有 ${owned} 条。`
          + '每条信号要么被某个层认领，要么明写为非目标——被压缩掉的目标不能就这么消失',
          owned === 0 ? 'block' : 'warn',
        )
      }
    },
    S2: () => {
      const problems = []
      const kept = nodes.filter((doc) => doc.data.status === 'kept')
      if (nodes.length === 0) problems.push('还没有任何推演节点')
      for (const doc of layers) {
        const id = String(doc.data.id)
        const covering = nodes.filter((node) => (Array.isArray(node.data.from) ? node.data.from.map(String) : []).includes(id))
        if (covering.length === 0) problems.push(`层 ${id} 没有挂任何推演节点（每层都要长出东西）`)
      }
      for (const doc of nodes) {
        const id = String(doc.data.id)
        const sections = sectionsOf(doc.body)
        if (!hasContent(sections.get('推演'))) problems.push(`${id} 缺少“## 推演”（推理链）`)
        if (doc.data.status === 'kept' && !hasContent(sections.get('反例'))) problems.push(`${id} 是保留节点但缺少“## 反例”`)
        if (doc.data.status === 'dropped' && !hasContent(sections.get('淘汰理由'))) problems.push(`${id} 是淘汰节点但缺少“## 淘汰理由”`)
        const evidence = String(doc.data.evidence ?? '')
        if (!(evidence === '无' || EVIDENCE.test(evidence))) problems.push(`${id} 的 evidence 必须是 E1|E2|E3|无`)
      }
      if (nodes.length > 0 && kept.length === 0) problems.push('没有任何保留节点')
      add('stage.S2.derivation', problems.length === 0, problems.join('；'))
    },
    S3: () => {
      const doc = readDoc(conceptPath)
      const sections = sectionsOf(doc.body)
      const problems = []
      // Trees grown before the concept/mechanism split are checked by the rules
      // they were written against, so an old tree is never retro-broken; it is
      // told what the current shape is and may migrate when it next moves.
      const legacy = !hasContent(sections.get('这意味着什么')) && hasContent(sections.get('判据'))
      const sentence = firstLine(sections.get('核心概念（一句话）'))
      if (sentence === '') problems.push('缺少“## 核心概念（一句话）”或内容为空')
      else if (sentence.length > (legacy ? 100 : 60)) {
        problems.push(`核心概念一句话 ${sentence.length} 字 > ${legacy ? 100 : 60} 字（堆并列说明还没收敛）`)
      }
      const required = legacy
        ? ['判据', '边界', '非目标', '反例与失败边界', '淘汰的竞争节点']
        : ['这意味着什么', '这不意味着什么', '它生成的主张', '边界', '非目标', '反例与失败边界', '承接了哪些层的什么', '淘汰的竞争概念']
      for (const heading of required) {
        if (!hasContent(sections.get(heading))) problems.push(`缺少“## ${heading}”或内容为空`)
      }
      if (!legacy) {
        const generates = bullets(sections.get('它生成的主张')).length
        if (generates > 0 && generates < 3) problems.push(`“## 它生成的主张”只有 ${generates} 条 < 3 条：概念要能生成做法，派不出三条说明它还只是个形容词`)
        if (bullets(sections.get('这意味着什么')).length < 2) problems.push('“## 这意味着什么”少于 2 条')
        if (bullets(sections.get('这不意味着什么')).length < 2) problems.push('“## 这不意味着什么”少于 2 条')
        if (conceptClaims(sections) < generates) {
          problems.push(`概念列了 ${generates} 条主张，但本节可被引用的编号条目只有 ${conceptClaims(sections)} 条：M- 的 服务: 第 N 条 要能对上`)
        }
        add(
          'stage.S3.mechanism-split',
          true,
          '提示：机制命题（靠什么保证）属于 S4 的 M-，不要写进顶芽——顶芽只回答“是什么气质”',
          'warn',
        )
      } else {
        add(
          'stage.S3.legacy',
          true,
          '本树的顶芽还是「理念 + 机制写在一句话里」的旧形状。新形状把机制拆到 concept/extensions.md 的 M- 条目'
          + '（M- 是技术选型的限制条件），顶芽只写理念概念。要不要迁移由你定：迁移能拿到「选型挂在概念上」这条好处',
          'warn',
        )
      }
      const nounLimit = legacy ? 5 : 3
      const nouns = bullets(sections.get('关键名词'))
      if (nouns.length === 0) problems.push('缺少“## 关键名词”条目（一句话里的自造词必须落到术语表）')
      if (nouns.length > nounLimit) problems.push(`关键名词 ${nouns.length} 个 > ${nounLimit} 个（一个理念背不动这么多新词）`)
      const confirmed = new Set(glossary.terms.filter((term) => term.status === 'confirmed').map((term) => term.name))
      for (const noun of nouns) {
        if (!confirmed.has(noun)) problems.push(`关键名词「${noun}」在术语表里不存在或尚未确认（[确认]）`)
      }
      const coverage = legacy ? sections.get('分层覆盖') : sections.get('承接了哪些层的什么')
      const uncovered = uncoveredLayers(layers.map((item) => String(item.data.id)), coverage ?? '', sections.get('非目标') ?? '')
      if (uncovered.length > 0) problems.push(`这些层未被覆盖也未列入非目标：${uncovered.join(', ')}`)
      add('stage.S3.apical', problems.length === 0, problems.join('；'))
    },
    S4: () => {
      const extensions = itemsOf(extensionsDoc.body, /^E-\d{3}$/)
      const problems = []
      if (extensions.length < 3) problems.push(`延伸条目 ${extensions.length} < 3`)
      for (const extension of extensions) {
        const tier = fieldOf(extension.body, '档位')
        if (tier === undefined || !TIERS.some((value) => tier.includes(value))) problems.push(`${extension.id} 缺少 档位:（必然|需求|猜测）`)
        if (tier !== undefined && tier.includes('需求')) {
          const source = (fieldOf(extension.body, '来源') ?? '').trim()
          if (!traceable.has(source)) problems.push(`${extension.id} 属需求档但 来源 不是有效 ID（${source || '空'}）`)
        }
      }
      add('stage.S4.extensions', problems.length === 0, problems.join('；'))

      // Mechanism propositions: the falsifiable half of the crown, and the only
      // place technology selection is allowed to take its limits from.
      const mechanismProblems = []
      const claims = conceptClaims(sectionsOf(readDoc(conceptPath).body))
      for (const item of mechanisms) {
        const sections = sectionsOf(item.body)
        if (!hasContent(sections.get('机制'))) mechanismProblems.push(`${item.id} 缺少“## 机制”`)
        if (!hasContent(sections.get('反例'))) mechanismProblems.push(`${item.id} 缺少“## 反例”（机制必须可证伪）`)
        const served = (fieldOf(item.body, '服务') ?? '').trim()
        if (served === '') mechanismProblems.push(`${item.id} 缺少 服务:（它服务概念「它生成的主张」里的第几条）`)
        else {
          const index = Number((/(\d+)/.exec(served) ?? [])[1])
          if (!Number.isInteger(index)) mechanismProblems.push(`${item.id} 的 服务: 要写成“第 N 条”（现在是 ${served}）`)
          else if (claims > 0 && index > claims) mechanismProblems.push(`${item.id} 的 服务: 第 ${index} 条 超出了概念的 ${claims} 条主张`)
        }
        if (item.status === 'dropped' && !hasContent(sections.get('淘汰理由'))) mechanismProblems.push(`${item.id} 是淘汰机制但缺少“## 淘汰理由”`)
        if (!['kept', 'dropped'].includes(item.status)) mechanismProblems.push(`${item.id} 的 status 必须是 kept|dropped（现在是 ${item.status}）`)
      }
      add('stage.S4.mechanisms', mechanismProblems.length === 0, mechanismProblems.join('；'))
      if (mechanisms.length === 0) {
        add(
          'stage.S4.mechanism-missing',
          true,
          '还没有 M- 机制命题：S6 的判据会失去机制来源，选型就会变成"市面上有什么"的盘点。'
          + '把"靠什么保证这个概念"写成 M- 条目（可证伪、带反例）',
          'warn',
        )
      }
      add('stage.S4.glossary', glossary.terms.length >= 3, `术语表少于 3 个术语（现在 ${glossary.terms.length}）`)
    },
    S5: () => {
      const doc = readDoc(conceptPath)
      const sections = sectionsOf(doc.body)
      const problems = []
      if (doc.data.status !== 'final') problems.push('concept.md frontmatter 需要 status: final')
      if (!hasContent(sections.get('已知反对与回应'))) problems.push('缺少“## 已知反对与回应”或内容为空')
      // Only kept branches are walked: a dropped node was left out of the concept
      // on purpose, and the recheck record is what keeps it accounted for.
      const keptForChain = nodes
        .filter((item) => item.data.status === 'kept')
        .map((item) => String(item.data.id))
      const conceptLegacy = !hasContent(sections.get('这意味着什么')) && hasContent(sections.get('判据'))
      const chain = chainProblems(sections.get('推演链') ?? '', parents, keptForChain, !conceptLegacy)
      if (chain.problems.length > 0) problems.push(...chain.problems)
      for (const warning of chain.warnings) add('stage.S5.chain', true, warning, 'warn')
      const challenges = readDoc(join(rootDir, 'audit/challenges.md'))
      if (!challenges.ok) problems.push('audit/challenges.md 不存在')
      for (const challenge of itemsOf(challenges.body, /^X-\d{3}$/)) {
        if (!hasContent(fieldOf(challenge.body, '结论'))) problems.push(`${challenge.id} 缺少 结论:`)
      }
      const proposed = decisions.filter((item) => item.data.status === 'proposed')
      if (proposed.length > 0) problems.push(`仍有 proposed 状态的决策：${proposed.map((item) => String(item.data.id)).join(', ')}`)
      add('stage.S5.final', problems.length === 0, problems.join('；'))
    },
    S6: () => {
      const criteria = readDoc(join(rootDir, 'tech/criteria.md'))
      const problems = []
      if (criteria.data.status !== 'locked') problems.push('tech/criteria.md frontmatter 需要 status: locked（先锁判据再看方案）')
      const list = itemsOf(criteria.body, /^K-\d{3}$/)
      if (list.length < 5) problems.push(`判据 ${list.length} 条 < 5 条`)
      let hard = 0
      let fromMechanism = 0
      let stale = 0
      for (const criterion of list) {
        if (fieldOf(criterion.body, '权重') === undefined) problems.push(`${criterion.id} 缺少 权重:`)
        const isHard = fieldOf(criterion.body, '硬约束')
        if (isHard === undefined || !/(是|否)/.test(isHard)) problems.push(`${criterion.id} 缺少 硬约束: 是|否`)
        else if (isHard.includes('是')) hard += 1
        if (fieldOf(criterion.body, 'stale') !== undefined && /true/i.test(fieldOf(criterion.body, 'stale'))) {
          stale += 1
          continue
        }
        const source = (fieldOf(criterion.body, '来源') ?? '').trim()
        if (source !== '' && !source.split(/[,，\s]+/).every((token) => traceable.has(token))) problems.push(`${criterion.id} 的 来源 含不存在的 ID`)
        if (mechanismIds.has(source)) fromMechanism += 1
      }
      if (list.length > 0 && hard === 0) problems.push('至少需要一条硬约束判据（硬约束: 是）')
      if (stale > 0) problems.push(`有 ${stale} 条判据标了 stale: true（上游被撤回波及）——重判后去掉 stale 或改写来源`)
      // Criteria that come from nowhere but "what exists on this machine" turn
      // selection into an inventory. At least one criterion must name the
      // mechanism it enforces.
      if (list.length > 0 && fromMechanism === 0) {
        add(
          'stage.S6.mechanism-source',
          true,
          '没有任何一条判据的 来源 指向 M- 机制命题：这样选出来的方案只满足约束，不体现概念。'
          + '把至少一条判据挂到某个 M- 上（挂不上说明那条判据不是从树上来的）',
          'warn',
        )
      }
      const optionsDoc = readDoc(join(rootDir, 'tech/options.md'))
      if (optionsDoc.ok && criteria.data.locked_at && optionsDoc.data.created) {
        if (String(optionsDoc.data.created) < String(criteria.data.locked_at)) problems.push('options.md 早于判据锁定时间：判据必须在看方案之前锁定')
      }
      add('stage.S6.criteria', problems.length === 0, problems.join('；'))
      if (optionsDoc.ok && !hasContent(sectionsOf(optionsDoc.body).get('清单来源'))) {
        add(
          'stage.S6.option-list-source',
          true,
          'tech/options.md 缺少“## 清单来源”：候选是从哪儿数的、查了哪些、没查哪些、可能漏什么。'
          + '不写清来源，用户就只能看到"就这么几个"',
          'warn',
        )
      }
    },
    S7: () => {
      const selection = readDoc(join(rootDir, 'tech/selection.md'))
      const optionsDoc = readDoc(join(rootDir, 'tech/options.md'))
      const problems = []
      if (selection.data.status !== 'final') problems.push('tech/selection.md frontmatter 需要 status: final')
      const sections = sectionsOf(selection.body)
      for (const heading of ['选定方案', '判据对照', '拒绝理由汇总', '退出成本与迁移', '未验证假设']) {
        if (!hasContent(sections.get(heading))) problems.push(`缺少“## ${heading}”或内容为空`)
      }
      if (!optionsDoc.ok) problems.push('tech/options.md 不存在')
      const keptNodes = new Set(nodes.filter((doc) => doc.data.status === 'kept').map((doc) => String(doc.data.id)))
      const allNodes = new Set(nodes.map((doc) => String(doc.data.id)))
      const keptMechanisms = new Set(mechanisms.filter((item) => item.status === 'kept').map((item) => item.id))
      const candidates = itemsOf(optionsDoc.body, /^O-\d{3}$/)
      if (candidates.length < 2) problems.push(`候选方案 ${candidates.length} < 2（只有一个候选不叫选型）`)
      let hasEvidence = false
      for (const candidate of candidates) {
        const evidence = fieldOf(candidate.body, '证据')
        if (evidence === undefined || !EVIDENCE.test(evidence)) problems.push(`${candidate.id} 缺少 证据: E1|E2|E3`)
        else if (evidence.includes('E2')) hasEvidence = true
        const verdict = fieldOf(candidate.body, '判定') ?? ''
        const origin = (fieldOf(candidate.body, '推演来源') ?? '').trim()
        // An adopted option carries the project forward, so it must be attached
        // to a surviving node or mechanism; a rejected one may legitimately trace
        // to a pruned branch (that is *why* it lost), and must still name an
        // existing node or mechanism.
        const originExists = allNodes.has(origin) || mechanismIds.has(origin)
        const originKept = keptNodes.has(origin) || keptMechanisms.has(origin)
        if (verdict.includes('淘汰')) {
          if (!originExists) problems.push(`${candidate.id} 的 推演来源 必须指向存在的推演节点或机制命题（现在是 ${origin || '空'}）`)
          if (!hasContent(fieldOf(candidate.body, '复活条件'))) {
            add(
              `stage.S7.revive.${candidate.id}`,
              true,
              `${candidate.id} 是被淘汰的候选，但没写 复活条件: ——淘汰是有条件的判断，条件变了它就该被重新考虑`,
              'warn',
            )
          }
        } else if (!originKept) {
          problems.push(`${candidate.id} 不是淘汰项，其 推演来源 必须是保留状态的 N- 或 M-（果实必须长在概念与机制上，现在是 ${origin || '空'}）`)
        }
        if (verdict.includes('淘汰') && !hasContent(fieldOf(candidate.body, '拒绝理由'))) problems.push(`${candidate.id} 判定淘汰但缺少 拒绝理由:`)
      }
      if (candidates.length > 0 && !hasEvidence && !/无/.test(sections.get('未验证假设') ?? '')) problems.push('没有任何 E2（实测）证据：要么补一次实测，要么在“未验证假设”里逐条声明')
      add('stage.S7.selection', problems.length === 0, problems.join('；'))
    },
  }

  const runStageCheck = stageChecks[stage]
  if (runStageCheck !== undefined) runStageCheck()

  const blockers = checks.filter((check) => !check.ok && check.level === 'block')
  return {
    ok: blockers.length === 0,
    root: rootDir,
    slug,
    stage,
    stageTitle: STAGE_TITLES[stage] ?? '',
    nextStage: nextStage(stage),
    requiredForStage: STAGE_ARTIFACTS[stage] ?? [],
    checks,
    blockers,
    errors: blockers.map((check) => `${check.id}: ${check.detail}`),
    stats: {
      layers: layers.length,
      layersConfirmed: layers.filter((doc) => doc.data.status === 'confirmed').length,
      nodes: nodes.length,
      nodesKept: nodes.filter((doc) => doc.data.status === 'kept').length,
      nodesDropped: nodes.filter((doc) => doc.data.status === 'dropped').length,
      mechanisms: mechanisms.length,
      mechanismsDropped: mechanisms.filter((item) => item.status === 'dropped').length,
      questionsOpen: openQuestions.length,
      decisions: decisions.length,
      rounds: roundFiles.length,
      terms: glossary.terms.length,
      termsPending: glossary.unconfirmed.length,
      siblings: siblingSlugs.length,
      dependsOn: dependsOn.length,
    },
  }
}

/** Count bullets in a file (used for the non-goals list inside the seed). */
function bulletCount(text) {
  return bullets(text).length
}

/** Sub-sections addressed by id, e.g. `## C-001 name`. */
function itemsOf(text, pattern) {
  const items = []
  let current = null
  for (const line of text.split('\n')) {
    const match = /^##\s+(\S+)\s*(.*)$/.exec(line)
    if (match !== null) {
      if (current !== null) items.push(current)
      const id = match[1]
      current = pattern.test(id) ? { id, title: match[2].trim(), body: '' } : null
      continue
    }
    if (current !== null) current.body += line + '\n'
  }
  if (current !== null) items.push(current)
  return items
}

/**
 * Parse `concept/extensions.md` into `M-` / `E-` items.
 *
 * Unlike the other collections this file is nested: each item has a `## 机制`
 * paragraph, a `## 反例` list, and so on, and the second item's header follows
 * the first item's nested headers. So the walk has to end an item at the next
 * *identifier-shaped* header, not at the next header of any kind — otherwise
 * every mechanism ends up with an empty body. Items whose id lives in a
 * `- 服务:`-style field rather than a header are handled too.
 * @param text - the file body.
 * @param pattern - which ids belong to this collection (e.g. `/^M-\d{3}$/`).
 */
function parseExtensionItems(text, pattern) {
  const headerRe = /^(#{2,4})\s+(.*)$/
  const items = []
  let current = null
  const push = () => {
    if (current !== null && current.body.trim() !== '') items.push(current)
    current = null
  }
  for (const line of text.split('\n')) {
    const header = headerRe.exec(line)
    const idMatch = header === null ? null : (/(?:M|E)-\d{3}/.exec(header[2]) ?? [])[0]
    if (idMatch !== undefined && idMatch !== null && pattern.test(idMatch)) {
      push()
      current = { id: idMatch, title: header[2].replace(idMatch, '').trim(), body: '' }
      continue
    }
    if (current === null) {
      // The item's id may be a field line instead of a header.
      const owner = (idMatch ?? (/(?:M|E)-\d{3}/.exec(line) ?? [])[0]) ?? null
      if (owner !== null && pattern.test(owner) && /服务|档位|类型|status/.test(line)) {
        current = { id: owner, title: '', body: '' }
      }
    }
    if (current !== null) current.body += line + '\n'
  }
  push()
  return items
}

/** Read one `- key: value` (or `key: value`) line out of an item body. */
function fieldOf(body, key) {
  const match = new RegExp(`^\\s*(?:[-*]\\s+)?\\*{0,2}${key}\\*{0,2}\\s*[:：]\\s*(.*)$`, 'm').exec(body)
  if (match === null) return undefined
  return match[1].trim()
}

/** First non-empty, de-bulleted line of a section. */
function firstLine(text) {
  for (const line of (text ?? '').split('\n')) {
    const cleaned = line.replace(/^\s*[-*>]+\s*/, '').replace(/\*\*/g, '').trim()
    if (cleaned !== '') return cleaned
  }
  return ''
}

/** Layers neither covered by the apical concept nor listed as non-goals. */
function uncoveredLayers(ids, coverageText, nonGoalsText) {
  const mentioned = new Set([...(coverageText.match(/L-\d{3}/g) ?? []), ...(nonGoalsText.match(/L-\d{3}/g) ?? [])])
  return ids.filter((id) => !mentioned.has(id)).sort()
}

/**
 * How many of a concept's generative claims can be pointed at by number.
 *
 * `M-` mechanism propositions say which claim they serve with `服务: 第 N 条`,
 * and that number has to resolve — otherwise "this mechanism serves the concept"
 * is a claim nobody can check.
 * @returns the highest N for which a numbered entry exists (bullets count as
 *   numbered too, since a plain list is the common shape).
 */
function conceptClaims(sections) {
  const text = sections.get('它生成的主张') ?? ''
  const explicit = [...text.matchAll(/^\s*(?:[-*]\s*)?(\d+)[.、)]/gm)].map((match) => Number(match[1]))
  const bullets = text.split('\n').filter((line) => /^\s*[-*]\s+\S/.test(line)).length
  const highest = explicit.length > 0 ? Math.max(...explicit) : 0
  return Math.max(highest, bullets)
}

/**
 * Whether one discarded item has a conclusion in a recheck record.
 * The item may be named in a `##` heading or in a `- 来源:` line (the template's
 * shape), so both are accepted; what is not accepted is a record that never
 * mentions it, or mentions it without saying 维持 / 复活 and why.
 * @returns `{ ok, reason }`.
 */
function recheckConclusion(body, id) {
  const blocks = []
  let current = null
  for (const line of body.split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading !== null) {
      if (current !== null) blocks.push(current)
      current = { head: heading[1], body: '' }
      continue
    }
    if (current !== null) current.body += line + '\n'
  }
  if (current !== null) blocks.push(current)
  const block = blocks.find((item) => item.head.includes(id) || new RegExp(`^\\s*[-*]\\s*来源\\s*[:：].*${id}`, 'm').test(item.body))
  if (block === undefined) return { ok: false, reason: '没有它的条目（每条待盘点项都要单独写一节）' }
  const conclusion = fieldOf(block.body, '结论')
  if (conclusion === undefined) return { ok: false, reason: '缺少 结论: 维持|复活' }
  if (!/(维持|复活)/.test(conclusion)) return { ok: false, reason: `结论必须是「维持」或「复活」（现在是 ${conclusion}）` }
  if (!hasContent(fieldOf(block.body, '理由'))) return { ok: false, reason: '缺少 理由:（维持也要写一句为什么，否则就是盖章）' }
  return { ok: true }
}

/**
 * Check the `## 推演链` section: walks from the seed through layers and nodes.
 *
 * A tree has several branches, so the section may hold several chains — one per
 * line. Each line is walked on its own (a previous line's last node is not the
 * next line's parent), and the set of chains must cover every kept node, since a
 * kept node that no chain reaches is a node that never entered the concept.
 *
 * @param text - the section body.
 * @param parents - the id → parents map of the whole tree.
 * @param keptNodes - ids that must be reachable through the chains.
 * @param strict - true for trees written against the current shape: a missing
 *   coverage is then an error rather than a migration hint.
 * @returns `{ problems, warnings }`.
 */
function chainProblems(text, parents, keptNodes = [], strict = true) {
  const lines = (text ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '')
  const chains = []
  for (const line of lines) {
    // A chain line is a bare sequence, not prose about a sequence: docs written
    // under the old shape talk *about* their chain in paragraphs, and those must
    // not be counted as chains.
    if (/^[>*]|^\*\*|\*\*$|：$|:$/.test(line)) continue
    const tokens = [...line.matchAll(/(?:seed|R-000|L-\d{3}|N-\d{3}|M-\d{3})/g)].map((match) => match[0])
      .filter((token, index, all) => index === 0 || token !== all[index - 1])
    if (tokens.length > 0) chains.push(tokens)
  }
  if (chains.length === 0) return { problems: ['“## 推演链”为空：必须写出从种子到顶芽的节点序列（seed → L-00N → N-00N → …），每行一条分支'], warnings: [] }
  const problems = []
  const warnings = []
  const covered = new Set()
  for (const tokens of chains) {
    if (!(tokens[0] === 'seed' || tokens[0] === 'R-000')) problems.push(`推演链必须从 seed（或 R-000）开始：${tokens.join(' → ')}`)
    if (tokens.length < 3) problems.push(`推演链至少要有 种子 → 一层 → 一个推演节点 三跳：${tokens.join(' → ')}`)
    for (let index = 1; index < tokens.length; index += 1) {
      const previous = tokens[index - 1]
      const current = tokens[index]
      if (current.startsWith('L-')) {
        const parent = (parents.get(current) ?? [])[0]
        const okLink = parent === previous || (previous === 'R-000' && parent === 'seed')
        if (!okLink) problems.push(`推演链断裂：${current} 的 parent 是 ${parent || '（缺失）'}，但链上前一个节点是 ${previous}`)
      } else if (current.startsWith('N-')) {
        const from = parents.get(current) ?? []
        covered.add(current)
        if (!from.includes(previous)) problems.push(`推演链断裂：${current} 的 from 是 [${from.join(', ')}]，不包含链上前一个节点 ${previous}`)
      } else if (current.startsWith('M-')) {
        const from = parents.get(current) ?? []
        covered.add(current)
        if (!from.includes(previous)) problems.push(`推演链断裂：${current} 的 服务 指向 [${from.join(', ')}]，不包含链上前一个节点 ${previous}`)
      } else {
        problems.push(`推演链中的 ${current} 既不是层、推演节点，也不是机制命题`)
      }
    }
    const last = tokens[tokens.length - 1]
    if (!/^(N|M)-\d{3}$/.test(last)) problems.push('推演链必须以一个推演节点（N-00N）或机制命题（M-00N）收尾，它才是顶芽的直接来源')
  }
  const missed = keptNodes.filter((id) => !covered.has(id))
  if (missed.length > 0) {
    const detail = `这些保留节点没有任何一条推演链走到（它们没进入概念）：${missed.join(', ')}`
    if (strict) problems.push(detail)
    else warnings.push(`${detail}（旧树按旧规矩检查；迁移到新形状时补齐即可）`)
  }
  return { problems, warnings }
}

/** Render a report for humans (used by the CLI and the DSH tool). */
export function renderReport(report) {
  const stats = report.stats
  const lines = []
  lines.push(`讨论根: ${report.root}`)
  lines.push(`阶段: ${report.stage} ${report.stageTitle}${report.nextStage === undefined ? '（终态）' : ` → ${report.nextStage} ${STAGE_TITLES[report.nextStage]}`}`)
  lines.push(
    `树: 层 ${stats.layers}(已确认 ${stats.layersConfirmed}) · 推演节点 ${stats.nodes}(保留 ${stats.nodesKept} / 淘汰 ${stats.nodesDropped}) · `
    + `机制 ${stats.mechanisms}${stats.mechanismsDropped > 0 ? `(淘汰 ${stats.mechanismsDropped})` : ''} · `
    + `未决问题 ${stats.questionsOpen} · 决策 ${stats.decisions} · 术语 ${stats.terms}(待确认 ${stats.termsPending}) · 轮次 ${stats.rounds}`,
  )
  if (report.ok) {
    lines.push(`门禁: PASS — ${report.stage} 的出口条件已满足`)
  } else {
    lines.push(`门禁: FAIL — 还缺 ${report.blockers.length} 项`)
    for (const blocker of report.blockers) lines.push(`  ✗ ${blocker.id}: ${blocker.detail}`)
  }
  // Warning-level checks exist so mechanical drift can be reported without
  // blocking a stage; they were computed but never printed until a test caught
  // it, so they are rendered in both the PASS and the FAIL case.
  for (const warning of report.checks.filter((check) => !check.ok && check.level !== 'block')) {
    lines.push(`  ! ${warning.id}: ${warning.detail}`)
  }
  if (report.ok && report.nextStage !== undefined) {
    lines.push(`下一步: apical_gate action=advance（把 stage 推进到 ${report.nextStage}）`)
    lines.push(`进入 ${report.nextStage} 需要: ${(STAGE_ARTIFACTS[report.nextStage] ?? []).join('；')}`)
  }
  return lines.join('\n')
}

/** Direct-invocation CLI. */
function main(argv) {
  const args = { root: undefined, cwd: process.cwd(), stage: undefined, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--root') args.root = argv[++index]
    else if (token === '--cwd') args.cwd = argv[++index]
    else if (token === '--stage') args.stage = argv[++index]
    else if (token === '--json') args.json = true
    else if (token === '--help' || token === '-h') {
      process.stdout.write('用法: node gate.mjs --root design/<slug> [--stage S5] [--json]\n      node gate.mjs --cwd .\n')
      return 0
    }
  }
  let root = args.root
  if (root === undefined) {
    const found = discoverRoot(args.cwd)
    if (found.kind === 'none') {
      process.stdout.write('门禁: 未发现讨论根（design/<slug>/state.json）。若讨论还没开始，先进入 S0 建立讨论根。\n')
      return 1
    }
    if (found.kind === 'ambiguous') {
      process.stdout.write(`门禁: 发现多个讨论根，请用 --root 指定：\n${found.roots.map((item) => `  ${item}`).join('\n')}\n`)
      return 1
    }
    root = found.root
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stdout.write(`门禁: 讨论根不存在: ${root}\n`)
    return 1
  }
  const report = validate(root, args.stage === undefined ? {} : { stage: args.stage })
  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + '\n' : renderReport(report) + '\n')
  return report.ok ? 0 : 1
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) process.exitCode = main(process.argv.slice(2))
