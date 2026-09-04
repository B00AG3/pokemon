import { useEffect, useMemo, useRef, useState } from 'react';
import { getCardById, getCardImageUrl } from '../services/tcgdex';

/**
 * First-visit intro: a screencast-style modal containing a 1:1 recreation of
 * the site. The playhead scrolls the mock page down to the market, a cursor
 * enters the draw for card #01, then a candlestick chart slides in beside the
 * card value - candles include natural red pullbacks.
 *
 * Responsive: below lg the chart panel and value panel stack (chart on top,
 * value panel below) inside a scrollable overlay; the chart SVG keeps its
 * 620x340 viewBox and scales with width 100%.
 *
 * Motion: a single rAF loop (with a timer fallback) drives the playhead and
 * can be paused and resumed from the modal chrome. The loop accumulates
 * elapsed time in fixed steps, so pausing freezes every track cleanly. When
 * the user prefers reduced motion the loop never starts: the final storyboard
 * frame (cap crossed, card won) renders statically with a caption.
 *
 * Skin: committed "Exchange board" tokens - canvas #070708, panel #0d0d0f,
 * hairline borders, Oswald display / Archivo body / JetBrains Mono numbers,
 * semantic green #00bd7d and red #f87171 only, 3px controls, 6px card media.
 * Component-scoped styles are prefixed tour- and live in TOUR_CSS so this
 * file stays self-contained.
 *
 * Performance: React renders the static tree once; the rAF loop writes
 * transforms / SVG attributes / textContent directly. Zero React re-renders
 * per frame.
 */

const TOTAL = 14.4;
const CLICK_AT = 4.8;
const AIRDROP_AT = 9.2;
const CHART_AT = 5.6;
const CANDLE_SPAN = 5.4;
const CANDLE_COUNT = 48;

const CHART_W = 620;
const CHART_H = 330;
const PAD_L = 12;
const PAD_R = 84;
const PAD_T = 18;
const PAD_B = 34;
const INNER_W = CHART_W - PAD_L - PAD_R;
const INNER_H = CHART_H - PAD_T - PAD_B;
const SLOT = INNER_W / CANDLE_COUNT;
const BODY_W = SLOT * 0.55;

const GREEN = '#00bd7d';
const RED = '#f87171';

const TOUR_CSS = `
.tour-btn{display:inline-flex;align-items:center;justify-content:center;border-radius:3px;padding:0 14px;height:32px;font-family:var(--font-mono,ui-monospace,monospace);font-size:11px;font-weight:600;letter-spacing:0.02em;line-height:1;cursor:pointer;transition:border-color 200ms ease-out,color 200ms ease-out}
.tour-btn:focus-visible{outline:2px solid #00bd7d;outline-offset:2px}
.tour-btn-primary{background:#f2f2f0;border:1px solid #f2f2f0;color:#070708}
.tour-btn-primary:hover{border-color:rgba(255,255,255,0.65)}
.tour-btn-ghost{background:transparent;border:1px solid rgba(255,255,255,0.16);color:rgba(255,255,255,0.6)}
.tour-btn-ghost:hover{border-color:rgba(255,255,255,0.4);color:#f2f2f0}
.tour-btn-sm{height:26px;padding:0 10px;font-size:10px;letter-spacing:0.02em}
`;

interface Candle {
  open: number;
  close: number;
  high: number;
  low: number;
}

