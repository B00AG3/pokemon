import * as fs from 'node:fs';
import * as path from 'node:path';
import { ethers, network } from 'hardhat';

const THRESHOLDS_DEFAULT = '10000,25000,50000,100000,250000,500000,1000000';

/**
 * Deploys MilestoneCards (+ MockMilestonePriceOracle when MOCK_ORACLE=1,
 * which is the default on local/testnet networks). The POKE token itself can
 * come from anywhere - set TOKEN_ADDRESS to point at an existing ERC-20
 * (e.g. a launchpad token) and it is used as-is; the draw only reads
 * balanceOf. Without TOKEN_ADDRESS a fresh PokeCardToken is deployed.
 *
 * Env:
 *   TOKEN_ADDRESS=       existing POKE ERC-20 (launchpad token) to bind instead of deploying
 *   MOCK_ORACLE=1        deploy the mock oracle (testnet/local runs; refused on mainnet)
 *   ORACLE_ADDRESS=      production oracle when not mocking; unset + V4_* or V3_*
 *                        vars deploys a fresh spot oracle instead
 *   V3_POOL_ADDRESS=     Pons path: the token's Uniswap v3 pool. Unset with a
 *                        Pons TOKEN_ADDRESS auto-discovers it via liquidityPool()
 *   V3_WETH_ADDRESS=     WETH the pool is quoted against (default: Robinhood mainnet WETH)
 *   V4_STATEVIEW_ADDRESS=  v4 StateView to read the pool from (v4 oracle deploy)
 *   V4_WETH_ADDRESS=       WETH of the pool (v4 oracle deploy)
 *   ETH_USD_FEED_ADDRESS=  Chainlink ETH/USD aggregator (oracle deploy, optional;
 *                          without it the owner sets a manual price post-deploy)
 *   V4_POOL_FEE / V4_TICK_SPACING / V4_HOOKS = pool key of the POKE pool (v4 oracle deploy)
 *   ORACLE_MAX_STALENESS=  seconds for the ETH/USD feed (default 3600)
 *   THRESHOLDS=          comma-separated USD market cap milestones
 *   CONFIRM_WINDOW=      seconds the cap must hold above the threshold (0 = instant)
 *   REDEEM_DELAY=        seconds a cap checkpoint must age before pricing redemptions (default 21600)
 *   BASE_TOKEN_URI=      metadata base URI, e.g. ipfs://<cid>/
 *   KEEPER_ADDRESS=      address allowed to mint (defaults to deployer)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const mock =
    process.env.MOCK_ORACLE === '1' ||
    network.name === 'hardhat' ||
    network.name === 'localhost';
  if (mock && network.name === 'robinhoodMainnet') {
    throw new Error('MOCK_ORACLE=1 (or no oracle config) is not allowed on robinhoodMainnet');
  }

  const thresholds = (process.env.THRESHOLDS ?? THRESHOLDS_DEFAULT)
    .split(',')
    .map((s) => BigInt(s.trim()) * 10n ** 18n);
  const confirmWindow = BigInt(process.env.CONFIRM_WINDOW ?? '0');
  const redeemDelay = BigInt(process.env.REDEEM_DELAY ?? '21600');
  const baseTokenURI = process.env.BASE_TOKEN_URI ?? 'ipfs://pokecard-lab/';
  const keeper = process.env.KEEPER_ADDRESS ?? deployer.address;

  console.log('Deployer:', deployer.address, 'network:', network.name);

  // Bind the draw to an existing ERC-20 (launchpad launch) or deploy our own.
  let tokenAddress: string;
  if (process.env.TOKEN_ADDRESS) {
    tokenAddress = process.env.TOKEN_ADDRESS;
    console.log('POKE token (external, launchpad):', tokenAddress);
  } else {
    const token = await (await ethers.getContractFactory('PokeCardToken')).deploy(deployer.address);
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    console.log('PokeCardToken:', tokenAddress);
  }

  let oracleAddress: string;
  let oracleKind: 'mock' | 'external' | 'v4' | 'v3';
  if (mock) {
    const oracle = await (await ethers.getContractFactory('MockMilestonePriceOracle')).deploy();
    await oracle.waitForDeployment();
    oracleAddress = await oracle.getAddress();
    oracleKind = 'mock';
    console.log('MockMilestonePriceOracle:', oracleAddress);
  } else if (process.env.ORACLE_ADDRESS) {
    oracleAddress = process.env.ORACLE_ADDRESS;
    oracleKind = 'external';
  } else if (process.env.V4_STATEVIEW_ADDRESS && process.env.V4_WETH_ADDRESS) {
    const poolKey = {
      currency0: tokenAddress.toLowerCase() < process.env.V4_WETH_ADDRESS.toLowerCase()
        ? tokenAddress
        : process.env.V4_WETH_ADDRESS,
      currency1: tokenAddress.toLowerCase() < process.env.V4_WETH_ADDRESS.toLowerCase()
        ? process.env.V4_WETH_ADDRESS
        : tokenAddress,
      fee: Number(process.env.V4_POOL_FEE ?? '3000'),
      tickSpacing: Number(process.env.V4_TICK_SPACING ?? '60'),
      hooks: process.env.V4_HOOKS ?? ethers.ZeroAddress,
    };
    const oracle = await (await ethers.getContractFactory('UniswapV4SpotOracle')).deploy(
      process.env.V4_STATEVIEW_ADDRESS,
      tokenAddress,
      process.env.V4_WETH_ADDRESS,
      poolKey,
      process.env.ETH_USD_FEED_ADDRESS ?? ethers.ZeroAddress,
      BigInt(process.env.ORACLE_MAX_STALENESS ?? '3600'),
    );
    await oracle.waitForDeployment();
    oracleAddress = await oracle.getAddress();
    oracleKind = 'v4';
    console.log('UniswapV4SpotOracle:', oracleAddress, 'pool fee', poolKey.fee, 'spacing', poolKey.tickSpacing);
  } else {
    // Pons path: tokens launch straight into a Uniswap v3 pool against WETH.
    // The pool comes from V3_POOL_ADDRESS or the token's own liquidityPool().
    const v3Weth = process.env.V3_WETH_ADDRESS ?? '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
    let poolAddress = process.env.V3_POOL_ADDRESS;
    if (!poolAddress) {
      try {
        poolAddress = await new ethers.Contract(
          tokenAddress,
          ['function liquidityPool() view returns (address)'],
          deployer,
        ).liquidityPool();
      } catch {
        /* not a Pons-style token; fall through to the error below */
      }
    }
    if (!poolAddress || poolAddress === ethers.ZeroAddress) {
      throw new Error(
        'Set ORACLE_ADDRESS, V4_STATEVIEW_ADDRESS + V4_WETH_ADDRESS, or V3_POOL_ADDRESS (or launch via Pons so liquidityPool() resolves) when MOCK_ORACLE is not 1',
      );
    }
    const oracle = await (await ethers.getContractFactory('UniswapV3SpotOracle')).deploy(
      poolAddress,
      tokenAddress,
      v3Weth,
      process.env.ETH_USD_FEED_ADDRESS ?? ethers.ZeroAddress,
      BigInt(process.env.ORACLE_MAX_STALENESS ?? '3600'),
    );
    await oracle.waitForDeployment();
    oracleAddress = await oracle.getAddress();
    oracleKind = 'v3';
    console.log('UniswapV3SpotOracle:', oracleAddress, 'pool', poolAddress, 'weth', v3Weth);
  }
  if (!mock) {
    // 0 is expected before the pool is seeded; a revert means wiring trouble
    try {
      const cap = await new ethers.Contract(oracleAddress, ['function marketCap() view returns (uint256)'], deployer).marketCap();
      console.log('  live marketCap read:', ethers.formatUnits(cap, 18), 'USD (0 means the pool is not seeded yet)');
    } catch (e) {
      console.log('  WARNING: marketCap() reverted - check the oracle wiring:', (e as Error).message?.slice(0, 120));
    }
  }

  const redeemBasePrice = BigInt(process.env.REDEEM_BASE_PRICE_WEI ?? (10n ** 16n).toString());
  const cards = await (
    await ethers.getContractFactory('MilestoneCards')
  ).deploy(oracleAddress, keeper, tokenAddress, redeemBasePrice, baseTokenURI, thresholds, confirmWindow, redeemDelay);
  await cards.waitForDeployment();
  const cardsAddress = await cards.getAddress();
  console.log(
    'MilestoneCards:',
    cardsAddress,
    '(airdrop draw on',
    tokenAddress + ', redeem base',
    ethers.formatEther(redeemBasePrice),
    'ETH)',
  );

  // Optional treasury fallback sale: dynamic pricing that tracks market cap.
  // Milestone cards airdrop to drawn holders, so this only ever moves
  // treasury-held fallback cards. DEPLOY_SALE=1 to deploy it.
  let saleAddress: string | null = null;
  if (process.env.DEPLOY_SALE === '1') {
    const basePriceWei = BigInt(process.env.SALE_BASE_PRICE_WEI ?? (10n ** 16n).toString());
    const sale = await (
      await ethers.getContractFactory('CardSale')
    ).deploy(cardsAddress, oracleAddress, basePriceWei);
    await sale.waitForDeployment();
    saleAddress = await sale.getAddress();
    // let the sale move treasury-held cards, then list every minted card
    await (await cards.connect(deployer).setApprovalForAll(saleAddress, true)).wait();
    console.log('CardSale:', saleAddress, '(treasury approved)');
  }

  // Peer-to-peer secondary market (escrowed listings + card-for-card swaps).
  const swap = await (await ethers.getContractFactory('CardSwap')).deploy(cardsAddress);
  await swap.waitForDeployment();
  const swapAddress = await swap.getAddress();
  console.log('CardSwap:', swapAddress);

  const record = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    keeper,
    token: tokenAddress,
    oracle: oracleAddress,
    oracleKind,
    deployedOracle: oracleKind === 'v3' || oracleKind === 'v4',
    mockOracle: mock,
    cards: cardsAddress,
    sale: saleAddress,
    swap: swapAddress,
    thresholds: thresholds.map(String),
    confirmWindow: String(confirmWindow),
    redeemDelay: String(redeemDelay),
    redeemBasePriceWei: String(redeemBasePrice),
    baseTokenURI,
  };
  const dir = path.resolve(__dirname, '../deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(record, null, 2));
  console.log('Saved to deployments/' + network.name + '.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
