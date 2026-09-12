/**
 * apical-gate — the model-facing gate tool for the `apical-bud` preset.
 *
 * WHY a tool instead of "please run the script": the tree's whole value rests on
 * stage transitions being facts rather than claims. This row makes
 * `state.json.stage` writable by exactly one actor — `action=advance` after the
 * stage's exit criteria actually pass — and the write guard beside it refuses
 * direct edits to that field. Everything else stays ordinary markdown the model
 * writes with ordinary file tools, so the tree remains reviewable by a human.
 *
 * The validation logic lives in the skill (`scripts/gate.mjs`) so the portable
 * artifact and this host share one implementation. It is resolved at first use
 * through the skill registry, with a `gateScript` config override; when neither
 * resolves, the tool answers with the fix instead of failing the preset (the
 * banner and the write guard keep working regardless).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_BASE, appendLog, discoverRoot, readState, stamp, writeState } from './lib/apical-state.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'apical-gate'

/** The tool registry must exist before this row can register anything. */
export const inject = ['tools']

const ACTIONS = ['status', 'check', 'advance', 'verdict']

/** Reference document the agent should read on entering each stage. */
const STAGE_REFERENCE = {
  S0: 'references/seed-and-layering.md',
  S1: 'references/seed-and-layering.md',
  S2: 'references/derivation.md',
  S3: 'references/apical.md',
  S4: 'references/apical.md',
  S5: 'references/apical.md',
  S6: 'references/tech-selection.md',
  S7: 'references/tech-selection.md',
}

const VERDICT_LABEL = { continue: '继续', pivot: '转向', stop: '终止' }

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

