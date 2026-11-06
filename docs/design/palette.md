# ECE interface palette

The onboarding flow set the visual direction: a white page, one green signal, soft
ruled cards and Instrument type. The rest of the workspace now uses the same system,
with denser tables where accounting needs them.

## Selected: Ledger Green

| Token | Value | Use |
| --- | --- | --- |
| Paper | `#FFFFFF` | Page canvas |
| Wash | `#F7F7F3` | Quiet panels, table totals, empty states |
| Ink | `#131310` | Headings and primary text |
| Ink 2 | `#3C3C37` | Body copy |
| Muted | `#6F6F66` | Labels, metadata (5.1:1 on white, 4.7:1 on wash) |
| Rule | `#E8E8E2` | Dividers and card borders |
| Rule strong | `#D4D4CB` | Input and secondary-button borders |
| Accent | `#0C7A43` | Primary action, active status, progress |
| Accent soft | `#F4FAF6` | Selected option, success banner, avatar |
| Warn | `#956400` | Pending approval and projected figures |
| Danger | `#9F2F2D` | Refusals and destructive actions |

Green is doing two jobs here: it is the primary action colour and the colour of a
healthy, approved state. That is deliberate — in a ledger product, "open" and
"approved" are the states operators look for all day.

## Alternatives

### Harbor Blue

For a more institutional, bank-software register. Blue owns actions; green is
reserved for approved states only.

| Token | Value |
| --- | --- |
| Paper | `#FFFFFF` |
| Wash | `#F5F7FA` |
| Ink | `#12151A` |
| Accent | `#1D4E89` |
| Accent soft | `#EEF3F9` |
| Rule | `#E4E8EE` |
| Success | `#0C7A43` |

### Clay and Graphite

Warmer, closer to a boutique accounting firm. Terracotta for primary actions,
muted green for healthy states, graphite for figures.

| Token | Value |
| --- | --- |
| Paper | `#FFFFFF` |
| Wash | `#F8F5F0` |
| Ink | `#171310` |
| Accent | `#A4552F` |
| Accent soft | `#FBF1EB` |
| Rule | `#EAE3DA` |
| Success | `#3F6B4F` |

## Rules that keep it fast

- **One accent.** Primary buttons, selected options, progress and active status use
  the accent. Amber means "needs a human"; red means "refused". Nothing else is
  coloured.
- **Two surfaces.** White for content, wash for a quiet panel. No gradients, no
  glass, no drop shadows except the company switcher.
- **Shape carries hierarchy.** Cards 14px, inputs 10px, actions are pills. Tables
  keep square internal rules so the numbers stay legible.
- **Type does the decoration.** Instrument Serif for page titles, Instrument Sans
  for everything else, IBM Plex Mono with tabular numerals for money and codes.
- **Readability floor.** Operational labels are 11px or larger, body copy sits at
  13–14.5px, and register values are 12.5–13.5px. Legal documents keep their own
  scale so pagination stays exact.
- **Motion is feedback.** 200ms colour and a 1px lift on cards. Nothing moves on
  load except the onboarding step.

## Switching schemes

All colours live in the `@theme` block of `src/app/globals.css`. To change scheme,
replace `--color-accent`, `--color-accent-soft`, `--color-surface-2`,
`--color-rule` and `--color-muted`. If the accent is no longer green, keep a green
state colour for approved records so "approved" stays distinct from "primary".
The onboarding flow is intentionally self-contained and uses the same hex values
directly.
