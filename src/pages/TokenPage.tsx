import { useState } from 'react';
import { useWalletClient } from 'wagmi';
import { CONTRACTS } from '../web3/contracts';
import { targetChain } from '../web3/config';

const SUPPLY = 1_000_000_000;

const STEPS = [
  {
    step: '01',
    title: 'Get POKE',
    body: 'Bridge or buy ETH on the Robinhood Chain, then swap for POKE in the launch pool. Every swap moves the cap.',
  },
  {
    step: '02',
    title: 'Enter the draw',
    body: 'Holding POKE is the only ticket. Enter once from the market page; the draw re-checks your balance at every crossing.',
  },
  {
    step: '03',
    title: 'Hold the chart',
    body: 'When market cap crosses a milestone and holds for the confirm window, the next card airdrops to a drawn holder.',
  },
  {
    step: '04',
    title: 'Win, then sell',
    body: 'The winner gets the card free. Keep it, or list it for ETH on the peer-to-peer market at whatever price the market pays.',
  },
];

function AddressRow({ label, address }: { label: string; address?: string }) {
  const [copied, setCopied] = useState(false);
  const explorer = targetChain.blockExplorers?.default.url;

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 py-3.5 last:border-b-0">
      <span className="font-mono text-[11px] text-white/45">{label}</span>
      {address ? (
        <span className="flex items-center gap-3">
          <a
            href={`${explorer}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-white/80 underline decoration-white/20 underline-offset-4 hover:text-white"
          >
            {address.slice(0, 10)}...{address.slice(-8)}
          </a>
          <button
            type="button"
            onClick={() => void copy()}
            className="font-mono text-[11px] text-white/40 transition hover:text-white"
          >
            {copied ? 'copied' : 'copy'}
          </button>
        </span>
      ) : (
        <span className="font-mono text-xs text-white/45">set at deploy</span>
      )}
    </div>
  );
}

export default function TokenPage() {
  const { data: walletClient } = useWalletClient();
  const [added, setAdded] = useState(false);
  const dexUrl = import.meta.env.VITE_DEX_POOL_URL as string | undefined;

  const addToWallet = async () => {
    if (!walletClient || !CONTRACTS.token) return;
    try {
      await walletClient.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: CONTRACTS.token,
            symbol: 'POKE',
            decimals: 18,
          },
        },
      } as never);
      setAdded(true);
    } catch {
      /* wallet declined or unsupported */
    }
  };

  return (
    <section className="pb-16">
      <div className="mb-8">
        <p className="eyebrow">The ticker</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Get POKE
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/60">
          One billion POKE, fixed supply. The cap drives the milestone
          airdrops, and holding POKE is the only ticket in the draw.
        </p>
      </div>

      <div className="panel mb-10 p-7">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
          <div>
            <p className="eyebrow">token</p>
            <p className="mt-1.5 font-display text-xl font-medium">PokeCard Token</p>
          </div>
          <div className="sm:border-l sm:border-white/10 sm:pl-10">
            <p className="font-mono text-[11px] text-white/40">symbol</p>
            <p className="mt-1.5 font-mono text-sm">POKE</p>
          </div>
          <div className="sm:border-l sm:border-white/10 sm:pl-10">
            <p className="font-mono text-[11px] text-white/40">supply</p>
            <p className="mt-1.5 font-mono text-sm">{SUPPLY.toLocaleString('en-US')}</p>
          </div>
          <div className="sm:border-l sm:border-white/10 sm:pl-10">
            <p className="font-mono text-[11px] text-white/40">network</p>
            <p className="mt-1.5 font-mono text-sm">{targetChain.name}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {dexUrl ? (
            <a
              href={dexUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary"
            >
              Buy POKE on the DEX
            </a>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled
              title="The launch pool link goes live with the token"
            >
              Buy POKE - pool opens at launch
            </button>
          )}
          {CONTRACTS.token && walletClient && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void addToWallet()}
            >
              {added ? 'Added' : 'Add POKE to wallet'}
            </button>
          )}
        </div>
      </div>

      <h2 className="font-display text-2xl font-medium tracking-tight">
        How to win a card, step by step
      </h2>
      <div className="mt-6 grid gap-x-8 gap-y-8 md:grid-cols-2">
        {STEPS.map((item) => (
          <div key={item.step} className="border-t border-white/15 pt-4">
            <p className="font-mono text-xs text-white/45">{item.step}</p>
            <h3 className="mt-2.5 text-[15px] font-semibold tracking-tight">
              {item.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-white/55">
              {item.body}
            </p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 font-display text-2xl font-medium tracking-tight">
        Contracts
      </h2>
      <div className="panel mt-4 px-5 py-1.5">
        <AddressRow label="POKE token (ERC-20)" address={CONTRACTS.token} />
        <AddressRow label="Milestone cards + airdrop draw (ERC-721)" address={CONTRACTS.cards} />
        <AddressRow label="Treasury fallback sale (CardSale)" address={CONTRACTS.sale} />
        <AddressRow label="Peer-to-peer swaps (CardSwap)" address={CONTRACTS.swap} />
      </div>
      <p className="mt-4 font-mono text-[11px] text-white/45">
        Addresses appear here the moment the contracts deploy to the Robinhood
        Chain - this page reads them from the deployment.
      </p>
    </section>
  );
}
