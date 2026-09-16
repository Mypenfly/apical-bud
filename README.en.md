# apical-bud

English | [中文](README.md)

**A record convention for deriving one need into an abstract concept model.** It specifies exactly two things: **how the files are organised, and how the words are used.** It does not specify what must be produced each turn — there are no stages, no gates, no round minutes. The files are the record of the derivation and its arguments, not a progress report.

```
seed.md ─► facts.md ─► derivation/ ─► model.md ─► build/ ─► handoff.md
 seed         facts       derivation     apical      technology   handoff
 (the need,              points         concept      selection
  the core             (question ⇄     model
  question)             conclusion)
                              └──────── map.md (progress + concept map, tool-generated) ────────┘
```

## What it is for

A discussion tends to collapse into one of two things: **handing over a ready-made solution**, or **filling in a process**. The first skips the derivation; the second produces documents instead of thought. This version blocks both:

- **Derivation is a loop**: need → **split its words** → **argue each item** (research happens here) → coin one abstract idea → use it to explain the need and every item → derive the next conclusion → raise the next question → back to splitting. The product of a step is a **concept**, not a number and not a list.
- **Split the need's own words**: nouns ask "what is it made of, how is it counted", adjectives ask "what are its features, how is it judged". Each item becomes a requirement line `R-01…` that must be argued and must own derivation points.
- **Every step follows from what is already written**, and the first thing written is the user's need. `answers:` (which question it answers), `from:` (which conclusions it takes as premises — `D-` only) and `line:` (which requirement line it serves) are three different relations.
- **Progress lives in the files and in the IDs**: one derivation point per file, numbered in order; IDs inside carry the coordinate (`Q-03.1`, `D-03.1`), and the tool-generated `map.md` carries a **requirement-line coverage table** (how far each line has come, which line has no points) plus a **concept chain**, so a brand-new session picks up by reading one file.
- **Wording is part of the convention**: write "because / therefore / if / conversely / the cost is"; do not write "stage / gate / exit criteria / commit to disk / round / complete".
- **A question lays out a tension, not a menu**: "these two cannot both hold — which do you give up, and why", plus "which one I am betting on, and where I might be wrong".

## How one derivation goes

| File | What it holds |
|---|---|
| `seed.md` | The user's own words (append-only), the one-sentence need, the **requirement lines (word split)**, the **core question**, non-goals, what counts as done, rejected phrasings |
| `facts.md` | `## F-001` facts with source + grade (E1 docs/source, E2 measured, E3 second-hand) + what they are used for; a closing "what I did not check" |
| `derivation/NN-<word>.md` | One derivation point: question / known / inference / conclusion / conversely / questions raised / user |
| `model.md` | The abstract concept model: name, one sentence, what it is made of, seams and boundaries, what is settled vs still open, what must be decided before building |
| `build/01-criteria.md`, `02-options.md`, `03-selection.md` | Criteria first, options after; rejects carry a rejection reason and a revival condition |
| `handoff.md` | Self-contained handoff: acceptance, first task, a prompt you can copy into a standard session |
| `map.md` | Progress, requirement-line coverage, concept chain — **tool-generated, never hand-written** |
| `glossary.md` | Terms: `- **term**: one plain-language definition` |

A single derivation point looks like this (abridged; the full guidance is in [`references/writing.md`](references/writing.md)):

```markdown
---
point: 02
title: reduce the bad, or add the good
status: open
step: coin-concept   # where in the loop: split / argue / coin-concept / explain-back / grow / raise
line: R-02           # which requirement line it serves
concept: good / bad tokens
answers: [Q-01.2]    # which question raised by an earlier step it answers
from: [D-01.1]       # which conclusions it takes as premises (D- only)
---
## Question   Q-02.1 Should density come from removing bad fragments or from adding good ones?
## Known      [F-002] The bad fragments one can spot at a glance are only the shallow few; the rest neither a human nor a model can pick out.
## Inference  Removing them requires recognising them, which is the harder problem; adding good ones only requires a factual judgement at the moment things go wrong.
## Conclusion D-02.1 Do only the "add good" side. Give up "clean the context".
## Conversely If the injection always lands after the error has set, this does not hold.
## Raised     Q-02.2 Who decides "about to set"? (status: open)
```

