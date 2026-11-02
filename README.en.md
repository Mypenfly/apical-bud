# apical-bud (顶芽)

**Derive a program's data flow from the user's first action, check what already exists, then build the smallest set of slices that runs it.**

English | [中文](README.md)

The method fixes only three things: how the data flow is derived, how existing projects are compared, and how implementation is sliced. No phases, no gates, no checker.

Two invariants: **exactly one main action chain**; **every gap must be resolved and must stop growing**.

## What changed in v2

- **User-first data flow instead of a concept tree.** The graph's root is the user launching the program; every requirement line starts from one concrete user action; anything the system triggers on its own must be reachable along some user action chain. No orphan nodes.
- **Check before building.** Same-ecosystem plugin market (zero migration) → similar open source → official/community. Migrate only when hard-step coverage is high *and* migration pain is acceptable; let the user try the shortest path before judging pain; otherwise self-build and record which condition failed.
- **Implementation is the endpoint.** Slices follow the user action order: slice 0 is a skeleton with a slot per main action; each later slice fills one action end to end and must run and be visible.
- **Simplicity is a second-order constraint.** After scope, closure and means are satisfied, pick the smallest engineering footprint. Create an abstraction only when it has a second consumer.
- **Boundaries are mandatory**: what it does not do, what it cannot do, what scenarios it alone supports — each with the cost of crossing it.
- **Two anchor files instead of nine**: `seed.md` and `flow.md`; everything else only when needed. Write-back happens at four moments only.
- **The checker is gone.** The 66 KB check script and the 47 KB selftest were deleted; four hard items remain and can be read by eye.

## Priority layers

Six layers, high to low. On conflict the higher layer wins; on a tie inside a layer, ask the user.

| Layer | Covers |
|---|---|
| L0 non-negotiable | honesty, no deciding for the user, no crossing boundaries |
| L1 scope | user-first data flow, scenario card, three boundary answers |
| L2 closure | the action chain closes; the user sees every step; failures have exits |
| L3 means | check existing first; migrate only when both conditions pass, otherwise self-build |
| L4 simplicity | second-order: smallest footprint after L1–L3 are met |
| L5 records & speech | only what is needed; one to five sentences |

## One round

1. Read the 现状 section of `flow.md`, pick one action.
2. Draw it into the graph: states, edge, reads/writes, failure exit.
3. Resolve the gaps it exposes; if unresolvable, mark it unresolvable with an unlock condition.
4. If you are about to build something, check what exists first.
5. When gaps are clear and the main chain closes, move to implementation.

Four questions per action edge: who acts in which state / what is read and written / what the user sees / what they see on failure and where it exits.

Convergence needs all three: the main chain closes (every state has a writer, every action an exit, every visible result a source), gaps are clear or marked unresolvable, and no new concept appears.

## Files

```
design/<slug>/seed.md      verbatim user words (append-only) / core question / main chain / lines / boundaries
design/<slug>/flow.md      current state (≤15 lines) / states / actions / gaps / one walk-through
design/<slug>/research.md  comparison table (when needed)
design/<slug>/impl.md      slice list (during implementation)
design/<slug>/handoff.md   when implementation moves to a new session
```

Templates live in `templates/`; what each file holds is in `references/records.md`.

## Implementation

Slice 0 is a skeleton with a visible slot for every main action. Each later slice fills one action end to end; it must run, be visible, and explicitly not do anything else. Do not build an abstraction layer or a config system before filling actions. Choose the session by engineering size: up to 2 slices, no new dependency, one file — same session; otherwise a fresh standard session.

## Install

```bash
git clone git@github.com:Mypenfly/apical-bud.git ~/.dsh/skills/apical-bud
~/.dsh/skills/apical-bud/dsh-preset/install.sh   # optional DSH assembly layer
```

## Older trees

v1 discussion roots are kept read-only: not checked, not migrated. To continue a project, open a new v2 root and say in its `seed.md` what it inherits and what it overturns.

The Chinese README is canonical. License: MIT.
