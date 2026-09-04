import * as fs from 'node:fs';
import * as path from 'node:path';
import { ethers, network } from 'hardhat';

/**
 * One-off ops grant for the testnet deployment: mints every remaining
 * milestone card to the treasury owner (the old pre-draw contract mints to
 * owner(), which here is the deployer) so the requested wallet ends up
 * holding them. Cards owned by other wallets are out of reach - their keys
 * were never persisted.
 *
 * Run: npx hardhat run scripts/grant-cards.ts --network robinhoodTestnet
 */
async function main() {
  const record = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../deployments/${network.name}.json`), 'utf8'),
  ) as {
    deployer: string;
    oracle: string;
    cards: string;
    thresholds: string[];
    confirmWindow: string;
  };

  const [deployer] = await ethers.getSigners();
  if (deployer.address.toLowerCase() !== record.deployer.toLowerCase()) {
    throw new Error('signer is not the deployment deployer');
  }
  const oracle = await ethers.getContractAt('MockMilestonePriceOracle', record.oracle);
  const cards = await ethers.getContractAt('MilestoneCards', record.cards);

  const ONE = 10n ** 18n;
  const window = BigInt(record.confirmWindow ?? '0');
  console.log('granting remaining milestone cards to', record.deployer);

  for (let loop = 0; loop < 20; loop++) {
    const [index, threshold] = await cards.nextMilestone();
    if (index === ethers.MaxUint256) break;
    const i = Number(index);

    await (await oracle.setMarketCap(threshold)).wait();
    await (await cards.connect(deployer).confirmCrossing()).wait();

    if (window > 0n) {
      const crossed: bigint = await cards.crossingAt(BigInt(i));
      const readyAt = Number(crossed) * 1000 + Number(window) * 1000;
      const waitMs = Math.max(0, readyAt - Date.now()) + 1_500;
      console.log(`  milestone #${i + 1}: confirm window, waiting ${Math.ceil(waitMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    await (await cards.connect(deployer).mintNext()).wait();
    console.log(`  minted card #${i + 1} at $${threshold / ONE} market cap`);
  }

  console.log('\nfinal card ownership:');
  for (let i = 1; i <= record.thresholds.length; i++) {
    let owner: string;
    try {
      owner = await cards.ownerOf(BigInt(i));
    } catch {
      owner = 'unminted';
    }
    console.log(`  card #${String(i).padStart(2, '0')}: ${owner}`);
  }
  const balance = await cards.balanceOf(record.deployer);
  console.log(`\n${record.deployer} holds ${balance.toString()} milestone cards`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
