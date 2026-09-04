# DESIGN.md - "Exchange board"

Replacement world, chosen 2026-09-03 to remove template-AI patterns (dot-grid
backgrounds, glow blobs, fake terminal chrome, numbered eyebrows, pill
everything, pulse-dot badges). The old look is anti-reference; do not
reintroduce those devices.

## Idea

The product is a market, so the interface borrows from exchange boards and
vault ledgers: a flat near-black canvas, hairline rules instead of floating
boxes, condensed display type like a ticker board, mono type for every number.
Expression lives in type scale, rules, and the card artwork itself; color is
semantic only.

## Tokens

- Canvas `#070708` flat. Panel `#0d0d0f`, used sparingly.
- Hairline `rgba(255,255,255,0.09)`; stronger edge `0.16` on hover.
- Text: `#f2f2f0` primary, `white/60` secondary, `white/40` meta,
  `white/30` fine print. Body text is never below `white/55` and never
  font-light below 14px.
- Semantic up/live `#00bd7d` (green), down/error `#f87171`, pending
  `#fbbf24`. Green means "up or live", nothing else.
- Radii: 3px controls, 6px card media. No pills except tiny status chips.
- Fonts: Oswald (display, 500/600, tight tracking), Archivo (body,
  400/500/600), JetBrains Mono (all numbers, labels, kickers, buttons).

## Primitives

- `.eyebrow`: mono 11px uppercase, 0.16em tracking, white/40. No numbering.
- `.btn`: square (3px), mono 11px uppercase tracked. Primary white-on-black
  text; ghost hairline. Hover: border brightens, no translate.
- `.panel`: hairline border on `#0d0d0f`, 4px radius, no shadow. Structure
  inside panels uses hairline dividers, not nested boxes.
- `.chip`: mono 10px uppercase, 2px radius, tinted border + text, transparent
  fill (solid green fill only for MINTED/YOURS).
- `.stat-strip`: one panel divided by vertical hairlines; label over mono
  value. Use for metric rows instead of grids of identical tiles.
- Buttons never lift (`translateY`); hover states change color only.
- Focus: 2px `#00bd7d` outline, offset 2px. Preserved everywhere.

## Surfaces

- Hero: mono kicker line, Oswald H1, short body, two buttons, live-cap line.
  Right: draggable card coverflow (kept from incumbent, it is the signature).
- Sections open with eyebrow + Oswald H2; content separated by hairlines.
- Market grid: hairline cards, card art is the only large color.
- Roadmap: ledger rows, hairline dividers, status chips.
- Footer: hairline top, brand, links, disclaimer fine print.

## Motion

Only state transitions: coverflow snap, card flip, progress bar. Durations
150-400ms, ease-out. No entrance animations, no pulses except the live status
dot. Respect `prefers-reduced-motion` where animation exists.

## Voice

Declarative, specific, mechanic-first. Numbers over adjectives. One claim per
surface: the "cheapest at mint" line lives on Home only. Never invent claims
(presale, allocations, guarantees) and never contradict
`basePrice x cap / launchCap`.
