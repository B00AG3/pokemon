import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

/**
 * Launches POKE on Pons (Robinhood Chain's permissionless launchpad) straight
 * from a script, so the UI click-flow is never needed. Talks to the Pons v2
 * factory the same way the Pons app does: launchToken(params, configId,
 * pairToken) with the 0.0005 ETH launch fee attached.
 *
 * The token launches with ZERO creator tax ("no tax") and native ETH as the
 * reserve, matching what the PokeCard contracts expect (curve graduates into
 * a Uniswap pool once 4.2 ETH of buys have gone through the curve).
 *
 * Env:
 *   NAME, SYMBOL         required - token name and ticker
 *   LOGO                 image URL shown on Pons (default: the site's card art)
 *   DESCRIPTION          optional blurb
 *   TWITTER, TELEGRAM, DISCORD, WEBSITE, FARCASTER   optional socials
 *   FEE_RECIPIENT        where creator fees (70% of trading fees) accrue;
 *                        defaults to the dev wallet, changeable later on-chain
 *   CREATOR_TAX_BPS      default 0 (no tax); hard cap is 1000 (10%)
 *   BUYBACK_ENABLED      default 0
 *   DEV_KEY              dev wallet key; falls back to PRIVATE_KEY from .env
 *   EXECUTE              1 = actually send the transaction (default: dry run)
 *
 * Run: npx ts-node scripts/launch-pons.ts
 */

const RPC = process.env.KEEPER_RPC_URL_MAINNET ?? 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e'; // Pons v2 factory

const factoryAbi = [
  'function launchFee() view returns (uint256)',
  'function launchConfigCount() view returns (uint256)',
  'function getLaunchConfig(uint256 id) view returns ((uint256 supply, uint256 curveFeeBps, uint256 phantomQuote, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, bool enabled))',
  'function previewLaunchEconomics(uint256 id, address pairToken) view returns (bytes32)',
  'function launchToken((string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt) params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)',
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
];

const num = (name: string, fallback: string) => process.env[name] ?? fallback;
const req = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

async function main() {
  const name = req('NAME');
  const symbol = req('SYMBOL');
  const key = process.env.DEV_KEY ?? process.env.PRIVATE_KEY;
  if (!key) throw new Error('DEV_KEY (or PRIVATE_KEY) missing in contracts/.env');

  const provider = new ethers.JsonRpcProvider(RPC);
  const dev = new ethers.Wallet(key, provider);
  const factory = new ethers.Contract(FACTORY, factoryAbi, dev);

  const fee: bigint = await factory.launchFee();
  const configId = BigInt(num('LAUNCH_CONFIG_ID', '0'));
  const pairToken = num('PAIR_TOKEN', ethers.ZeroAddress);
  const cfg = await factory.getLaunchConfig(configId);
  const expectedEconomics: string = await factory.previewLaunchEconomics(configId, pairToken);
  const feeRecipient = num('FEE_RECIPIENT', dev.address);
  const salt = ethers.hexlify(ethers.randomBytes(32));

  const params = {
    name,
    symbol,
    logo: num('LOGO', 'https://pokecard.fun/cards/base1-4_hires.png'),
    description: num('DESCRIPTION', ''),
    socials: {
      twitter: num('TWITTER', ''),
      telegram: num('TELEGRAM', ''),
      discord: num('DISCORD', ''),
      website: num('WEBSITE', ''),
      farcaster: num('FARCASTER', ''),
    },
    creatorFeeRecipient: feeRecipient,
    creatorTaxBps: BigInt(num('CREATOR_TAX_BPS', '0')),
    buybackEnabled: num('BUYBACK_ENABLED', '0') === '1',
    expectedEconomics,
    salt,
  };

  const balance = await provider.getBalance(dev.address);
  console.log(`Pons launch plan (factory ${FACTORY})`);
  console.log(`  dev wallet:      ${dev.address} (balance ${Number(balance) / 1e18} ETH)`);
  console.log(`  token:           ${params.name} ($${params.symbol})`);
  console.log(`  logo:            ${params.logo}`);
  console.log(`  creator tax:     ${params.creatorTaxBps} bps | buyback: ${params.buybackEnabled}`);
  console.log(`  fee recipient:   ${feeRecipient} (70% of trading fees accrue here)`);
  console.log(`  config:          #${configId}, supply ${Number(cfg.supply) / 1e18 / 1e9}B tokens, graduation ${Number(cfg.graduationThreshold) / 1e18} ETH`);
  console.log(`  reserve:         ${pairToken === ethers.ZeroAddress ? 'native ETH' : pairToken}`);
  console.log(`  launch fee:      ${Number(fee) / 1e18} ETH + gas`);
  console.log(`  economics:       ${expectedEconomics}`);

  if (process.env.EXECUTE !== '1') {
    console.log('\nDRY RUN - nothing sent. Re-run with EXECUTE=1 to launch.');
    return;
  }

  if (balance < fee) throw new Error('dev wallet cannot cover the launch fee');

  console.log('\nSending launchToken...');
  const tx = await factory.launchToken(params, configId, pairToken, { value: fee });
  console.log(`tx ${tx.hash} - waiting for confirmation`);
  const receipt = await tx.wait();

  const launched = receipt.logs
    .map((log: ethers.Log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: ethers.LogDescription | null) => parsed?.name === 'TokenLaunched');
  if (!launched) throw new Error('TokenLaunched event missing from receipt');

  console.log(`\nLAUNCHED`);
  console.log(`  TOKEN_ADDRESS=${launched.args.token}`);
  console.log(`  curve:        ${launched.args.curve}`);
  console.log(`  graduation:   ${Number(launched.args.graduationThreshold) / 1e18} ETH of curve buys`);
  console.log('\nNext: the token trades on the curve until graduation, then pools on');
  console.log('Uniswap; hand TOKEN_ADDRESS to scripts/smoke-mainnet.ts as planned.');
}

main().catch((e) => {
  console.error('launch failed:', (e as Error).message ?? e);
  process.exit(1);
});
