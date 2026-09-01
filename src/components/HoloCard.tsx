import { useRef, useState } from 'react';
import type { CardLike } from '../types/tcgdex';
import { getCardImageUrl } from '../services/tcgdex';
import { TYPE_COLORS, isHoloRarity } from '../constants/pokemon';

interface HoloCardProps {
  card: CardLike;
}

const MAX_TILT_DEGREES = 14;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Interactive 3D tilt card. The 2D TCGdex scan is projected onto a
 * perspective plane; pointer position drives rotateX/rotateY CSS variables,
 * plus a cursor-tracked glare layer and a color-dodge rainbow foil layer for
 * holo rarities. All motion is done with CSS variables written inside a
 * single rAF batch, so pointer movement never re-renders React.
 */
export default function HoloCard({ card }: HoloCardProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const rafId = useRef(0);
  const [imageFailed, setImageFailed] = useState(false);

  const imageUrl = getCardImageUrl(card);
  const primaryType = card.types?.[0];
  const foil = isHoloRarity(card.rarity);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = sceneRef.current;
    if (!el) return;
    const { clientX, clientY } = event;
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0;
      const rect = el.getBoundingClientRect();
      const px = clamp01((clientX - rect.left) / rect.width);
      const py = clamp01((clientY - rect.top) / rect.height);
      el.style.setProperty('--px', px.toFixed(4));
      el.style.setProperty('--py', py.toFixed(4));
      el.style.setProperty('--rx', ((px - 0.5) * MAX_TILT_DEGREES).toFixed(2));
      el.style.setProperty('--ry', ((0.5 - py) * MAX_TILT_DEGREES).toFixed(2));
    });
  };

  const handlePointerLeave = () => {
    const el = sceneRef.current;
    if (!el) return;
    el.style.setProperty('--px', '0.5');
    el.style.setProperty('--py', '0.5');
    el.style.setProperty('--rx', '0');
    el.style.setProperty('--ry', '0');
  };

  return (
    <div
      ref={sceneRef}
      className="card-scene"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className="card-tilt">
        {imageUrl && !imageFailed ? (
          <img
            src={imageUrl}
            alt={card.name}
            loading="lazy"
            draggable={false}
            onError={() => setImageFailed(true)}
            className="h-full w-full rounded-[inherit] object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-800 to-slate-900 p-4 text-center">
            <span className="text-3xl font-black text-slate-500">
              {card.name.charAt(0).toUpperCase()}
            </span>
            <span className="text-xs font-medium text-slate-400">
              {card.name}
            </span>
            <span className="text-[10px] text-slate-600">
              No artwork available
            </span>
          </div>
        )}

        {foil && <div className="card-foil" aria-hidden />}
        <div className="card-glare" aria-hidden />

        {card.hp !== undefined && (
          <span className="absolute left-2 top-2 rounded-md bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-bold text-rose-300 ring-1 ring-white/20">
            HP {card.hp}
          </span>
        )}

        {primaryType && (
          <span
            className="absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-slate-950 shadow"
            style={{ backgroundColor: TYPE_COLORS[primaryType] ?? '#94a3b8' }}
          >
            {primaryType}
          </span>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-[inherit] bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-transparent px-3 pb-2.5 pt-8">
          <p className="truncate text-sm font-semibold text-white">
            {card.name || card.id}
          </p>
          <p className="truncate text-[11px] text-slate-300">
            {card.set?.name ?? card.rarity ?? card.id}
          </p>
        </div>
      </div>
    </div>
  );
}
