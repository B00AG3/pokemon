import { useState } from 'react';
import { useWalletClient } from 'wagmi';
import { CONTRACTS } from '../web3/contracts';
import { targetChain } from '../web3/config';

const SUPPLY = 1_000_000_000;

const STEPS = [
  {
    step: '1',
    title: 'Get ETH on the Robinhood Chain',
    body: 'Bridge or buy ETH and switch your wallet to the Robinhood Chain network. The connect button in the header can switch you automatically.',
  },
  {
    step: '2',
    title: 'Swap ETH for POKE',
    body: 'Trade ETH for POKE on the launch pool. Every swap moves the market cap, and the market cap gates the milestone mints.',
  },
  {
    step: '3',
    title: 'Hold the chart',
    body: 'When market cap crosses a milestone and holds there, the next Pokemon card mints to the treasury - exactly once.',
  },
  {
    step: '4',
    title: 'Buy the cards',
    body: 'Milestone cards go on sale priced off the same chart. Buy, sell, or trade them as the collection climbs.',
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
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 py-3">
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
        <span className="font-mono text-xs text-white/30">set at deploy</span>
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
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
          Get POKE
        </h1>
        <p className="mt-3 max-w-xl text-sm font-light leading-relaxed text-white/55">
          One token, one billion supply, one collection. Holding POKE is a
          stake in the chart that mints every milestone card - and every card
          price is derived from the same market cap.
        </p>
      </div>

      <div className="terminal mb-8 p-7">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
          <div>
            <p className="eyebrow">token</p>
            <p className="mt-1.5 font-display text-xl font-semibold">PokeCard Token</p>
          </div>
          <div>
            <p className="font-mono text-[11px] text-white/40">symbol</p>
            <p className="mt-1.5 font-mono text-sm">POKE</p>
          </div>
          <div>
            <p className="font-mono text-[11px] text-white/40">supply</p>
            <p className="mt-1.5 font-mono text-sm">{SUPPLY.toLocaleString('en-US')}</p>
          </div>
          <div>
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
              className="btn btn-primary !px-5 !py-2.5 text-[13px]"
            >
              Buy POKE on the DEX
            </a>
          ) : (
            <button
              type="button"
              className="btn btn-primary !px-5 !py-2.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
              disabled
              title="The launch pool link goes live with the token"
            >
              Buy POKE - pool opens at launch
            </button>
          )}
          {CONTRACTS.token && walletClient && (
            <button
              type="button"
              className="btn btn-ghost !px-5 !py-2.5 text-[13px]"
              onClick={() => void addToWallet()}
            >
              {added ? 'Added' : 'Add POKE to wallet'}
            </button>
          )}
        </div>
      </div>

      <h2 className="font-display text-2xl font-semibold tracking-tight">
        How to buy, step by step
      </h2>
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        {STEPS.map((item) => (
          <div key={item.step}>
            <p className="font-mono text-xs text-white/30">{item.step}</p>
            <h3 className="mt-2.5 text-[15px] font-semibold tracking-tight">
              {item.title}
            </h3>
            <p className="mt-2 text-sm font-light leading-relaxed text-white/50">
              {item.body}
            </p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">
        Contracts
      </h2>
      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-2">
        <AddressRow label="POKE token (ERC-20)" address={CONTRACTS.token} />
        <AddressRow label="Milestone cards (ERC-721)" address={CONTRACTS.cards} />
        <AddressRow label="Treasury sale (CardSale)" address={CONTRACTS.sale} />
        <AddressRow label="Peer-to-peer swaps (CardSwap)" address={CONTRACTS.swap} />
      </div>
      <p className="mt-4 font-mono text-[11px] text-white/35">
        Addresses are set the moment the contracts deploy to the Robinhood
        Chain - this page updates itself from the deployment.
      </p>
    </section>
  );
}
