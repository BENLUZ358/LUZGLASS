# LuzGlass — UI Foundation & Admin Migration

**Date:** 2026-08-06
**Restore point:** tag `pre-ui-redesign` at `eba787b`
**Work branch:** `ui-redesign`

## Problem

Thirteen standalone HTML pages each carry their own inline `<style>` block and
their own copy of the design tokens. The copies have already drifted, and the
duplication means every visual fix costs thirteen edits instead of one.

Measured against the `ui-ux-pro-max` rule database:

| Finding | Count | Rule violated |
|---|---|---|
| Emoji used as icons | 338 (admin 120, workday 118, check-station 57) | Style Selection — explicit anti-pattern |
| Text below 12px (9/10/11px) | 286 across 12 files | Typography — Contrast Readability (High) |
| Duplicate `:root` blocks | 9 diverging copies | html-tailwind — Semantic colors |
| Accessibility attributes total | 5 across 13 pages | Focus States, Keyboard Navigation, Skip Links (all High) |
| `prefers-reduced-motion` | 0 | Reduced motion (High) |

Concrete drift: `--border` is `rgba(0,0,0,0.07)` in `admin.html` but `0.08`
everywhere else. `--gold` is `#b8922a` everywhere except `check-station.html`
where it is `#c9a84c`. `login.html` has no token block at all — every value is
a hardcoded hex.

### Contrast audit of the existing palette

Computed against the WCAG 4.5:1 threshold for normal text:

