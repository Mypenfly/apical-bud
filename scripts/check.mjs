#!/usr/bin/env node
// apical-bud 体检（零依赖 · Node ESM）
//
// 只查一件事：**组成成分齐不齐**。齐了就是 PASS，其余一律只报警告。
// 不做阶段判定、不推进、不写状态——推演到哪一步写在文件里，由 `map` 读出来。
//
//   node scripts/check.mjs --root design/<slug>          人类可读
//   node scripts/check.mjs --root design/<slug> --json   机器可读
//   node scripts/check.mjs --root design/<slug> --map    顺手把 map.md 写出来
//   node scripts/check.mjs --cwd .                       自动发现讨论根
//   node scripts/check.mjs --trees                       列出项目里的全部讨论根
//
// 退出码：0 = 齐全（可能有警告）｜1 = 缺件｜2 = 用法错误
//
// 旧形状（apical-bud v1：state.json / layers/ / concept/）不检查、不拦，只提示。

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CORE_FILES = ['seed.md', 'facts.md', 'glossary.md']
export const POINT_SECTIONS = ['问题', '已知', '推论', '结论', '反过来', '生出的问题', '用户']
export const MODEL_SECTIONS = [
  '一句话',
  '概念图',
  '它由什么组成',
  '接缝与边界',
  '确定了什么',
  '还没确定什么',
  '反过来',
  '反转：什么情况下这棵树不成立',
  '要落地必须先定的事',
]
export const SELECTION_SECTIONS = ['选定方案', '判据对照', '拒绝理由汇总', '退出成本与迁移', '未验证假设']
export const PROBE_SECTIONS = ['要回答的问题', '杀判据（跑之前先写死）', '怎么跑']
export const HANDOFF_SECTIONS = [
  '一句话',
  '概念模型',
  '选定组合',
  '判据',
  '明确不做',
  '验收',
  '第一件事',
  '给接收会话的提示词',
]

const MINIMAL_OPTION = /什么都不做|最小方案/
const RE_HEADING = /^##\s+(.+?)\s*$/
const RE_BULLET = /^\s*(?:[-*]|\d+\.)\s+(.*\S)\s*$/
// 小节标题里的编号写在最前面：`## F-001 模型计价分三类`
const HEAD_FACT = /^(F-\d{3})\b/
const HEAD_CRITERION = /^(K-\d{2})\b/
const HEAD_OPTION = /^(O-\d{2})\b/
// 正文里出现的编号
const FIND_FACT = /\bF-\d{3}\b/g
const FIND_QUESTION = /\bQ-\d{2}\.\d+\b/g
const FIND_CONCLUSION = /\bD-\d{2}\.\d+\b/g
const FIND_LINE = /\bR-\d{2}\b/g
const ANY_ID = /\b([FQDKO])-(\d+(?:\.\d+)*)/g
const ID_SHAPE = { F: /^F-\d{3}$/, Q: /^Q-\d{2}\.\d+$/, D: /^D-\d{2}\.\d+$/, K: /^K-\d{2}$/, O: /^O-\d{2}$/ }
const SYMBOLIC = new Set(['seed', 'model', '用户'])

/**
 * 一个推演节点在循环里的位置。一个节点只标一个。
 * v1.5 用 `step:` 标六个全局位置；这一版把循环收进节点内部，`step:` 可省，
 * 要写就写五问里的一个。旧值照旧认——旧树不该因为改了写法就报错。
 */
export const STEP_VALUES = ['命名', '组成', '为什么', '怎么落机制', '生出新概念', '新概念', '机制']
export const LEGACY_STEP_VALUES = ['拆词', '论证', '立概念', '倒回去解释', '长出新结论', '生出问题']
const ALL_STEP_VALUES = [...STEP_VALUES, ...LEGACY_STEP_VALUES]

/** 需求线在这一版里要选角色：核心恰好一条，其余是检验条件／非目标。 */
export const ROLE_VALUES = ['核心', '检验条件', '非目标']
const ROLE_CORE = /核心/
const ROLE_CHECK = /检验|担保|底线/
const ROLE_NONE = /非目标|挂起|不算|不做/
/** 检验条件不超过 3 条是建议；多了只提醒"要的太多"，不拦。 */
export const CHECK_CONDITION_SOFT_LIMIT = 3
/** 连着这么多处未定项只增不减，就是没在收敛。 */
const UNDECIDED_RUN_LIMIT = 3

// ── 读盘 ────────────────────────────────────────────────────────────────────

export function readDoc(file) {
  if (!existsSync(file)) return null
  const raw = readFileSync(file, 'utf8')
  const { data, body } = splitFrontmatter(raw)
  return { file, raw, data, body, sections: sectionsOf(body) }
}

export function splitFrontmatter(raw) {
  // 允许 frontmatter 之前有空白行或 HTML 注释（模板的习惯写法）。
  const prefix = /^(?:[ \t]*\r?\n|<!--[\s\S]*?-->)*/.exec(raw)[0]
  const rest = raw.slice(prefix.length)
  if (!rest.startsWith('---')) return { data: {}, body: raw }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(rest)
  if (!match) return { data: {}, body: raw }
  return { data: parseFrontmatter(match[1]), body: prefix + rest.slice(match[0].length) }
}

