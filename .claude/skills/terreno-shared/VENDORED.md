# Vendored terreno planning files

Not a skill (no `SKILL.md`). Shared references for `distill`, `cut`, `barrel`, and `finish`.

Copied from [TerrenoLabs/terreno](https://github.com/TerrenoLabs/terreno) at `d8fdd897`
(plugin `terreno` 2.12.0, `plugins/terreno-claude/`):

| Here | Upstream | Changes |
| --- | --- | --- |
| `*.md`, `*.json` in this directory | `references/` | none |
| `testing.md`, `mocking.md` | `skills/2-pick/references/` | none |
| `../barrel/stages/pick.md` | `skills/2-pick/SKILL.md` | frontmatter dropped, links, Roast is followed from `roast.md` |
| `../barrel/stages/roast.md` | `skills/3-roast/SKILL.md` | frontmatter dropped, links |
| `../barrel/stages/brew.md` | `skills/4-brew/SKILL.md` | frontmatter dropped, links, hand-off goes to `finish` |
| `../finish/taste.md` | `skills/5-taste/SKILL.md` | frontmatter dropped, links, `finish` owns the repeat loop |
| `../distill/references/distilling.md` | `skills/1-grow/references/grilling.md` | rewritten: triage instead of full grilling |

Only `reaching-the-human.md` is original to this directory.

Name mapping: lifecycle docs say Grow/Pick/Roast/Brew/Taste and `terreno-*-loop`. Here Grow
is `distill`, the Pick→Brew outer loop is `barrel`, and Taste-until-green is `finish`.
Stage results still use the upstream `stage` enum (`grow`, `pick`, `roast`, `brew`, `taste`)
so zerg and other terreno tooling can read them.

To resync, diff the upstream files against these and reapply the Changes column.
