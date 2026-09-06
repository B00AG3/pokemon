import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { Signer } from 'ethers';
import { ethers, network } from 'hardhat';

/**
 * One-command mainnet smoke test (LAUNCH.md "Quick path"). Give it a Pons
 * token address and a funded deployer (PRIVATE_KEY in contracts/.env) and it
 * runs the whole loop: resolves the token's Pons bonding curve, creates and
 * funds throwaway trader wallets, buys POKE straight off the curve with them,
 * deploys the smoke stack (tiny thresholds, 60s windows, the curve oracle),
 * prices the oracle, funds the redemption pool, enters the draw, and hands
 * off to the keeper.
 *
 * Pre-graduation only: the token still trades on its curve. After the 4.2 ETH
 * graduation the token lives in a locked v4 pool - use the V4 oracle path.
 *
 * Env (all optional unless noted):
 *   TOKEN_ADDRESS          REQUIRED - Pons-launched POKE ERC-20
 *   CURVE_ADDRESS          curve override (default: resolve from the Pons
 *                          factory's getLaunchedToken(token) record)
 *   PONS_FACTORY           factory override (default: mainnet Pons v2 factory)
 *   START_KEEPER           1 (default) = run the keeper when setup finishes
 *   DRY_RUN                1 = print the plan, touch nothing
 *
 * Smoke values (SMOKE_* below) are hardcoded to throwaway sizes and ignore
 * whatever THRESHOLDS/CONFIRM_WINDOW/... contracts/.env carries: this tool
 * must never deploy the real ladder by accident.
 *   SMOKE_THRESHOLDS          default 4000,6000,7000 (the curve spawns the
 *                             coin near $5k market cap, so the 4k rung is
 *                             crossed at launch and each higher rung needs
 *                             real buys; do NOT graduate during the smoke)
 *   SMOKE_CONFIRM_WINDOW      default 60s
 *   SMOKE_REDEEM_DELAY        default 60s
 *   SMOKE_REDEEM_BASE_PRICE_WEI  default 0.001 ETH
 *   SMOKE_FUND_ETH            default 0.01
 *   SMOKE_MANUAL_ETH_USD      default 3000
 *   SMOKE_BUY_WALLETS         default 2
 *   SMOKE_BUY_ETH_PER_WALLET  default 0.0005 ETH
 *   SMOKE_TRADER_GAS_ETH      default 0.0004 ETH
 *
 * Run: npm run smoke:mainnet
 */

const PONS_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const MAINNET_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com';
const CURVE_ABI = [
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
  'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)',
];

const num = (name: string, fallback: string) => process.env[name] ?? fallback;

/**
 * Resolve the token's curve without trusting any struct layout: raw-call
 * getLaunchedToken(token) on the factory and scan the returned words for an
 * address that actually answers getReserves() with a live curve. An explicit
 * CURVE_ADDRESS skips the scan but is validated the same way.
 */
async function resolveCurve(
  factoryAddress: string,
  tokenAddress: string,
  signer: Signer,
): Promise<string> {
  const provider = signer.provider!;
  const probe = async (candidate: string): Promise<boolean> => {
    const code = await provider.getCode(candidate);
    if (code === '0x') return false;
    try {
      const curve = new ethers.Contract(candidate, CURVE_ABI, provider);
      const [quoteReserve, tokenReserve]: [bigint, bigint] = await curve.getReserves();
      return quoteReserve > 0n && tokenReserve > 0n;
    } catch {
      return false;
    }
  };

  if (process.env.CURVE_ADDRESS) {
    if (!(await probe(process.env.CURVE_ADDRESS))) {
      throw new Error(`CURVE_ADDRESS ${process.env.CURVE_ADDRESS} is not a live Pons curve`);
    }
    return process.env.CURVE_ADDRESS;
  }

  const selector = ethers.id('getLaunchedToken(address)').slice(0, 10);
  const args = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [tokenAddress]).slice(2);
  const raw: string = await provider.call({ to: factoryAddress, data: selector + args });
  const data = raw.replace(/^0x/, '');
  if (data.length < 64) throw new Error('factory returned nothing for getLaunchedToken');
  for (let offset = 0; offset + 64 <= data.length; offset += 64) {
    const word = data.slice(offset, offset + 64);
    const candidate = ethers.getAddress('0x' + word.slice(24)); // last 20 bytes
    if (await probe(candidate)) return candidate;
  }
  throw new Error(
    'could not resolve the token curve from the factory record - set CURVE_ADDRESS',
  );
}

