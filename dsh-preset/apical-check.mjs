/**
 * apical-check — the `apical_check` tool for the `apical-bud` preset.
 *
 * WHY a tool instead of "please run the script": the skill's validation must be
 * one implementation, reachable from the session, and light enough to run after
 * every edit. The method itself is now just file organization and wording, so
 * this row is correspondingly thin — it runs the check and hands back what to
 * fix, generates `map.md`, and lists the project's discussion roots. It does NOT
 * judge stages, does not advance anything, and does not block discussion: the
 * only hard question is "are the component files there?", everything else is a
 * warning the model is free to weigh.
 *
 * The validation logic lives in the skill (`scripts/check.mjs`) so the portable
 * artifact and this host share one implementation. It is resolved at first use
 * through the skill registry, with a `checkScript` config override; when none of
 * the routes resolves, the tool answers with the list of paths it tried instead
 * of failing the preset (the banner and the write guard keep working regardless).
 *
 * Reads of the tree for the banner live in `lib/apical-tree.mjs`; this file does
 * not duplicate them.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_BASE, discoverRoot, lastCheck, recordCheck, stamp, treePulse } from './lib/apical-tree.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'apical-check'

/** The tool registry must exist before this row can register anything. */
export const inject = ['tools']

const ACTIONS = ['check', 'map', 'trees']

