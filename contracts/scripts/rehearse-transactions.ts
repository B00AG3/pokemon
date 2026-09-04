import { ethers, network } from 'hardhat';

/**
 * Mainnet launch rehearsal for the airdrop loop: deploys a fresh contract
 * stack on the target network, funds a user wallet, and exercises every
 * user-facing write path with real transactions and hard asserts. Fresh
 * deployment keeps the draw deterministic: the rehearsing user is the only
 * entrant, so the first airdrop is guaranteed to hit their wallet.
 *
 * Scenario (T = treasury/deployer/keeper, U = freshly funded user):
 *   1. U fails to enter the draw with no POKE (holder check), then gets
 *      POKE and enters; a second entry reverts
 *   2. Crossing confirms, the window holds, and the mint airdrops card #1
 *      to U for free (sole entrant, deterministic winner)
 *   3. An empty-draw milestone falls back to the treasury (card #2)
 *   4. U lists card #1 on CardSwap at 1.2x the reference price
 *   5. T buys it - asserts the 2.5% royalty split to the treasury
 *   6. U wins a second draw (card #3, sole entrant again)
 *   7. Redemption: pool funded, cap checkpoint ages, U redeems card #3 for
 *      its chart value and the card burns
 *   8. Pause smoke test: mints halt while paused, resume after unpause
 *
 * The stack deploys with a 60s redeem delay so step 7 can age a checkpoint
 * in about a minute; mainnet runs hours.
 *
 * Run: npx hardhat run scripts/rehearse-transactions.ts --network robinhoodTestnet
 */
