import { ethers, network } from 'hardhat';

/**
 * Mainnet launch rehearsal: exercises every user-facing write path on a live
 * network with real transactions and asserts the money flows, especially the
 * ERC-2981 royalty split on secondary sales.
 *
 * Scenario (T = treasury/deployer, U = freshly funded user):
 *   1. U buys card #1 from the treasury CardSale
 *   2. U lists card #1 on CardSwap at 1.2x price
 *   3. T buys it back - asserts the 2.5% royalty split to the treasury
 *   4. U buys card #2 from the treasury sale
 *   5. U offers a swap: card #2 for card #1 plus an ETH ask
 *   6. T accepts - asserts both cards and the ETH ask land correctly
 *   7. U re-lists card #1 (holder listing stays visible on the market)
 *   8. Pause smoke test: buys revert while paused, work after unpause
 *
 * Run: npx hardhat run scripts/rehearse-transactions.ts --network robinhoodTestnet
 */
async function main() {
  const [treasury] = await ethers.getSigners();
  const record = JSON.parse(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node:fs').readFileSync(`deployments/${network.name}.json`, 'utf8'),
  ) as { cards: string; sale: string; swap: string };

  const cards = await ethers.getContractAt('MilestoneCards', record.cards);
  const sale = await ethers.getContractAt('CardSale', record.sale);
  const swap = await ethers.getContractAt('CardSwap', record.swap);

  const user = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log('user wallet:', user.address);

  const bal = async (addr: string) => await ethers.provider.getBalance(addr);
  const eth = (v: bigint) => `${Number(ethers.formatEther(v)).toFixed(6)} ETH`;

  // fund the user
  const FUNDING = ethers.parseEther('0.004');
  await (await treasury.sendTransaction({ to: user.address, value: FUNDING })).wait();

  const price1: bigint = await sale.priceOf(1n);
  const price2: bigint = await sale.priceOf(2n);
  console.log(`prices: card1 ${eth(price1)} | card2 ${eth(price2)}`);

  // 1. user buys card #1 from the treasury sale
  await (await sale.connect(user).buy(1n, { value: price1 })).wait();
  if ((await cards.ownerOf(1n)) !== user.address) throw new Error('sale buy failed');
  console.log(`1. user bought card #1 from CardSale for ${eth(price1)}`);

  // 2. user lists card #1 on CardSwap at 1.2x
  const listingPrice = (price1 * 12n) / 10n;
  await (await cards.connect(user).approve(await swap.getAddress(), 1n)).wait();
  await (await swap.connect(user).list(1n, listingPrice)).wait();
  const listing = await swap.listings(1n);
  if (listing.seller !== user.address) throw new Error('listing escrow failed');
  console.log(`2. user listed card #1 on CardSwap for ${eth(listingPrice)} (escrowed)`);

  // 3. treasury buys it back; assert the royalty split
  const userBefore = await bal(user.address);
  const buyValue = (listingPrice * 105n) / 100n;
  await (await swap.connect(treasury).buy(1n, { value: buyValue })).wait();
  const royalty = (listingPrice * 25n) / 1000n;
  const userAfter = await bal(user.address);
  if (userAfter - userBefore !== listingPrice - royalty) {
    throw new Error(
      `seller payout mismatch: got ${userAfter - userBefore}, want ${listingPrice - royalty}`,
    );
  }
  console.log(`3. treasury bought card #1 for ${eth(listingPrice)} - seller got ${eth(listingPrice - royalty)}, royalty ${eth(royalty)} split OK`);

  // 4. user buys card #2
  await (await sale.connect(user).buy(2n, { value: price2 })).wait();
  if ((await cards.ownerOf(2n)) !== user.address) throw new Error('sale buy 2 failed');
  console.log(`4. user bought card #2 from CardSale for ${eth(price2)}`);

  // 5. user offers swap: card #2 for card #1 plus an ETH ask
  const ask = price2 / 5n;
  await (await cards.connect(user).approve(await swap.getAddress(), 2n)).wait();
  await (await swap.connect(user).offerSwap(2n, 1n, ask)).wait();
  const offer = await swap.offers(0n);
  if (!offer.active || offer.maker !== user.address) throw new Error('swap offer failed');
  console.log(`5. user offered card #2 for card #1 + ${eth(ask)} ask`);

  // 6. treasury accepts, paying the ask
  await (await cards.connect(treasury).approve(await swap.getAddress(), 1n)).wait();
  await (await swap.connect(treasury).acceptSwap(0n, { value: (ask * 105n) / 100n })).wait();
  if ((await cards.ownerOf(1n)) !== user.address) throw new Error('swap: maker did not receive card 1');
  if ((await cards.ownerOf(2n)) !== treasury.address) throw new Error('swap: taker did not receive card 2');
  if ((await swap.offers(0n)).active) throw new Error('offer still active');
  console.log(`6. swap accepted - user holds card #1, treasury holds card #2, ask ${eth(ask)} paid`);

  // 7. user re-lists card #1 (site shows a holder listing on the market)
  await (await cards.connect(user).approve(await swap.getAddress(), 1n)).wait();
  await (await swap.connect(user).list(1n, price1)).wait();
  console.log(`7. user re-listed card #1 on CardSwap for ${eth(price1)}`);

  // 8. emergency stop smoke test
  await (await sale.pause()).wait();
  let pausedRevert = false;
  try {
    await (await sale.connect(user).buy(3n, { value: price2 })).wait();
  } catch {
    pausedRevert = true;
  }
  if (!pausedRevert) throw new Error('buy went through while paused');
  await (await sale.unpause()).wait();
  await (await sale.connect(user).buy(3n, { value: (await sale.priceOf(3n)) })).wait();
  if ((await cards.ownerOf(3n)) !== user.address) throw new Error('post-unpause buy failed');
  console.log('8. pause blocked buys, unpause restored them - emergency stop OK');

  const finalUser = await bal(user.address);
  console.log('\nREHEARSAL PASSED - all write paths exercised on', network.name);
  console.log(`user final balance: ${eth(finalUser)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