/** Register the `apical_gate` tool. */
export function apply(ctx, config) {
  const base = typeof config.base === 'string' && config.base.trim() !== '' ? config.base : DEFAULT_BASE
  const skillName = typeof config.skillName === 'string' ? config.skillName : 'apical-bud'
  const configuredScript = typeof config.gateScript === 'string' ? config.gateScript : undefined

  /** Locate and import the skill's gate module once per mount. */
  let gatePromise
  const gateModule = (probe) => {
    if (gatePromise === undefined) {
      gatePromise = (async () => {
        const candidates = []
        if (configuredScript !== undefined) candidates.push(resolve(configuredScript))
        try {
          const list = await probe()
          const skill = list.find((entry) => entry.name === skillName)
          const resourceBase = skill?.resourceBase
          if (resourceBase !== undefined && resourceBase.kind === 'directory') {
            candidates.push(join(resourceBase.path, 'scripts', 'gate.mjs'))
          }
        } catch {
          // Skill registry unavailable — the configured path is still tried.
        }
        for (const candidate of candidates) {
          if (!existsSync(candidate)) continue
          try {
            return { module: await import(pathToFileURL(candidate).href), path: candidate }
          } catch (error) {
            return { error: `门禁脚本加载失败: ${candidate}: ${String((error && error.message) || error)}` }
          }
        }
        return {
          error:
            `找不到门禁脚本。请安装 skill "${skillName}"（例如 git clone <repo> ${'$DSH_HOME'}/skills/${skillName}），`
            + '或在 preset 的 apical-gate 行里配置 gateScript: /绝对路径/scripts/gate.mjs。',
        }
      })().then((result) => {
        // A resolution failure is not cached: installing the skill mid-session
        // should fix the tool without restarting the host.
        if (result.error !== undefined) gatePromise = undefined
        return result
      })
    }
    return gatePromise
  }

  ctx.tools.register({
    name: 'apical_gate',
    description:
      '读取、校验、推进「顶芽」理念推演树的阶段门禁。action=status 只读报告；action=check 校验当前阶段出口条件并记录结果；'
      + 'action=advance 校验通过后把 state.json.stage 推进到下一阶段——这是修改 stage 的唯一合法途径（直接改会被写守卫拒绝）；'
      + 'action=verdict 记录项目裁决（继续/转向/终止，转向即回退到更早阶段重做）。在声称任何阶段"完成"之前必须至少跑一次 check。',
    parameters: toJsonSchema({
      action: { type: 'string', required: true, enum: ACTIONS, description: 'status | check | advance | verdict' },
      root: { type: 'string', description: '讨论根路径（相对会话工作目录或绝对路径）；省略则自动发现 design/ 下唯一的讨论根' },
      status: { type: 'string', enum: ['continue', 'pivot', 'stop'], description: 'action=verdict 时的裁决结论' },
      reason: { type: 'string', description: 'action=verdict 时的理由与证据（必填）' },
    }),
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      try {
        const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
        const action = typeof args.action === 'string' ? args.action.trim() : ''
        if (!ACTIONS.includes(action)) {
          return { text: `未知 action "${action}"：可用 status / check / advance / verdict。` }
        }

        // ── resolve the discussion root ────────────────────────────────────
        let root
        if (typeof args.root === 'string' && args.root.trim() !== '') {
          root = resolve(cwd, args.root.trim())
        } else {
          const found = discoverRoot(cwd, base)
          if (found.kind === 'none') {
            return {
              text:
                `还没有讨论根（${base}/<slug>/state.json）。若讨论尚未开始，按 skill ${skillName} 进入 S0（种子）：`
                + `建 ${base}/<slug>/ 并写入 state.json（topic 与 slug 必填），再把用户原话存进 seed/R-000-original.md。`,
            }
          }
          if (found.kind === 'ambiguous') {
            return { text: `发现多个讨论根，请用 root 参数指定：\n${found.roots.join('\n')}` }
          }
          root = found.root
        }
        const stateRead = readState(root)
        if (!stateRead.ok) {
          return { text: `讨论根的 state.json 不可读或不是合法 JSON: ${root} (${stateRead.error})` }
        }
        const state = stateRead.state

        const loaded = await gateModule(() => ctx.skills.list({ scope: exec?.agent ?? ctx, cwd: exec?.agent?.session?.header?.cwd, signal: exec?.signal }))
        if (loaded.error !== undefined) return { text: loaded.error }
        const gate = loaded.module
        const report = gate.validate(root)
        const header = `讨论根: ${root}\n`

        if (action === 'status') {
          return { text: header + gate.renderReport(report) }
        }

        if (action === 'check') {
          state.gates = { ...(state.gates ?? {}), [report.stage]: { state: report.ok ? 'pass' : 'fail', at: stamp(), missing: report.blockers.map((item) => item.id) } }
          writeState(root, state)
          appendLog(root, `[${stamp()}] ${report.stage} check ${report.ok ? 'PASS' : `FAIL (${report.blockers.length})`}`)
          const tail = report.ok
            ? '\n可以 action=advance 推进；推进前再确认一次本阶段结论已复述给用户。'
            : '\n逐条消掉上面每一项再 check。不要用"基本完成"这类说法代替门禁通过。'
          return { text: header + gate.renderReport(report) + tail }
        }

        if (action === 'advance') {
          if (state.verdict !== undefined && state.verdict.status === 'stop') {
            return { text: `${header}裁决为「终止」，讨论已停止推进阶段。若要重启，先用 action=verdict status=continue 写一条新裁决并说明重启理由。` }
          }
          if (!report.ok) {
            state.gates = { ...(state.gates ?? {}), [report.stage]: { state: 'fail', at: stamp(), missing: report.blockers.map((item) => item.id) } }
            writeState(root, state)
            appendLog(root, `[${stamp()}] ${report.stage} advance REFUSED (${report.blockers.length})`)
            return {
              text:
                `${header}拒绝推进 ${report.stage}：出口条件未满足。\n`
                + report.blockers.map((item) => `  ✗ ${item.id}: ${item.detail}`).join('\n')
                + '\n补齐后重新 check；门禁不通过就宣称完成，是最贵的返工来源。',
            }
          }
          const next = report.nextStage
          if (next === undefined) {
            return { text: `${header}已经是终态 ${report.stage}（${report.stageTitle}）。讨论结束后产出交接说明：哪些决策先落地、哪些假设最早验证、哪些接口留后路。` }
          }
          state.stage = next
          state.gates = { ...(state.gates ?? {}), [report.stage]: { state: 'pass', at: stamp(), missing: [] } }
          writeState(root, state)
          appendLog(root, `[${stamp()}] ${report.stage} → ${next} advance PASS`)
          return {
            text:
              `${header}已推进: ${report.stage} → ${next} ${gate.STAGE_TITLES[next]}\n`
              + `进入 ${next} 需要: ${(gate.STAGE_ARTIFACTS[next] ?? []).join('；')}\n`
              + `先读: ${STAGE_REFERENCE[next] ?? 'references/protocol.md'}（skill ${skillName} 的资源）\n`
              + '下一步: 按协议提下一个问题（一次一问），本轮只长一节。',
          }
        }

        // ── verdict ────────────────────────────────────────────────────────
        const verdictStatus = typeof args.status === 'string' ? args.status.trim() : ''
        if (!Object.keys(VERDICT_LABEL).includes(verdictStatus)) {
          return { text: 'action=verdict 需要 status: continue（继续）| pivot（转向）| stop（终止）。' }
        }
        const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
        if (reason === '') {
          return { text: 'action=verdict 必须给出 reason：理由 + 证据（引用 L-/N-/D-/X- 编号）。没有证据的裁决不算裁决。' }
        }
        const file = join(root, 'audit/verdict.md')
        mkdirSync(dirname(file), { recursive: true })
        let text = ''
        try {
          text = readFileSync(file, 'utf8')
        } catch {
          text = '# 项目裁决\n'
        }
        const numbers = [...text.matchAll(/^##\s+V-(\d{3})/gm)].map((match) => Number(match[1]))
        const nextNumber = String((numbers.length === 0 ? 0 : Math.max(...numbers)) + 1).padStart(3, '0')
        const entry = [
          '',
          `## V-${nextNumber} ${VERDICT_LABEL[verdictStatus]}`,
          '',
          `- 阶段: ${report.stage}`,
          `- 结论: ${VERDICT_LABEL[verdictStatus]}`,
          `- 理由: ${reason}`,
          `- 记录时间: ${stamp()}`,
          '',
        ].join('\n')
        writeFileSync(file, text.replace(/\s*$/, '\n') + entry, 'utf8')
        state.verdict = { status: verdictStatus, at: stamp(), note: reason.slice(0, 300) }
        writeState(root, state)
        appendLog(root, `[${stamp()}] verdict V-${nextNumber} ${verdictStatus}`)
        const follow = verdictStatus === 'stop'
          ? '\n裁决已记录：不再推进阶段。把结论与重启条件明确告诉用户，并停止在本会话继续讨论。'
          : verdictStatus === 'pivot'
            ? '\n裁决已记录：转向意味着种子、分层或推演发生结构性改变——回到相应阶段（通常 S0/S1/S2），把旧版本挪进"被否的表述"或 `status: dropped` 节点，并在轮次纪要里写清改了什么。'
            : '\n裁决已记录：继续。'
        return { text: `${header}已记录 audit/verdict.md V-${nextNumber}：${VERDICT_LABEL[verdictStatus]}${follow}` }
      } catch (error) {
        return { text: `apical_gate 执行失败: ${String((error && error.message) || error)}` }
      }
    },
  })
}
