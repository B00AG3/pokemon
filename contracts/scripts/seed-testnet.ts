import * as fs from 'node:fs';
import * as path from 'node:path';
import { ethers, network } from 'hardhat';

/**
 * One-shot market seeder for the airdrop draw: funds a couple of extra
 * wallets, gives them POKE, has them enter the standing draw, then walks the
 * mock oracle up the first N milestones and mints each card through the
 * keeper (honoring the confirm window). Every mint airdrops its card to a
 * random entrant - the point of seeding is to have real competition in the
 * draw and real winner addresses on the testnet market.
 *
 * Env:
 *   SEED_MILESTONES   how many of the first milestones to mint (default 3)
 *   SEED_HOLDERS      extra entrant wallets to fund (default 2, max 5)
 *
 * Run: npm run seed:testnet
 */
async function main() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;
  const record = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../deployments/${network.name}.json`), 'utf8'),
  ) as { oracle: string; cards: string; token: string; keeper: string; thresholds: string[]; confirmWindow: string };

  const count = Number(process.env.SEED_MILESTONES ?? '3');
  const holderCount = Math.min(5, Math.max(0, Number(process.env.SEED_HOLDERS ?? '2')));
  const oracle = await ethers.getContractAt('MockMilestonePriceOracle', record.oracle);
  const cards = await ethers.getContractAt('MilestoneCards', record.cards);
  const token = await ethers.getContractAt('PokeCardToken', record.token);

  // mint through the dedicated keeper wallet when one is configured
  const keeper =
    signers.find((s) => s.address.toLowerCase() === record.keeper.toLowerCase()) ?? deployer;
  console.log('Seeding', count, 'milestones on', network.name, '| keeper:', keeper.address);

  // fund extra entrants: a little ETH for gas and a little POKE so they pass
  // the holder check (one entry per wallet, any balance counts). With a
  // launchpad token the deployer must hold POKE first (buy some on the
  // launchpad); if the balance is zero we seed with the deployer alone.
  const fundPerWallet = ethers.parseEther('0.001');
  const pokeStake = 1_000n * 10n ** (await token.decimals());
  const deployerPoke: bigint = await token.balanceOf(deployer.address);
  const canFund = deployerPoke > pokeStake * BigInt(holderCount);
  if (!canFund) {
    console.log('deployer holds no POKE to distribute - skipping extra entrants');
    console.log('(buy POKE on the launchpad, then re-run with SEED_HOLDERS)');
  }
  for (let i = 0; i < (canFund ? holderCount : 0); i++) {
    const entrant = ethers.Wallet.createRandom().connect(ethers.provider);
    await (await deployer.sendTransaction({ to: entrant.address, value: fundPerWallet })).wait();
    await (await token.transfer(entrant.address, pokeStake)).wait();
    await (await cards.connect(entrant).enterDraw()).wait();
    console.log(`entrant ${i + 1}: ${entrant.address} (${ethers.formatEther(pokeStake)} POKE)`);
  }

  // the deployer holds the bulk of POKE and enters too, so every draw has
  // at least holderCount + 1 candidates
  if (!(await cards.isEntered(deployer.address))) {
    await (await cards.connect(deployer).enterDraw()).wait();
    console.log('entrant: deployer', deployer.address);
  }

  const window = BigInt(record.confirmWindow ?? '0');
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

    const tx = await (await cards.connect(keeper).mintNext()).wait();
    const minted = tx?.logs
      .map((log) => {
        try {
          return cards.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === 'MilestoneMinted');
    const winner = (minted?.args?.to as string) ?? 'unknown';
    console.log(`airdropped card #${i + 1} at $${threshold / 10n ** 18n} market cap -> ${winner}`);
  }

  // leave the market cap above the last minted milestone
  const finalCap = BigInt(record.thresholds[Math.min(count, record.thresholds.length) - 1]);
  await (await oracle.setMarketCap(finalCap)).wait();
  console.log('oracle market cap set to $' + (finalCap / 10n ** 18n).toString());
  console.log('entrants in the standing draw:', (await cards.entrantCount()).toString());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
