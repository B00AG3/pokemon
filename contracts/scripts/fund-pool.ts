import * as fs from 'node:fs';
import * as path from 'node:path';
import { ethers, network } from 'hardhat';

/**
 * Funds the MilestoneCards redemption pool and reports its liability.
 *
 * Where redemption money comes from: a holder who redeems is paid from the ETH
 * balance of the MilestoneCards contract. Nothing funds it automatically, so
 * run this after deploying and whenever income lands (Pons creator fees,
 * CardSwap royalties). Default run is a dry report; set FUND_ETH to send.
 *
 *   FUND_ETH=0.05        send exactly this much ETH from the signer
 *   MATCH_LIABILITY=1    send exactly the outstanding liability instead
 *
 * Env:
 *   CARDS_ADDRESS   deployed MilestoneCards (or deployments/<network>.json)
 *
 * Run: npx hardhat run scripts/fund-pool.ts --network robinhoodMainnet
 */
async function main() {
  const [signer] = await ethers.getSigners();
  const recordPath = path.resolve(__dirname, '../deployments', `${network.name}.json`);
  let cardsAddress = process.env.CARDS_ADDRESS;
  if (!cardsAddress && fs.existsSync(recordPath)) {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as { cards?: string };
    cardsAddress = record.cards;
  }
  if (!cardsAddress) throw new Error('CARDS_ADDRESS is required (or deploy first so the record exists)');

  const cards = await ethers.getContractAt('MilestoneCards', cardsAddress);
  const oracleAddress = await cards.oracle();
  const oracle = new ethers.Contract(oracleAddress, ['function marketCap() view returns (uint256)'], signer);

  const base = await cards.redeemBasePrice();
  const total = await cards.totalMilestones();
  const cap: bigint = await oracle.marketCap();
  const poolBefore = await ethers.provider.getBalance(cardsAddress);

  console.log(`MilestoneCards ${cardsAddress} on ${network.name}`);
  console.log(`redemption pool: ${ethers.formatEther(poolBefore)} ETH | redeem base: ${ethers.formatEther(base)} ETH`);

  let chartReady = true;
  let outstanding = 0n; // ETH needed to back every minted, un-redeemed card right now
  let minted = 0n;
  for (let i = 1n; i <= total; i++) {
    const [, isMinted] = await cards.milestoneAt(i - 1n);
    if (!isMinted) continue;
    minted++;
    try {
      await cards.ownerOf(i); // burned cards carry no liability
    } catch {
      continue;
    }
    try {
      outstanding += await cards.chartPriceOf(i);
    } catch {
      chartReady = false; // ChartNotReady until the first checkpoint ages
    }
  }
  if (!chartReady) {
    console.log('chart values not seasoned yet (first checkpoint aging): liability shown by formula instead');
    outstanding = 0n;
    for (let i = 1n; i <= total; i++) {
      const [threshold, isMinted] = await cards.milestoneAt(i - 1n);
      if (!isMinted) continue;
      try {
        await cards.ownerOf(i);
      } catch {
        continue;
      }
      outstanding += (base * cap) / threshold;
    }
  }

  // worst case if the cap holds where it is and every remaining slot mints
  let worstCase = 0n;
  for (let i = 0n; i < total; i++) {
    const [threshold] = await cards.milestoneAt(i);
    worstCase += (base * cap) / threshold;
  }

  console.log(`market cap: $${ethers.formatUnits(cap, 18)} | cards minted: ${minted}/${total}`);
  console.log(`outstanding liability (minted, unredeemed): ${ethers.formatEther(outstanding)} ETH`);
  console.log(`worst case at the current cap (all slots mint): ${ethers.formatEther(worstCase)} ETH`);

  const fundEth = process.env.MATCH_LIABILITY === '1' ? outstanding : process.env.FUND_ETH ? ethers.parseEther(process.env.FUND_ETH) : null;
  if (fundEth === null) {
    console.log('\ndry run - set FUND_ETH=<amount> or MATCH_LIABILITY=1 to fund the pool');
    return;
  }
  if (fundEth === 0n) {
    console.log('\nnothing to fund: outstanding liability is already 0');
    return;
  }

  const tx = await signer.sendTransaction({ to: cardsAddress, value: fundEth });
  await tx.wait();
  const poolAfter = await ethers.provider.getBalance(cardsAddress);
  console.log(`\nfunded ${ethers.formatEther(fundEth)} ETH - tx ${tx.hash}`);
  console.log(`pool now: ${ethers.formatEther(poolAfter)} ETH | covers outstanding: ${poolAfter >= outstanding ? 'yes' : 'NO - fund more'}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
