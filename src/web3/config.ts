import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { metaMaskWallet, rabbyWallet, coinbaseWallet } from '@rainbow-me/rainbowkit/wallets';
import { QueryClient } from '@tanstack/react-query';
import { robinhoodChain, robinhoodTestnet } from './chains';

/**
 * Wallet layer via RainbowKit: a maintained connector modal with proper
 * multi-wallet detection (MetaMask, Rabby, Coinbase Wallet and friends),
 * install links, and network switching. Injected wallets work out of the
 * box; QR/mobile connects additionally need a (free) WalletConnect project
 * id from https://cloud.walletconnect.com in VITE_WALLETCONNECT_PROJECT_ID.
 */
const testnet = import.meta.env.VITE_ROBINHOOD_TESTNET === '1';

export const targetChain = testnet ? robinhoodTestnet : robinhoodChain;

export const wagmiConfig = getDefaultConfig({
  appName: 'PokeCard Lab',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '00000000000000000000000000000000',
  chains: [targetChain] as const,
  wallets: [
    {
      groupName: 'Suggested',
      wallets: [metaMaskWallet, rabbyWallet, coinbaseWallet],
    },
  ],
  ssr: false,
});

export const queryClient = new QueryClient();