export function parseFrontmatter(text) {
  const data = {}
  for (const line of text.split(/\r?\n/)) {
    // 键允许非 ASCII（`写于:`、`状态:` 都行），值一律当字符串。
    const match = /^([^\s:#][^:]*?)\s*:\s*(.*)$/.exec(line.trim())
    if (!match) continue
    // 值里允许行尾注释（`status: draft  # draft | settled`）。
    data[match[1]] = stripQuotes(match[2].replace(/\s+#.*$/, '').trim())
  }
  return data
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

/** 把正文按 `## 标题` 切成小节；正文最前面不属于任何小节的部分放进 `_前言`。 */
export function sectionsOf(body) {
  const sections = new Map()
  let current = '_前言'
  sections.set(current, [])
  for (const line of body.split(/\r?\n/)) {
    const heading = RE_HEADING.exec(line)
    if (heading) {
      current = heading[1].trim()
      if (!sections.has(current)) sections.set(current, [])
      continue
    }
    sections.get(current).push(line)
  }
  const out = new Map()
  for (const [title, lines] of sections) out.set(title, lines.join('\n').trim())
  return out
}

export function hasContent(text) {
  if (text === undefined || text === null) return false
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/[\s>*_`-]/g, '').length > 0
}

export function bullets(text) {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((line) => RE_BULLET.exec(line))
    .filter(Boolean)
    .map((match) => match[1].trim())
}

/** `- key：value` / `- key: value` 的取值。 */
export function fieldOf(text, key) {
  if (!text) return ''
  for (const line of text.split(/\r?\n/)) {
    const match = new RegExp(`^\\s*[-*]?\\s*${key}\\s*[:：]\\s*(.*)$`).exec(line)
    if (match) return match[1].trim()
  }
  return ''
}

function idsIn(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const out = []
  for (const match of String(text ?? '').matchAll(new RegExp(pattern.source, flags))) {
    out.push(match[1] ?? match[0])
  }
  return out
}

/** 编号属于哪个推演节点（`D-05.5` → `05`）；拿不到就返回空串。 */
function orderOfId(id) {
  return /^[QDR]-?(\d{2})/.exec(String(id))?.[1] ?? ''
}

const DEMAND_HEADER = /^(编号|ID|词|需求里的词|需求线)$/
const DEMAND_ROLE = /^(核心|检验条件|担保|非目标|挂起|次要|不算)$/
const DEMAND_ROLE_LOOSE = /^(核心|检验条件|担保|底线|非目标|挂起|次要|不算|不做|不计)/
const QUESTION_MARK = /[？?]|怎么|哪几|哪些|多少|是什么|由什么|如何|是否|受什么/

/**
 * 这一格是不是"角色"列（核心／检验条件／非目标）。
 * 表头里有那一列时，认它是角色；没有表头时，只有**整格就是一个角色词**才算——
 * `token 花费 = 核心；其余不算` 是被省略了角色列的旧四列形状，那是认领，不是角色。
 */
function isRoleCell(value, headerHasRole = false) {
  const text = String(value ?? '').replace(/\*\*/g, '').trim()
  if (text === '' || DEMAND_HEADER.test(text)) return true
  if (DEMAND_ROLE.test(text)) return true
  return headerHasRole && DEMAND_ROLE_LOOSE.test(text)
}

/** 角色格可能是"核心 · 代价……"：只取开头那个角色词。 */
function roleWord(value) {
  const text = String(value ?? '').replace(/\*\*/g, '').trim()
  const head = text.split(/[·｜|，,；;（(]/)[0].trim()
  return DEMAND_ROLE_LOOSE.test(head) ? head : text
}

/** 中文数字进阿拉伯数字；认不出返回 null。 */
function toNumber(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return null
  const arabic = /^-?\d+$/.exec(raw)
  if (arabic) return Number(raw)
  const table = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (Object.prototype.hasOwnProperty.call(table, raw)) return table[raw]
  if (raw === '十') return 10
  return null
}

/**
 * 种子里「需求线」一节的各行。
 *
 * 这一版：`R-01 | 需求里的词 | 拆出来的项 | 角色（核心／检验条件／非目标） | 用户认领与放弃代价`。
 * 角色列可以省（省了按位置推断：第一条是核心，其余是检验条件），也可以和认领挤在一格
 * （`R-01 | 低成本 | … | 核心 | token 花费 = 核心` 与 `R-01 | 低成本 | … | token 花费 = 核心` 都认）。
 * v1.5 的四列形状（没有角色列）照旧读得懂。
 */
export function demandLines(seed) {
  const section = seed?.sections.get('需求线') ?? ''
  const rows = tableRows(section)
  for (const line of bullets(section)) {
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean)
    if (cells.length >= 2) rows.push(cells)
  }
  // 表头告诉这一版有没有「角色」列：有就按列读，没有就退回旧四列形状。
  const headerRow = tableRows(section).find((cells) => cells.some((cell) => DEMAND_HEADER.test(cell))) ?? []
  const roleIndex = headerRow.findIndex((cell) => /角色|关系/.test(cell))
  const headerHasRole = roleIndex >= 0
  const out = []
  const seen = new Set()
  const clean = (value) => String(value ?? '').replace(/\*\*/g, '').trim()
  for (const cells of rows) {
    const id = /\bR-\d{2}\b/.exec(cells[0] ?? '')?.[0]
    if (!id || seen.has(id)) continue
    seen.add(id)
    const rest = cells.slice(1).map(clean).filter((cell) => cell !== '')
    if (rest.length === 0) continue
    const word = rest[0] ?? ''
    // 这一版：`词 | 拆出来的项 | 角色 | 认领与放弃代价`。角色列可能整格空着。
    // 旧四列：`词 | 拆出来的项 | 认领`——第 3 格不是角色格，第 4 格起才是认领。
    const shifted = headerHasRole
      ? rest.length >= 2
      : rest.length >= 3 && isRoleCell(rest[1], false)
    const roleCell = headerHasRole
      ? (rest.length >= 3 && isRoleCell(rest[2], true) ? roleWord(rest[2]) : '')
      : (shifted && isRoleCell(rest[1], false) ? roleWord(rest[1]) : '')
    const question = rest[1] ?? ''
    const claim = rest.slice(shifted ? 3 : 2).join(' · ')
    let role
    const roleStated = roleCell !== ''
    if (roleStated) role = roleCell
    // 角色列空着时按位置推断：第一条是核心，其余是检验条件。
    // （v1.5 的四列形状没有角色列，走的也是这一条——`roleStated` 于是为 false。）
    else if (out.length === 0) role = '核心'
    else role = '检验条件'
    out.push({ id, word, question, claim, role, roleStated })
  }
  return out
}

/** 种子里的核心行与检验条件行。核心按职责恰好一条；一条都没有时默认第一条。 */
export function seedRoles(lines) {
  const list = Array.isArray(lines) ? lines : []
  const core = list.filter((item) => ROLE_CORE.test(item.role))
  const others = list.filter((item) => !ROLE_CORE.test(item.role))
  const conditions = others.filter((item) => !ROLE_NONE.test(item.role))
  const nonGoals = others.filter((item) => ROLE_NONE.test(item.role))
  return {
    core: core.length > 0 ? core : list.slice(0, 1),
    coreStated: core.length,
    conditions,
    nonGoals,
    // 这一版才要求"选一个核心 + 写放弃代价"。v1.5 的四列需求线没有角色列，
    // 不该被按这一版的规矩挑毛病——所以这两条警告只在明确选过角色的树上报。
    explicit: list.some((item) => item.roleStated === true),
  }
}

/**
 * 节点里「## 未定项」的条目数：写"无"算 0，其余按条数点。
 *
 * ★ 2026-09-26 修一处长期误报：这一节常见的写法是「**活的 N 条**（说明…）」＋条目，
 *   或「**0 项**（说明…）」，说明里还常带"第 1 条…"这样的行内引用。老版把这些说明
 *   整段当成 1 条（无条目时），或者把说明里的数字当条数，于是 `undecided:` 明明对得上、
 *   却报 drift。现在：先认"节首自报的条数"（活的 N 条／N 项），再退回条目数，最后才当 1。
 */
function declaredSectionCount(raw) {
  const flat = raw.replace(/[\*`]/g, '').trim()
  const m = /^活[的]?\s*(\d+)\s*条/.exec(flat) || /^(\d+)\s*项/.exec(flat) || /^(\d+)\s*条/.exec(flat)
  return m ? Number(m[1]) : null
}
export function undecidedCount(doc) {
  const parsed = toNumber(doc?.data?.undecided)
  if (parsed !== null) return parsed
  const raw = String(doc?.sections?.get('未定项') ?? '').trim()
  if (raw === '' || /^无[。.]?$|^（?无）?$|^暂无/.test(raw)) return 0
  const items = bullets(raw).filter((line) => !/^(无|暂无)/.test(line.trim()))
  if (items.length > 0) return items.length
  const declared = declaredSectionCount(raw)
  if (declared !== null) return declared
  const text = raw.replace(/\*\*/g, '').trim()
  return text === '无' ? 0 : text === '' ? 0 : 1
}

/** 只数「## 未定项」正文里的条目（不看 frontmatter）——用来查这两处对不对得上。 */
export function undecidedSectionCount(doc) {
  const raw = String(doc?.sections?.get('未定项') ?? '').trim()
  if (raw === '' || /^无[。.]?$|^（?无）?$|^暂无/.test(raw)) return 0
  const items = bullets(raw).filter((line) => !/^(无|暂无)/.test(line.trim()))
  if (items.length > 0) return items.length
  const declared = declaredSectionCount(raw)
  if (declared !== null) return declared
  return raw.replace(/\*\*/g, '').trim() === '' ? 0 : 1
}

/** 节点自己定义的编号（`D-05.5` 只算推演节点 05 的），去重；避免把交叉引用当成自己的结论。 */
function ownIds(doc, section, pattern, order) {
  if (!order) return []
  return [...new Set(idsIn(doc?.sections.get(section), pattern))].filter((id) => orderOfId(id) === order)
}

/** 最长的「连续同类」段：`pick` 返回分类键，返回 { key, from, to, count }。 */
function longestRun(points, pick) {
  let best = { key: '', from: '', to: '', count: 0 }
  let current = { key: null, from: '', to: '', count: 0 }
  for (const point of points) {
    const key = pick(point)
    if (key === null) {
      current = { key: null, from: '', to: '', count: 0 }
      continue
    }
    if (current.key === key) {
      current.to = point.order || point.name
      current.count += 1
    } else {
      current = { key, from: point.order || point.name, to: point.order || point.name, count: 1 }
    }
    if (current.count > best.count) best = { ...current }
  }
  return best
}

/** 小节标题最前面的编号（`## K-01 单机可离线` → `K-01`）。 */
function headingIds(sections, pattern) {
  const out = []
  for (const title of sections.keys()) {
    const match = pattern.exec(String(title).trim())
    if (match) out.push(match[1])
  }
  return out
}

/** 按编号取小节正文（标题里编号后面还跟着名字）。 */
function sectionById(sections, id) {
  for (const [title, text] of sections) {
    if (String(title).trim().startsWith(id)) return text
  }
  return undefined
}

export function isLegacy(root) {
  const dir = resolve(root)
  if (existsSync(join(dir, 'seed.md'))) return false
  return ['state.json', 'layers', 'concept', 'seed', 'tech', 'rounds'].some((name) => existsSync(join(dir, name)))
}

export function treeKind(root) {
  const dir = resolve(root)
  if (existsSync(join(dir, 'seed.md'))) return 'new'
  if (isLegacy(dir)) return 'legacy'
  return 'empty'
}

/** 扫描 `<cwd>/design/*`，返回全部讨论根。 */
export function discoverRoots(cwd = process.cwd(), base = 'design') {
  const dir = resolve(cwd, base)
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (!statSync(path).isDirectory()) continue
    const kind = treeKind(path)
    if (kind === 'empty') continue
    out.push({ slug: entry, root: path, kind })
  }
  return out
}

export function pointFiles(root) {
  const dir = join(resolve(root), 'derivation')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ name, order: /^(\d{2})-/.exec(name)?.[1] ?? '', doc: readDoc(join(dir, name)) }))
}