/** Minimal JSON schema compiler for tool parameters (zero dependencies). */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec)) {
    const prop = { type: meta.type }
    if (meta.description !== undefined) prop.description = meta.description
    if (meta.enum !== undefined) prop.enum = meta.enum
    properties[key] = prop
    if (meta.required === true) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/** One-line message from an unknown thrown value. */
function messageOf(error) {
  return String((error && error.message) || error)
}

/** Register the `apical_check` tool. */
export function apply(ctx, config) {
  const base = typeof config.base === 'string' && config.base.trim() !== '' ? config.base : DEFAULT_BASE
  const skillName = typeof config.skillName === 'string' ? config.skillName : 'apical-bud'
  const configuredScript = typeof config.checkScript === 'string' ? config.checkScript : undefined

  /** This plugin's own directory, i.e. the preset directory. */
  const presetDir = dirname(fileURLToPath(import.meta.url))

  /**
   * Ask the skill registry where the skill lives.
   *
   * `ctx.get(name)` is the sanctioned OPTIONAL lookup: cordis throws
   * `cannot get property "<name>" without inject` when an uninjected service is
   * read through the property proxy. Both routes are tried because either may
   * exist; the throw must not be allowed to empty the candidate list.
   * @returns `{ candidates, note }` — candidate paths plus what the registry said.
   */
  const probeRegistry = async (exec) => {
    let registry
    try {
      registry = typeof ctx.get === 'function' ? ctx.get('skills') : undefined
    } catch (error) {
      registry = undefined
      void error
    }
    if (registry === undefined) {
      try {
        registry = ctx.skills
      } catch (error) {
        return { candidates: [], note: `技能注册表不可读：${messageOf(error)}` }
      }
    }
    if (registry === undefined) return { candidates: [], note: "技能注册表不可用（ctx.get('skills') 返回 undefined）" }
    try {
      const list = await registry.list({
        scope: exec?.agent ?? ctx,
        cwd: exec?.agent?.session?.header?.cwd,
        signal: exec?.signal,
      })
      const skill = Array.isArray(list) ? list.find((entry) => entry.name === skillName) : undefined
      if (skill === undefined) {
        const names = Array.isArray(list) ? list.map((entry) => entry.name).join(', ') : '(非数组)'
        return { candidates: [], note: `注册表返回 ${Array.isArray(list) ? list.length : '?'} 个技能，其中没有「${skillName}」：${names}` }
      }
      const resourceBase = skill.resourceBase
      if (resourceBase === undefined || resourceBase.kind !== 'directory') {
        return { candidates: [], note: `「${skillName}」没有目录型 resourceBase：${JSON.stringify(resourceBase)}` }
      }
      return { candidates: [join(resourceBase.path, 'scripts', 'check.mjs')], note: `命中注册表：${resourceBase.path}` }
    } catch (error) {
      return { candidates: [], note: `技能注册表查询失败：${messageOf(error)}` }
    }
  }

  /**
   * Resolve and import the skill's check module. Every candidate is tried in
   * order — explicit config, environment (new name, then the old gate-era name),
   * skill registry, then the filesystem layouts a skill and this preset actually
   * take on disk — so the tool cannot be defeated by one broken seam. Only a
   * success is cached; a failure is retried on the next call, so installing the
   * skill mid-session fixes it without restarting the host.
   */
  let checkCache
  const loadCheck = async (exec) => {
    if (checkCache !== undefined) return checkCache
    const tried = []
    const add = (value, why) => {
      if (typeof value !== 'string' || value.trim() === '') return
      const path = resolve(value)
      if (!tried.some((entry) => entry.path === path)) tried.push({ path, why })
    }
    add(configuredScript, 'preset 配置 checkScript')
    add(process.env.APICAL_CHECK_SCRIPT, '环境变量 APICAL_CHECK_SCRIPT')
    add(process.env.APICAL_GATE_SCRIPT, '环境变量 APICAL_GATE_SCRIPT（旧名，仅作回退）')
    const probe = await probeRegistry(exec)
    for (const candidate of probe.candidates) add(candidate, '技能注册表 resourceBase')

    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
    add(join(dshHome, 'skills', skillName, 'scripts', 'check.mjs'), '$DSH_HOME/skills')
    add(join(agentsHome, 'skills', skillName, 'scripts', 'check.mjs'), '$DSH_AGENTS_HOME/skills')
    add(join(presetDir, '..', 'scripts', 'check.mjs'), '仓库布局（dsh-preset/ 的上级就是 skill 根）')
    add(join(presetDir, '..', '..', 'skills', skillName, 'scripts', 'check.mjs'), '已安装布局（$DSH_HOME/.agent-presets/<id>/）')
    const cwd = exec?.agent?.session?.header?.cwd
    if (typeof cwd === 'string' && cwd !== '') {
      add(join(cwd, '.dsh', 'skills', skillName, 'scripts', 'check.mjs'), '项目根 .dsh/skills')
      add(join(cwd, '.agents', 'skills', skillName, 'scripts', 'check.mjs'), '项目根 .agents/skills')
    }

    const missing = []
    for (const candidate of tried) {
      if (!existsSync(candidate.path)) {
        missing.push(candidate)
        continue
      }
      try {
        const module = await import(pathToFileURL(candidate.path).href)
        checkCache = { module, path: candidate.path }
        return checkCache
      } catch (error) {
        return {
          error: `体检脚本存在但加载失败：${candidate.path}（来源：${candidate.why}）\n${messageOf(error)}`,
        }
      }
    }

    // Never report "not found" without the evidence: these lines are what turns
    // a wrong root-cause theory into a two-minute fix.
    return {
      error: [
        `找不到体检脚本（skill「${skillName}」的 scripts/check.mjs）。已尝试的路径都不存在：`,
        ...missing.map((entry) => `  ✗ ${entry.path}   ← ${entry.why}`),
        `技能注册表：${probe.note}`,
        '修法任选其一：① git clone <repo> 到 '
        + `${join(dshHome, 'skills', skillName)}；② 在本 preset 的 apical-check 行里配置 `
        + 'checkScript: <仓库>/scripts/check.mjs；③ 设环境变量 APICAL_CHECK_SCRIPT 指向该文件。',
      ].join('\n'),
    }
  }

  /** Resolve which discussion root an action means, or the text explaining why not. */
  const resolveRoot = (args, exec) => {
    const sessionCwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
    const projectCwd = typeof args.cwd === 'string' && args.cwd.trim() !== ''
      ? resolve(sessionCwd, args.cwd.trim())
      : sessionCwd
    if (typeof args.root === 'string' && args.root.trim() !== '') {
      return { root: resolve(sessionCwd, args.root.trim()), projectCwd, sessionCwd }
    }
    if (typeof args.slug === 'string' && args.slug.trim() !== '') {
      return { root: join(projectCwd, base, args.slug.trim()), projectCwd, sessionCwd }
    }
    const found = discoverRoot(projectCwd, base)
    if (found.kind === 'one') return { root: found.root, projectCwd, sessionCwd }
    if (found.kind === 'ambiguous') {
      return {
        text: `项目里有 ${found.roots.length} 个讨论根，本模式不替你挑：\n`
          + found.roots.map((root) => `  - ${root}`).join('\n')
          + `\n用 root=${base}/<slug> 指定要体检的那一个，或 action=trees 先看全部。`,
      }
    }
    return {
      text:
        `在 ${join(projectCwd, base)} 下还没有讨论根。若推演尚未开始：照 skill ${skillName} 的 `
        + `templates/seed.md 建 ${base}/<slug>/seed.md（先写「## 用户原话」与「## 核心问题」），`
        + `再跑 action=check；讨论过程中的文件会陆续补齐（facts.md / glossary.md / derivation/）。`,
    }
  }

  ctx.tools.register({
    name: 'apical_check',
    description:
      '体检「顶芽」讨论根，只查"组成成分齐不齐"：action=check 跑体检并把缺件（硬拦）与警告念给你（默认）；'
      + 'action=map 生成并回显 map.md（进度与概念图，机器生成，不要手写）；'
      + 'action=trees 列出项目里的全部讨论根（新形状与旧形状）。'
      + '它只报告文件齐不齐与警告，不推进任何流程、也不拦讨论；旧形状（state.json / layers/ / concept/）只提示、不检查。'
      + '有改动之后跑一次 check；map.md 过时就跑一次 map。',
    parameters: toJsonSchema({
      action: { type: 'string', enum: ACTIONS, description: 'check（默认，可省略）| map | trees' },
      root: { type: 'string', description: '讨论根路径（相对会话工作目录或绝对路径）；省略则用项目里唯一的那一个' },
      slug: { type: 'string', description: `讨论根目录名，等价 ${base}/<slug>；与 root 二选一` },
      cwd: { type: 'string', description: '项目目录（默认会话工作目录），用于发现讨论根与 action=trees' },
    }),
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      try {
        const action = typeof args.action === 'string' && args.action.trim() !== '' ? args.action.trim() : 'check'
        if (!ACTIONS.includes(action)) {
          return { text: `未知 action "${String(args.action)}"：可用 check / map / trees（省略即 check）。` }
        }
        const loaded = await loadCheck(exec)
        if (loaded.error !== undefined) return { text: loaded.error }
        const module = loaded.module

        // ── trees: every discussion root in the project ─────────────────────
        if (action === 'trees') {
          const sessionCwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
          const projectCwd = typeof args.cwd === 'string' && args.cwd.trim() !== ''
            ? resolve(sessionCwd, args.cwd.trim())
            : sessionCwd
          const roots = module.discoverRoots(projectCwd, base)
          if (roots.length === 0) {
            return {
              text: `项目里还没有讨论根（${join(projectCwd, base)}/*/）。`
                + `要开始：照 skill ${skillName} 的 templates/seed.md 建 ${base}/<slug>/seed.md。`,
            }
          }
          const lines = roots.map((item) => {
            if (item.kind === 'legacy') return `- [旧形状] ${base}/${item.slug}/ · 不检查、不拦（原样保留，不迁移）`
            const pulse = treePulse(item.root)
            const check = lastCheck(item.root)
            const checkText = check === undefined
              ? '上次体检: 未运行'
              : check.ok
                ? `上次体检: 齐（${check.warnings.length} 警告）`
                : `上次体检: 缺 ${check.blockers.length} 件（${check.blockers.slice(0, 3).join('、')}）`
            return `- [新形状] ${base}/${item.slug}/ · 推演节点 ${pulse.points.total}`
              + `（进行中 ${pulse.points.open}/已结 ${pulse.points.closed}/悬置 ${pulse.points.paused}）`
              + ` · 事实 ${pulse.facts} · 顶芽 ${pulse.model} · 选型 ${pulse.build} · ${checkText}`
          })
          const hints = []
          if (roots.length > 1) hints.push('讨论时用 root 或 slug 指定要动的那一个（本模式没有会话绑定）。')
          if (roots.some((item) => item.kind === 'legacy')) {
            hints.push('旧形状的树要按新形状继续，就在同一项目里新开一个讨论根，并在新 seed.md 里写一句「与已有树的关系」。')
          }
          return { text: [`项目里共 ${roots.length} 个讨论根（${join(projectCwd, base)}）：`, ...lines, ...hints].join('\n') }
        }

        // ── check / map: one specific root ─────────────────────────────────
        const picked = resolveRoot(args, exec)
        if (picked.text !== undefined) return { text: picked.text }
        const { root } = picked

        if (action === 'map') {
          const kind = module.treeKind(root)
          if (kind === 'legacy') {
            return {
              text: `${root} 是旧形状（apical-bud v1）的讨论根：map.md 只对新形状生成，这里不写、也不拦。`
                + '要按新形状继续，就在同一项目里新开一个讨论根。',
            }
          }
          if (kind === 'empty') {
            return {
              text: `${root} 下还没有 seed.md：map.md 是"推演到哪了"的读出结果，先有种子（照 templates/seed.md）才有得读。`,
            }
          }
          const file = module.writeMap(root)
          return { text: `map.md 已写出: ${file}\n（内容由本次调用从文件重新读出，不要手改。）\n\n${readFileSync(file, 'utf8')}` }
        }

        // ── check ─────────────────────────────────────────────────────────
        const report = module.check(root)
        recordCheck(root, {
          ok: report.ok,
          blockers: report.blockers.map((item) => item.id),
          warnings: report.warnings.map((item) => item.id),
          at: stamp(),
        })
        let text = module.renderReport(report)
        if (report.kind === 'legacy') {
          text += '\n（旧形状：不检查、不拦；要按新形状继续，就在同一项目里新开一个讨论根，并在新 seed.md 里写一句「与已有树的关系」。）'
        } else if (report.ok) {
          text += `\n组成成分齐 ✓。改动过就再跑一次 action=check，并跑一次 action=map 刷新 map.md；`
            + `${report.warnings.length} 条警告不拦人，值不值得处理由你判断。`
        } else {
          text += `\n缺 ${report.blockers.length} 件：补齐后再跑一次 action=check。`
            + `其余 ${report.warnings.length} 条只是警告——它们是提醒，不是拦路的条件。`
        }
        return { text }
      } catch (error) {
        return { text: `apical_check 执行失败: ${messageOf(error)}` }
      }
    },
  })
}
