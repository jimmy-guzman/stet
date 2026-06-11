# Claude Instructions

Follow `AGENTS.md` as the source of truth for this repo.

Before implementing OpenTUI UI code, read the project-local OpenTUI skill:

- `.agents/skills/opentui/SKILL.md`
- `.agents/skills/opentui/docs/bindings/react.mdx`
- Relevant component docs under `.agents/skills/opentui/docs/components/`

Before changing Bun scripts, dependencies, tests, runtime behavior, or build commands, read:

- `.agents/skills/bun/SKILL.md`

Before discovering or installing more skills, read:

- `.agents/skills/find-skills/SKILL.md`

Important project constraints:

- `sideye` is a human review tool, not an AI reviewer.
- No agent integration, no gating, no accept/reject protocol, and no generated review explanations.
- Bun is the runtime and command runner.
- Use `bun run check` for normal verification and `bun run build` for the compile smoke check.
- Keep `bun.lock` committed with dependency changes.
- OpenTUI React is the UI stack.
- Git data renders first; diagnostics stream in later.
- Badge states must distinguish pending, clean, findings, and failures explicitly.
- Use strict equality only.
- Do not add sign-offs.
