# Email templates — technology showcase

Three transactional/lifecycle emails for CS2 Portfolio, each pushing a
different tier of email technology. All are hand-coded, image-free
(no hosted assets needed), 600px hybrid layouts.

## 01 — Weekly Portfolio Report (`01-weekly-report.html`)
Maximum-compatibility "looks designed everywhere" tier:

- **7-day value chart built from pure table cells** — renders in every
  client including Outlook desktop (no images, no SVG, no CSS heights).
- **Bulletproof VML button** for Outlook + gradient CSS button elsewhere.
- **Dark/light mode**: `color-scheme` meta, `prefers-color-scheme`
  overrides, `[data-ogsc]` hooks for Outlook.com forced dark mode.
- **Gradient headline** via `@supports (-webkit-background-clip: text)`
  with a solid-color fallback that can never render invisible text.
- Staggered CSS entrance animation on chart bars (WebKit clients only).
- Hidden preheader, rarity-colored item stripes, mobile stacking.

## 02 — Kinetic Price Alert (`02-kinetic-price-alert.html`)
Interactive ("kinetic") tier — the email is a tiny UI:

- **CSS-only tabs** (Gainers / Losers / Watchlist) via the radio-input
  `:checked` technique. Works in Apple Mail / iOS Mail.
- **Guard checkbox pattern**: interactivity only activates when the
  client provably kept `<input>` elements; everyone else (Gmail,
  Outlook) gets a static stacked fallback — no broken states.
- CSS keyframe animations: pulsing LIVE dot, shimmering progress bar
  toward the sell target, hover lift on cards.
- Progress-to-target bar degrades to a static two-cell table in
  non-animating clients.

## 03 — AMP Live Portfolio (`03-amp-live-portfolio.amp.html`)
AMP for Email (`text/x-amp-html`) tier — the email is a living app:

- **`amp-list`** re-fetches portfolio JSON on every open, so the inbox
  shows *current* prices weeks after sending.
- **`amp-bind`** in-email USD/EUR toggle.
- **`amp-carousel`** swipeable featured skins.
- **`amp-accordion`** per-item marketplace quote breakdown.
- **`amp-form`** "refresh quotes" POST without leaving the inbox.

Delivery requires sender registration with Gmail/Yahoo/Mail.ru, an
HTML fallback part (use 01), and AMP CORS headers
(`AMP-Email-Allow-Sender`) on the `/api/amp/*` endpoints, which are not
implemented yet — endpoints referenced in the template are the planned
contract.

## Testing

Rendered previews: open the `.html` files in a browser (approximates
WebKit clients). For real-client matrices run them through Litmus or
Email on Acid; validate the AMP file at https://amp.gmail.dev/playground/.
