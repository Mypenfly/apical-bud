# apical-bud

English | [中文](README.md)

**A concept-deduction methodology for the phase before implementation.** Start from one possibly vague need (the *seed*), split it into layers (*roots*), derive node by node (*trunk*), converge on **exactly one concept** (the *apical bud*), state what guarantees it as mechanism propositions plus extensions (*limbs*) — and only then select the technology (*fruit*) from locked criteria.

```
seed ──► roots ──► trunk ──► apical bud ──► limbs ──────► fruit
need     layers     derivation  the concept   mechanisms    technology
                                              + extensions
```

**The character lives in the bud, the guarantees in the limbs.** The bud answers "what does this feel like" (explicable, generative, *not* falsifiable); the `M-` mechanism propositions answer "what guarantees it" (falsifiable, with counterexamples), and they are the constraints technology selection must obey — a criterion whose source is not an `M-` turns selection into an inventory of whatever happens to be installed.

Research is **fertilizer**: it supplies premises and counterexamples, never conclusions. Questions are the **vitality**: the tree grows one node per round of Q&A. Everything is file-driven — a decision that was not written down was not made.

It ships as a skill (`SKILL.md` + `references/` + `templates/` + `scripts/`), and as a DSH agent preset (`dsh-preset/`) that turns the method into machinery. Six claims that are unusual for a "thinking partner":

1. **The conversation is the medium; files are the ledger.** Proposals, options and derivation chains are stated in chat — you never have to open a file to answer, and files record only what has already happened. A discussion degrades into "it writes, I read, I nitpick" exactly when this is violated (the DSH preset enforces it with a write guard).
2. **Derivation, not brainstorming.** Every concept node records which parent it came from, and its ancestry must reach the seed. The gate rejects orphan nodes: an idea can be discussed, but it cannot impersonate a derivation.
3. **Layering is itself an interpretation.** There is always more than one way to decompose a need; writing down only one silently replaces your need with my wording. So every layer keeps the competing reading it beat, and needs your confirmation.
4. **One bud, several mechanisms, and pruned branches stay.** The concept is unique; mechanism propositions may compete and may come back. A drop is a *conditional* judgment (reason + **revival condition**), and everything discarded is re-judged in full before the tree is allowed to converge (entering S3/S5/S6/S7) — the condition may have changed.
5. **You run the experiments; I decide whether one is needed.** When a derivation depends on how some program actually behaves: read the source first (no file and line means you did not read it), and only then hand a real-machine test to you — with a hand-off document, **a prompt you can paste as-is**, and pass/fail criteria. Never ask for a reboot when reading the source would answer it.
6. **Terminology must not become a wall.** At most one new term per round, at most one awaiting your confirmation, and a term may not be defined using a term that is not yet defined above it. **You may rewrite any question or term, and retract any decision without giving a reason** — the old entry is marked superseded, never deleted.

## Install

**DSH (DeepSeek Harness)** — skill plus the preset that makes the rules mechanical:

```bash
git clone git@github.com:Mypenfly/apical-bud.git ~/.dsh/skills/apical-bud
~/.dsh/skills/apical-bud/dsh-preset/install.sh
```

The preset adds a write guard (the session cannot quietly start editing production code), the `apical_gate` tool (the only legal writer of `state.json.stage`), and a per-turn state banner (stage, tree size, pending terms, last gate result). See [`dsh-preset/README.md`](dsh-preset/README.md).

**Claude Code / any host that reads SKILL.md** — the skill alone is enough:

```bash
git clone git@github.com:Mypenfly/apical-bud.git ~/.claude/skills/apical-bud
```

The gate script is zero-dependency Node ESM and runs anywhere:

```bash
node scripts/gate.mjs --root design/<slug>
```

## Usage

Say "let's talk through this idea", "help me pin down what I actually need", "how should this concept be designed", "is this direction worth doing" — or invoke `/apical-bud` directly. The discussion creates `design/<slug>/` at the top of your repository:

```
seed/          seed: verbatim statement + one-sentence real need + rejected phrasings + non-goals
layers/        roots: layers of the need (L-00N)
derivation/    trunk: derivation nodes (N-00N); pruned branches are kept
concept/       apical bud concept.md ★ + limbs extensions.md ★
tech/          fruit: criteria.md (locked first) → options.md → selection.md ★
questions/     open questions (Q-00N)     decisions/  decision records (D-00N)
glossary.md    terms ([确认] confirmed / [提案] proposed)
audit/         objections, verdicts, gate log
```

**A project may hold several trees.** Different needs, different phases — and trees may declare how they relate (`dependsOn` / `relation` in `state.json`, cross-cited in prose as `<slug>#L-003`). One session binds to one tree:

```bash
apical_gate action=trees                 # list every tree and its lifecycle state
apical_gate action=bind slug=<slug>      # bind this session to one of them
```

Once a tree reaches S7 (or is terminated by a verdict), do not grow a new need on it — start a new tree and record what it inherits and overrides in the seed's relation section.

The full contract for directories, IDs, frontmatter and gate rules is in [`references/doc-conventions.md`](references/doc-conventions.md).

## The gate

```bash
node scripts/gate.mjs --root design/<slug>            # human-readable report
node scripts/gate.mjs --root design/<slug> --json      # machine-readable
node scripts/gate.mjs --cwd .                          # discover the single design/<slug>
node scripts/gate.mjs --root design/<slug> --stage S5  # check from another stage's viewpoint
```

Exit code 0 = pass, 1 = something is missing. It is also a module — a host plugin can `import { validate } from './scripts/gate.mjs'`.

What it checks is **structure and traceability**: no orphan nodes, every layer confirmed with a decomposition argument, the apical concept in one sentence of ≤100 characters, its key nouns all confirmed terms, the derivation chain intact hop by hop, criteria locked before options, selected options attached to surviving nodes. It **cannot** tell whether the concept is *good* — that is the red team's job and yours.

## Repository layout

```
SKILL.md                       the method itself (always-on)
README.md / README.en.md       中文 / English
references/protocol.md         round loop, question discipline, user rewrites, anti-patterns
references/seed-and-layering.md S0–S1 seed alignment and need layering
references/derivation.md       S2 derivation rules, how research may be used, when to retreat
references/apical.md           S3–S5 convergence, extensions, finalisation, red-team review
references/tech-selection.md   S6–S7 criteria, evidence levels, exit cost
references/doc-conventions.md  document contract enforced by the gate
templates/                     17 ready-to-copy document templates
scripts/gate.mjs               zero-dependency gate validator (module + CLI)
dsh-preset/                    DSH session assembly: persona, write guard, gate tool, banner, installer, self-test
```

## Credit and licence

The questioning discipline (one question at a time, concrete options, never ask what a file can answer) is adapted from [grill-me](https://github.com/RobMitt/grill-me-skill); four things were added on top: **traceable derivation, layered confirmation, stage gates, and the right to challenge or veto**.

**Licence: all rights reserved.** No open-source licence is attached, so GitHub reports `No license`: the repository is readable, but no permission is granted to use, copy, modify or redistribute it. If you want others to reuse it, add a licence (MIT, Apache-2.0, …).
