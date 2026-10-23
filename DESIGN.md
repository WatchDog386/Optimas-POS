---
name: Motocore Tactical POS
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#44474d'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#75777d'
  outline-variant: '#c5c6cd'
  surface-tint: '#505f78'
  primary: '#000e23'
  on-primary: '#ffffff'
  primary-container: '#14243a'
  on-primary-container: '#7c8ba6'
  inverse-primary: '#b7c7e4'
  secondary: '#0051d5'
  on-secondary: '#ffffff'
  secondary-container: '#316bf3'
  on-secondary-container: '#fefcff'
  tertiary: '#001105'
  on-tertiary: '#ffffff'
  tertiary-container: '#002a12'
  on-tertiary-container: '#009f54'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d4e3ff'
  primary-fixed-dim: '#b7c7e4'
  on-primary-fixed: '#0b1c32'
  on-primary-fixed-variant: '#38475f'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#77fca3'
  tertiary-fixed-dim: '#59df89'
  on-tertiary-fixed: '#00210d'
  on-tertiary-fixed-variant: '#005228'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  numeric-data:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  currency-callout:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-compact: 0.5rem
  margin: 1.5rem
  margin-mobile: 0.75rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system establishes an ultra-refined, high-throughput operational interface engineered specifically for the fast-paced motor parts and retail trade in East Africa. The aesthetic reflects mechanical precision, financial integrity, and enterprise discipline. It bridges raw automotive logistics—ranging from micro-retail boda boda workshops to large fleet parts distributors—with the poise of high-grade financial tooling.

The brand tone is focused, decisive, and authoritative. The interface avoids frivolous ornamentation or visual bloat, favoring high information density balanced with immaculate micro-spacing. Visual depth relies on structured grid alignment, clean hairline borders, and subtle surface stratification rather than deep shadows or dramatic gradients. 

High-frequency actions (barcode scans, OEM SKU lookups, split tender reconciliations, and mobile money verifications) are tuned for zero cognitive lag. The visual hierarchy maintains strict clarity under intense shop-floor lighting while providing deep reassurance during rapid cash and digital currency exchanges.

## Colors

The palette establishes an immediate hierarchy between structural enterprise surfaces and actionable transactional states.

- **Primary Brand Base (`#14243A` & `#0F172A`)**: Deep navy and dark slate provide authoritative grounding for navigation sidebars, high-level headers, and dominant interface anchors.
- **Action Interactive (`#2563EB`, hover `#1D4ED8`)**: A focused cobalt blue reserved for primary user paths: checkout commits, search triggers, positive selections, and key conversion moments.
- **Transactional & Payment System (`#00A859`)**: Safaricom Green is treated as an isolated domain token. It is utilized exclusively for mobile money transactions, M-Pesa push triggers, C2B confirmations, and associated verification pill badges.
- **Neutral Canvas (`#F8FAFC` to `#FFFFFF`)**: The application foundation is built on `#F8FAFC` (canvas backing) with pure `#FFFFFF` dedicated to interactive cards, dense ledger tables, and floating modal sheets. Hairline divisions are rendered using subtle slate `#E2E8F0`.
- **Telemetry & Status States**:
  - Confirmed / Healthy Stock: Forest Green (`#16A34A`)
  - Low Stock / Pending / In-Review: Balanced Amber (`#D97706`)
  - Out of Stock / Overdue Credit / System Error: Crimson (`#DC2626`)
  - Compatibility & Spec Labels: Slate (`#475569`) with neutral tinted fills (`#F1F5F9`)

## Typography

Inter serves as the sole typographic engine, deployed with strict tabular OpenType features enabled (`tnum`, `cv05`, `cv11`).

All financial quantities, currency notations (`KSh`, `KES`), inventory tallies, barcode strings, and OEM cross-references must render using tabular lining figures (`font-variant-numeric: tabular-nums`). This guarantees that multi-row transaction ledgers, parts picking sheets, and cart item columns align consistently along vertical decimal axes.

Section and field labels rely on deliberate, uppercase tracking at smaller scales (`label-sm`) to ensure rapid legibility on lower-resolution point-of-sale hardware terminals and counter-mounted tablets.

## Layout & Spacing

The layout model is governed by a strict 4px sub-grid and an 8px architectural rhythm designed for enterprise density. 

- **Structure**: Interfaces employ a responsive fluid grid. Desktop POS screens use an asymmetrical 12-column layout: an 8-column transactional catalog/lookup canvas paired with a persistent 4-column register ticket sidebar.
- **Breakpoints**:
  - `Mobile` (< 768px): Single-column stacked workflow. POS shifts to a bottom-anchored action drawer. Margins reduce to `margin-mobile` (12px).
  - `Tablet / Counter Display` (768px – 1180px): Compact dual-column view utilizing `gutter-compact` (8px) to fit inventory list and ticket concurrently without horizontal overflow.
  - `Desktop / POS Terminal` (> 1180px): Standard 12-column layout with 16px (`gutter`) spacing and 24px (`margin`) boundary insets.
