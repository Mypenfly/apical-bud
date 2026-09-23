# apical-bud

English | [中文](README.md)

**A record convention for deriving one need into an abstract concept model.** It specifies exactly two things: **how the files are organised, and how the words are used.** It does not specify what must be produced each turn — there are no stages, no gates, no round minutes. The files are the record of the derivation and its arguments, not a progress report.

It adds two invariants that decide whether the tree is actually working: **there is exactly one core**, and **open items must be resolved and must stop growing**.

```
seed.md ──► facts.md ──► derivation/ ──► model.md ──► build/ ──► handoff.md
 the seed     facts &      derivation     apical      technology   the fruit
 (one core,   research     nodes          concept     selection
  conditions,              (name →       model       criteria /   handoff +
  what you                 parts →       (coherent   options /    runnable
  gave up,                 why → how →   & buildable) experiment / probe files
  core question)           new concept)               selection    & data
                               └── map.md (progress, next step, requirement-line coverage, concept chain, open items; tool-generated) ──┘
```

## What it is for

A discussion tends to collapse into one of two things: **handing over a ready-made solution**, or **filling in a process**. The first skips the derivation; the second produces documents instead of thought. This version blocks both, and pulls the **waste** forward so it is priced during the derivation instead of after the build:

- **Leave the user with exactly one core.** What a user asks for in one breath is never one thing. "Low cost, high performance" is not two goals you can buy in full at the same time. Lay every item out, pick **exactly one** core, and demote the rest to **conditions** (a floor that must not break while the core is met — past 3, say plainly that it is too much) or **non-goals** — and write down **what you gave up**: which item, what it costs, where I might be wrong.
- **Derivation is a node tree.** A node walks the loop once: **name → parts → why → how it lands on a mechanism → new concept / new question**. Nodes are unbounded, and the five questions are one way to unfold a node, not a format; what matters is not skipping any of them — the one most often skipped is *how it lands on a mechanism*.
- **Convergence has a hard test**: did this new node raise a new conceptual question? Every node declares `undecided:` and an `## 未定项` list. **Open items that only grow mean the tree is not converging** — that is spreading out, not deriving.
- **Experiments may overturn the concept.** At the selection stage, experiments are allowed and encouraged — they can overturn `model.md`, or establish that *the need itself is infeasible*. **This layer only produces the experiment files**; the user runs them in a standard-mode session and brings the results back. An experiment with no kill criterion is a demo, not an experiment.
- **The fruit is two things**: `handoff.md` (self-contained, carrying a **verification status**: confirmed / overturned / unverified) **plus** the runnable probe files and data under `probe/`.
- **Progress lives in the files and in the IDs**: one derivation node per file, numbered in order; IDs inside carry the coordinate (`Q-03.1`, `D-03.1`), and the tool-generated `map.md` carries a **requirement-line coverage table** (how far each line has come, which line has no nodes), a **concept chain**, the **open items** and a one-line **next step**, so a brand-new session picks up by reading one file.
- **Records do not go stale**: a conclusion, once accepted, is written back to the files **in the same turn** — the user's words into `seed.md` (append-only), the conclusion into the node, an undecided item changed in **both** the frontmatter `undecided:` and the `## 未定项` section, a new term into `glossary.md`, and finally `map.md` refreshed. **After a new session or a context compaction**, read `map.md` → the last derivation node → `model.md`, then **recite three sentences — where we stopped, what the last round settled, what the next step is** — and wait for the user to correct it before deriving on. **Records falling behind the conversation is the fastest way this tree loses progress.**
- **Wording is part of the convention**: write "because / therefore / if / conversely / the cost is"; never write "stage / gate / exit criteria / commit to disk / round / complete".
- **A question lays out a tension, not a menu**: "these two cannot both hold — which do you give up, and why", plus "which one I am betting on, and where I might be wrong".
- **The default reader is not a technical person in this field** (`seed.md`'s `reader:` can override): technical words may appear, but the first occurrence must be grounded on the spot — what it is, what example lets you recognise it, what it means elsewhere versus what it means here. **Every quantity in a formula must be explained in full** (what it refers to in the system / where it is observed / unit or magnitude / how it is counted; when "how it is counted" cannot be given, mark it a candidate pending answer). **A word borrowed from ordinary language must declare how it differs** — words like *cost*, *density*, *hit*, *good*: the user thinks it means what they mean, but it means what you defined; same name, different meaning is the main source of misunderstanding. **Lowering the bar is done by explaining, not by vagueness.** One test: would the user have to ask a second time to understand this word?
- **A concept must be walkable**: when a concept takes shape for the first time, add a `## 走一遍` (walk it through) section to the node — take one concrete input and follow it from entry to end. **How it lands on a mechanism** is the mechanism view (who reads what); this section is the time view. With only the former, the user thinks they understood, and only at implementation time finds that every step fails to line up.

## How one derivation goes

| File | What it holds |
|---|---|
| `seed.md` | The user's own words (append-only), the one-sentence need, the **requirement lines (word split, with a role: core / condition / non-goal)**, **the core and what it costs**, the **core question**, non-goals, what counts as done, rejected phrasings, `needs_probe`, an optional `reader:` |
| `facts.md` | `## F-001` facts with source + grade (E1 docs/source, E2 measured, E3 second-hand) + what they are used for; a closing "what I did not check" |
| `derivation/NN-<word>.md` | One derivation node: question / known / inference / conclusion / **how it lands on a mechanism** / conversely / questions raised / **open items** (+ an optional **walk-through** section once the concept takes shape) |
| `model.md` | The abstract concept model: name, one sentence, what it is made of, seams and boundaries, what is settled vs still open, conversely, and *reversal: when this whole tree does not hold* |
| `build/01-criteria.md`, `02-options.md`, `04-selection.md` | Criteria first, options after, selection last; rejects carry a rejection reason and a revival condition; `03-experiment.md` only when an experiment is needed |
| `probe/` | Probe files: a runnable script plus `README.md` (how to run it, which `Q-` it answers, the **kill criterion**, where the result goes) |
| `handoff.md` | One half of the fruit: self-contained handoff — acceptance, first task, a copyable prompt, **verification status** |
| `map.md` | Progress, **next step**, requirement-line coverage, concept chain, open items — **tool-generated, never hand-written** |
| `glossary.md` | Terms: `- **term**: one plain-language definition` (an entry borrowed from ordinary language must state "what it means elsewhere / what it means here / how it differs"; plus "former names" and "words not used") |

A single derivation node looks like this (abridged; the full guidance is in [`references/writing.md`](references/writing.md)):

```markdown
---
point: 02
title: reduce the bad, or add the good
status: open
what: good / bad tokens   # one node names one thing
line: R-02                # which requirement line it serves
undecided: 1              # how many items are still open — convergence watches this
answers: [Q-01.2]         # which earlier question it answers
from: [D-01.1]            # which conclusions it takes as premises (D- only)
---
## Question   Q-02.1 Should density come from removing bad fragments or from adding good ones?
## Known      [F-002] The bad fragments one can spot at a glance are only the shallow few; the rest neither a human nor a model can pick out.
## Inference  Removing them requires recognising them, which is the harder problem; adding good ones only requires a factual judgement at the moment things go wrong.
## Conclusion D-02.1 Do only the "add good" side. Give up "clean the context".
## How it lands  Read only the fragments near the anomaly; inject when an error is about to set; every injection carries its source. Who decides "about to set" still cannot be pointed at.
## Conversely If the injection always lands after the error has set, this does not hold.
## Raised     Q-02.2 Who decides "about to set"? (answered by node 03)
## Open items The trigger and its timing; answered by node 03.
```

**One node, five questions**: *name* is `what:`, *parts* and *why* live in Known/Inference, *how* lives in "how it lands" (write "cannot point at it yet, because…" when that is the truth), and *new* lives in Raised plus Open items. Splitting the node into `## what` / `## parts` / `## explain` / `## how` / `## new` sections works just as well. **When a concept takes shape for the first time, add an optional `## 走一遍` section**: take one concrete input from entry to end — however fine the mechanism is written, this is the section the reader uses to assemble the whole picture.

**When you already have a conclusion**: register it as a *conclusion to be derived*, then derive forward from the need. If it follows, it is argued; if it does not, it becomes an assumption or a competing concept, and the step where it breaks is named. It is never used as a premise directly.

## Experiments and the fruit

A coherent concept only means it **makes sense**; it does not mean it **holds**. At the selection stage an experiment is allowed to hit it:

- **Whether to experiment is decided in the seed** (`needs_probe: yes | no`). Some trees genuinely do not need one (pure choice problems, pure external-information problems) — **deciding against is a legitimate choice**, but `build/04-selection.md` must say why.
- **The discussion session does not run experiments**: it only produces probe files under `probe/`. The user runs them in a standard-mode session — that one can edit code and iterate, while a long discussion context runs them slowly and unreliably.
- **An experiment with no kill criterion is a demo**: write down, before running, what result would kill the concept. Results go into `facts.md` (E2 measured) and the node says "this turned which conclusion into what". **If it overturned something, say so** — one successful falsification is worth more than ten confirmations.
- **A falsified need is a legitimate ending**: write it into the handoff's "what not to do" and the model's "reversal". The implementation cost that saves *is* the result.

## The check (deliberately light)

It checks **composition and non-emptiness only**: are the seed sections there (**including the requirement lines**, with **exactly one core**), are `facts.md` and `glossary.md` there, is there at least one derivation node, do the nodes have a question and a conclusion, are `model.md` / `build/` formed if they exist, and do probe files carry a question to answer and a kill criterion. **Everything else is a warning**:

- did the derivation drift: a requirement line with no nodes, four nodes in a row on the same line, five nodes in a row with no new concept, **a condition declared in the seed that no node is testing**;
- is the ledger honest: **more than 3 conditions** (a nudge that it is too much, never a block), a seed with no "the core and what it costs";
- **is it converging**: open items growing across several nodes in a row;
- is an anchor wrong: a fact sitting in `from:`, a node missing `line:` / `what:`, an ID that points nowhere, a second node unrelated to the first;
- **are the records keeping up with the conversation**: `undecided:` disagreeing with the number of items in `## 未定项` (**change only one of the two and the progress number in `map.md` is wrong**), the **"where we stopped" / "next step"** lines in `map.md` disagreeing with what the files now say (**a content-level comparison — `mtime` is reset by checkout, copy and editor saves, and therefore cannot detect "stopped a round ago"**);
- did selection jump the order: a criterion with no source, options written before criteria, a parked question with no unlocking fact, experiments promised but none written…

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

`dsh-preset/` turns two rules into mechanism: `write`/`edit` may only touch the discussion root (`design/`), so a discussion never edits the implementation; and the "user's own words" section of `seed.md` is append-only. Probe files live at `design/<slug>/probe/`, inside the tree, so they need no extra whitelisting — **running them is the user's job, not this layer's**. Details in [`dsh-preset/README.md`](dsh-preset/README.md).

After changing the skill or the preset, re-run `install.sh` and **start a new session**: the persona and `SKILL.md` are injected when a session begins.

**Claude Code / any host that reads SKILL.md**:

```bash
git clone git@github.com:Mypenfly/apical-bud.git ~/.claude/skills/apical-bud
```

## Layout

```
SKILL.md                       method body: the two invariants, the appendix index, the reader assumption and write-back-on-settle, one line on the check
references/                    appendices, read on demand (indexed at the top of SKILL.md)
  core.md                      picking the core, the derivation loop, the five questions, the two relations
  node.md                      how to write one node: frontmatter, nine sections plus an optional walk-through, provenance
  check.md                     file inventory, start order, model/selection shape, what the check checks
  terminology.md               wording, the phrasing table, writing for a human reader (reader assumption, borrowed-word declaration, formulas explained in full), how to ask
  writing.md                   how to write: one full example, the convergence test, nine shapes of drift, common symptoms
templates/                     10 templates (seed / facts / point / model / criteria / options / probe / selection / handoff / glossary)
scripts/check.mjs              zero-dependency check: composition + warnings + map.md (module and CLI)
dsh-preset/                    DSH session assembly: persona, apical_check tool, write guard, banner, install.sh, selftest
README.md / README.en.md       Chinese / English
```

## Relationship to earlier versions

**v1** was a stage machine: S0–S7, exit criteria per stage, candidate/conclusion tiers, round minutes, full re-judgement passes, a state file. A real test exposed what that cost: **mechanical clause growth** (the same decision written twice), **premature convergence** (four parallel single points each derived once counted as done, and the trunk was never questioned), **the gate steering the derivation** (chains assembled to pass the check), **bureaucratic wording**, and **the feeling of a finished stage outweighing the question itself**.

**v1.5** removed those mechanisms and kept only the layer that specifies file organisation and wording, handing progress back to the files and the IDs. Its hole was that it **could not close**: the loop said "a concept must raise the next question" but never said "open items must be resolved" — so raising new questions became every node's achievement and resolving them was nobody's job, and the nodes could grow forever.

This version adds three things: **pick one core and write down what you gave up** (so you are not serving two fighting goals at once), **open items must be resolved and must stop growing** (nodes are unbounded; sprawl is not), and **experiments may overturn the concept or establish that the need is infeasible** (the fruit is a text plus runnable probe files, not a correct but useless document).

**This round** adds three more things that came out of actual use, with the core bet placed on **records not going stale**:

- **every quantity in a formula must be explained in full** (what it refers to in the system / where it is observed / unit or magnitude / how it is counted; when "how it is counted" cannot be given, mark it a candidate pending answer), and **a word borrowed from ordinary language must declare on the spot how it differs** — same name, different meaning is the main source of misunderstanding: the user thinks it means what they mean, but it means what you defined;
- **walk a concept through the first time it takes shape**: one concrete input, from entry to end, adding the time view that "how it lands on a mechanism" (the mechanism view) does not give;
- **records do not go stale**: a conclusion is written back to the files **in the same turn** it is accepted (the write-back list); after a new session or a context compaction, **read `map.md` → the last node → `model.md`, then recite three sentences** for the user to correct; the check gained `undecided.drift` (`undecided:` disagreeing with the number of items in `## 未定项`) and `map.drift` (**a content-level** comparison of the "where we stopped / next step" lines — `mtime` cannot detect "stopped a round ago"), and `map.md` gained a **"next step"** line. **The default reader is not a technical person in this field**: the first occurrence of a technical word must be grounded on the spot.

**The method body lives in exactly one place.** The persona carries only the always-on contract (the invariants, write-back and resumption, the reader assumption, the wording rules that go wrong most often), and its first line pushes the model to `SKILL.md`; the same passage is no longer hand-copied at every layer. `selftest.mjs` has an assertion guarding it: every file under `references/` must be indexed from `SKILL.md`, no `references/` pointer in either copy may dangle, and the persona body must stay within a 7 KB budget — **a pointer to `references/writing.md` was once added to the skill and the persona copy never followed**, and that assertion came from that drift.

Old-shape roots (`state.json` / `layers/` / `concept/`) are **left untouched, readable, not migrated**; v1.5-shaped roots (several peer requirement lines, `step:` marking one of six loop positions, no open items) are read just as well by the check and reported as complete. To continue in this shape, start a new root in the same project and write one line in its `seed.md`: "relationship to existing trees" — what it inherits, what it overturns.

## Credits and licence

The questioning discipline (one question at a time; never ask the user what a file can answer) follows [grill-me](https://github.com/RobMitt/grill-me-skill). This version **drops** its most harmful rule — "always state which option I lean towards": in practice the user took the facilitator's preferred option nine times out of nine, and the discussion became the facilitator supplying a ready-made solution for the user to stamp. The shape now is to lay out the tension and ask for the user's reason.

**Licence: [MIT](LICENSE).** Use it, change it, republish it — keep the copyright notice.
