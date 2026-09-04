import { Link } from 'react-router-dom';

const LINKS = [
  { to: '/', label: 'Market' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/activity', label: 'Activity' },
  { to: '/roadmap', label: 'Roadmap' },
  { to: '/token', label: 'Get POKE' },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/10 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="font-mono text-[11px] tracking-[0.08em] text-white/40">
          PokeCard Lab
        </span>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="font-mono text-[11px] tracking-[0.02em] text-white/40 transition hover:text-white/80"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <p className="mt-5 max-w-3xl font-mono text-[10px] leading-relaxed text-white/45">
        Not affiliated with Nintendo, Creatures Inc., GAME FREAK, The Pokemon
        Company, or Robinhood Markets. Card data and artwork via the Pokemon
        TCG Developer API (pokemontcg.io). Nothing here is financial advice.
      </p>
    </footer>
  );
}
