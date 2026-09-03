import * as fs from 'node:fs';
import * as path from 'node:path';
import { ethers, network } from 'hardhat';

const THRESHOLDS_DEFAULT = '5000,10000,25000,50000,100000,250000,500000,1000000';

/**
 * Deploys PokeCardToken + MilestoneCards (+ MockMilestonePriceOracle when
 * MOCK_ORACLE=1, which is the default on local/testnet networks).
 *
 * Env:
 *   MOCK_ORACLE=1        deploy the mock oracle (testnet/local runs)
 *   ORACLE_ADDRESS=      production oracle (Uniswap TWAP adapter) when not mocking
 *   THRESHOLDS=          comma-separated USD market cap milestones
 *   CONFIRM_WINDOW=      seconds the cap must hold above the threshold (0 = instant)
 *   BASE_TOKEN_URI=      metadata base URI, e.g. ipfs://<cid>/
 *   KEEPER_ADDRESS=      address allowed to mint (defaults to deployer)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const mock =
    process.env.MOCK_ORACLE === '1' ||
    network.name === 'hardhat' ||
    network.name === 'localhost';

  const thresholds = (process.env.THRESHOLDS ?? THRESHOLDS_DEFAULT)
    .split(',')
    .map((s) => BigInt(s.trim()) * 10n ** 18n);
  const confirmWindow = BigInt(process.env.CONFIRM_WINDOW ?? '0');
  const baseTokenURI = process.env.BASE_TOKEN_URI ?? 'ipfs://pokecard-lab/';
  const keeper = process.env.KEEPER_ADDRESS ?? deployer.address;

  let oracleAddress: string;
  if (mock) {
    const oracle = await (await ethers.getContractFactory('MockMilestonePriceOracle')).deploy();
    await oracle.waitForDeployment();
    oracleAddress = await oracle.getAddress();
    console.log('MockMilestonePriceOracle:', oracleAddress);
  } else {
    if (!process.env.ORACLE_ADDRESS) {
      throw new Error('ORACLE_ADDRESS is required when MOCK_ORACLE is not 1');
    }
    oracleAddress = process.env.ORACLE_ADDRESS;
  }

  console.log('Deployer:', deployer.address, 'network:', network.name);

  const token = await (await ethers.getContractFactory('PokeCardToken')).deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log('PokeCardToken:', tokenAddress);

  const cards = await (
    await ethers.getContractFactory('MilestoneCards')
  ).deploy(oracleAddress, keeper, baseTokenURI, thresholds, confirmWindow);
  await cards.waitForDeployment();
  const cardsAddress = await cards.getAddress();
  console.log('MilestoneCards:', cardsAddress);

  // Optional treasury sale contract: dynamic pricing that tracks market cap.
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
    mockOracle: mock,
    cards: cardsAddress,
    sale: saleAddress,
    swap: swapAddress,
    thresholds: thresholds.map(String),
    confirmWindow: String(confirmWindow),
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