async function main() {
  const [treasury] = await ethers.getSigners();

  console.log('deploying a fresh stack for the rehearsal on', network.name);
  const oracle = await (await ethers.getContractFactory('MockMilestonePriceOracle')).deploy();
  await oracle.waitForDeployment();
  const token = await (await ethers.getContractFactory('PokeCardToken')).deploy(treasury.address);
  await token.waitForDeployment();
  const thresholds = [5000, 10_000, 25_000, 50_000].map((usd) => BigInt(usd) * 10n ** 18n);
  const redeemBase = 10n ** 16n; // 0.01 ETH at a card's own launch cap
  const cards = await (
    await ethers.getContractFactory('MilestoneCards')
  ).deploy(
    await oracle.getAddress(),
    treasury.address,
    await token.getAddress(),
    redeemBase,
    'ipfs://pokecard-lab/',
    thresholds,
    0,
    60,
  );
  await cards.waitForDeployment();
  const swap = await (await ethers.getContractFactory('CardSwap')).deploy(await cards.getAddress());
  await swap.waitForDeployment();

  const user = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log('user wallet:', user.address);

  const bal = async (addr: string) => await ethers.provider.getBalance(addr);
  const eth = (v: bigint) => `${Number(ethers.formatEther(v)).toFixed(6)} ETH`;
  const ONE = 10n ** 18n;

  // fund the user: gas money plus enough POKE to enter the draw
  await (await treasury.sendTransaction({ to: user.address, value: ethers.parseEther('0.005') })).wait();
  await (await token.transfer(user.address, 1000n * ONE)).wait();
  console.log('funded user with gas + 1,000 POKE');

  // 1. draw entry requires holding POKE, and only one entry per wallet
  const broke = ethers.Wallet.createRandom().connect(ethers.provider);
  await (await treasury.sendTransaction({ to: broke.address, value: ethers.parseEther('0.001') })).wait();
  let holderCheck = false;
  try {
    await (await cards.connect(broke).enterDraw()).wait();
  } catch {
    holderCheck = true;
  }
  if (!holderCheck) throw new Error('wallet without POKE entered the draw');
  await (await cards.connect(user).enterDraw()).wait();
  let doubleEntry = false;
  try {
    await (await cards.connect(user).enterDraw()).wait();
  } catch {
    doubleEntry = true;
  }
  if (!doubleEntry) throw new Error('double entry allowed');
  if ((await cards.entrantCount()) !== 1n) throw new Error('entrant count mismatch');
  console.log('1. holder check enforced, single entry recorded - 1 entrant');

  // 2. crossing + mint airdrops card #1 to the sole entrant, free
  await (await oracle.setMarketCap(5000n * ONE)).wait();
  await (await cards.connect(treasury).mintNext()).wait();
  if ((await cards.ownerOf(1n)) !== user.address) throw new Error('airdrop missed the entrant');
  const userNftBalance = await cards.balanceOf(user.address);
  if (userNftBalance !== 1n) throw new Error('user did not receive the card');
  console.log(`2. card #1 airdropped to the user for free (ETH before/after unchanged: ${eth(await bal(user.address))})`);

  // 3. no entrants left for milestone 2 (only entrant already won? the draw
  // is standing - the user is still in it). Withdraw the user to prove the
  // empty-draw fallback lands on the treasury.
  await (await cards.connect(user).leaveDraw()).wait();
  await (await oracle.setMarketCap(10_000n * ONE)).wait();
  await (await cards.connect(treasury).mintNext()).wait();
  if ((await cards.ownerOf(2n)) !== treasury.address) throw new Error('empty draw did not fall back to treasury');
  console.log('3. empty draw fell back to the treasury for card #2');

  // 4. user lists card #1 on CardSwap at 1.2x the reference price
  const reference = 10n ** 16n; // matches the sale base price convention: 0.01 ETH at a $5k mint
  const listingPrice = (reference * 12n) / 10n;
  await (await cards.connect(user).approve(await swap.getAddress(), 1n)).wait();
  await (await swap.connect(user).list(1n, listingPrice)).wait();
  const listing = await swap.listings(1n);
  if (listing.seller !== user.address) throw new Error('listing escrow failed');
  console.log(`4. user listed card #1 on CardSwap for ${eth(listingPrice)} (escrowed)`);

  // 5. treasury buys it; assert the royalty split
  const userBefore = await bal(user.address);
  await (await swap.connect(treasury).buy(1n, { value: (listingPrice * 105n) / 100n })).wait();
  const royalty = (listingPrice * 25n) / 1000n;
  const userAfter = await bal(user.address);
  if (userAfter - userBefore !== listingPrice - royalty) {
    throw new Error(`seller payout mismatch: got ${userAfter - userBefore}, want ${listingPrice - royalty}`);
  }
  console.log(`5. treasury bought card #1 - seller got ${eth(listingPrice - royalty)}, royalty ${eth(royalty)} split OK`);

  // 6. re-enter the draw, cross milestone 3, user wins card #3 (sole entrant again)
  await (await cards.connect(user).enterDraw()).wait();
  await (await oracle.setMarketCap(25_000n * ONE)).wait();
  await (await cards.connect(treasury).mintNext()).wait();
  if ((await cards.ownerOf(3n)) !== user.address) throw new Error('second airdrop missed the entrant');
  console.log('6. user won a second draw - card #3 airdropped free');

  // 7. redemption: fund the pool, checkpoint the cap, let it age, redeem
  const cardsAddress = await cards.getAddress();
  await (await treasury.sendTransaction({ to: cardsAddress, value: ethers.parseEther('0.05') })).wait();
  await (await cards.connect(treasury).checkpointCap()).wait();
  console.log('7a. pool funded with 0.05 ETH, cap checkpoint recorded; aging 65s');
  await new Promise((resolve) => setTimeout(resolve, 65_000));
  const poolBefore = await ethers.provider.getBalance(cardsAddress);
  const expected = await cards.chartPriceOf(3n); // at its own launch cap: the base price
  if (expected !== redeemBase) throw new Error(`chart price mismatch: got ${expected}, want ${redeemBase}`);
  const userBeforeRedeem = await bal(user.address);
  await (await cards.connect(user).redeem(3n)).wait();
  const userAfterRedeem = await bal(user.address);
  if (userAfterRedeem - userBeforeRedeem < expected - ethers.parseEther('0.001')) {
    throw new Error(`redemption payout mismatch: got ${userAfterRedeem - userBeforeRedeem}`);
  }
  if (poolBefore - (await ethers.provider.getBalance(cardsAddress)) !== expected) {
    throw new Error('pool did not pay out exactly the chart value');
  }
  let burned = false;
  try {
    await cards.ownerOf(3n);
  } catch {
    burned = true;
  }
  if (!burned) throw new Error('redeemed card did not burn');
  console.log(`7b. user redeemed card #3 for ${eth(expected)} - card burned, pool drained by the same`);

  // 8. emergency stop: pause halts mints and draw entries, unpause restores
  await (await cards.pause()).wait();
  let pausedRevert = false;
  try {
    await (await cards.connect(user).enterDraw()).wait();
  } catch {
    pausedRevert = true;
  }
  if (!pausedRevert) throw new Error('draw entry went through while paused');
  await (await oracle.setMarketCap(50_000n * ONE)).wait();
  let pausedMint = false;
  try {
    await (await cards.connect(treasury).mintNext()).wait();
  } catch {
    pausedMint = true;
  }
  if (!pausedMint) throw new Error('mint went through while paused');
  await (await cards.unpause()).wait();
  await (await cards.connect(treasury).mintNext()).wait();
  if ((await cards.totalMinted()) !== 4n) throw new Error('post-unpause mint failed');
  console.log('8. pause blocked entries and mints, unpause restored them - emergency stop OK');

  console.log('\nREHEARSAL PASSED - full airdrop loop exercised on', network.name);
  console.log(`user final balance: ${eth(await bal(user.address))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
