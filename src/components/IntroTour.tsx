import { useEffect, useMemo, useRef, useState } from 'react';
import { getCardById, getCardImageUrl } from '../services/tcgdex';

/**
 * First-visit intro: a motion-video modal containing a 1:1 recreation of the
 * site. The playhead scrolls the mock page down to the market, a cursor buys
 * card #01, then a TradingView-style candlestick chart slides in beside the
 * card value - candles include natural red pullbacks.
 *
 * Performance: React renders the static tree once; a single rAF loop (with a
 * timer fallback) writes transforms / SVG attributes / textContent directly.
 * Zero React re-renders per frame.
 */

const TOTAL = 14.4;
const CLICK_AT = 4.8;
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
  const bannerRef = useRef<HTMLDivElement>(null);
  const taglineRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const buyBtnRef = useRef<HTMLButtonElement>(null);
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

  const doneRef = useRef(false);
  const boughtRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const [arts, setArts] = useState<Record<string, DemoArt>>({});
  const candles = useMemo(() => buildCandles(), []);
  const minLow = useMemo(() => Math.min(...candles.map((c) => c.low)), [candles]);
  const maxHigh = useMemo(() => Math.max(...candles.map((c) => c.high)), [candles]);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
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
    const yFor = (price: number) =>
      PAD_T + ((maxHigh - price) / (maxHigh - minLow)) * INNER_H;

    const startedAt = performance.now();
    let raf = 0;
    let interval: number | undefined;

    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDoneRef.current();
    };

    const tick = () => {
      if (doneRef.current) return;
      const t = (performance.now() - startedAt) / 1000;

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

      // the buy
      if (t >= CLICK_AT && !boughtRef.current) {
        boughtRef.current = true;
        if (badgeRef.current) badgeRef.current.style.opacity = '1';
        if (buyBtnRef.current) buyBtnRef.current.style.display = 'none';
        if (sellBtnRef.current) sellBtnRef.current.style.display = 'inline-flex';
        if (statusRef.current) statusRef.current.style.display = 'inline';
        if (balanceRef.current) balanceRef.current.textContent = '1.941 ETH';
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
        headRef.current.setAttribute('cy', yFor(shown).toFixed(1));
      }
      if (lastLineRef.current) {
        lastLineRef.current.setAttribute('y1', yFor(shown).toFixed(1));
        lastLineRef.current.setAttribute('y2', yFor(shown).toFixed(1));
      }
      if (chipGroupRef.current) {
        chipGroupRef.current.setAttribute('transform', `translate(0 ${yFor(shown).toFixed(1)})`);
      }
      if (chipRectRef.current) {
        chipRectRef.current.setAttribute('fill', shown >= c0.open ? '#16c784' : '#ea3943');
      }
      if (chipTextRef.current) chipTextRef.current.textContent = usd(shown);
      if (mcValueRef.current) mcValueRef.current.textContent = usd(shown);

      // card value tracks the chart
      const cardUsd = (shown / 5000) * 150;
      const pct = Math.round((shown / 5000 - 1) * 1000) / 10;
      if (cardValueRef.current) cardValueRef.current.textContent = usd(cardUsd);
      if (cardPctRef.current) {
        cardPctRef.current.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% SINCE MINT`;
        cardPctRef.current.style.background = pct >= 0 ? '#00bd7d' : '#ea3943';
      }

      // banner + tagline + fade out
      if (bannerRef.current) {
        bannerRef.current.style.opacity =
          t < 3.0 ? String(clamp01(t / 0.5)) : String(Math.max(0, 1 - (t - 3.0) / 0.4));
      }
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
  }, [candles, minLow, maxHigh, onDone]);

  const yFor = (price: number) =>
    PAD_T + ((maxHigh - price) / (maxHigh - minLow)) * INNER_H;

  return (
    <div ref={rootRef} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85">
      <button
        type="button"
        onClick={finish}
        className="absolute right-6 top-6 z-30 rounded-full border border-white/20 px-5 py-2 font-mono text-xs text-white/70 transition hover:border-white/60 hover:text-white"
      >
        skip intro →
      </button>

      <div
        ref={modalRef}
        className="relative w-[min(1120px,94vw)] overflow-hidden rounded-2xl border border-white/15 bg-[#050505] shadow-2xl shadow-black/80"
        style={{ height: 'min(700px, 84vh)' }}
      >
        <div className="flex items-center gap-3 border-b border-white/10 bg-[#0b0b0c] px-4 py-2.5">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((d) => (
              <span key={d} className="h-2.5 w-2.5 rounded-full bg-white/15" />
            ))}
          </div>
          <div className="mx-auto rounded-md border border-white/10 px-4 py-1 font-mono text-[11px] text-white/40">
            pokecard-lab.vercel.app
          </div>
          <span className="w-10" />
        </div>

        <div ref={viewportRef} className="relative h-[calc(100%-44px)] overflow-hidden">
          <div ref={innerRef} className="will-change-transform">
            <div className="flex items-center justify-between px-10 pt-5">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden>
                  <circle cx="16" cy="16" r="10" fill="none" stroke="#fff" strokeWidth="2" />
                  <path d="M6 16h6M20 16h6" stroke="#fff" strokeWidth="2" />
                  <circle cx="16" cy="16" r="3.2" fill="#fff" />
                </svg>
                <span className="text-sm font-semibold text-white">PokeCard Lab</span>
              </div>
              <span className="rounded-full bg-white px-4 py-2 text-[11px] font-semibold text-slate-950">
                Connect Wallet
              </span>
            </div>

            <div className="max-w-xl px-10 pt-10">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                Robinhood Chain / launching soon
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight text-white">
                Every milestone, a real Pokemon card.
              </h1>
              <p className="mt-4 text-[13px] font-light leading-relaxed text-white/50">
                The token launches on the Robinhood Chain. As market cap climbs,
                each milestone mints the next Pokemon card into the collection -
                minted once, then yours to buy, sell, or trade.
              </p>
            </div>

            <div className="px-10 pt-9">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl font-semibold text-white">
                  Buy, sell, trade
                </h2>
                <span className="font-mono text-[11px] text-white/40">
                  market cap $5,688 - POKE $0.0000
                </span>
              </div>

              <div className="mt-3 flex items-center gap-8 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 font-mono text-[11px] text-white/55">
                <span>
                  demo balance:{' '}
                  <span className="text-white" ref={balanceRef}>
                    2.000 ETH
                  </span>
                </span>
                <span>
                  your cards:{' '}
                  <span className="text-white" ref={cardsRef}>
                    0
                  </span>
                </span>
                <span className="hidden text-[#00bd7d]" ref={statusRef}>
                  Bought Charizard for 0.059 ETH
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-4">
                {DEMO_CARDS.map((demo, i) => {
                  const art = arts[demo.tcgId];
                  const isCardOne = i === 0;
                  const mine = isCardOne && boughtRef.current;
                  return (
                    <div
                      key={demo.tcgId}
                      className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      {isCardOne && (
                        <span
                          ref={badgeRef}
                          className="absolute right-2.5 top-2.5 z-10 rounded-full bg-[#00bd7d] px-2 py-0.5 font-mono text-[9px] font-bold text-slate-950 opacity-0"
                        >
                          YOURS
                        </span>
                      )}
                      <div className="overflow-hidden rounded-xl border border-white/10">
                        {art?.image ? (
                          <img
                            src={getCardImageUrl({ image: art.image })}
                            alt={art.name ?? demo.tcgId}
                            className="aspect-[245/342] w-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <div className="aspect-[245/342] w-full animate-pulse bg-white/[0.04]" />
                        )}
                      </div>
                      <p className="mt-2 truncate text-xs font-semibold text-white">
                        {art?.name ?? '...'}
                      </p>
                      <p className="font-mono text-[10px] text-white/40">
                        owner: {mine ? 'You' : i === 1 ? 'Trader 1' : i === 2 ? 'Trader 2' : 'Treasury'}
                      </p>
                      <p className="mt-1 font-mono text-xs text-white">
                        {(0.059 * (demo.launch / 5000)).toFixed(3)} ETH
                      </p>
                      <div className="mt-2 flex gap-2">
                        {isCardOne ? (
                          <>
                            <span
                              ref={buyBtnRef}
                              data-demo-buy
                              className="inline-flex cursor-pointer items-center rounded-full bg-white px-4 py-1.5 text-[10px] font-semibold text-slate-950"
                            >
                              Buy
                            </span>
                            <span
                              ref={sellBtnRef}
                              className="hidden items-center rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-semibold text-white"
                            >
                              Sell
                            </span>
                          </>
                        ) : (
                          <span className="inline-flex cursor-pointer items-center rounded-full bg-white px-4 py-1.5 text-[10px] font-semibold text-slate-950 opacity-70">
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

          {/* cursor */}
          <div
            ref={cursorRef}
            className="pointer-events-none absolute left-0 top-0 z-30 opacity-0"
          >
            <svg width={26} height={26} viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.85))' }}>
              <path d="M4 2l16 12-7 1 4 7-3 1-4-7-6 5z" fill="#fff" stroke="#050505" strokeWidth={1.5} />
            </svg>
          </div>
        </div>

        {/* chart + card value */}
        <div
          ref={chartRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 top-10 z-20 flex items-center justify-center gap-4 bg-[#050505] opacity-0"
        >
          <div className="rounded-2xl border border-white/10 bg-[#0b0e13] p-4">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">
                POKE market cap - Robinhood Chain
              </span>
              <span className="font-mono text-sm text-white" ref={mcValueRef}>
                $5,000
              </span>
            </div>
            <svg width={CHART_W} height={CHART_H}>
              <defs>
                <clipPath id="introCandleClip">
                  <rect ref={clipRectRef} x={PAD_L} y={0} width={0} height={CHART_H} />
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
                  const color = up ? '#16c784' : '#ea3943';
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
                y1={yFor(candles[0].close)}
                y2={yFor(candles[0].close)}
                stroke="rgba(255,255,255,0.25)"
                strokeDasharray="4 4"
              />
              <g ref={chipGroupRef}>
                <rect ref={chipRectRef} x={CHART_W - PAD_R + 6} y={-10} width={76} height={20} rx={4} fill="#16c784" />
                <text
                  ref={chipTextRef}
                  x={CHART_W - PAD_R + 44}
                  y={4}
                  textAnchor="middle"
                  fontSize={11}
                  fontFamily="monospace"
                  fill="#050505"
                >
                  $5,000
                </text>
              </g>
              {[0, 8, 16, 24, 32, 40, 47].map((i) => (
                <text
                  key={i}
                  x={PAD_L + i * SLOT + SLOT / 2}
                  y={CHART_H - 12}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="monospace"
                  fill="rgba(255,255,255,0.35)"
                >
                  {timeLabel(i)}
                </text>
              ))}
            </svg>
          </div>

          <div className="w-[280px] rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">
              Card #01 value
            </p>
            {arts['base1-4']?.image && (
              <img
                src={getCardImageUrl({ image: arts['base1-4'].image })}
                alt="card"
                className="mx-auto mt-4 w-32 rounded-lg border border-white/15"
                draggable={false}
              />
            )}
            <p className="mt-4 font-display text-3xl font-semibold text-white" ref={cardValueRef}>
              $150
            </p>
            <span
              className="mt-3 inline-block rounded-full px-3 py-1 font-mono text-xs font-bold text-slate-950"
              ref={cardPctRef}
            >
              +0.0% SINCE MINT
            </span>
            <p className="mt-4 font-mono text-[11px] leading-relaxed text-white/40">
              your card tracks the chart, up and down
            </p>
          </div>
        </div>

        {/* tagline */}
        <div
          ref={taglineRef}
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/70 opacity-0"
        >
          <div className="text-center">
            <p className="font-display text-5xl font-semibold text-white">
              Every milestone, a real Pokemon card.
            </p>
            <p className="mt-4 font-mono text-sm tracking-[0.22em] text-[#00bd7d]">
              THE COLLECTION IS YOURS
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
