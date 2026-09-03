import * as fs from 'node:fs';
import * as path from 'node:path';
import { ethers, network } from 'hardhat';

/**
 * One-shot market seeder for testnet demos: walks the mock oracle up the
 * first N milestones, mints each card (confirmWindow must be 0 or already
 * elapsed), and lists the minted cards on CardSale.
 *
 * Env:
 *   SEED_MILESTONES   how many of the first milestones to mint (default 3)
 *
 * Run: npm run seed:testnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const record = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../deployments/${network.name}.json`), 'utf8'),
  ) as { oracle: string; cards: string; sale: string | null; thresholds: string[] };

  const count = Number(process.env.SEED_MILESTONES ?? '3');
  const oracle = await ethers.getContractAt('MockMilestonePriceOracle', record.oracle);
  const cards = await ethers.getContractAt('MilestoneCards', record.cards);
  const sale = record.sale ? await ethers.getContractAt('CardSale', record.sale) : null;

  console.log('Seeding', count, 'milestones on', network.name);

  const minted: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const threshold = BigInt(record.thresholds[i]);
    await (await oracle.setMarketCap(threshold)).wait();
    await (await cards.connect(deployer).confirmCrossing()).wait();
    await (await cards.connect(deployer).mintNext()).wait();
    minted.push(BigInt(i + 1));
    console.log(`minted card #${i + 1} at $${threshold / 10n ** 18n} market cap`);
  }

  if (sale) {
    await (await sale.connect(deployer).list(minted)).wait();
    console.log('listed on CardSale:', minted.map(String).join(', '));
  }

  // leave the market cap above the last minted milestone so prices read live
  const finalCap = BigInt(record.thresholds[Math.min(count, record.thresholds.length) - 1]);
  await (await oracle.setMarketCap(finalCap)).wait();
  console.log('oracle market cap set to $' + (finalCap / 10n ** 18n).toString());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