async function main() {
  const tokenAddress = process.env.TOKEN_ADDRESS;
  if (!tokenAddress) throw new Error('TOKEN_ADDRESS is required (the Pons-launched POKE ERC-20)');

  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isMainnet = network.name === 'robinhoodMainnet';
  const buyWallets = Number(num('SMOKE_BUY_WALLETS', '2'));
  const buyEthPerWallet = num('SMOKE_BUY_ETH_PER_WALLET', '0.0005');
  const traderGasEth = num('SMOKE_TRADER_GAS_ETH', '0.0004');
  const fundEth = num('SMOKE_FUND_ETH', '0.01');
  const thresholds = num('SMOKE_THRESHOLDS', '4000,6000,7000');
  const confirmWindow = num('SMOKE_CONFIRM_WINDOW', '60');
  const redeemDelay = num('SMOKE_REDEEM_DELAY', '60');
  const redeemBasePriceWei = num('SMOKE_REDEEM_BASE_PRICE_WEI', (10n ** 15n).toString());
  const manualEthUsd = num('SMOKE_MANUAL_ETH_USD', '3000');

  const balance = await ethers.provider.getBalance(deployer.address);
  const needed =
    ethers.parseEther(fundEth) +
    BigInt(buyWallets) * (ethers.parseEther(buyEthPerWallet) + ethers.parseEther(traderGasEth)) +
    ethers.parseEther('0.005'); // deploy + keeper gas buffer

  console.log('=== PokeCard mainnet smoke test ===');
  console.log(`network:      ${network.name} (${chainId})`);
  console.log(`deployer:     ${deployer.address}`);
  console.log(`balance:      ${ethers.formatEther(balance)} ETH`);
  console.log(`token:        ${tokenAddress}`);
  console.log(`plan:         resolve the curve, create ${buyWallets} trader wallets,`);
  console.log(`              buy ${buyEthPerWallet} ETH of POKE each, fund pool with ${fundEth} ETH,`);
  console.log(`              thresholds [${thresholds}] USD, windows ${confirmWindow}s/${redeemDelay}s`);

  if (balance < needed) {
    throw new Error(
      `deployer balance too low: have ${ethers.formatEther(balance)} ETH, ` +
        `plan needs ~${ethers.formatEther(needed)} ETH (pool funding + buys + gas)`,
    );
  }

  if (process.env.DRY_RUN === '1') {
    console.log('\nDRY_RUN=1 - stopping before any transaction.');
    return;
  }

  // 1. Resolve the token's Pons bonding curve (pre-graduation pricing home).
  const factoryAddress = num('PONS_FACTORY', PONS_FACTORY);
  const curveAddress = await resolveCurve(factoryAddress, tokenAddress, deployer);
  const curve = new ethers.Contract(curveAddress, CURVE_ABI, deployer);
  const [quoteReserve, tokenReserve] = await curve.getReserves();
  console.log(`curve:        ${curveAddress} (resolved from the factory record)`);
  console.log(
    `  reserves:   ${ethers.formatEther(quoteReserve)} quote / ${ethers.formatUnits(tokenReserve, 18)} POKE`,
  );

  // 2. Create and seed throwaway trader wallets.
  const walletsPath = path.resolve(__dirname, '../deployments', `${network.name}.smoke-wallets.json`);
  const traders: { address: string; privateKey: string }[] = [];
  for (let i = 0; i < buyWallets; i++) {
    const wallet = ethers.Wallet.createRandom();
    traders.push({ address: wallet.address, privateKey: wallet.privateKey });
  }
  fs.writeFileSync(walletsPath, JSON.stringify(traders, null, 2));
  // Throwaway keys: scrub the file when this process exits (success, error,
  // or Ctrl+C) so plaintext keys never outlive the run.
  process.on('exit', () => {
    try {
      fs.rmSync(walletsPath, { force: true });
    } catch {
      /* best effort */
    }
  });
  console.log(
    `traders:      ${traders.map((t) => t.address).join(', ')}\n` +
      `              keys saved to ${path.basename(walletsPath)} (gitignored, deleted on exit - do not commit)`,
  );
  for (const trader of traders) {
    const tx = await deployer.sendTransaction({
      to: trader.address,
      value: ethers.parseEther(buyEthPerWallet) + ethers.parseEther(traderGasEth),
    });
    await tx.wait();
    console.log(`  seeded ${trader.address} with ${(+buyEthPerWallet + +traderGasEth).toFixed(4)} ETH (${tx.hash})`);
  }

  // 3. Buy POKE into each trader wallet straight off the curve. The curve
  // takes the quote from msg.value and credits `recipient`; minTokensOut uses
  // half the marginal price as the floor - smoke buys are tiny against a
  // 1.68+ ETH reserve, so real fills land far above it while total failures
  // (wrong curve, reverted tx) still revert.
  console.log('  waiting 10s for Pons\' 5s snipe-tax window to pass before buying');
  await new Promise((r) => setTimeout(r, 10_000));
  for (const trader of traders) {
    const traderWallet = new ethers.Wallet(trader.privateKey, ethers.provider);
    const quoteIn = ethers.parseEther(buyEthPerWallet);
    const minOut = (quoteIn * tokenReserve) / quoteReserve / 2n;
    const buyOnce = async () =>
      (
        await curve
          .connect(traderWallet)
          .getFunction('buy')(quoteIn, minOut, trader.address, { value: quoteIn })
      ).wait();
    try {
      await buyOnce();
    } catch {
      // launch-protection blocks the first moments; wait it out and retry once
      console.log('  buy reverted (launch protection?) - retrying in 15s');
      await new Promise((r) => setTimeout(r, 15_000));
      await buyOnce();
    }
    const poke = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address) view returns (uint256)'],
      deployer,
    );
    console.log(`  ${trader.address}: ${ethers.formatEther(await poke.balanceOf(trader.address))} POKE`);
  }

  // 4. Deploy the smoke stack through the existing deploy script: the curve
  // oracle path prices the pre-graduation cap straight off the bonding curve.
  console.log('\ndeploying the smoke stack...');
  const childEnv = {
    ...process.env,
    TOKEN_ADDRESS: tokenAddress,
    MOCK_ORACLE: '0',
    CURVE_ADDRESS: curveAddress,
    THRESHOLDS: thresholds,
    CONFIRM_WINDOW: confirmWindow,
    REDEEM_DELAY: redeemDelay,
    REDEEM_BASE_PRICE_WEI: redeemBasePriceWei,
    DEPLOY_SALE: '0',
    BASE_TOKEN_URI: 'ipfs://pokecard-lab/',
    KEEPER_ADDRESS: process.env.KEEPER_ADDRESS ?? deployer.address,
  };
  const deployResult = spawnSync(
    `npx hardhat run scripts/deploy.ts --network ${network.name}`,
    { shell: true, stdio: 'inherit', env: childEnv },
  );
  if (deployResult.status !== 0) throw new Error('deploy.ts failed - see output above');

  const recordPath = path.resolve(__dirname, '../deployments', `${network.name}.json`);
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as {
    oracle: string;
    cards: string;
    swap: string;
    token: string;
  };

  // 5. Price the oracle when there is no Chainlink feed on the chain.
  const oracle = new ethers.Contract(
    record.oracle,
    [
      'function ethUsdFeed() view returns (address)',
      'function setManualEthUsdPrice(uint256 price) external',
      'function marketCap() view returns (uint256)',
    ],
    deployer,
  );
  let feed = ethers.ZeroAddress;
  try {
    feed = await oracle.ethUsdFeed();
  } catch {
    /* feed accessor missing: treat as manual */
  }
  if (feed === ethers.ZeroAddress) {
    const price8 = ethers.parseUnits(manualEthUsd, 8);
    await (await oracle.setManualEthUsdPrice(price8)).wait();
    console.log(`oracle:       manual ETH/USD set to $${manualEthUsd}`);
  }
  try {
    const cap: bigint = await oracle.marketCap();
    console.log(`market cap:   $${Number(ethers.formatUnits(cap, 18)).toLocaleString('en-US')}`);
  } catch (e) {
    console.log(`WARNING: marketCap() reverted: ${(e as Error).message?.slice(0, 140)}`);
  }

  // 6. Fund the redemption pool through the existing fund script (it also
  // prints the outstanding liability).
  const fundResult = spawnSync(`npx hardhat run scripts/fund-pool.ts --network ${network.name}`, {
    shell: true,
    stdio: 'inherit',
    env: { ...childEnv, FUND_ETH: fundEth },
  });
  if (fundResult.status !== 0) throw new Error('fund-pool.ts failed - see output above');

  // 7. Enter the draw from the first trader wallet (it holds POKE).
  const trader = new ethers.Wallet(traders[0].privateKey, ethers.provider);
  const cards = new ethers.Contract(
    record.cards,
    ['function enterDraw()', 'function entrantCount() view returns (uint256)'],
    trader,
  );
  await (await cards.enterDraw()).wait();
  console.log(`draw:         ${trader.address} entered (${await cards.entrantCount()} in the draw)`);

  // 8. Hand off: print the site envs, then run the keeper in this console.
  const rpcUrl = isMainnet ? MAINNET_RPC : TESTNET_RPC;
  console.log('\n=== Point the site at this stack ===');
  console.log(`VITE_ROBINHOOD_TESTNET=${isMainnet ? '  # unset = mainnet' : '1'}`);
  console.log(`VITE_TOKEN_ADDRESS=${record.token}`);
  console.log(`VITE_CARDS_ADDRESS=${record.cards}`);
  console.log(`VITE_ORACLE_ADDRESS=${record.oracle}`);
  console.log(`VITE_SALE_ADDRESS=  # skipped (DEPLOY_SALE=0)`);
  console.log(`VITE_SWAP_ADDRESS=${record.swap}`);

  // Single-wallet smoke run: when no dedicated keeper key is configured the
  // deployer acts as the keeper (the deploy already defaults KEEPER_ADDRESS
  // to the deployer), so only one funded wallet is needed.
  const keeperKey = process.env.KEEPER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (process.env.START_KEEPER === '0') {
    console.log('\nkeeper not started (START_KEEPER=0). Start it with:');
    console.log(
      `  KEEPER_PRIVATE_KEY=*** CARDS_ADDRESS=${record.cards} KEEPER_RPC_URL=${rpcUrl} npm run keeper`,
    );
    return;
  }
  if (!keeperKey) {
    console.log('\nno PRIVATE_KEY/KEEPER_PRIVATE_KEY in contracts/.env - start the keeper with:');
    console.log(
      `  KEEPER_PRIVATE_KEY=*** CARDS_ADDRESS=${record.cards} KEEPER_RPC_URL=${rpcUrl} npm run keeper`,
    );
    return;
  }

  console.log('\n=== Keeper starting (Ctrl+C stops it) ===');
  console.log('it will checkpoint the cap, confirm the first crossing, wait the');
  console.log(`${confirmWindow}s window, and airdrop card #1 to the drawn holder`);
  const keeper = spawn(
    'npm run keeper',
    [],
    {
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        KEEPER_PRIVATE_KEY: keeperKey,
        CARDS_ADDRESS: record.cards,
        KEEPER_RPC_URL: rpcUrl,
        CURVE_ADDRESS: curveAddress,
        INTERVAL_MS: process.env.INTERVAL_MS ?? '15000',
      },
    },
  );
  keeper.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