| Pair | Ratio | Status | Used by |
|---|---|---|---|
| `--text` #1a1714 on `--bg` #f7f4ef | 16.27:1 | AAA | Body text |
| `--gold` #b8922a on `--text` #1a1714 | 6.11:1 | Pass | Sidebar logo |
| `--muted` #8a8278 on `--bg` #f7f4ef | 3.45:1 | **Fail** | Secondary text — widespread |
| `--muted` #8a8278 on `--surface` #fff | 3.79:1 | **Fail** | Table labels, `.c-name` |
| `--gold` #b8922a on `--surface` #fff | 2.92:1 | **Fail** | Prices `.c-price` |
| #fff on `--gold` #b8922a | 2.92:1 | **Fail** | `.btn-new`, `.badge` |
| `.nav-sec` (20% on #1a1714) | 1.82:1 | **Fail** | Sidebar category headings |
| `.sb-logo .sub` (30% on #1a1714) | 2.57:1 | **Fail** | Logo subtitle |

`login.html` already solves the button case correctly — `background:#b8922a;
color:#1a1714` measures 6.11:1. Only `admin.html` puts white on gold. The fix
is to align admin with login, which requires no change to the brand gold.

## Decisions taken

1. **Keep the existing brand.** Gold `#b8922a`, near-black `#1a1714`, cream
   `#f7f4ef`, Playfair Display + Heebo. The database's `--design-system` mode
   proposed replacing this with an industrial slate + green palette and Plus
   Jakarta Sans; that output belongs to its landing-page pattern set
   ("Enterprise Gateway" / "Exaggerated Minimalism") and does not fit an
   internal operations tool. Rejected deliberately.
2. **Admin first.** `admin.html` is the priority surface.
3. **Shared foundation, no file splitting.** Extract shared CSS to one file;
   leave `admin.html`'s JavaScript untouched.
4. **Embedded SVG icon set** replacing emoji, in admin only for now.

## Design

### Component 1 — `lg-ui.css`

The single source of truth for tokens and shared components. No page defines
its own `:root` once migrated.

**Colour tokens**

```
--gold:      #b8922a   unchanged — fills, borders, logo on dark
--gold-text: #886c1f   new — gold as text on light backgrounds
--on-gold:   #1a1714   new — text on a gold fill (6.11:1)
--muted:     #756e66   darkened from #8a8278 (3.45:1 -> 4.58:1)
--border:    rgba(0,0,0,0.08)   single value, resolves the 0.07 drift
--text:      #1a1714   unchanged
--bg:        #f7f4ef   unchanged
--bg2:       #ede9e1   unchanged
--surface:   #ffffff   unchanged
```

`--gold-text` measures 4.54:1 on `--bg` and 4.99:1 on `--surface`, but only
4.12:1 on `--bg2`. It is therefore **defined for use on `--bg` and `--surface`
only**. Gold text on `--bg2` is not permitted; use `--text` there.

The foundation defines light-surface tokens only. `check-station.html` and the
`login.html` card are dark-surfaced and keep their current local values in this
phase; a dark scale is designed when those pages are migrated.

**Type scale — 12px floor**

```
--fs-xs:   12px
--fs-sm:   13px
--fs-base: 14px
--fs-lg:   16px
--fs-xl:   20px
```

All 286 occurrences of 9/10/11px collapse to the 12px floor. This flattens
three former size steps into one, so the hierarchy they carried must be
re-expressed by **weight and colour** instead — a label that was 9px muted
becomes 12px muted at weight 500; a value that was 11px bold becomes 13px bold.
Reintroducing a sub-12px step to restore contrast between them is not
permitted.

Density is preserved through the spacing scale (8–32px, matching what the
database returns at `--density 8`), not by shrinking text.

**Shared components:** `.btn` (primary / secondary / ghost), `.card`,
`.badge`, `.field`, `.table`, `.modal`, `.empty-state`.

**System states currently absent everywhere:**

- `:focus-visible` gold ring on every interactive element
- 44×44px minimum touch targets, 8px minimum spacing between them
- `@media (prefers-reduced-motion: reduce)` neutralising the `pulse` and `su`
  keyframe animations
- `.skip-link` to bypass navigation

### Component 2 — `lg-icons.js`

Roughly 30 Lucide-style SVG icons embedded in the project, no external CDN —
matching how the site already loads its assets. Usage:
`<span data-icon="package"></span>`. Icons inherit `currentColor` and
`font-size`, so they follow the tokens automatically.

Applied to `admin.html` only in this phase (120 occurrences). The remaining 218
in workday, check-station and elsewhere stay until those pages are migrated.

### Component 3 — `admin.html` migration

The six `<style>` blocks (lines 25, 231, 1356, 1379, 1402, 2257) collapse:
generic rules move to `lg-ui.css`, admin-specific rules consolidate into a
single block in `<head>`. The nine-column kanban grid is the genuinely
admin-specific piece that remains.

The five `<script>` blocks are not moved, reordered, or edited. This is the
boundary between the chosen approach and the rejected file-splitting approach.

## Sequence

| Step | Deliverable | Risk |
|---|---|---|
| 1 | `lg-ui.css` + `lg-icons.js` created; no page references them yet | None |
| 2 | admin links the foundation; its duplicate tokens deleted | Low |
| 3 | Typography and contrast fixes in admin | Low |
| 4 | 120 emoji replaced with SVG in admin | Medium — visual only |
| 5 | focus / touch / reduced-motion / skip-link | Low |

After step 5 the remaining twelve pages become mechanical: delete the local
`:root`, link the foundation, reconcile whatever breaks.

## Verification

Each step is checked before the next begins:

- Contrast ratios recomputed for every token pair; all normal text at 4.5:1 or
  better on its documented background.
- No `font-size` below 12px remains in `admin.html`.
- No emoji remains in interface positions in `admin.html`.
- Every interactive element shows a visible `:focus-visible` ring on keyboard
  tab-through.
- Admin renders without layout breakage at 375, 768, 1024 and 1440px.
- Kanban, table view, filters, search and modals still function — verified by
  loading the page, not by inspecting the diff.

## Out of scope

- Splitting `admin.html` into separate `.js` / `.css` files
- The slate + green palette the database proposed
- GSAP scroll animations — the database returned a subtle preset at
  `--motion 2`, but scroll-reveal does not suit an internal operations tool
- The other twelve pages in this phase

## Rollback

`main` is untouched at `eba787b`. Reverting is `git checkout main`, and the
branch can be discarded with `git branch -D ui-redesign`. The tag
`pre-ui-redesign` marks the same commit independently of the branch.
