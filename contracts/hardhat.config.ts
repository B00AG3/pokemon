import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

// Robinhood Chain: Arbitrum Orbit L2.
// Mainnet chainId 4663, testnet chainId 46630. ETH is the gas token.
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    robinhoodTestnet: {
      chainId: 46630,
      url: process.env.RPC_TESTNET_URL ?? 'https://rpc.testnet.chain.robinhood.com',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    robinhoodMainnet: {
      chainId: 4663,
      url: process.env.RPC_MAINNET_URL ?? 'https://rpc.mainnet.chain.robinhood.com',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      robinhoodTestnet: 'no-key-needed',
      robinhoodMainnet: 'no-key-needed',
    },
    customChains: [
      {
        network: 'robinhoodTestnet',
        chainId: 46630,
        urls: {
          apiURL: 'https://explorer.testnet.chain.robinhood.com/api',
          browserURL: 'https://explorer.testnet.chain.robinhood.com',
        },
      },
      {
        network: 'robinhoodMainnet',
        chainId: 4663,
        urls: {
          apiURL: 'https://robinhoodchain.blockscout.com/api',
          browserURL: 'https://robinhoodchain.blockscout.com',
        },
      },
    ],
  },
};

export default config;
