// Dip-buy bot for btc-race-24h-20261115-0828 (agent-fun/bars-replay/v1).
//
// Idea, found by testing on the published dev window: the window drifts down
// about 400 bps over 24h with sharp intraday drops and fast snap-backs, so
// trend-following whipsaws itself to death (every EMA-cross variant lost
// money in local testing) while buying a sharp drop after it starts to
// bounce back catches the snap-back. The bot therefore stays in cash and
// waits for a capitulation dip, buys it whole, and exits on a fixed
// take-profit, a wide hard stop, or a max hold. A late-window fallback
// trigger exists only so the bot still makes at least one trade (the race
// guardrail) on a quiet window where no sharp dip ever comes.
//
// All arithmetic is integer (bigint) basis points off the closes the harness
// sends, so two runs on the same bars produce the same orders. No clock, no
// randomness, no network, no files.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10000n;

// Buy triggers: (lookback bars, drop in bps, bounce off the lookback low in bps)
const TRIGGERS = [
  { lookback: 20, dropBps: 100n, bounceBps: 40n },
  { lookback: 10, dropBps: 100n, bounceBps: 20n },
] as const;
// Fallback trigger, armed only late in the window when nothing has traded
// yet, so a quiet race window still meets the >=1 trade guardrail.
const FALLBACK = { armSeq: 1080, lookback: 10, dropBps: 40n, bounceBps: 20n } as const;

const TAKE_PROFIT_BPS = 200n; // sell when the close is +200 bps over the fill price
const HARD_STOP_BPS = 400n; // sell when the close is -400 bps under the fill price
const MAX_HOLD_BARS = 480; // sell after 480 bars held, whatever the price
const MAX_SLIPPAGE_BPS = 300; // fills land at the next open; 1m moves are ~12 bps sd
const REENTRY_COOLDOWN_BARS = 60; // bars to wait after a sell before buying again, so a fresh snap-back is not chased straight back into the same dip

const closes: bigint[] = [];
let entryPrice: bigint | null = null; // fill price of the open position
let entryBar = -1; // fill_bar of the buy that opened it
let everFilled = false; // any fill this run (buy or sell)
let lastSellBar = -1; // fill_bar of the most recent sell fill

function bpsChange(now: bigint, ref: bigint): bigint {
  return ((now - ref) * BPS) / ref;
}

function dipAndBounce(now: bigint, lookback: number, dropBps: bigint, bounceBps: bigint): boolean {
  if (closes.length <= lookback) return false;
  const ref = closes[closes.length - 1 - lookback];
  if (bpsChange(now, ref) > -dropBps) return false;
  let low = now;
  for (let i = closes.length - 1 - lookback; i < closes.length; i++) {
    if (closes[i] < low) low = closes[i];
  }
  return bpsChange(now, low) >= bounceBps;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];

    // Fold this batch's fills in first: a buy fill opens the position and
    // sets the entry price; a sell fill closes it.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      everFilled = true;
      if (fill.side === 'buy') {
        entryPrice = BigInt(fill.price);
        entryBar = fill.fill_bar;
      } else if (fill.side === 'sell') {
        entryPrice = null;
        entryBar = -1;
        lastSellBar = fill.fill_bar;
      }
    }

    closes.push(close);
    const held = state.positions.get(SYMBOL);
    const qty = held?.qty ?? 0n;

    if (qty > 0n && entryPrice !== null) {
      const change = bpsChange(close, entryPrice);
      const heldBars = batch.seq - entryBar;
      if (change >= TAKE_PROFIT_BPS || change <= -HARD_STOP_BPS || heldBars >= MAX_HOLD_BARS) {
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (qty === 0n && state.cash > 0n && batch.seq - lastSellBar >= REENTRY_COOLDOWN_BARS) {
      for (const t of TRIGGERS) {
        if (dipAndBounce(close, t.lookback, t.dropBps, t.bounceBps)) {
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      if (!everFilled && batch.seq >= FALLBACK.armSeq) {
        if (dipAndBounce(close, FALLBACK.lookback, FALLBACK.dropBps, FALLBACK.bounceBps)) {
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
    }
    return [];
  },
});