// ── 体检 ────────────────────────────────────────────────────────────────────

export function check(root, options = {}) {
  const dir = resolve(root)
  const checks = []
  const add = (id, ok, detail = '', level = 'block') => checks.push({ id, ok: ok === true, detail, level })

  const kind = treeKind(dir)
  const report = { root: dir, slug: basename(dir), ok: true, kind, checks, blockers: [], warnings: [], stats: {} }
  const finish = () => {
    report.blockers = checks.filter((item) => !item.ok && item.level === 'block')
    report.warnings = checks.filter((item) => !item.ok && item.level === 'warn')
    report.ok = report.blockers.length === 0
    return report
  }

  if (kind === 'legacy') {
    add('tree.legacy', true, '这是 apical-bud v1 形状的讨论根（state.json / layers / concept）：本工具不检查、不拦。要按新形状继续，请在同一项目里新开一个讨论根，并在新 seed.md 里写一句「与已有树的关系」。', 'warn')
    report.stats = { legacy: true }
    return finish()
  }
  if (kind === 'empty') {
    add('tree.exists', false, `${dir} 下没有 seed.md（也没有旧形状的痕迹）：先照 templates/seed.md 建种子。`)
    report.stats = {}
    return finish()
  }

  const seed = readDoc(join(dir, 'seed.md'))
  const facts = readDoc(join(dir, 'facts.md'))
  const glossary = readDoc(join(dir, 'glossary.md'))
  const model = readDoc(join(dir, 'model.md'))
  const handoff = readDoc(join(dir, 'handoff.md'))
  const points = pointFiles(dir)
  const criteria = readDoc(join(dir, 'build', '01-判据.md'))
  const optionsDoc = readDoc(join(dir, 'build', '02-方案.md'))
  const selection = readDoc(join(dir, 'build', '04-选型.md')) ?? readDoc(join(dir, 'build', '03-选型.md'))
  const selectionName = existsSync(join(dir, 'build', '04-选型.md')) ? 'build/04-选型.md' : 'build/03-选型.md'
  const probeDir = join(dir, 'probe')
  const probes = existsSync(probeDir) && statSync(probeDir).isDirectory()
    ? readdirSync(probeDir).filter((name) => /\.(md|mjs|js|cjs|py|sh|ts)$/.test(name)).sort()
    : []

  // ── 硬拦：组成成分 ────────────────────────────────────────────────────────
  const lines = demandLines(seed)
  /** 标成「非目标」的需求线不要求有人推它——它本来就不该吃掉节点。 */
  const isNonGoal = (id) => {
    const seedLines = seed?.sections?.get('需求线') ?? ''
    const row = seedLines.split(/\r?\n/).find((line) => line.includes(id)) ?? ''
    return /非目标/.test(row)
  }

  const lineIds = lines.map((item) => item.id)
  const roles = seedRoles(lines)
  const coreIds = roles.core.map((item) => item.id)
  const seedMissing = ['用户原话', '一句话需求', '核心问题'].filter((name) => !hasContent(seed?.sections.get(name)))
  if (lines.length === 0) {
    seedMissing.push('需求线（把需求里的词逐个拆成 R-01…：名词问"由什么组成、怎么算"，形容词问"有哪些特征、怎么评价"；核心问题要压住每一条线）')
  }
  if (lines.length > 0 && roles.explicit && roles.coreStated !== 1) {
    seedMissing.push(
      roles.coreStated === 0
        ? '核心（需求线里要指定**恰好一条** R-0x 是核心：整棵树只能为它服务；其余的角色写「检验条件」或「非目标」）'
        : `核心恰好一条（现在标了 ${roles.coreStated} 条：${coreIds.join('、')}）——一口气要的那几样，不可能同时全额买到，让用户选一个，其余降为检验条件或非目标`,
    )
  }
  add('core.seed', seed !== null && seedMissing.length === 0, `seed.md 缺这些内容：${seedMissing.join('、')}（种子是推演的起点，缺一节都推不动）`)
  add('core.facts', facts !== null, 'facts.md 不存在：外部事实与调研结论要有一份落处（没有就写"暂无"，但不能没有这份文件）')
  add('core.glossary', glossary !== null, 'glossary.md 不存在：没有用语规范，词会越长越多、各说各的')
  add('core.derivation', points.length > 0, 'derivation/ 下还没有推演节点：还没有开始推')
  if (seed !== null && roles.explicit && !hasContent(seed.sections.get('核心与放弃代价'))) {
    add('seed.core-tradeoff', false, 'seed.md 没有「## 核心与放弃代价」：选了核心就必须写放弃代价（放弃了哪一条、会失去什么、我可能错在哪）——认领地没写代价，核心就没被真正选过', 'warn')
  }
  if (roles.conditions.length > CHECK_CONDITION_SOFT_LIMIT) {
    add('seed.too-many-conditions', false, `种子写了 ${roles.conditions.length} 条检验条件（${roles.conditions.map((item) => item.id).join('、')}）——超过 ${CHECK_CONDITION_SOFT_LIMIT} 条要提醒用户"要的太多"：每多一条担保，核心的可选空间就小一分`, 'warn')
  }
  const conditionsWithoutNode = (roles.explicit ? roles.conditions : [])
    .filter((item) => !points.some((point) => /\bR-\d{2}\b/.exec(String(point.doc?.data.line ?? ''))?.[0] === item.id))
    .map((item) => item.id)
  if (conditionsWithoutNode.length > 0) {
    add('line.condition-unverified', false, `这些检验条件没有任何推演节点在验它：${conditionsWithoutNode.join('、')}——担保写了就有人验，否则它只是写给人看的`, 'warn')
  }

  const shapeProblems = []
  for (const point of points) {
    const doc = point.doc
    const where = `derivation/${point.name}`
    if (!doc) {
      shapeProblems.push(`${where} 读不出来`)
      continue
    }
    for (const key of ['point', 'title', 'status']) {
      if (!hasContent(doc.data[key])) shapeProblems.push(`${where} 缺 ${key}:`)
    }
    if (point.order && doc.data.point && String(doc.data.point) !== point.order) {
      shapeProblems.push(`${where} 的 point: ${doc.data.point} 与文件序号 ${point.order} 不一致`)
    }
    for (const name of ['问题', '结论']) {
      if (!hasContent(doc.sections.get(name))) shapeProblems.push(`${where} 缺「## ${name}」的内容`)
    }
  }
  if (points.length > 0) add('point.shape', shapeProblems.length === 0, shapeProblems.join('；'))

  if (model) {
    add('model.shape', hasContent(model.data.name) && hasContent(model.sections.get('一句话')), 'model.md 缺 name: 或「## 一句话」：概念模型还没有成形（可以先不建这个文件）')
  }
  if (criteria) {
    const ks = headingIds(criteria.sections, HEAD_CRITERION)
    add('build.criteria', ks.length > 0, 'build/01-判据.md 里一条 K- 判据都没有')
  }
  if (optionsDoc) {
    const os = headingIds(optionsDoc.sections, HEAD_OPTION)
    const hasMinimal = [...optionsDoc.sections.keys()].some((title) => MINIMAL_OPTION.test(title))
    add('build.options', os.length >= 2 && hasMinimal, `build/02-方案.md 需要 ≥2 个「## O-0N」候选（现在 ${os.length} 个），外加一个「什么都不做 / 最小方案」对照项`)
  }
  if (selection) {
    const missing = SELECTION_SECTIONS.filter((name) => !selection.sections.has(name))
    const empty = SELECTION_SECTIONS.filter((name) => selection.sections.has(name) && !hasContent(selection.sections.get(name)))
    add('build.selection', missing.length === 0, `${selectionName} 缺这些小节：${missing.join('、')}`)
    if (empty.length > 0) {
      add('build.selection.empty', false, `${selectionName} 这些小节还空着：${empty.join('、')}`, 'warn')
    }
  }
  // 实验件：写了就每一件都要能证伪（有杀判据、有结果栏），跑没跑由"结果"一栏看得出来。
  const needsProbe = /^(yes|y|是|要|需要|true)$/i.test(String(seed?.data.needs_probe ?? '').trim())
  const probeProblems = []
  const probeDocs = probes.filter((item) => item.endsWith('.md') && !item.toLowerCase().startsWith('readme'))
  for (const name of probeDocs) {
    const doc = readDoc(join(probeDir, name))
    if (!doc) {
      probeProblems.push(`probe/${name} 读不出来`)
      continue
    }
    for (const section of PROBE_SECTIONS) {
      if (!hasContent(doc.sections.get(section))) probeProblems.push(`probe/${name} 缺「## ${section}」`)
    }
    if (!hasContent(doc.data.answers) || !/\bQ-\d{2}\.\d+\b/.test(String(doc.data.answers ?? ''))) {
      probeProblems.push(`probe/${name} 没写 answers:（这个实验回答哪一个 Q-；一个实验回答两个问题，结果就说不清是谁造成的）`)
    }
  }
  if (probes.length > 0) {
    if (probeDocs.length > 0) add('probe.shape', probeProblems.length === 0, probeProblems.join('；'))
    if (!probes.some((name) => name.toLowerCase().startsWith('readme'))) {
      add('probe.readme', false, 'probe/ 下没有 README.md：用户要拿着它去跑，得先知道跑法、要回答什么、什么结果算杀死——见 templates/probe.md', 'warn')
    }
  } else if (needsProbe) {
    add('probe.missing', false, 'seed.md 写着 needs_probe: yes，但 probe/ 下还没有实验文件——把实验件产出来，让用户换标准模式会话去跑；不需要实验就把 needs_probe 改成 no 并说明为什么', 'warn')
  }
  if (!needsProbe && selection && !hasContent(selection.sections.get('实验与证伪'))) {
    add('build.probe-skip', false, `${selectionName} 没有「## 实验与证伪」：不设实验是允许的，但要写一句为什么不需要（纯选择题、纯外部信息题都算正当理由）`, 'warn')
  }
  if (handoff) {
    const bad = ['验收', '第一件事'].filter((name) => !hasContent(handoff.sections.get(name)))
    add('build.handoff', bad.length === 0, `handoff.md 缺「## ${bad.join('」「## ')}」：交接件必须说清"怎么算成了"和"先做什么"`)
  }

  // ── 警告：内容与逻辑 ──────────────────────────────────────────────────────
  const seedStatement = String(seed?.data.statement ?? '').trim()
  if (seedStatement.length > 80) add('seed.statement-length', false, `seed.md 的 statement 有 ${seedStatement.length} 字（>80）：一句话需求要能被你一眼认出来`, 'warn')
  const seedEmpty = ['非目标', '什么叫成了', '被否的表述'].filter((name) => !hasContent(seed?.sections.get(name)))
  if (seedEmpty.length > 0) add('seed.missing-sections', false, `seed.md 这些小节还空着：${seedEmpty.join('、')}`, 'warn')

  const factIds = facts ? headingIds(facts.sections, HEAD_FACT) : []
  const factNoSource = factIds.filter((id) => !hasContent(fieldOf(sectionById(facts.sections, id), '出处')))
  const factNoLevel = factIds.filter((id) => !hasContent(fieldOf(sectionById(facts.sections, id), '等级')))
  if (factNoSource.length > 0) add('facts.sources', false, `这些事实没写「出处」：${factNoSource.join('、')}——没出处的事实只是印象`, 'warn')
  if (factNoLevel.length > 0) add('facts.levels', false, `这些事实没写「等级」（E1/E2/E3）：${factNoLevel.join('、')}`, 'warn')
  const userSourced = factIds.filter((id) => {
    const source = fieldOf(sectionById(facts.sections, id), '出处')
    if (!hasContent(source)) return false
    const external = /https?:\/\/|文档|规范|源码|代码|论文|arxiv|日志|命令|输出|实测|\.md|第\s*\d+\s*行|账单|报价|定价|数据/i.test(source)
    return !external && /用户|访谈|问卷|体验|感受|偏好|反馈/.test(source)
  })
  if (userSourced.length > 0) {
    add('facts.not-external', false, `这些"事实"的出处是用户自述：${userSourced.join('、')}——facts.md 只收外部信息（文档／源码／数据／实测输出）；用户说过的话属于 seed.md 与推演节点的 [用户]。把用户当信息来源，推演会一路滑成对他体验的调查`, 'warn')
  }
  const unsearched = [...(facts?.sections.keys() ?? [])].find((title) => title.includes('没查'))
  if (facts && (unsearched === undefined || !hasContent(facts.sections.get(unsearched)))) {
    add('facts.unsearched', false, 'facts.md 没有「没查的」一节：写清哪些没查、因此可能漏什么，比穷尽更重要', 'warn')
  }

  const defined = new Set(factIds)
  const inlineRefs = []
  const questions = new Map()
  const conclusions = new Map()
  const raisedQuestions = []
  const problems = []
  for (const point of points) {
    const doc = point.doc
    if (!doc) continue
    const where = `derivation/${point.name}`
    const status = String(doc.data.status ?? '')
    for (const name of ['已知', '推论', '反过来']) {
      if (!hasContent(doc.sections.get(name))) problems.push(`${where} 的「## ${name}」空着`)
    }
    for (const id of idsIn(doc.sections.get('问题'), FIND_QUESTION)) questions.set(id, { point: point.order, doc })
    for (const id of idsIn(doc.sections.get('结论'), FIND_CONCLUSION)) conclusions.set(id, { point: point.order, doc })
    for (const id of questions.keys()) defined.add(id)
    for (const id of conclusions.keys()) defined.add(id)
    const raiseText = doc.sections.get('生出的问题') ?? ''
    const raised = idsIn(raiseText, FIND_QUESTION)
    for (const match of String(doc.raw).matchAll(/\[(事实|结论)\s+((?:F|D)-\d+(?:\.\d+)?)\]/g)) {
      inlineRefs.push({ id: match[2], where, kind: match[1] })
    }
    for (const id of raised) {
      defined.add(id)
      const line = lineWith(raiseText, id)
      raisedQuestions.push({
        id,
        where,
        status,
        line,
        // 写了去向（待答 / 悬置 / 由某点回答）就算交代过；一个字都不写才算丢掉。
        marked: /去向|待答|悬置|由推演节点|由推演节点\s*\d/.test(line),
        paused: /悬置|解锁|什么事实|什么时候能/.test(line),
      })
    }
    if (status === 'open' && raised.length === 0) {
      problems.push(`${where} 标着 open，却没有「## 生出的问题」——推演停在哪儿了？`)
    }
    if (status === 'paused' && !/解锁|什么事实|什么时候能/.test(raiseText)) {
      problems.push(`${where} 悬置了，但没写"什么事实能解开"`)
    }
  }
  if (problems.length > 0) add('point.missing-sections', false, problems.join('；'), 'warn')

  const badNames = points.filter((point) => !point.order).map((point) => `derivation/${point.name}`)
  if (badNames.length > 0) {
    add('point.filename', false, `这些推演节点的文件名没有两位序号开头（NN-<短词>.md），推演顺序就读不出来了：${badNames.join('、')}`, 'warn')
  }

  const badIds = []
  for (const point of points) {
    const doc = point.doc
    if (!doc) continue
    for (const match of doc.raw.matchAll(new RegExp(ANY_ID.source, 'g'))) {
      const token = `${match[1]}-${match[2]}`
      if (!ID_SHAPE[match[1]].test(token)) badIds.push(`derivation/${point.name}: ${token}`)
    }
  }
  if (badIds.length > 0) {
    add('point.ids', false, `这些编号不合形状（事实 F-001／问题 Q-03.1／结论 D-03.1／判据 K-01／方案 O-01）：${[...new Set(badIds)].slice(0, 6).join('、')}`, 'warn')
  }

  const references = new Map()
  for (const point of points) {
    const doc = point.doc
    if (!doc) continue
    for (const key of ['from', 'answers']) {
      const raw = String(doc.data[key] ?? '').trim()
      if (!raw) continue
      const value = raw.replace(/^\[|\]$/g, '')
      for (const part of value.split(',').map((item) => item.trim()).filter(Boolean)) {
        references.set(part, `derivation/${point.name}.${key}`)
      }
    }
  }
  const unresolved = [...references.keys()].filter((id) => !SYMBOLIC.has(id) && !defined.has(id))
  if (unresolved.length > 0) {
    add('refs.resolve', false, `这些前提/回答指向了不存在的编号：${unresolved.map((id) => `${id}（${references.get(id)}）`).join('、')}`, 'warn')
  }

  const unanswered = raisedQuestions
    .filter((item) => item.status === 'closed' && !item.marked && !references.has(item.id))
    .map((item) => `${item.id}（${item.where}）`)
  if (unanswered.length > 0) {
    add('logic.dangling', false, `这些节点已经结了，它生出的问题却连去向都没写（待答 / 悬置 / 由哪一个节点回答，写一个就行）：${unanswered.join('、')}`, 'warn')
  }

  const brokenInline = inlineRefs.filter((item) => !defined.has(item.id))
  if (brokenInline.length > 0) {
    add('refs.inline', false, `正文里引用的编号不存在（写错号了？）：${[...new Set(brokenInline.map((item) => `${item.id}（${item.where}）`))].join('、')}`, 'warn')
  }

  // 推演纪律：每一步都要由上一步生出来——回答前面提出的问题，或把前面的结论当前提。
  // 第一个点除外（它回答的是种子的核心问题）。另查两种顺序错误与"一步答多问"。
  const discipline = []
  const raisedBy = new Map()
  for (const point of points) {
    const doc = point.doc
    if (!doc) continue
    const order = point.order
    const from = refList(doc.data.from)
    const answers = refList(doc.data.answers)
    if (order !== '' && order !== '01') {
      const fromConclusion = from.some((id) => /^D-\d{2}\./.test(id))
      const answeredEarlier = answers.some((id) => raisedBy.has(id))
      if (!fromConclusion && !answeredEarlier) {
        discipline.push(`${order}「${doc.data.title ?? point.name}」既没有回答前面提出的问题（answers:），也没有把前面的结论当前提（from: 里没有 D-）——它和上一步没有关系，像是另起了一个话题`)
      }
    }
    for (const id of [...from, ...answers]) {
      const target = orderOfId(id)
      if (target !== '' && order !== '' && target >= order) {
        discipline.push(`${order} 引用了 ${id}（属于推演节点 ${target}）——推演只能往后长，不能引用自己和后面的点`)
      }
    }
    if (answers.length > 1) {
      discipline.push(`${order} 一步回答了 ${answers.length} 个问题（${answers.join('、')}）——逐级深入一次只答一个，多的拆成几步`)
    }
    for (const id of idsIn(doc.sections.get('生出的问题'), FIND_QUESTION)) {
      if (!raisedBy.has(id)) raisedBy.set(id, order)
    }
  }
  if (discipline.length > 0) add('chain.sequence', false, discipline.join('；'), 'warn')

  // 需求线：每条线都要有人推；每个点只标一个循环位置；事实不进 from:。
  const brief = (list, limit = 4) => (list.length > limit ? `${list.slice(0, limit).join('、')}…（共 ${list.length} 个）` : list.join('、'))
  const lineLabel = (id) => {
    const line = lines.find((item) => item.id === id)
    return line && line.word ? `${id}（${line.word}）` : id
  }
  const noLine = []
  const unknownLine = []
  const noStep = []
  const badStep = []
  const noWhat = []
  const factFrom = []
  for (const point of points) {
    const doc = point.doc
    if (!doc) continue
    const where = `derivation/${point.name}`
    const raw = String(doc.data.line ?? '').trim()
    const id = /\bR-\d{2}\b/.exec(raw)?.[0]
    if (!id) noLine.push(where)
    else if (lineIds.length > 0 && !lineIds.includes(id)) unknownLine.push(`${where} 的 line: ${raw}`)
    const step = String(doc.data.step ?? '').trim()
    if (step && !ALL_STEP_VALUES.includes(step)) badStep.push(`${where} 的 step: ${step}`)
    // 命名：这一版的节点认一个词。旧树用 concept: 表达同一件事，也认。
    if (!hasContent(doc.data.what) && !hasContent(doc.data.concept)) noWhat.push(where)
    if (refList(doc.data.from).some((item) => /^F-\d{3}$/.test(item))) factFrom.push(where)
  }
  if (lineIds.length > 0 && noLine.length > 0) {
    add('line.missing', false, `这些推演节点没写 line:（它服务哪条需求线）：${brief(noLine)}——每条线都要有人推`, 'warn')
  }
  if (unknownLine.length > 0) add('line.unknown', false, `这些 line: 指向种子里没有的线：${brief(unknownLine)}`, 'warn')
  if (badStep.length > 0) {
    add('step.unknown', false, `这些推演节点的 step: 不在循环位置里：${brief(badStep)}——五问是 ${STEP_VALUES.join('／')}（旧写法 ${LEGACY_STEP_VALUES[0]} 等也认）；一个节点只标一个`, 'warn')
  }
  if (noWhat.length > 0) {
    add('what.missing', false, `这些推演节点没写 what:（这一步在谈哪个词）：${brief(noWhat)}——一个节点认一个词，没名字的节点多半在算账`, 'warn')
  }
  if (factFrom.length > 0) {
    add('point.fact-from', false, `这些推演节点的 from: 里放了事实：${brief(factFrom)}——事实是材料，写进「## 已知」；from: 只放结论 D-`, 'warn')
  }

  // 收敛：节点可以无限长，未定项不能一直涨。
  const undecidedAt = new Map()
  const declaredUndecided = []
  for (const point of points) {
    const doc = point.doc
    if (!doc) continue
    undecidedAt.set(point.order || point.name, undecidedCount(doc))
    if (String(doc.data.undecided ?? '').trim() !== '') declaredUndecided.push(point.order || point.name)
  }
  const rising = []
  const ordered = points.filter((point) => point.doc)
  for (let index = 0; index < ordered.length; index += 1) {
    const here = undecidedAt.get(ordered[index].order || ordered[index].name) ?? 0
    let risingSteps = 0
    let cursor = index
    let previous = here
    while (cursor + 1 < ordered.length) {
      const next = undecidedAt.get(ordered[cursor + 1].order || ordered[cursor + 1].name) ?? 0
      if (next > previous) {
        risingSteps += 1
        cursor += 1
        previous = next
      } else break
    }
    if (risingSteps + 1 >= UNDECIDED_RUN_LIMIT && !rising.some((item) => item.from === ordered[index].order)) {
      rising.push({
        from: ordered[index].order || ordered[index].name,
        to: ordered[cursor].order || ordered[cursor].name,
        count: risingSteps + 1,
        fromValue: here,
        toValue: previous,
      })
    }
    index = Math.max(index, cursor - 1)
  }
  if (rising.length > 0) {
    add('undecided.rising', false, `${rising.map((item) => `推演节点 ${item.from}–${item.to} 连着 ${item.count} 个未定项只增不减（${item.fromValue} → ${item.toValue}）`).join('；')}——节点在长、未定项也在长，这不是收敛是铺摊子：停下来把一个未定项真正关掉（哪怕结论是"这条走不通"），或者明说这棵树卡在哪一条上`, 'warn')
  }
  const undecidedDrift = []
  for (const point of points) {
    const doc = point.doc
    if (!doc) continue
    if (String(doc.data.undecided ?? '').trim() === '') continue
    if (!doc.sections.has('未定项')) continue
    const declaredValue = undecidedCount(doc)
    const sectionValue = undecidedSectionCount(doc)
    if (declaredValue !== sectionValue) {
      undecidedDrift.push(`${point.order || point.name}（frontmatter ${declaredValue}，正文 ${sectionValue}）`)
    }
  }
  if (undecidedDrift.length > 0) {
    add('undecided.drift', false, `这些推演节点的 undecided: 与「## 未定项」条数对不上：${brief(undecidedDrift)}——两处同时改；只改一处，map.md 里那个进度数字就是错的`, 'warn')
  }
  if (declaredUndecided.length > 0 && [...undecidedAt.values()].every((value) => value === 0)) {
    const settled = String(model?.data?.status ?? '').trim() === 'settled'
    if (!settled && points.every((point) => String(point.doc?.data.status) !== 'open')) {
      add('undecided.clear', false, '未定项已经清零、也没有进行中的节点了：概念自洽且可实现就可以写 model.md 的 settled，然后动 build/', 'warn')
    }
  }
  if (lineIds.length > 0 && points.length >= 3) {
    const owned = new Map(lineIds.map((id) => [id, []]))
    for (const point of points) {
      const id = /\bR-\d{2}\b/.exec(String(point.doc?.data.line ?? ''))?.[0]
      if (id && owned.has(id)) owned.get(id).push(point.order || point.name)
    }
    const idle = lineIds.filter((id) => owned.get(id).length === 0 && !isNonGoal(id))
    const busy = lineIds.filter((id) => owned.get(id).length >= 3)
    if (idle.length > 0 && busy.length > 0) {
      add('line.idle', false, `偏了：${idle.map(lineLabel).join('、')} 一个推演节点都没有，而 ${busy.map((id) => `${lineLabel(id)} 已经吃掉 ${owned.get(id).length} 个`).join('、')}——每条需求线都要有人推`, 'warn')
    }
    const lineOf = (point) => /\bR-\d{2}\b/.exec(String(point.doc?.data.line ?? ''))?.[0] ?? null
    const run = longestRun(points, lineOf)
    // 只有一条需求线时，"连着几个点都在同一条线上"是必然的，不算跑偏。
    if (lineIds.length >= 2 && run.count >= 4) {
      add('line.run', false, `推演节点 ${run.from}–${run.to} 连着 ${run.count} 个都在 ${lineLabel(run.key)} 上——换一条线，或者明说这条线为什么还没推完`, 'warn')
    }
  }

  const newConceptAt = new Set()
  const seenConcepts = new Set()
  for (const point of points) {
    const value = String(point.doc?.data.what ?? point.doc?.data.concept ?? '').trim()
    if (!value) continue
    if (!seenConcepts.has(value)) newConceptAt.add(point.order || point.name)
    seenConcepts.add(value)
  }
  // 只在"没有新概念"的节点上连段：出现新概念就断开（返回 null）。
  const flat = longestRun(points, (point) => (newConceptAt.has(point.order || point.name) ? null : 'flat'))
  if (flat.count >= 5) {
    add('concept.flat', false, `推演节点 ${flat.from}–${flat.to} 连着 ${flat.count} 个没有出现新概念——在算账，不在推演：一个节点的产物是一个概念`, 'warn')
  }

  const soleAssumption = []
  for (const point of points) {
    const doc = point.doc
    if (!doc) continue
    const raw = String(doc.data.from ?? '').replace(/^\[|\]$/g, '')
    const list = raw.split(',').map((item) => item.trim()).filter(Boolean)
    const isAssumption = /假设/.test(String(doc.data.type ?? '')) || /type\s*[:：]\s*假设/.test(doc.sections.get('结论') ?? '')
    if (isAssumption && list.length <= 1) soleAssumption.push(`derivation/${point.name}`)
  }
  if (soleAssumption.length > 0) {
    add('logic.assumption', false, `这些结论是被当成结论写的假设，且只有一个前提：${soleAssumption.join('、')}——假设不能单独支撑结论`, 'warn')
  }

  // 种子拆出来的词在推演里有没有落点。
  // 只做保守判断：**每一条需求线的词都一次没出现**才报。拆开的词本来就不该原样出现，
  // 所以比的是子串（"低成本"算数，"钱花在哪几块"里的"钱花"也算数），不要求整句命中。
  const FILLER = /^(怎么|哪些|什么|是否|多少|如何|由什么|受什么|哪几|是什么|的|了|吗|呢)$/
  const chainText = [...points.map((point) => point.doc?.raw ?? ''), model?.raw ?? ''].join('\n')
  const landedWords = (line) => {
    const tokens = [line.word, ...String(line.question ?? '').split(/[\s/、,，;；：:（）()【】[\]]+/)]
    const probes = tokens.map((token) => String(token ?? '').replace(/[①-⑳？?]/g, '').trim())
    const extra = [...String(line.word ?? '')].filter((char) => /[\u4e00-\u9fa5]/.test(char))
    return [...new Set([...probes, ...extra])].filter((item) => item.length >= 2 && !FILLER.test(item))
  }
  const unlanded = lines.filter((line) => {
    const probes = landedWords(line)
    return probes.length > 0 && !probes.some((probe) => chainText.includes(probe))
  })
  // 还没有推演节点时无从谈起"落点"：那不是跑偏，是还没开始。
  if (points.length > 0 && lines.length > 0 && unlanded.length === lines.length) {
    const shown = unlanded.slice(0, 4).map((line) => `${line.id}${line.word ? `（${line.word}）` : ''}`)
    add('logic.landing', false, `种子里拆出来的词在推演里一个都没出现（${shown.join('、')}${unlanded.length > 4 ? '…' : ''}）——推演可能跑到了别处`, 'warn')
  }

  if (model) {
    const line = (model.sections.get('一句话') ?? '').replace(/\s/g, '')
    if (line.length > 60) add('model.length', false, `model.md 的「一句话」有 ${line.length} 字（>60）：概念模型的名字要一句话说得完`, 'warn')
    const coreQuestion = (seed?.sections.get('核心问题') ?? '').replace(/[\s，。？！、；：""''（）*_`-]/g, '')
    // 照模板刚建出来的树里，两边都还是 <占位>：那不是"找不到核心问题"，是还没写。
    const stillTemplate = (model.sections.get('一句话') ?? '').includes('<') || (seed?.sections.get('核心问题') ?? '').includes('<')
    if (coreQuestion.length >= 6 && !stillTemplate) {
      const probe = []
      for (let index = 0; index + 4 <= coreQuestion.length; index += 1) probe.push(coreQuestion.slice(index, index + 4))
      if (!probe.some((chunk) => model.raw.includes(chunk))) {
        add('model.core-question', false, 'model.md 里找不到种子的核心问题：顶芽要回答的是它，不是别的问题', 'warn')
      }
    }
    const paused = points.filter((point) => String(point.doc?.data.status) === 'paused')
    if (paused.length > 0 && !hasContent(model.sections.get('还没确定什么'))) {
      add('model.open', false, `还有 ${paused.length} 个悬置的推演节点，但 model.md 的「## 还没确定什么」是空的——悬置的东西要出现在概念模型里`, 'warn')
    }
    const buildTouched = Boolean(criteria || optionsDoc || selection || handoff)
    const buildStillTemplate = [criteria, optionsDoc, selection].some((doc) => String(doc?.raw ?? '').includes('<'))
    if (buildTouched && !buildStillTemplate && String(model.data.status ?? '') !== 'settled') {
      const modelStatus = String(model.data.status ?? '').trim()
      add('build.premature', false, `model.md 的 status 是「${modelStatus === '' ? '空' : modelStatus}」，还没到 settled 就动笔选型了：先把顶芽定下来，否则判据会被方案带偏`, 'warn')
    }
  }

  const writtenAt = (doc) => String(doc?.data['写于'] ?? '').trim()
  if (criteria && optionsDoc && writtenAt(criteria) && writtenAt(optionsDoc) && writtenAt(optionsDoc) < writtenAt(criteria)) {
    add('build.order', false, `02-方案.md（写于 ${writtenAt(optionsDoc)}）早于 01-判据.md（写于 ${writtenAt(criteria)}）：判据先锁，方案后看`, 'warn')
  }
  const buildGaps = []
  for (const id of criteria ? headingIds(criteria.sections, HEAD_CRITERION) : []) {
    const text = sectionById(criteria.sections, id)
    if (!hasContent(fieldOf(text, '来源'))) buildGaps.push(`${id} 缺 来源`)
    if (!hasContent(fieldOf(text, '硬约束'))) buildGaps.push(`${id} 缺 硬约束`)
  }
  for (const id of optionsDoc ? headingIds(optionsDoc.sections, HEAD_OPTION) : []) {
    const text = sectionById(optionsDoc.sections, id)
    if (!hasContent(fieldOf(text, '证据'))) buildGaps.push(`${id} 缺 证据等级`)
    if (/淘汰|不选|拒绝/.test(text ?? '') && !hasContent(fieldOf(text, '复活条件'))) buildGaps.push(`${id} 淘汰了但没写 复活条件`)
  }
  if (buildGaps.length > 0) add('build.gaps', false, buildGaps.join('；'), 'warn')

  const mapFile = join(dir, 'map.md')
  if (!existsSync(mapFile) && points.length > 0) {
    add('map.missing', false, '还没有 map.md：跑一次 apical_check action=map——新会话靠它一眼接上进度', 'warn')
  }
  if (existsSync(mapFile)) {
    const mapText = readFileSync(mapFile, 'utf8')
    // 内容级比对：mtime 会被 checkout、复制、编辑器保存重置，而"map.md 停在哪一轮"才是接续要紧的。
    const freshMap = buildMap(root)
    const pick = (text, prefix) => text.split('\n').find((line) => line.startsWith(prefix)) ?? ''
    const drifted = [['**现在停在**：', '现在停在'], ['**下一步**：', '下一步']]
      .filter(([prefix]) => {
        const was = pick(mapText, prefix)
        // 旧 map.md 里根本没有这一行（比如早于「下一步」那一版）就不算漂移：旧形状读得懂、不报缺件。
        return was !== '' && was !== pick(freshMap, prefix)
      })
      .map(([, label]) => label)
    if (drifted.length > 0) {
      add('map.drift', false, `map.md 里的「${drifted.join('」「')}」与文件现在写着的对不上：跑一次 apical_check action=map——新会话只读 map.md，错的那一行会把进度接错（换过版本的 map.md 也会这样，重跑一次就对了）`, 'warn')
    }
    const sources = ['seed.md', 'facts.md', 'glossary.md', 'model.md', 'handoff.md']
      .map((name) => join(dir, name))
      .concat(points.map((point) => join(dir, 'derivation', point.name)))
      .filter((file) => existsSync(file))
    const newest = sources.reduce((latest, file) => Math.max(latest, statSync(file).mtimeMs), 0)
    if (statSync(mapFile).mtimeMs < newest) {
      add('map.stale', false, 'map.md 比源文件旧：跑一次 apical_check action=map 让它跟上——新会话正是靠它接进度的', 'warn')
    }
  }

  if (handoff && !hasContent(handoff.sections.get('概念模型'))) {
    add('handoff.inline', false, 'handoff.md 的「## 概念模型」是空的：交接件要自包含，接收方不该被迫读这棵树', 'warn')
  }

  const glossaryTerms = bullets(glossary?.sections.get('_前言') ?? glossary?.body ?? '')
  const lineCoverage = lines.map((item) => ({
    id: item.id,
    word: item.word,
    points: points
      .filter((point) => /\bR-\d{2}\b/.exec(String(point.doc?.data.line ?? ''))?.[0] === item.id)
      .map((point) => point.order || point.name),
  }))
  report.stats = {
    points: points.length,
    open: points.filter((point) => String(point.doc?.data.status) === 'open').length,
    closed: points.filter((point) => String(point.doc?.data.status) === 'closed').length,
    paused: points.filter((point) => String(point.doc?.data.status) === 'paused').length,
    conclusions: conclusions.size,
    questions: questions.size,
    facts: factIds.length,
    terms: glossaryTerms.length,
    lines: lines.length,
    lineCoverage,
    model: model ? String(model.data.status || 'draft') : '未成形',
    build: [criteria && '判据', optionsDoc && '方案', selection && '选型', handoff && '交接'].filter(Boolean).join('·') || '未开始',
  }
  return finish()
}

// ── 概念图与进度（map.md） ───────────────────────────────────────────────────

/** 小节标题去掉编号后的名字（`## F-001 模型计价分三类` → `模型计价分三类`）。 */
function headingName(sections, id) {
  for (const title of sections.keys()) {
    const text = String(title).trim()
    if (text.startsWith(id)) return text.slice(id.length).trim()
  }
  return ''
}

export function buildMap(root) {
  const dir = resolve(root)
  const seed = readDoc(join(dir, 'seed.md'))
  const facts = readDoc(join(dir, 'facts.md'))
  const model = readDoc(join(dir, 'model.md'))
  const handoff = readDoc(join(dir, 'handoff.md'))
  const points = pointFiles(dir)
  const buildNames = ['01-判据.md', '02-方案.md', '03-实验.md', '04-选型.md'].map((name) => [name, existsSync(join(dir, 'build', name))])

  // 谁回答了哪个问题：从各点的 `answers:` 反查。
  const answeredBy = new Map()
  for (const point of points) {
    for (const id of refList(point.doc?.data.answers)) answeredBy.set(id, point.order)
  }
  // 只列本点自己定义的编号：`## 结论` 里引用别点的 `[D-05.1]` 不算本点的结论。
  const questionLine = (doc, id) => lineWith(doc?.sections.get('问题'), id)
  const conclusionLine = (doc, id) => lineWith(doc?.sections.get('结论'), id)
  const ownQuestions = (doc, order) => ownIds(doc, '问题', FIND_QUESTION, order)
  const ownConclusions = (doc, order) => ownIds(doc, '结论', FIND_CONCLUSION, order)
  /**
   * 一个节点「生出的问题」里**还没答的**那些。
   * ★ 2026-09-26 修：老版把已答的（行内 `~~` 划掉、或写着"已答／已用／已跑"）也算成"下一个问题"，
   *   于是 map.md 的「下一步」反复指向一个早就答完的问题（本轮就出现过一次）。
   */
  const raiseLines = (doc, order) =>
    ownIds(doc, '生出的问题', FIND_QUESTION, order)
      .map((id) => ({ id, text: lineWith(doc?.sections.get('生出的问题'), id) }))
      .filter((item) => !/~~|已答|已跑|已用|作废|见 F-/.test(item.text))

  const lines = []
  const seedHeading = /^#\s+(.+?)\s*$/m.exec(seed?.body ?? '')?.[1] ?? ''
  const topic = String(seed?.data.topic ?? seed?.data.title ?? seedHeading ?? '').replace(/^种子\s*[:：]\s*/, '') || basename(dir)
  lines.push(`# 推演进度 · ${topic}`)
  lines.push('')
  lines.push('<!-- 本文件由 apical_check map 生成，不要手改。 -->')
  lines.push('')
  lines.push(`**核心问题**：${oneLine(seed?.sections.get('核心问题')) || '（seed.md 里还没写）'}`)
  lines.push('')

  const current = [...points].reverse().find((point) => String(point.doc?.data.status) === 'open')
  if (current) {
    const doc = current.doc
    lines.push(`**现在停在**：推演节点 ${current.order}「${doc.data.title ?? ''}」`)
    for (const id of ownQuestions(doc, current.order)) lines.push(`- 在答：${questionLine(doc, id)}`)
    for (const id of ownConclusions(doc, current.order)) lines.push(`- 已得：${conclusionLine(doc, id)}`)
    for (const item of raiseLines(doc, current.order)) lines.push(`- 待答：${item.text}`)
  } else if (points.length > 0) {
    lines.push(`**现在停在**：没有标着 open 的推演节点${points.some((point) => String(point.doc?.data.status) === 'paused') ? '（还有悬置的节点，见下）' : ''}`)
  } else {
    lines.push('**现在停在**：还没有推演节点')
  }
  lines.push('')

  // 下一步：把进度变成一句可执行的话——上下文被压缩之后，先接的就是这一行。
  const nextStep = (() => {
    if (points.length === 0) return '照 `templates/seed.md` 起种子：一句话需求 → 需求线 → 核心与放弃代价 → 核心问题。'
    if (current) {
      const raised = raiseLines(current.doc, current.order)
      if (raised.length > 0) return `先答推演节点 ${current.order} 生出的下一个问题：${oneLine(raised[0].text)}`
      const items = bullets(String(current.doc?.sections?.get('未定项') ?? '')).filter((line) => !/^(无|暂无)/.test(line.trim()))
      if (items.length > 0) return `先把推演节点 ${current.order} 认领的未定项关掉：${oneLine(items[0])}`
      return `推演节点 ${current.order} 的未定项已经清空：开下一个节点，或写 model.md 的 settled。`
    }
    const paused = points.filter((point) => String(point.doc?.data.status) === 'paused')
    if (paused.length > 0) return `悬置的推演节点 ${paused.map((point) => point.order).join('、')} 等的是外部事实：去查它，或者写明"现在拿不到"。`
    const left = points.reduce((sum, point) => sum + undecidedCount(point.doc), 0)
    if (left === 0 && String(model?.data.status ?? '').trim() !== 'settled') return '未定项已经清零：写 model.md 的 `status: settled`，再进 build/ 立判据。'
    return '没有进行中的节点：开一个新节点，或者回 seed.md 看是哪条需求线还没被推。'
  })()
  lines.push(`**下一步**：${nextStep}`)
  lines.push('')

  const demand = demandLines(seed)
  if (demand.length > 0) {
    const owned = new Map(demand.map((item) => [item.id, []]))
    for (const point of points) {
      const id = /\bR-\d{2}\b/.exec(String(point.doc?.data.line ?? ''))?.[0]
      if (id && owned.has(id)) owned.get(id).push(point.order || point.name)
    }
    lines.push('## 需求线')
    for (const item of demand) {
      const mine = owned.get(item.id)
      const where = mine.length > 0 ? `节点 ${mine.join('、')}（共 ${mine.length} 个）` : '**还没有推演节点**'
      const claim = item.claim && !/^候选/.test(item.claim) ? ` · 认领：${item.claim}` : ''
      const role = item.role ? `［${item.role}］` : ''
      lines.push(`- **${item.id}${item.word ? ` ${item.word}` : ''}**${role} ${item.question}${claim} · ${where}`)
    }
    lines.push('')
  }

  const chain = points.filter((point) => hasContent(point.doc?.data.what ?? point.doc?.data.concept))
  if (chain.length > 0) {
    const seen = new Set()
    lines.push('## 概念链')
    for (const point of points) {
      const concept = String(point.doc?.data.what ?? point.doc?.data.concept ?? '').trim()
      if (!concept) continue
      const step = String(point.doc?.data.step ?? '').trim()
      const fresh = !seen.has(concept)
      seen.add(concept)
      lines.push(`- ${point.order} ${step ? `[${step}] ` : ''}${fresh ? `**${concept}**` : `${concept}（推进）`} ← ${point.doc?.data.title ?? point.name}`)
    }
    lines.push('')
  }

  const openCount = points.reduce((sum, point) => sum + undecidedCount(point.doc), 0)
  lines.push('## 未定项')
  lines.push(`- 未定项合计 ${openCount} 项${openCount === 0 ? '（已清零）' : '——只增不减就是没在收敛，见 references/writing.md 的偏离形状'}`)
  for (const point of points) {
    const items = bullets(String(point.doc?.sections?.get('未定项') ?? '')).filter((line) => !/^(无|暂无)/.test(line.trim()))
    if (items.length === 0) continue
    lines.push(`- 节点 ${point.order}「${point.doc?.data.title ?? point.name}」（${undecidedCount(point.doc)} 项）`)
    for (const item of items) lines.push(`  - ${item}`)
  }
  lines.push('')

  lines.push('## 推演节点')
  if (points.length === 0) {
    lines.push('- （还没有）')
  } else {
    for (const point of points) {
      const doc = point.doc
      const status = String(doc?.data.status ?? '?')
      const mark = status === 'closed' ? '已结' : status === 'paused' ? '悬置' : '进行中'
      const tags = [String(doc?.data.step ?? '').trim(), String(doc?.data.line ?? '').trim(), `未定 ${undecidedCount(doc)}`].filter(Boolean).join(' · ')
      lines.push(`- [${mark}] ${point.order} ${doc?.data.title ?? point.name}${tags ? `（${tags}）` : ''}`)
      for (const id of ownQuestions(doc, point.order)) lines.push(`  - ${questionLine(doc, id)}`)
      for (const id of ownConclusions(doc, point.order)) lines.push(`  - ${conclusionLine(doc, id)}`)
      for (const item of raiseLines(doc, point.order)) {
        const answer = answeredBy.get(item.id)
        const suffix = answer && !item.text.includes('回答') ? `（由推演节点 ${answer} 回答）` : ''
        lines.push(`  - ${item.text}${suffix}`)
      }
    }
  }
  lines.push('')

  lines.push('## 顶芽')
  if (model) {
    lines.push(`- **${model.data.name ?? '（没有名字）'}**（${model.data.status ?? 'draft'}）：${oneLine(model.sections.get('一句话')) || '（还没有一句话）'}`)
  } else {
    lines.push('- 未成形')
  }
  lines.push('')

  const paused = points.filter((point) => String(point.doc?.data.status) === 'paused')
  if (paused.length > 0) {
    lines.push('## 悬置')
    for (const point of paused) {
      for (const item of raiseLines(point.doc)) lines.push(`- ${item.text}`)
    }
    lines.push('')
  }

  lines.push('## 技术选型')
  lines.push(`- ${buildNames.map(([name, there]) => `${name.replace(/\.md$/, '').replace(/^\d\d-/, '')} ${there ? '有' : '未开始'}`).join(' · ')} · 交接 ${handoff ? '有' : '未开始'}`)
  lines.push('')

  const factIds = facts ? headingIds(facts.sections, HEAD_FACT) : []
  lines.push('## 事实索引')
  lines.push(
    factIds.length === 0
      ? '- （还没有）'
      : factIds.map((id) => `- ${id} ${headingName(facts.sections, id) || oneLine(sectionById(facts.sections, id))}`).join('\n'),
  )
  lines.push('')
  return lines.join('\n')
}

/** 取包含某个编号的那一行，去掉列表符号与强调，过长则截断。 */
function lineWith(text, id, limit = 96) {
  if (!text) return ''
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes(id)) continue
    const clean = line
      .replace(/^\s*[-*]\s*/, '')
      .replace(/\*\*/g, '')
      .trim()
    return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
  }
  return ''
}

