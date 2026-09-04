import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardListItem } from '../types/pokemontcg';
import { getCardImageUrl } from '../services/pokemontcg';

const SPACING = 170;
const SNAP_MS = 400;
const ARC_RADIUS = 820;
const INTRO_MS = 950;
const INTRO_STAGGER_MS = 85;

function wrap(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * TCG Pocket-style hero carousel: the belt never drifts on its own. You drag,
 * and on release it snaps to the nearest card with a quick eased animation.
 * Because motion only happens inside that fast transition, cards never sit
 * mid-overlap long enough for the stacking hand-off to read as clipping.
 *
 * Entrance: on mount the fan deals itself out from the center card - each
 * card rises from below with a stagger by distance from center, un-blurring
 * and un-rotating into its belt slot. The same rAF loop drives it, blended
 * against the belt math so a drag during the entrance stays coherent.
 *
 * Anti-clip stack:
 *  - flat (non-preserve-3d) context, so planes cannot slice each other;
 *    z-index alone decides stacking
 *  - spacing wider than the rotated card footprint, so resting overlap is
 *    only a thin sliver at the inner edges
 *  - hand-off rule: whichever side is travelling toward the front stacks
 *    above the card it passes, for the whole duration of the motion
 */
/**
 * Image sources per card, tried in order: the vendored file first, then the
 * pokemontcg CDN (hires, then standard) for vendored cards. A transient
 * failure moves to the next source instead of dropping the card.
 */
function imageSources(card: CardListItem): string[] {
  const sources: string[] = [];
  const primary = getCardImageUrl(card);
  if (primary) sources.push(primary);
  if (card.image?.startsWith('/cards/')) {
    const [setCode, number] = card.image.slice('/cards/'.length).split('-');
    if (setCode && number) {
      sources.push(`https://images.pokemontcg.io/${setCode}/${number}_hires.png`);
      sources.push(`https://images.pokemontcg.io/${setCode}/${number}.png`);
    }
  }
  return sources;
}

export default function CardCoverflow({ items }: { items: CardListItem[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState(false);

  const reduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const st = useRef({
    pos: 0,
    dragging: false,
    lastX: 0,
    velX: 0,
    anim: null as null | { from: number; to: number; start: number },
    lastFramePos: 0,
    introT0: 0,
    raf: 0,
  }).current;

  const sources = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const card of items) map[card.id] = imageSources(card);
    return map;
  }, [items]);

  const visible = useMemo(
    () =>
      items.filter(
        (card) => (attempt[card.id] ?? 0) < (sources[card.id]?.length ?? 0),
      ),
    [items, attempt, sources],
  );

  const n = visible.length;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || n === 0) return;

    const tick = (now: number) => {
      if (st.introT0 === 0) st.introT0 = now;
      if (st.anim) {
        const a = st.anim;
        const t = Math.min(1, (now - a.start) / SNAP_MS);
        st.pos = a.from + (a.to - a.from) * easeOutQuart(t);
        if (t >= 1) {
          st.pos = wrap(a.to, n);
          st.anim = null;
        }
      }
      const ev = st.pos - st.lastFramePos;
      st.lastFramePos = st.pos;
      st.pos = wrap(st.pos, n);

      for (const el of Array.from(container.children)) {
        const cardEl = el as HTMLElement;
        const i = Number(cardEl.dataset.i);
        let f = wrap(i - st.pos, n);
        if (f > n / 2) f -= n;
        const a = Math.abs(f);
        // arc fan: angled inward, tucked behind the center, fanned around a
        // pivot below the stage, with a little torsion while the belt moves
        const tangentDeg = ((f * SPACING) / ARC_RADIUS) * 57.3 * 0.5;
        const motionTilt = Math.max(-5, Math.min(5, ev * 45));
        const y = a * a * 26 - 14 * Math.max(0, 1 - a);
        const blur = a > 1.2 ? Math.min((a - 1.2) * 2.4, 5) : 0;
        const approaching =
          ev > 0.0004 ? f > 0 : ev < -0.0004 ? f < 0 : null;
        const boost = approaching ? 500 : 0;

        // entrance blend: 0 = dealt from below the stage, 1 = settled belt
        let it = reduced
          ? 1
          : (now - st.introT0 - Math.min(a, 5) * INTRO_STAGGER_MS) / INTRO_MS;
        it = Math.max(0, Math.min(1, it));
        const ie = 1 - Math.pow(1 - it, 3);
        const enterY = (1 - ie) * 120;
        const enterRotY = (1 - ie) * -26;
        const enterRotZ = (1 - ie) * (f >= 0 ? -18 : 18);
        const scale = 0.84 + 0.16 * ie;

        cardEl.style.zIndex = String(3000 - Math.round(a * 200) + boost);
        cardEl.style.transform =
          `translate(-50%, -50%)` +
          ` translateX(${(f * SPACING).toFixed(1)}px)` +
          ` translateY(${(y + enterY).toFixed(1)}px)` +
          ` translateZ(${(-a * 110).toFixed(1)}px)` +
          ` rotateY(${(-f * 32 + enterRotY).toFixed(2)}deg)` +
          ` rotateZ(${(tangentDeg + motionTilt + enterRotZ).toFixed(2)}deg)` +
          ` scale(${scale.toFixed(3)})`;
        cardEl.style.opacity = (Math.max(0, 1 - a * 0.26) * ie).toFixed(3);
        const brightness =
          0.5 + (Math.max(0.4, 1 - a * 0.22) - 0.5) * ie;
        cardEl.style.filter =
          `brightness(${brightness.toFixed(3)}) blur(${(blur + (1 - ie) * 7).toFixed(1)}px)`;
        cardEl.style.setProperty('--ca', Math.max(0, 1.15 - a).toFixed(2));
      }
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(st.raf);
  }, [n, st, reduced]);

  if (visible.length === 0) {
    return (
      <div className="orbit-stage" aria-hidden>
        <div className="orbit-glow" />
        <div className="orbit">
          {[-1, 0, 1].map((o) => (
            <div
              className="orbit-card"
              key={o}
              style={{ left: '50%', top: '50%' }}
            >
              <div className="orbit-slot" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="orbit-stage">
      <div className="orbit-glow" aria-hidden />
      <div
        ref={containerRef}
        className={`orbit${dragging ? ' dragging' : ''}`}
        role="group"
        aria-label="Card gallery, drag or use arrow keys"
        tabIndex={0}
        onKeyDown={(event) => {
          // arrow keys nudge the belt one card with the same snap as a drag
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const step = event.key === 'ArrowRight' ? 1 : -1;
          st.anim = { from: st.pos, to: Math.round(st.pos) + step, start: performance.now() };
        }}
        onPointerDown={(event) => {
          st.anim = null;
          st.dragging = true;
          st.lastX = event.clientX;
          st.velX = 0;
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!st.dragging) return;
          const dx = event.clientX - st.lastX;
          st.lastX = event.clientX;
          st.pos -= dx / SPACING;
          st.velX = st.velX * 0.5 + (-dx / SPACING) * 0.5;
        }}
        onPointerUp={() => {
          st.dragging = false;
          setDragging(false);
          const flick = Math.max(-2, Math.min(2, Math.round(st.velX * 4)));
          const target = Math.round(st.pos) + flick;
          st.velX = 0;
          st.anim = { from: st.pos, to: target, start: performance.now() };
        }}
        onPointerCancel={() => {
          st.dragging = false;
          setDragging(false);
          const target = Math.round(st.pos);
          st.anim = { from: st.pos, to: target, start: performance.now() };
        }}
        onDragStart={(event) => event.preventDefault()}
      >
        {visible.map((card, i) => {
          const cardSources = sources[card.id] ?? [];
          const src = cardSources[attempt[card.id] ?? 0];
          return (
            <div className="orbit-card" data-i={i} key={card.id}>
              {src ? (
                <img
                  key={src}
                  src={src}
                  alt={card.name || card.id}
                  draggable={false}
                  onLoad={(event) => event.currentTarget.classList.add('ready')}
                  ref={(el) => {
                    // cached images can finish before React attaches onLoad
                    if (el && el.complete && el.naturalWidth > 0) {
                      el.classList.add('ready');
                    }
                  }}
                  onError={() =>
                    setAttempt((prev) => ({
                      ...prev,
                      [card.id]: (prev[card.id] ?? 0) + 1,
                    }))
                  }
                />
              ) : (
                <div className="orbit-slot">
                  <span>{(card.name || card.id).charAt(0).toUpperCase()}</span>
                </div>
              )}
              <div className="orbit-caption" aria-hidden>
                <span>{card.name || card.id}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
