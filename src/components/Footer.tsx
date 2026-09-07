import { Link } from 'react-router-dom';

const LINKS = [
  { to: '/', label: 'Market' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/activity', label: 'Activity' },
  { to: '/roadmap', label: 'Roadmap' },
  { to: '/token', label: 'Get POKEDROP' },
];

const X_URL = 'https://x.com/PokeDropRH';

export default function Footer() {
  return (
    <footer className="border-t border-white/10 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="font-mono text-[11px] tracking-[0.08em] text-white/40">
          Pokedrop
        </span>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="font-mono text-[11px] tracking-[0.02em] text-white/40 transition hover:text-white/80"
            >
              {link.label}
            </Link>
          ))}
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Pokedrop on X"
            className="text-white/40 transition hover:text-white/80"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
            </svg>
          </a>
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
