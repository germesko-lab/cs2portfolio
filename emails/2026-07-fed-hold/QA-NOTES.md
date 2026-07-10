# QA Notes — Deep Flow Capital, July 2026 send ("Fed hold" educational note)

## Campaign inputs (found via autonomous research)

- **Topic:** The Fed's June 17, 2026 decision to hold rates, and what a pause means for savers' cash.
- **Anchor fact (used verbatim in all 5 versions):** "On June 17, the Federal Reserve held its target range for the federal funds rate at 3.50%–3.75% — the fourth consecutive meeting without a change."
- **Secondary supported claim:** the vote to hold was unanimous; policymakers are split on the path for the rest of 2026. Kept qualitative (no dot-plot numbers cited).
- **Destination URL (CTA in all 5):** https://www.federalreserve.gov/newsevents/pressreleases/monetary20260617a.htm
- **Subject line (all 5):** The Fed held at 3.50%–3.75%. What a pause means for your cash.
- **Preheader (all 5):** Four straight meetings, no change — and a five-minute check worth doing this week.

## Sources (show-your-work)

1. Federal Reserve, FOMC statement, June 17, 2026 — federalreserve.gov/newsevents/pressreleases/monetary20260617a.htm (primary source; URL surfaced by search from the Fed's own domain).
2. CNBC, "Fed interest rate decision June 2026" (June 17, 2026) — cnbc.com/2026/06/17/fed-interest-rate-decision-june-2026.html (corroborates hold at 3.50%–3.75%, fourth decision of 2026).
3. NerdWallet, "What 2026 Fed Rate Decisions Mean for CDs" (June 2026) — corroborates the unchanged 3.50%–3.75% range (its CD-rate figures were deliberately NOT used in copy; not on the approved source list).

⚠️ **Human verification required before send:** the build environment's network proxy returned 403 on direct fetches of federalreserve.gov and press coverage, so the anchor fact was corroborated via two independent search passes rather than a page-level read. A human must click the Fed URL, confirm it resolves, and confirm the statement says the target range was held at 3.50%–3.75% on June 17, 2026 and that this was the fourth consecutive hold.

## Per-version QA (3-line notes)

### 01 — Minimal-Lux / Quiet Authority (`01-minimal-lux.html`)
- Mobile: 500px table goes fluid at ≤620px; side padding drops to 24px; serif body 17px/1.65 holds up at small widths.
- Dark/contrast: navy #071B2C on white ≈ 16.5:1; footer #3d4f5e on white ≈ 8:1; dark-mode media query flips bg to #121212 with light text. Orange appears exactly once (the 48px rule) — decorative, no contrast dependency.
- Compliance sign-off needed: confirm disclosure wording with legal; confirm the logo PNG is not white-on-transparent (it sits on white here).

### 02 — Founder-Letter / Plain-Text-Feel (`02-founder-letter.html`)
- Mobile: system font stack, single 560px column, fluid; button 44px+ tap target.
- Dark/contrast: body text 16px navy on white; orange button uses navy text (≈6.7:1, passes AA); dark-mode overrides included.
- Compliance sign-off needed: **"Daniel Reeve, Head of Research" is a placeholder identity — replace with a real, named person before send** (CAN-SPAM header accuracy), plus legal review of disclosure.

### 03 — Data-Briefing / Chart-Led (`03-data-briefing.html`)
- Mobile: 600px fluid; the 52px monospace number steps down to 40px via media query; four-bar visual is pure table cells (no image), so it renders with images off.
- Dark/contrast: bars #173B55/#F58220 on #f2f4f6 panel are decorative; all figures also exist as text. Orange section numerals sit next to navy labels — the orange is ornamental, labels carry AA contrast.
- Compliance sign-off needed: bars are labeled "HOLD 1–3 / JUN 17" without specific meeting dates on purpose (earlier 2026 meeting dates unverified) — confirm with a human whether to add real dates from the Fed calendar.

### 04 — Bold Editorial / Magazine (`04-bold-editorial.html`)
- Mobile: headline steps 40px→32px, pull-quote 26px→22px; color blocks are full-width table cells, no images needed for the layout.
- Dark/contrast: white on navy ≈16.5:1; navy on orange pull-quote ≈6.7:1 (AA for large and normal text); no white-on-orange text anywhere. Orange band + orange CTA ≈ 35–40% of visible surface.
- Compliance sign-off needed: legal review of disclosure; confirm logo PNG is legible on the navy masthead (if the logo is navy-on-transparent it will vanish — may need the white/reversed logo file).

### 05 — Dossier / Dark Briefing (`05-dossier-dark.html`)
- Mobile: 580px fluid, headline 32px→28px; dark-native (#06131F outer / #0D2A40 card), `color-scheme: dark` declared so clients don't invert it.
- Contrast: #E8EEF4 body on #0D2A40 ≈ 12:1; muted #9FB3C4 footer ≈ 6.9:1; orange #F58220 accents on #0D2A40 ≈ 5.7:1 — all pass 4.5:1 at 16px+.
- Compliance sign-off needed: the logo image was deliberately replaced with a text wordmark because the PNG's colors couldn't be verified against a dark background from this environment — confirm whether a reversed logo file exists, plus legal review of disclosure.

## Shared checks (all 5)

- CAN-SPAM: physical address (Immersion Technologies LLC, 260 Chapman Rd, Newark, DE 19702) present; one-click unsubscribe placeholder `__unsubscribe_url__` present; "educational newsletter, nothing to buy" identification present; subject matches content.
- Disclosure text used exactly as provided, unparaphrased, in every version.
- No performance claims, no guarantees, no predictions presented as fact; the only rate quoted is the Fed's own benchmark.
- Banned-word scan: clean (no leverage/unlock/seamless/robust/navigate-as-verb/etc.).
- One CTA per email ("Read the full note"), button ≥44px tall, above the fold; repeated once below content only in 04 (the longest layout).
- Total image weight: one logo PNG per email (04/01/02/03), zero images in 05 — well under limits, but confirm the hosted logo.png is <200KB.
