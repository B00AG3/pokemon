import * as fs from 'node:fs';
import * as path from 'node:path';
import { ethers, network } from 'hardhat';

/**
 * One-shot market seeder: walks the mock oracle up the first N milestones
 * and mints each card through the keeper (honoring the confirm window),
 * then lists the minted cards on CardSale. When a KEEPER_PRIVATE_KEY is
 * configured, minting runs through that dedicated wallet exactly like the
 * production keeper flow.
 *
 * Env:
 *   SEED_MILESTONES   how many of the first milestones to mint (default 3)
 *
 * Run: npm run seed:testnet
 */
async function main() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;
  const record = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../deployments/${network.name}.json`), 'utf8'),
  ) as { oracle: string; cards: string; sale: string | null; keeper: string; thresholds: string[]; confirmWindow: string };

  const count = Number(process.env.SEED_MILESTONES ?? '3');
  const oracle = await ethers.getContractAt('MockMilestonePriceOracle', record.oracle);
  const cards = await ethers.getContractAt('MilestoneCards', record.cards);
  const sale = record.sale ? await ethers.getContractAt('CardSale', record.sale) : null;

  // mint through the dedicated keeper wallet when one is configured
  const keeper =
    signers.find((s) => s.address.toLowerCase() === record.keeper.toLowerCase()) ?? deployer;
  console.log('Seeding', count, 'milestones on', network.name, '| keeper:', keeper.address);

  const window = BigInt(record.confirmWindow ?? '0');
  const minted: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const threshold = BigInt(record.thresholds[i]);
    await (await oracle.setMarketCap(threshold)).wait();

    // real keeper flow: confirm the crossing, then wait out the window
    await (await cards.connect(keeper).confirmCrossing()).wait();
    if (window > 0n) {
      const crossed: bigint = await cards.crossingAt(BigInt(i));
      const readyAt = Number(crossed) * 1000 + Number(window) * 1000;
      const waitMs = Math.max(0, readyAt - Date.now()) + 2_000;
      console.log(`  confirm window: waiting ${Math.ceil(waitMs / 1000)}s for milestone #${i + 1}`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    await (await cards.connect(keeper).mintNext()).wait();
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