function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uptrend with two natural pullbacks - red candles are part of the story. */
function buildCandles(): Candle[] {
  const rand = mulberry32(20260902);
  const out: Candle[] = [];
  let price = 5000;
  for (let i = 0; i < CANDLE_COUNT; i++) {
    const pullback = (i >= 16 && i <= 20) || (i >= 33 && i <= 36);
    const drift = pullback ? -0.0042 : 0.0052;
    const open = price;
    const close = open * (1 + drift + (rand() - 0.5) * 0.006);
    const high = Math.max(open, close) * (1 + rand() * 0.0026);
    const low = Math.min(open, close) * (1 - rand() * 0.0026);
    out.push({ open, close, high, low });
    price = close;
  }
  return out;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const usd = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;

const DEMO_CARDS = [
  { tcgId: 'base1-4', launch: 5000 },
  { tcgId: 'base1-2', launch: 10000 },
  { tcgId: 'base1-1', launch: 25000 },
];

/** Card #01 anchors the story: its launch cap drives every derived value. */
const LAUNCH_CAP = DEMO_CARDS[0].launch;
const CARD_ONE_BASE_VALUE = 150;

interface DemoArt {
  name: string;
  image?: string;
}

function timeLabel(i: number) {
  const minutes = 9 * 60 + i * 5;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export default function IntroTour({ onDone }: { onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const buyBtnRef = useRef<HTMLSpanElement>(null);
  const sellBtnRef = useRef<HTMLSpanElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const balanceRef = useRef<HTMLSpanElement>(null);
  const cardsRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const clipRectRef = useRef<SVGRectElement>(null);
  const headRef = useRef<SVGCircleElement>(null);
  const lastLineRef = useRef<SVGLineElement>(null);
  const chipGroupRef = useRef<SVGGElement>(null);
  const chipRectRef = useRef<SVGRectElement>(null);
  const chipTextRef = useRef<SVGTextElement>(null);
  const mcValueRef = useRef<HTMLSpanElement>(null);
  const cardValueRef = useRef<HTMLParagraphElement>(null);
  const cardPctRef = useRef<HTMLSpanElement>(null);
  const taglineRef = useRef<HTMLDivElement>(null);

  const doneRef = useRef(false);
  const enteredRef = useRef(false);
  const airdroppedRef = useRef(false);
  const pausedRef = useRef(false);
  const onDoneRef = useRef(onDone);

  const [arts, setArts] = useState<Record<string, DemoArt>>({});
  const [paused, setPaused] = useState(false);
  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const artsRef = useRef(arts);

  // keep the imperative animation loop reading fresh art without re-render
  // churn; refs update in effects, never during render
  useEffect(() => {
    onDoneRef.current = onDone;
    artsRef.current = arts;
  }, [onDone, arts]);

  const candles = useMemo(() => buildCandles(), []);
  const minLow = useMemo(() => Math.min(...candles.map((c) => c.low)), [candles]);
  const maxHigh = useMemo(() => Math.max(...candles.map((c) => c.high)), [candles]);

  // Final storyboard values, used for the static reduced-motion frame.
  const finalShown = candles[CANDLE_COUNT - 1].close;
  const finalCardUsd = (finalShown / LAUNCH_CAP) * CARD_ONE_BASE_VALUE;
  const finalPct = Math.round((finalShown / LAUNCH_CAP - 1) * 1000) / 10;
  const finalUp = finalPct >= 0;
  const cardOneName = arts[DEMO_CARDS[0].tcgId]?.name ?? 'Charizard';

  const yFor = (price: number) =>
    PAD_T + ((maxHigh - price) / (maxHigh - minLow)) * INNER_H;

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  };

  const togglePause = () => {
    if (doneRef.current || reduced) return;
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
  };

  useEffect(() => {
    let alive = true;
    Promise.all(
      DEMO_CARDS.map((card) => getCardById(card.tcgId).catch(() => null)),
    ).then((results) => {
      if (!alive) return;
      const map: Record<string, DemoArt> = {};
      results.forEach((card, i) => {
        if (card) map[DEMO_CARDS[i].tcgId] = { name: card.name, image: card.image };
      });
      setArts(map);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (reduced) return;

    const yForLocal = (price: number) =>
      PAD_T + ((maxHigh - price) / (maxHigh - minLow)) * INNER_H;

    // Wall-clock accumulation with per-step clamping: pausing freezes the
    // playhead, and background-tab time jumps never skip the story ahead.
    let elapsed = 0;
    let last = performance.now();
    let raf = 0;
    let interval: number | undefined;

    const tick = () => {
      if (doneRef.current) return;
      const now = performance.now();
      const step = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) elapsed += step;
      const t = elapsed;

      // mock scroll
      const scrollP = easeInOut(clamp01((t - 2.0) / 1.6));
      if (innerRef.current && viewportRef.current) {
        const max = Math.max(0, innerRef.current.scrollHeight - viewportRef.current.clientHeight);
        innerRef.current.style.transform = `translateY(${-scrollP * max}px)`;
      }

      // cursor glide to buy
      const glideP = easeInOut(clamp01((t - 3.6) / 1.2));
      if (cursorRef.current && viewportRef.current && buyBtnRef.current) {
        const v = viewportRef.current.getBoundingClientRect();
        const b = buyBtnRef.current.getBoundingClientRect();
        const ix = v.width * 0.74;
        const iy = v.height * 0.3 + Math.sin(t * 3) * 5;
        const bx = b.x - v.left + b.width * 0.4;
        const by = b.y - v.top + b.height / 2;
        cursorRef.current.style.transform = `translate3d(${(ix * (1 - glideP) + bx * glideP).toFixed(1)}px, ${(iy * (1 - glideP) + by * glideP).toFixed(1)}px, 0)`;
        cursorRef.current.style.opacity = t >= CHART_AT ? '0' : '1';
      }

      // the click: enter the draw
      if (t >= CLICK_AT && !enteredRef.current) {
        enteredRef.current = true;
        if (statusRef.current) {
          statusRef.current.style.display = 'inline';
          statusRef.current.textContent = 'You entered the draw - free';
        }
      }

      // the airdrop: the cap crossed and the card lands, free
      if (t >= AIRDROP_AT && !airdroppedRef.current) {
        airdroppedRef.current = true;
        const wonName = artsRef.current[DEMO_CARDS[0].tcgId]?.name ?? 'Charizard';
        if (badgeRef.current) badgeRef.current.style.opacity = '1';
        if (buyBtnRef.current) buyBtnRef.current.style.display = 'none';
        if (sellBtnRef.current) sellBtnRef.current.style.display = 'inline-flex';
        if (statusRef.current)
          statusRef.current.textContent = `Airdrop won: ${wonName}, 0 ETH`;
        if (cardsRef.current) cardsRef.current.textContent = '1';
      }

      // chart panel slide-in
      const chartO = clamp01((t - CHART_AT) / 0.5);
      if (chartRef.current) {
        chartRef.current.style.opacity = String(chartO);
        chartRef.current.style.transform = `translateY(${((1 - chartO) * 24).toFixed(1)}px)`;
      }

      // candle reveal + live values
      const candleFloat = clamp01((t - (CHART_AT + 0.3)) / CANDLE_SPAN) * CANDLE_COUNT;
      const idx = Math.min(CANDLE_COUNT - 1, Math.floor(candleFloat));
      const frac = candleFloat - idx;
      const c0 = candles[idx];
      const shown = c0.open + (c0.close - c0.open) * frac;
      const revealX = PAD_L + candleFloat * SLOT + SLOT / 2;

      if (clipRectRef.current) clipRectRef.current.setAttribute('width', revealX.toFixed(1));
      if (headRef.current) {
        headRef.current.setAttribute('cx', revealX.toFixed(1));
        headRef.current.setAttribute('cy', yForLocal(shown).toFixed(1));
      }
      if (lastLineRef.current) {
        lastLineRef.current.setAttribute('y1', yForLocal(shown).toFixed(1));
        lastLineRef.current.setAttribute('y2', yForLocal(shown).toFixed(1));
      }
      if (chipGroupRef.current) {
        chipGroupRef.current.setAttribute('transform', `translate(0 ${yForLocal(shown).toFixed(1)})`);
      }
      if (chipRectRef.current) {
        chipRectRef.current.setAttribute('fill', shown >= c0.open ? GREEN : RED);
      }
      if (chipTextRef.current) chipTextRef.current.textContent = usd(shown);
      if (mcValueRef.current) mcValueRef.current.textContent = usd(shown);

      // card value tracks the chart
      const cardUsd = (shown / LAUNCH_CAP) * CARD_ONE_BASE_VALUE;
      const pct = Math.round((shown / LAUNCH_CAP - 1) * 1000) / 10;
      if (cardValueRef.current) cardValueRef.current.textContent = usd(cardUsd);
      if (cardPctRef.current) {
        cardPctRef.current.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% since airdrop`;
        cardPctRef.current.style.background = pct >= 0 ? GREEN : RED;
        cardPctRef.current.style.color = pct >= 0 ? '#04120c' : '#1c0909';
      }

      // tagline + fade out
      if (taglineRef.current) {
        taglineRef.current.style.opacity = String(clamp01((t - 11.5) / 0.8));
      }
      if (rootRef.current) {
        rootRef.current.style.opacity = t > TOTAL - 0.8 ? String(clamp01((TOTAL - t) / 0.8)) : '1';
      }

      if (t >= TOTAL) finish();
    };

    raf = window.requestAnimationFrame(function loop() {
      tick();
      if (!doneRef.current) raf = window.requestAnimationFrame(loop);
    });
    interval = window.setInterval(() => tick(), 80);

    return () => {
      window.cancelAnimationFrame(raf);
      if (interval !== undefined) window.clearInterval(interval);
    };
    // onDone arrives through onDoneRef so the animation never restarts when
    // the parent re-renders (the demo ticker re-renders Home every few seconds)
  }, [reduced, candles, minLow, maxHigh]);

  const firstOpenY = yFor(candles[0].open);
  const finalY = yFor(finalShown);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(7, 7, 8, 0.92)' }}
    >
      <style>{TOUR_CSS}</style>

      <div
        ref={modalRef}
        className="relative flex w-[min(1120px,94vw)] flex-col overflow-hidden rounded-[4px] border border-white/[0.09] bg-[#070708]"
        style={{ height: 'min(700px, 84vh)' }}
      >
        {/* fake browser chrome, token palette */}
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-white/[0.09] bg-[#0d0d0f] px-3">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((d) => (
              <span key={d} className="h-2.5 w-2.5 rounded-full bg-white/[0.16]" />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[280px] truncate rounded-[3px] border border-white/[0.09] px-3 py-1 text-center font-mono text-[11px] text-white/40">
              pokecard-lab.vercel.app
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!reduced && (
              <button
                type="button"
                className="tour-btn tour-btn-ghost tour-btn-sm"
                onClick={togglePause}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
            )}
            <button
              type="button"
              className="tour-btn tour-btn-ghost tour-btn-sm"
              onClick={finish}
            >
              {reduced ? 'Close' : 'Skip intro'}
            </button>
          </div>
        </div>

        <div ref={viewportRef} className="relative flex-1 overflow-hidden">
          <div ref={innerRef} className="will-change-transform">
            <div className="flex items-center justify-between px-4 pt-4 sm:px-6 lg:px-10 lg:pt-5">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden>
                  <circle cx="16" cy="16" r="10" fill="none" stroke="#f2f2f0" strokeWidth="2" />
                  <path d="M6 16h6M20 16h6" stroke="#f2f2f0" strokeWidth="2" />
                  <circle cx="16" cy="16" r="3.2" fill="#f2f2f0" />
                </svg>
                <span className="text-sm font-semibold text-[#f2f2f0]">PokeCard Lab</span>
              </div>
              <span className="tour-btn tour-btn-primary tour-btn-sm">Connect Wallet</span>
            </div>

            <div className="max-w-xl px-4 pt-8 sm:px-6 lg:px-10 lg:pt-10">
              <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-[#f2f2f0] sm:text-4xl">
                Every milestone airdrops a real Pokemon card.
              </h1>
              <p className="mt-4 text-[13px] leading-relaxed text-white/60">
                POKE launches on the Robinhood Chain. At each market-cap
                milestone, the contract airdrops one real card to a drawn
                holder - free, exactly once.
              </p>
            </div>

            <div className="px-4 pt-8 sm:px-6 lg:px-10 lg:pt-9">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 className="font-display text-xl font-semibold tracking-tight text-[#f2f2f0] sm:text-2xl">
                  Buy, sell, trade
                </h2>
                <span className="font-mono text-[10px] text-white/40 sm:text-[11px]">
                  market cap $5,688 - POKE $0.0000
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-[4px] border border-white/[0.09] bg-[#0d0d0f] px-4 py-2.5 font-mono text-[11px] text-white/60">
                <span>
                  demo balance:{' '}
                  <span className="text-[#f2f2f0]" ref={balanceRef}>
                    2.000 ETH
                  </span>
                </span>
                <span>
                  your cards:{' '}
                  <span className="text-[#f2f2f0]" ref={cardsRef}>
                    {reduced ? '1' : '0'}
                  </span>
                </span>
                <span ref={statusRef} className="text-[#00bd7d]" style={{ display: reduced ? 'inline' : 'none' }}>
                  {reduced ? `Airdrop won: ${cardOneName}, 0 ETH` : 'You entered the draw - free'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 lg:gap-4">
                {DEMO_CARDS.map((demo, i) => {
                  const art = arts[demo.tcgId];
                  const isCardOne = i === 0;
                  return (
                    <div
                      key={demo.tcgId}
                      className="relative rounded-[4px] border border-white/[0.09] bg-[#0d0d0f] p-3"
                    >
                      {isCardOne && (
                        <span
                          ref={badgeRef}
                          className="absolute right-2.5 top-2.5 z-10 rounded-[2px] bg-[#00bd7d] px-2 py-0.5 font-mono text-[9px] font-bold text-[#04120c]"
                          style={{ opacity: reduced ? 1 : 0 }}
                        >
                          Airdropped
                        </span>
                      )}
                      <div className="overflow-hidden rounded-[6px] border border-white/[0.14]">
                        {art?.image ? (
                          <img
                            src={getCardImageUrl({ image: art.image })}
                            alt={art.name ?? demo.tcgId}
                            className="aspect-[245/342] w-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <div className="aspect-[245/342] w-full bg-white/[0.04]" />
                        )}
                      </div>
                      <p className="mt-2 truncate text-xs font-semibold text-[#f2f2f0]">
                        {art?.name ?? '...'}
                      </p>
                      <p className="font-mono text-[10px] text-white/40">
                        owner:{' '}
                        {isCardOne
                          ? reduced
                            ? 'You'
                            : 'draw open'
                          : i === 1
                            ? 'Trader 1'
                            : 'Trader 2'}
                      </p>
                      <p className="mt-1 font-mono text-xs text-[#f2f2f0]">
                        {isCardOne
                          ? 'Free'
                          : `${(0.059 * (demo.launch / LAUNCH_CAP)).toFixed(3)} ETH`}
                      </p>
                      <div className="mt-2 flex gap-2">
                        {isCardOne ? (
                          <>
                            <span
                              ref={buyBtnRef}
                              data-demo-buy
                              className="tour-btn tour-btn-primary tour-btn-sm"
                              style={{ display: reduced ? 'none' : undefined }}
                            >
                              Enter draw
                            </span>
                            <span
                              ref={sellBtnRef}
                              className="tour-btn tour-btn-ghost tour-btn-sm"
                              style={{ display: reduced ? 'inline-flex' : 'none' }}
                            >
                              Sell
                            </span>
                          </>
                        ) : (
                          <span className="tour-btn tour-btn-primary tour-btn-sm opacity-60">
                            Buy
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="h-16" />
          </div>

          {/* screencast cursor */}
          <div
            ref={cursorRef}
            className="pointer-events-none absolute left-0 top-0 z-30 opacity-0"
          >
            <svg width={26} height={26} viewBox="0 0 24 24">
              <path
                d="M4 2l16 12-7 1 4 7-3 1-4-7-6 5z"
                fill="#f2f2f0"
                stroke="#070708"
                strokeWidth={1.5}
              />
            </svg>
          </div>
        </div>

        {/* chart + card value: stacks below lg (chart on top), row above */}
        <div
          ref={chartRef}
          className="absolute inset-x-0 bottom-0 top-10 z-20 flex overflow-y-auto bg-[#070708]"
          style={{ opacity: reduced ? 1 : 0 }}
        >
          <div className="m-auto flex w-full max-w-[960px] flex-col items-center gap-3 p-3 sm:p-4 lg:flex-row lg:justify-center lg:gap-4">
            <div className="w-full max-w-[620px] rounded-[4px] border border-white/[0.09] bg-[#0d0d0f] p-3 lg:min-w-0 lg:flex-1 lg:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
                <span className="font-mono text-[10px] tracking-[0.08em] text-white/40">
                  POKE market cap - Robinhood Chain
                </span>
                <span className="font-mono text-sm text-[#f2f2f0]" ref={mcValueRef}>
                  {reduced ? usd(finalShown) : '$5,000'}
                </span>
              </div>
              <svg
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                preserveAspectRatio="xMidYMid meet"
                style={{
                  display: 'block',
                  width: '100%',
                  height: 'auto',
                  aspectRatio: `${CHART_W} / ${CHART_H}`,
                }}
                role="img"
                aria-label="POKE market cap chart"
              >
                <defs>
                  <clipPath id="introCandleClip">
                    <rect
                      ref={clipRectRef}
                      x={PAD_L}
                      y={0}
                      width={reduced ? CHART_W : 0}
                      height={CHART_H}
                    />
                  </clipPath>
                </defs>
                {[0.2, 0.4, 0.6, 0.8].map((g) => (
                  <line
                    key={g}
                    x1={PAD_L}
                    x2={CHART_W - PAD_R}
                    y1={PAD_T + INNER_H * g}
                    y2={PAD_T + INNER_H * g}
                    stroke="rgba(255,255,255,0.06)"
                  />
                ))}
                <g clipPath="url(#introCandleClip)">
                  {candles.map((c, i) => {
                    const x = PAD_L + i * SLOT + SLOT / 2;
                    const up = c.close >= c.open;
                    const color = up ? GREEN : RED;
                    const top = yFor(Math.max(c.open, c.close));
                    const bottom = yFor(Math.min(c.open, c.close));
                    return (
                      <g key={i}>
                        <line x1={x} x2={x} y1={yFor(c.high)} y2={yFor(c.low)} stroke={color} strokeWidth={1} />
                        <rect
                          x={x - BODY_W / 2}
                          y={top}
                          width={BODY_W}
                          height={Math.max(1, bottom - top)}
                          fill={color}
                        />
                      </g>
                    );
                  })}
                </g>
                <line
                  ref={lastLineRef}
                  x1={PAD_L}
                  x2={CHART_W - PAD_R}
                  y1={reduced ? finalY : yFor(candles[0].close)}
                  y2={reduced ? finalY : yFor(candles[0].close)}
                  stroke="rgba(255,255,255,0.25)"
                  strokeDasharray="4 4"
                />
                <circle
                  ref={headRef}
                  r={3.5}
                  fill={GREEN}
                  cx={reduced ? PAD_L + (CANDLE_COUNT - 1) * SLOT + SLOT / 2 : PAD_L + SLOT / 2}
                  cy={reduced ? finalY : firstOpenY}
                />
                <g
                  ref={chipGroupRef}
                  transform={`translate(0 ${(reduced ? finalY : firstOpenY).toFixed(1)})`}
                >
                  <rect
                    ref={chipRectRef}
                    x={CHART_W - PAD_R + 6}
                    y={-10}
                    width={76}
                    height={20}
                    rx={2}
                    fill={GREEN}
                  />
                  <text
                    ref={chipTextRef}
                    x={CHART_W - PAD_R + 44}
                    y={4}
                    textAnchor="middle"
                    fontSize={11}
                    className="font-mono"
                    fill="#04120c"
                  >
                    {reduced ? usd(finalShown) : usd(candles[0].open)}
                  </text>
                </g>
                {[0, 8, 16, 24, 32, 40, 47].map((i) => (
                  <text
                    key={i}
                    x={PAD_L + i * SLOT + SLOT / 2}
                    y={CHART_H - 12}
                    textAnchor="middle"
                    fontSize={10}
                    className="font-mono"
                    fill="rgba(255,255,255,0.4)"
                  >
                    {timeLabel(i)}
                  </text>
                ))}
              </svg>
            </div>

            <div className="w-full rounded-[4px] border border-white/[0.09] bg-[#0d0d0f] p-4 text-center lg:w-[280px] lg:shrink-0 lg:p-6">
              <p className="font-mono text-[10px] tracking-[0.08em] text-white/40">
                Card #01 value
              </p>
              {arts[DEMO_CARDS[0].tcgId]?.image && (
                <img
                  src={getCardImageUrl({ image: arts[DEMO_CARDS[0].tcgId].image })}
                  alt={cardOneName}
                  className="mx-auto mt-4 w-24 rounded-[6px] border border-white/[0.14] lg:w-32"
                  draggable={false}
                />
              )}
              <p className="mt-4 font-mono text-3xl font-semibold text-[#f2f2f0]" ref={cardValueRef}>
                {reduced ? usd(finalCardUsd) : '$150'}
              </p>
              <span
                className="mt-3 inline-block rounded-[2px] px-3 py-1 font-mono text-[11px] font-semibold"
                style={{
                  background: finalUp ? GREEN : RED,
                  color: finalUp ? '#04120c' : '#1c0909',
                }}
                ref={cardPctRef}
              >
                {reduced
                  ? `${finalUp ? '+' : ''}${finalPct.toFixed(1)}% since airdrop`
                  : '+0.0% since airdrop'}
              </span>
              <p className="mt-4 font-mono text-[11px] leading-relaxed text-white/60">
                your card tracks the chart, up and down
              </p>
            </div>

            {reduced && (
              <div className="max-w-[560px] text-center">
                <p className="font-mono text-[11px] leading-relaxed text-white/60">
                  Milestone crossed at {usd(finalShown)} - {cardOneName}{' '}
                  airdropped to a drawn holder for free.
                </p>
                <button type="button" className="tour-btn tour-btn-ghost mt-4" onClick={finish}>
                  Got it
                </button>
              </div>
            )}
          </div>
        </div>

        {/* tagline */}
        {!reduced && (
          <div
            ref={taglineRef}
            className="pointer-events-none absolute inset-x-0 bottom-0 top-10 z-30 flex items-center justify-center bg-[#070708]/85 opacity-0"
          >
            <div className="px-6 text-center">
              <p className="font-display text-3xl font-semibold leading-tight tracking-tight text-[#f2f2f0] sm:text-4xl md:text-5xl">
                Every milestone airdrops a real Pokemon card.
              </p>
              <p className="mt-4 font-mono text-xs tracking-[0.12em] text-[#00bd7d] sm:text-sm">
                The collection is yours.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
