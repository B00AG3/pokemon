import { Link, NavLink, useLocation } from 'react-router-dom';
import WalletButton from './WalletButton';

const LINKS = [
  { to: '/', label: 'Market' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/activity', label: 'Activity' },
  { to: '/roadmap', label: 'Roadmap' },
  { to: '/token', label: 'Get POKE' },
];

function PokeballMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle
        cx="16"
        cy="16"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M6 16h6M20 16h6" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="3.2" fill="currentColor" />
    </svg>
  );
}

export default function Nav({ onHowItWorks }: { onHowItWorks?: () => void }) {
  const location = useLocation();

  return (
    <nav className="sticky top-0 z-40 -mx-6 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#070708]/85 px-6 py-4 backdrop-blur-lg">
      <Link to="/" className="flex items-center gap-2.5">
        <PokeballMark className="h-6 w-6 text-white" />
        <span className="font-display text-[17px] font-medium tracking-wide">
          PokeCard Lab
        </span>
      </Link>
      <div className="flex flex-wrap items-center gap-4 lg:gap-6">
        <div className="flex flex-wrap items-center gap-4 lg:gap-5">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                `font-mono text-[12px] tracking-[0.02em] transition ${
                  isActive ? 'text-white' : 'text-white/45 hover:text-white/85'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {location.pathname === '/' && onHowItWorks && (
            <button
              type="button"
              onClick={onHowItWorks}
              className="btn btn-ghost !h-9 !px-3.5 !text-[10px]"
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
              How it works
            </button>
          )}
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}