/** markdown 表格的数据行（跳过表头分隔行），每行一个单元格数组。 */
function tableRows(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => /^\s*\|/.test(line))
    .map((line) =>
      line
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length >= 2 && !cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === ''))
}

/** `[D-01.1, F-002]` → `['D-01.1', 'F-002']`。 */
function refList(raw) {
  return String(raw ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function oneLine(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)[0] ?? ''
}

export function writeMap(root) {
  const file = join(resolve(root), 'map.md')
  writeFileSync(file, buildMap(root), 'utf8')
  return file
}

// ── 报告与 CLI ──────────────────────────────────────────────────────────────

export function renderReport(report) {
  const lines = []
  lines.push(`讨论根: ${report.root}`)
  if (report.kind === 'legacy') {
    lines.push('形状: 旧形状（apical-bud v1）— 不检查、不拦')
    for (const check of report.checks) lines.push(`  · ${check.detail}`)
    return lines.join('\n')
  }
  const stats = report.stats ?? {}
  if (stats.points !== undefined) {
    lines.push(`推演节点: ${stats.points}（进行中 ${stats.open} · 已结 ${stats.closed} · 悬置 ${stats.paused}） · 结论 ${stats.conclusions} · 问题 ${stats.questions} · 事实 ${stats.facts} · 术语 ${stats.terms}`)
    if (Array.isArray(stats.lineCoverage) && stats.lineCoverage.length > 0) {
      lines.push(`需求线: ${stats.lineCoverage.map((item) => `${item.id}${item.word ? `（${item.word}）` : ''} ${item.points.length > 0 ? `${item.points.length} 点` : '未动'}`).join(' · ')}`)
    }
    lines.push(`顶芽: ${stats.model} · 选型: ${stats.build}`)
  }
  lines.push('')
  if (report.ok) {
    lines.push('组成成分: 齐 ✓')
  } else {
    lines.push(`组成成分: 缺 ${report.blockers.length} 件`)
    for (const blocker of report.blockers) lines.push(`  ✗ ${blocker.id}: ${blocker.detail}`)
  }
  for (const warning of report.warnings) lines.push(`  ! ${warning.id}: ${warning.detail}`)
  if (report.warnings.length === 0 && report.ok) lines.push('警告: 无')
  return lines.join('\n')
}

function main(argv) {
  const args = argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('用法: node scripts/check.mjs --root design/<slug> [--json] [--map] | --cwd . | --trees')
    return 0
  }
  const base = valueOf(args, '--base') ?? 'design'
  if (args.includes('--trees')) {
    const roots = discoverRoots(resolve(valueOf(args, '--cwd') ?? process.cwd()), base)
    if (roots.length === 0) console.log(`没找到讨论根（${join(process.cwd(), base)}/*/）`)
    for (const item of roots) console.log(`${item.kind === 'legacy' ? '[旧形状]' : '[新形状]'} ${item.slug}  ${item.root}`)
    return 0
  }
  const cwd = valueOf(args, '--cwd')
  let root = valueOf(args, '--root')
  if (!root && cwd) {
    const roots = discoverRoots(resolve(cwd), base)
    if (roots.length === 0) {
      console.error(`在 ${join(resolve(cwd), base)} 下没找到讨论根`)
      return 1
    }
    if (roots.length > 1) {
      console.error(`找到多棵讨论树，请用 --root 指定其中一棵：`)
      for (const item of roots) console.error(`  ${item.slug}`)
      return 2
    }
    root = roots[0].root
  }
  if (!root) {
    const roots = discoverRoots(process.cwd(), base)
    if (roots.length === 1) root = roots[0].root
    else {
      console.error('用法: node scripts/check.mjs --root design/<slug>（或 --cwd . / --trees）')
      return 2
    }
  }
  const wantsMap = args.includes('--map') && treeKind(root) === 'new'
  if (wantsMap) writeMap(root)
  const report = check(root)
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(renderReport(report))
    if (wantsMap && report.kind !== 'legacy') console.log(`\nmap.md 已写出: ${join(root, 'map.md')}`)
  }
  return report.ok ? 0 : 1
}

function valueOf(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  process.exitCode = main(process.argv)
}
