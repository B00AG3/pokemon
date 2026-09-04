import { useEffect, useRef, useState } from 'react';
import { useAccount, useDisconnect, useSwitchChain } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { targetChain } from '../web3/config';

function shorten(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const menuClass =
  'absolute right-0 top-12 z-50 w-60 overflow-hidden rounded-[4px] border border-white/12 bg-[#0d0d0f] py-1.5 shadow-2xl shadow-black/60';
const menuItemClass =
  'w-full px-4 py-2.5 text-left font-mono text-xs text-white/75 transition hover:bg-white/5 hover:text-white';

/**
 * Nav wallet pill. Connecting opens the RainbowKit modal (multi-wallet
 * detection, install links, QR when a WalletConnect project id is set).
 * Once connected, the pill shows the address plus a menu with network
 * switch, copy address, and disconnect.
 */
export default function WalletButton() {
  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const openConnect = openConnectModal ?? (() => {});
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, []);

  const wrongChain = isConnected && chain?.id !== targetChain.id;

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (!isConnected) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => openConnect()}
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn btn-ghost !gap-2 !normal-case"
        onClick={() => setMenuOpen((value) => !value)}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${
            wrongChain ? 'bg-amber-400' : 'bg-[#00bd7d]'
          }`}
        />
        {address ? shorten(address) : '...'}
      </button>
      {menuOpen && (
        <div className={menuClass}>
          {wrongChain && (
            <button
              type="button"
              className={menuItemClass}
              onClick={() => switchChain({ chainId: targetChain.id })}
            >
              Switch to {targetChain.name}
            </button>
          )}
          <button type="button" className={menuItemClass} onClick={() => void copyAddress()}>
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            type="button"
            className={menuItemClass}
            onClick={() => {
              disconnect();
              setMenuOpen(false);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
