import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ethers, network } from 'hardhat';

/**
 * One-command mainnet smoke test (LAUNCH.md "Quick path"). Give it a Pons
 * token address and a funded deployer (PRIVATE_KEY in contracts/.env) and it
 * runs the whole loop: discovers the POKE/WETH pool, deploys a tiny swapper
 * helper, creates and funds throwaway trader wallets, buys POKE into them,
 * deploys the smoke stack (tiny thresholds, 60s windows), prices the oracle,
 * funds the redemption pool, enters the draw, and hands off to the keeper.
 *
 * Env (all optional unless noted):
 *   TOKEN_ADDRESS          REQUIRED - Pons-launched POKE ERC-20
 *   V3_POOL_ADDRESS        pool override (default: token.liquidityPool())
 *   V3_WETH_ADDRESS        WETH the pool is quoted against
 *                          (default: Robinhood mainnet WETH)
 *   SWAPPER_ADDRESS        reuse a previously deployed SmokeSwapper
 *   START_KEEPER           1 (default) = run the keeper when setup finishes
 *   DRY_RUN                1 = print the plan, touch nothing
 *
 * Smoke values (SMOKE_* below) are hardcoded to throwaway sizes and ignore
 * whatever THRESHOLDS/CONFIRM_WINDOW/... contracts/.env carries: this tool
 * must never deploy the real ladder by accident.
 *   SMOKE_THRESHOLDS          default 50,100,250
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

const WETH_DEFAULT = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const MAINNET_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com';
const SLIPPAGE_NUM = 9n; // accept fills down to 90% of spot
const SLIPPAGE_DEN = 10n;

const num = (name: string, fallback: string) => process.env[name] ?? fallback;

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
  const thresholds = num('SMOKE_THRESHOLDS', '50,100,250');
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
  console.log(`plan:         deploy swapper + smoke stack, create ${buyWallets} trader wallets,`);
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

  // 1. Discover the POKE/WETH pool (Pons tokens expose liquidityPool()).
  let poolAddress = process.env.V3_POOL_ADDRESS ?? null;
  if (!poolAddress) {
    try {
      poolAddress = await new ethers.Contract(
        tokenAddress,
        ['function liquidityPool() view returns (address)'],
        deployer,
      ).liquidityPool();
    } catch {
      /* not a Pons-style token */
    }
  }
  if (!poolAddress || poolAddress === ethers.ZeroAddress) {
    throw new Error('could not resolve the POKE pool: set V3_POOL_ADDRESS');
  }
  const pool = new ethers.Contract(
    poolAddress,
    [
      'function token0() view returns (address)',
      'function token1() view returns (address)',
      'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
    ],
    deployer,
  );
  const [token0, token1] = [await pool.token0(), await pool.token1()];
  const wethAddress = process.env.V3_WETH_ADDRESS ?? WETH_DEFAULT;
  if (
    wethAddress.toLowerCase() !== token0.toLowerCase() &&
    wethAddress.toLowerCase() !== token1.toLowerCase()
  ) {
    throw new Error(`WETH ${wethAddress} is not an end of pool ${poolAddress} (ends: ${token0} / ${token1})`);
  }
  const zeroForOne = token0.toLowerCase() === wethAddress.toLowerCase(); // sell WETH for POKE
  console.log(`pool:         ${poolAddress} (WETH ${zeroForOne ? 'token0' : 'token1'})`);

  // 2. Deploy (or reuse) the swap helper.
  let swapperAddress = process.env.SWAPPER_ADDRESS;
  if (!swapperAddress) {
    const swapper = await (await ethers.getContractFactory('SmokeSwapper')).deploy(wethAddress);
    await swapper.waitForDeployment();
    swapperAddress = await swapper.getAddress();
    console.log(`swapper:      ${swapperAddress} (throwaway helper)`);
  }

  // 3. Create and seed throwaway trader wallets.
  const walletsPath = path.resolve(__dirname, '../deployments', `${network.name}.smoke-wallets.json`);
  const traders: { address: string; privateKey: string }[] = [];
  for (let i = 0; i < buyWallets; i++) {
    const wallet = ethers.Wallet.createRandom();
    traders.push({ address: wallet.address, privateKey: wallet.privateKey });
  }
  fs.writeFileSync(walletsPath, JSON.stringify(traders, null, 2));
  console.log(
    `traders:      ${traders.map((t) => t.address).join(', ')}\n` +
      `              keys saved to ${path.basename(walletsPath)} (gitignored - do not commit)`,
  );
  for (const trader of traders) {
    const tx = await deployer.sendTransaction({
      to: trader.address,
      value: ethers.parseEther(buyEthPerWallet) + ethers.parseEther(traderGasEth),
    });
    await tx.wait();
    console.log(`  seeded ${trader.address} with ${(+buyEthPerWallet + +traderGasEth).toFixed(4)} ETH (${tx.hash})`);
  }

  // 4. Buy POKE into each trader wallet through the swapper.
  const [, sqrtPriceX96] = await pool.slot0();
  const sq = BigInt(sqrtPriceX96);
  const priceToken1PerToken0 = (sq * sq) / (1n << 192n); // both sides 18 decimals
  const spotOut = zeroForOne ? priceToken1PerToken0 : (1n << 192n) / priceToken1PerToken0;
  const swapper = new ethers.Contract(
    swapperAddress,
    ['function swapEthToToken(address pool, address outToken, address to, uint256 minOut) payable returns (uint256)'],
    deployer,
  );
  for (const trader of traders) {
    const minOut = (spotOut * ethers.parseEther(buyEthPerWallet) * SLIPPAGE_NUM) / SLIPPAGE_DEN;
    try {
      const tx = await swapper.swapEthToToken(poolAddress, tokenAddress, trader.address, minOut, {
        value: ethers.parseEther(buyEthPerWallet),
      });
      await tx.wait();
    } catch {
      // launch-protection blocks the first pools; wait it out and retry once
      console.log('  buy reverted (launch protection?) - retrying in 15s');
      await new Promise((r) => setTimeout(r, 15_000));
      const tx = await swapper.swapEthToToken(poolAddress, tokenAddress, trader.address, minOut, {
        value: ethers.parseEther(buyEthPerWallet),
      });
      await tx.wait();
    }
    const poke = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address) view returns (uint256)'],
      deployer,
    );
    console.log(`  ${trader.address}: ${ethers.formatEther(await poke.balanceOf(trader.address))} POKE`);
  }

  // 5. Deploy the smoke stack through the existing deploy script.
  console.log('\ndeploying the smoke stack...');
  const childEnv = {
    ...process.env,
    TOKEN_ADDRESS: tokenAddress,
    MOCK_ORACLE: '0',
    V3_POOL_ADDRESS: poolAddress,
    V3_WETH_ADDRESS: wethAddress,
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

  // 6. Price the oracle when there is no Chainlink feed on the chain.
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

  // 7. Fund the redemption pool through the existing fund script (it also
  // prints the outstanding liability).
  const fundResult = spawnSync(`npx hardhat run scripts/fund-pool.ts --network ${network.name}`, {
    shell: true,
    stdio: 'inherit',
    env: { ...childEnv, FUND_ETH: fundEth },
  });
  if (fundResult.status !== 0) throw new Error('fund-pool.ts failed - see output above');

  // 8. Enter the draw from the first trader wallet (it holds POKE).
  const trader = new ethers.Wallet(traders[0].privateKey, ethers.provider);
  const cards = new ethers.Contract(
    record.cards,
    ['function enterDraw()', 'function entrantCount() view returns (uint256)'],
    trader,
  );
  await (await cards.enterDraw()).wait();
  console.log(`draw:         ${trader.address} entered (${await cards.entrantCount()} in the draw)`);

  // 9. Hand off: print the site envs, then run the keeper in this console.
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
