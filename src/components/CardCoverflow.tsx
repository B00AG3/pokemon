import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardListItem } from '../types/tcgdex';
import { getCardImageUrl } from '../services/tcgdex';

const SPACING = 170;
const SNAP_MS = 400;
const ARC_RADIUS = 820;

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
 * Anti-clip stack:
 *  - flat (non-preserve-3d) context, so planes cannot slice each other;
 *    z-index alone decides stacking
 *  - spacing wider than the rotated card footprint, so resting overlap is
 *    only a thin sliver at the inner edges
 *  - hand-off rule: whichever side is travelling toward the front stacks
 *    above the card it passes, for the whole duration of the motion
 */
export default function CardCoverflow({ items }: { items: CardListItem[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [dragging, setDragging] = useState(false);

  const st = useRef({
    pos: 0,
    dragging: false,
    lastX: 0,
    velX: 0,
    anim: null as null | { from: number; to: number; start: number },
    lastFramePos: 0,
    raf: 0,
  }).current;

  const n = useMemo(
    () => items.filter((card) => !failed.has(card.id)).length,
    [items, failed],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || n === 0) return;

    const tick = (now: number) => {
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
        cardEl.style.zIndex = String(3000 - Math.round(a * 200) + boost);
        cardEl.style.transform =
          `translate(-50%, -50%)` +
          ` translateX(${(f * SPACING).toFixed(1)}px)` +
          ` translateY(${y.toFixed(1)}px)` +
          ` translateZ(${(-a * 110).toFixed(1)}px)` +
          ` rotateY(${(-f * 32).toFixed(2)}deg)` +
          ` rotateZ(${(tangentDeg + motionTilt).toFixed(2)}deg)`;
        cardEl.style.opacity = Math.max(0, 1 - a * 0.26).toFixed(3);
        cardEl.style.filter = `brightness(${Math.max(0.4, 1 - a * 0.22).toFixed(3)}) blur(${blur.toFixed(1)}px)`;
        cardEl.style.setProperty('--ca', Math.max(0, 1.15 - a).toFixed(2));
      }
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(st.raf);
  }, [n, st]);

  const visible = useMemo(
    () => items.filter((card) => !failed.has(card.id)),
    [items, failed],
  );

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
          return (
            <div className="orbit-card" data-i={i} key={card.id}>
              {card.image && !failed.has(card.id) ? (
                <img
                  src={getCardImageUrl(card)}
                  alt={card.name || card.id}
                  draggable={false}
                  onError={() =>
                    setFailed((prev) => new Set(prev).add(card.id))
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
