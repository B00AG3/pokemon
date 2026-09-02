import { useEffect, useMemo, useRef, useState } from 'react';
import { getCardById, getCardImageUrl } from '../services/tcgdex';

/**
 * First-visit intro: a motion-video modal containing a 1:1 recreation of the
 * site. The playhead scrolls the mock page down to the market, a cursor buys
 * card #01, then a TradingView-style candlestick chart slides in beside the
 * card value - candles include natural red pullbacks, not just green.
 * Nothing touches the real site: it is a scripted animation with a skip.
 */

const TOTAL = 14.4;
const SCROLL = [2.0, 3.6] as const;
const GLIDE = [3.6, 4.8] as const;
const CLICK_AT = 4.8;
const CHART_AT = 5.6;
const CANDLE_SPAN = 5.4;
const CANDLE_COUNT = 48;

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
  { tcgId: 'base1-4', launch: 5000, no: '01' },
  { tcgId: 'base1-2', launch: 10000, no: '02' },
  { tcgId: 'base1-1', launch: 25000, no: '03' },
];

export default function IntroTour({ onDone }: { onDone: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [arts, setArts] = useState<Record<string, { name: string; image?: string }>>({});
  const modalRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const buyRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(false);

  const candles = useMemo(buildCandles, []);

  useEffect(() => {
    let alive = true;
    Promise.all(
      DEMO_CARDS.map((card) => getCardById(card.tcgId).catch(() => null)),
    ).then((results) => {
      if (!alive) return;
      const map: Record<string, { name: string; image?: string }> = {};
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
    // rAF drives the animation while visible; a timer fallback keeps the
    // timeline moving if the tab is backgrounded and rAF gets throttled
    const startedAt = performance.now();
    let raf = 0;
    let interval: number | undefined;
    const tick = () => {
      const t = (performance.now() - startedAt) / 1000;
      setElapsed((prev) => (t > prev ? t : prev));
    };
    raf = requestAnimationFrame(tick);
    interval = window.setInterval(tick, 80);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (elapsed >= TOTAL && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [elapsed, onDone]);

  const bought = elapsed >= CLICK_AT;
  const modalIn = clamp01(elapsed / 0.5);
  const scrollP = easeInOut(clamp01((elapsed - SCROLL[0]) / (SCROLL[1] - SCROLL[0])));
  const glideP = easeInOut(clamp01((elapsed - GLIDE[0]) / (GLIDE[1] - GLIDE[0])));
  const chartIn = clamp01((elapsed - CHART_AT) / 0.5);
  const candleFloat = clamp01((elapsed - (CHART_AT + 0.3)) / CANDLE_SPAN);
  const tourFade = elapsed < TOTAL - 0.8 ? 1 : clamp01((TOTAL - elapsed) / 0.8);

  const clickFlash = elapsed >= CLICK_AT && elapsed < CLICK_AT + 0.5;

  // mock scroll + cursor geometry (site-viewport-relative: the cursor div
  // lives inside viewportRef, below the browser chrome)
  let cursor = { x: 0, y: 0 };
  if (viewportRef.current) {
    const v = viewportRef.current.getBoundingClientRect();
    if (elapsed < GLIDE[0]) {
      cursor = { x: v.width * 0.74, y: v.height * 0.3 + Math.sin(elapsed * 3) * 5 };
    } else if (buyRef.current) {
      const b = buyRef.current.getBoundingClientRect();
      const bx = b.x - v.left + b.width * 0.4;
      const by = b.y - v.top + b.height / 2;
      const ix = v.width * 0.74;
      const iy = v.height * 0.3;
      cursor = {
        x: ix * (1 - glideP) + bx * glideP,
        y: iy * (1 - glideP) + by * glideP,
      };
    }
  }

  // scroll the mock to its maximum so the Buy buttons are fully in view
  const scrollMax =
    innerRef.current && viewportRef.current
      ? Math.max(0, innerRef.current.scrollHeight - viewportRef.current.clientHeight)
      : 430;
  const scrollY = scrollP * scrollMax;

  // candle rendering values
  const chartW = 620;
  const chartH = 330;
  const padL = 12;
  const padR = 84;
  const padT = 18;
  const padB = 34;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;
  const slot = innerW / CANDLE_COUNT;
  const bodyW = slot * 0.55;
  const minLow = Math.min(...candles.map((c) => c.low));
  const maxHigh = Math.max(...candles.map((c) => c.high));
  const yOf = (price: number) => padT + ((maxHigh - price) / (maxHigh - minLow)) * innerH;

  const visible = Math.min(CANDLE_COUNT, Math.floor(candleFloat * CANDLE_COUNT) + 1);
  const frac = candleFloat * CANDLE_COUNT - Math.floor(candleFloat * CANDLE_COUNT);
  const lastVisible = candles[visible - 1];
  const formingClose =
    lastVisible && frac > 0
      ? lastVisible.open + (lastVisible.close - lastVisible.open) * frac
      : lastVisible?.close ?? 5000;
  const shownClose = lastVisible ? (frac > 0 ? formingClose : lastVisible.close) : 5000;

  const timeLabel = (i: number) => {
    const minutes = 9 * 60 + i * 5;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  };

  const balance = bought ? 1.941 : 2.0;
  const myCards = bought ? 1 : 0;
  const cardUsd = (shownClose / 5000) * 150;
  const cardPct = Math.round(((shownClose / 5000 - 1) * 100) * 10) / 10;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85" style={{ opacity: tourFade }}>
      {/* skip */}
      <button
        type="button"
        onClick={() => {
          if (!doneRef.current) {
            doneRef.current = true;
            onDone();
          }
        }}
        className="absolute right-6 top-6 z-30 rounded-full border border-white/20 px-5 py-2 font-mono text-xs text-white/70 transition hover:border-white/60 hover:text-white"
      >
        skip intro →
      </button>

      {/* the "browser" modal - 1:1 recreation of the site */}
      <div
        ref={modalRef}
        className="relative w-[min(1120px,94vw)] overflow-hidden rounded-2xl border border-white/15 bg-[#050505] shadow-2xl shadow-black/80"
        style={{
          height: 'min(700px, 84vh)',
          opacity: modalIn,
          transform: `scale(${0.94 + modalIn * 0.06})`,
        }}
      >
        {/* browser chrome */}
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

        {/* site viewport */}
        <div ref={viewportRef} className="relative h-[calc(100%-44px)] overflow-hidden">
          <div
            ref={innerRef}
            className="will-change-transform"
            style={{ transform: `translateY(${-scrollY}px)` }}
          >
            {/* nav */}
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

            {/* hero */}
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

            {/* demo market */}
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
                  demo balance: <span className="text-white">{balance.toFixed(3)} ETH</span>
                </span>
                <span>
                  your cards: <span className="text-white">{myCards}</span>
                </span>
                {bought && <span className="text-[#00bd7d]">Bought Charizard for 0.059 ETH</span>}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-4">
                {DEMO_CARDS.map((demo, i) => {
                  const art = arts[demo.tcgId];
                  const isCardOne = i === 0;
                  const mine = isCardOne && bought;
                  const price = 0.05 * (5868 / demo.launch);
                  return (
                    <div
                      key={demo.tcgId}
                      className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      {mine && (
                        <span className="absolute right-2.5 top-2.5 z-10 rounded-full bg-[#00bd7d] px-2 py-0.5 font-mono text-[9px] font-bold text-slate-950">
                          YOURS
                        </span>
                      )}
                      <div className="overflow-hidden rounded-xl border border-white/10">
                        {art?.image ? (
                          <img
                            src={getCardImageUrl({ image: art.image })}
                            alt={art.name}
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
                        {(price * 0.985).toFixed(3)} ETH
                      </p>
                      <div className="mt-2 flex gap-2">
                        {mine ? (
                          <span className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-semibold text-white">
                            Sell
                          </span>
                        ) : (
                          isCardOne && (
                            <button
                              ref={i === 0 ? buyRef : undefined}
                              data-demo-buy
                              type="button"
                              className="rounded-full bg-white px-4 py-1.5 text-[10px] font-semibold text-slate-950"
                            >
                              Buy
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="h-16" />
          </div>

          {/* click ripple */}
          {clickFlash && cursor.x > 0 && (
            <div
              className="pointer-events-none absolute z-30 rounded-full border-2 border-[#00bd7d]"
              style={{ left: cursor.x, top: cursor.y, width: 44, height: 44, marginLeft: -22, marginTop: -22 }}
            />
          )}

          {/* cursor */}
          {elapsed >= 0.8 && elapsed < CHART_AT && cursor.x > 0 && (
            <div className="pointer-events-none absolute z-30" style={{ left: cursor.x, top: cursor.y }}>
              <svg width={26} height={26} viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.85))' }}>
                <path d="M4 2l16 12-7 1 4 7-3 1-4-7-6 5z" fill="#fff" stroke="#050505" strokeWidth={1.5} />
              </svg>
            </div>
          )}

          {/* chart + card value, sliding over the mock */}
          {elapsed >= CHART_AT && (
            <div
              className="absolute inset-x-0 bottom-0 top-10 z-20 flex items-center justify-center gap-4 bg-[#050505]"
              style={{ opacity: chartIn, transform: `translateY(${(1 - chartIn) * 24}px)` }}
            >
              {/* candlestick chart */}
              <div className="rounded-2xl border border-white/10 bg-[#0b0e13] p-4">
                <div className="flex items-center justify-between px-1 pb-2">
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">
                    POKE market cap - Robinhood Chain
                  </span>
                  <span
                    className="font-mono text-sm"
                    style={{ color: shownClose >= (candles[visible - 2]?.close ?? 0) ? '#16c784' : '#ea3943' }}
                  >
                    {usd(shownClose)}
                  </span>
                </div>
                <svg width={chartW} height={chartH}>
                  {[0.2, 0.4, 0.6, 0.8].map((g) => (
                    <line
                      key={g}
                      x1={padL}
                      x2={chartW - padR}
                      y1={padT + innerH * g}
                      y2={padT + innerH * g}
                      stroke="rgba(255,255,255,0.06)"
                    />
                  ))}
                  {candles.slice(0, visible).map((c, i) => {
                    const x = padL + i * slot + slot / 2;
                    const isLast = i === visible - 1;
                    const close = isLast && frac > 0 ? c.open + (c.close - c.open) * frac : c.close;
                    const top = yOf(Math.max(c.open, close));
                    const bottom = yOf(Math.min(c.open, close));
                    const up = close >= c.open;
                    const color = up ? '#16c784' : '#ea3943';
                    return (
                      <g key={i}>
                        <line x1={x} x2={x} y1={yOf(c.high)} y2={yOf(c.low)} stroke={color} strokeWidth={1} />
                        <rect
                          x={x - bodyW / 2}
                          y={top}
                          width={bodyW}
                          height={Math.max(1, bottom - top)}
                          fill={color}
                        />
                      </g>
                    );
                  })}
                  {lastVisible && (
                    <>
                      <line
                        x1={padL}
                        x2={chartW - padR}
                        y1={yOf(shownClose)}
                        y2={yOf(shownClose)}
                        stroke="rgba(255,255,255,0.25)"
                        strokeDasharray="4 4"
                      />
                      <rect
                        x={chartW - padR + 6}
                        y={yOf(shownClose) - 10}
                        width={76}
                        height={20}
                        rx={4}
                        fill={shownClose >= lastVisible.open ? '#16c784' : '#ea3943'}
                      />
                      <text
                        x={chartW - padR + 44}
                        y={yOf(shownClose) + 4}
                        textAnchor="middle"
                        fontSize={11}
                        fontFamily="monospace"
                        fill="#050505"
                      >
                        {usd(shownClose)}
                      </text>
                    </>
                  )}
                  {[0, 8, 16, 24, 32, 40, 47].map((i) => (
                    <text
                      key={i}
                      x={padL + i * slot + slot / 2}
                      y={chartH - 12}
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

              {/* card value panel */}
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
                <p className="mt-4 font-display text-3xl font-semibold text-white">
                  {usd(cardUsd)}
                </p>
                <span
                  className="mt-3 inline-block rounded-full px-3 py-1 font-mono text-xs font-bold"
                  style={{
                    background: cardPct >= 0 ? '#00bd7d' : '#ea3943',
                    color: '#050505',
                  }}
                >
                  {cardPct >= 0 ? '+' : ''}
                  {cardPct.toFixed(1)}% SINCE MINT
                </span>
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-white/40">
                  your card tracks the chart - up and down, together
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