- **Internal Density**: Component interiors strictly preserve micro-compact paddings (`space-sm` for table cells and button insets; `space-xs` for tag containers) to maximize vertical row visibility above the counter fold.

## Elevation & Depth

This system intentionally departs from deep, blurred shadow layers. In warehouse and counter environments, blurred ambient shadows diminish visual clarity and create dirty-screen perceptions.

Instead, depth is created through **tonal surface stacking** combined with **crisp low-contrast outlines**:
- **Layer 0 (Canvas Backing)**: `#F8FAFC` base application shell.
- **Layer 1 (Working Surface)**: `#FFFFFF` crisp cards, table panels, and search docks bounded by a continuous 1px solid `#E2E8F0` border.
- **Layer 2 (Floating Overlays & Cart Controls)**: `#FFFFFF` elevated panels with a precise mechanical shadow: `0px 1px 3px rgba(15, 23, 42, 0.08), 0px 4px 6px -2px rgba(15, 23, 42, 0.05)` framed by `#CBD5E1`.
- **Layer 3 (Modals & Checkout Sheets)**: Top-tier dialogs use a backdrop blur of `4px` with a dark slate wash (`#0F172A` at 40% opacity), paired with a concentrated elevation perimeter: `0px 10px 25px -5px rgba(15, 23, 42, 0.15)`.

## Shapes

The design system standardizes on a **Soft (0.25rem / 4px)** corner radius base. 

Sharp, near-orthogonal geometry honors the industrial nature of mechanical components and promotes maximum spatial efficiency inside data-heavy records.
- Standard controls (input fields, buttons, table rows, and alert banners) feature a `4px` corner radius.
- Cards, containment panels, and modal windows scale up modestly to `rounded-lg` (`8px`).
- Badges, status pills, and vehicle model compatibility tags use a compact pill radius (`9999px`) to create an immediate visual distinction between actionable structural containers and informational meta-tags.

## Components

### Buttons & Interactive Controls
- **Primary POS Action**: Solid `#2563EB` fill, `#FFFFFF` text, `4px` radius, bold 13px Inter label. Hover: `#1D4ED8`. Active state scales subtly (`transform: scale(0.99)`).
- **M-Pesa Trigger Action**: Solid `#00A859` fill, `#FFFFFF` label, integrated M-Pesa icon token. Hover: `#008F4C`.
- **Secondary / Actionable Neutral**: `#FFFFFF` background, 1px border `#CBD5E1`, dark slate text `#1E293B`. Hover: `#F1F5F9`.
- **Critical / Void / Return**: `#FEE2E2` background, 1px border `#FCA5A5`, text `#DC2626`. Hover: `#DC2626` background, `#FFFFFF` text.

### Data Tables & Parts Inventory Ledgers
- Row height fixed at a compact `40px` for high density.
- Alternating row zebra subtle tint: `#FFFFFF` on even rows, `#F8FAFC` on odd rows. Hover highlight: `#F1F5F9`.
- Fixed-width right-aligned columns for SKU count, reorder point, unit cost, and selling price.
- Text overflow truncated with inline ellipsis; OEM identifiers always set in monospace-tuned Inter tabular weights.

### Vehicle Compatibility Tags (Make / Model / Fitment)
- Pill format (`9999px` radius) with `2px 8px` vertical/horizontal padding.
- Neutral contextual tags (e.g., *Bajaj Boxer 150*, *TVS Star HLX*, *Toyota Probox*) use `#F1F5F9` background, `#334155` text, and `#E2E8F0` border.
- Universal/General Fit tags use a soft blue tint: `#EFF6FF` background, `#1D4ED8` text, `#BFDBFE` border.

### Multi-Tender Split Payment Modal
- Dedicated payment ledger split into distinct source blocks: M-Pesa Express (STK Push), Cash Received, Bank Card, and Customer Shop Credit.
- Immediate dynamic calculation display showing: `Total Bill` vs. `Tendered Sum` vs. `Balance Remaining / Change Due`.
- M-Pesa block highlights live reconciliation polling with a pulsating `#00A859` micro-dot alongside reference input.

### Search & Barcode Quick-Lookup Field
- High-prominence, persistent header input.
- Height: `44px` on desktop, interior leading icon for hardware optical scanner readiness.
- Clear numeric display showing matched results tally, direct OEM cross-reference matches, and bin location codes (e.g., `Shelf B-14`).