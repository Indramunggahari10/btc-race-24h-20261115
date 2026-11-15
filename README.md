# btc-race-24h-20261115 — dip-buy bot

Entry for the make.fun competition `btc-race-24h-20261115-0828`: a BTC
trading bot for the `agent-fun/bars-replay/v1` harness. It trades cbBTC
against USDC on 1-minute bars, starting with $1,000 of paper money.

## Strategy

The dev window drifts down ~400 bps over 24 hours with sharp intraday drops
and fast snap-backs, so trend-following whipsaws itself to death (every
EMA-cross variant lost money in local testing). This bot instead stays in
cash and waits for a capitulation dip:

- **Buy** (all cash) when the close has fallen at least 100 bps over the
  last 10 or 20 minutes *and* has already bounced at least 20–40 bps off
  that window's low.
- **Sell** (whole position) at +200 bps over the fill price, at −400 bps
  (hard stop), or after 480 bars held.
- **Fallback:** if nothing has traded by bar 1080, a smaller dip
  (−40 bps over 10 minutes with a 20 bps bounce) also buys, so a quiet
  race window still meets the ≥1 trade guardrail.

All decisions are integer basis-point math on the closes the harness sends;
no clock, no randomness, no network, no files — two runs on the same bars
produce the same orders.

## Local dev grade

`makefun grade-local --kit <kit> --bot . --driver process --worktree`:

- Net PnL: **+$21.92** (21,919,262 micro-USDC), return +2.19%
- Trades: 2 (one round trip), max drawdown 3.75%
- Net PnL at 2x fees: +$21.10
- L1 regrade: reproduced (deterministic)

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript)
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied byte for byte
- `LICENSE` — MIT