**When you already have a conclusion**: register it as a *conclusion to be derived*, then derive forward from the need. If it follows, it is argued; if it does not, it becomes an assumption or a competing concept, and the step where it breaks is named. It is never used as a premise directly.

## The check (deliberately light)

It checks **composition only**: are the four seed sections there (**including the requirement lines** — the need's own words split into `R-01…`), are `facts.md` and `glossary.md` there, is there at least one derivation point, do the points have a question and a conclusion, and are `model.md` / `build/` formed if they exist. **Everything else is a warning**:

- did the derivation drift: a requirement line with no points, four points in a row on the same line, five points in a row with no new concept;
- is an anchor wrong: a fact sitting in `from:`, a point missing `line:` / `step:` / `concept:`, an ID that points nowhere, a second point unrelated to the first;
- did selection jump the order: a criterion with no source, options written before criteria, a parked question with no unlocking fact…

It never judges a stage, never advances anything, never blocks a discussion.

```bash
node scripts/check.mjs --root design/<slug>        # human-readable
node scripts/check.mjs --root design/<slug> --json # machine-readable
node scripts/check.mjs --root design/<slug> --map  # also write map.md
node scripts/check.mjs --cwd .                     # discover the discussion root
node scripts/check.mjs --trees                     # list every root in the project
```

Exit code 0 = complete (warnings may exist), 1 = something is missing. It is also a module: `import { check, renderReport, buildMap, discoverRoots } from './scripts/check.mjs'`.

## Install

**DSH (DeepSeek Harness)**:

```bash
git clone git@github.com:Mypenfly/apical-bud.git ~/.dsh/skills/apical-bud

# optional: the session assembly layer (standing persona, apical_check tool, write guard, banner)
~/.dsh/skills/apical-bud/dsh-preset/install.sh
```

`dsh-preset/` turns two rules into mechanism: `write`/`edit` may only touch the discussion root (`design/`), so a discussion never edits the implementation; and the "user's own words" section of `seed.md` is append-only. Details in [`dsh-preset/README.md`](dsh-preset/README.md).

After changing the skill or the preset, re-run `install.sh` and **start a new session**: the persona and `SKILL.md` are injected when a session begins.

**Claude Code / any host that reads SKILL.md**:

```bash
git clone git@github.com:Mypenfly/apical-bud.git ~/.claude/skills/apical-bud
```

## Layout

```
SKILL.md                       the method (always loaded): files, derivation points, the model, wording, questions, the check
references/writing.md          how to write: one full example, four shapes to avoid, wording table
templates/                     9 templates (seed / facts / point / model / criteria / options / selection / handoff / glossary)
scripts/check.mjs              zero-dependency check: composition + warnings + map.md (module and CLI)
dsh-preset/                    DSH session assembly: persona, apical_check tool, write guard, banner, install.sh, selftest
README.md / README.en.md       Chinese / English
```

## Relationship to v1

v1 was a stage machine: S0–S7, exit criteria per stage, candidate/conclusion tiers, round minutes, full re-judgement passes, a state file. A real test exposed what that cost: **mechanical clause growth** (the same decision written twice), **premature convergence** (four parallel single points each derived once counted as done, and the trunk was never questioned), **the gate steering the derivation** (chains assembled to pass the check), **bureaucratic wording**, and **the feeling of a finished stage outweighing the question itself**.

This version removes those mechanisms and keeps only the layer that specifies file organisation and wording, handing progress back to the files and the IDs. Old-shape roots (`state.json` / `layers/` / `concept/`) are **left untouched, readable, not migrated**; to continue in the new shape, start a new root in the same project and write one line in its `seed.md`: "relationship to existing trees" — what it inherits, what it overturns.

## Credits and licence

The questioning discipline (one question at a time; never ask the user what a file can answer) follows [grill-me](https://github.com/RobMitt/grill-me-skill). This version **drops** its most harmful rule — "always state which option I lean towards": in practice the user took the facilitator's preferred option nine times out of nine, and the discussion became the facilitator supplying a ready-made solution for the user to stamp. The shape now is to lay out the tension and ask for the user's reason.

**Licence: [MIT](LICENSE).** Use it, change it, republish it — keep the copyright notice.
