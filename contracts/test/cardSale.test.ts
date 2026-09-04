import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const ONE = 10n ** 18n;
const SIX_HOURS = 6n * 3600n; // matches the deployment redeem delay

describe('CardSale', () => {
  async function deployFixture() {
    const [owner, keeper, buyer] = await ethers.getSigners();
    const oracle = await (
      await ethers.getContractFactory('MockMilestonePriceOracle')
    ).deploy();
    const token = await (await ethers.getContractFactory('PokeCardToken')).deploy(owner.address);
    const thresholds = [5000n * ONE, 10_000n * ONE];
    const cards = await (
      await ethers.getContractFactory('MilestoneCards')
    ).deploy(
      await oracle.getAddress(),
      keeper.address,
      await token.getAddress(),
      10n ** 16n,
      'ipfs://pokecard-lab/',
      thresholds,
      0,
      SIX_HOURS,
    );
    // 0.1 ETH base price at the card's own launch milestone
    const sale = await (
      await ethers.getContractFactory('CardSale')
    ).deploy(await cards.getAddress(), await oracle.getAddress(), 10n ** 17n);

    // treasury (cards owner) lets the sale contract move its cards
    await cards.setApprovalForAll(await sale.getAddress(), true);

    // mint card 01 at a $5,000 market cap, then age a checkpoint at that cap
    // so sale pricing (which reads the aged cap) is live
    await oracle.setMarketCap(5000n * ONE);
    await cards.connect(keeper).mintNext();
    await cards.connect(keeper).checkpointCap();
    await time.increase(SIX_HOURS + 1n);
    await sale.list([1n]);

    return { owner, keeper, buyer, oracle, cards, sale };
  }

  it('prices card 01 at base price when market cap equals its launch milestone', async () => {
    const { sale } = await loadFixture(deployFixture);
    expect(await sale.priceOf(1n)).to.equal(10n ** 17n);
  });

  it('scales 200x when market cap runs from $5k to $1M', async () => {
    const { oracle, cards, keeper, sale } = await loadFixture(deployFixture);
    await oracle.setMarketCap(1_000_000n * ONE);
    await cards.connect(keeper).checkpointCap();
    await time.increase(SIX_HOURS + 1n);
    expect(await sale.priceOf(1n)).to.equal(10n ** 17n * 200n);
  });

  it('quotes the aged cap, not a live dump', async () => {
    const { oracle, sale } = await loadFixture(deployFixture);
    await oracle.setMarketCap(1n * ONE); // un-checkpointed crash: price must hold
    expect(await sale.priceOf(1n)).to.equal(10n ** 17n);
  });

  it('sells the card, pays the treasury, and refunds overpayment', async () => {
    const { oracle, cards, sale, owner, buyer } = await loadFixture(deployFixture);
    await oracle.setMarketCap(5000n * ONE);

    const treasuryBefore = await ethers.provider.getBalance(owner.address);
    await sale.connect(buyer).buy(1n, { value: 10n ** 17n + 5n * 10n ** 16n });

    expect(await cards.ownerOf(1n)).to.equal(buyer.address);
    const treasuryAfter = await ethers.provider.getBalance(owner.address);
    // the buyer pays gas, so the treasury receives exactly the sale price
    expect(treasuryAfter - treasuryBefore).to.equal(10n ** 17n);
    expect(await sale.isListed(1n)).to.equal(false);

    await expect(
      sale.connect(buyer).buy(1n, { value: 10n ** 17n }),
    ).to.be.revertedWithCustomError(sale, 'NotListed');
  });

  it('reverts when underpaying', async () => {
    const { oracle, sale, buyer } = await loadFixture(deployFixture);
    await oracle.setMarketCap(5000n * ONE);
    await expect(
      sale.connect(buyer).buy(1n, { value: 10n ** 16n }),
    ).to.be.revertedWithCustomError(sale, 'InsufficientPayment');
  });

  it('reverts for cards that have not minted yet', async () => {
    const { sale, buyer } = await loadFixture(deployFixture);
    await expect(sale.priceOf(2n)).to.be.revertedWithCustomError(sale, 'CardNotMinted');
    await expect(
      sale.connect(buyer).buy(2n, { value: ONE }),
    ).to.be.revertedWithCustomError(sale, 'NotListed');
  });

  it('lets the owner pause buys and unpause to restore them', async () => {
    const { owner, sale, buyer } = await loadFixture(deployFixture);
    await sale.connect(owner).pause();
    await expect(
      sale.connect(buyer).buy(1n, { value: 10n ** 17n }),
    ).to.be.revertedWithCustomError(sale, 'EnforcedPause');

    await sale.connect(owner).unpause();
    await sale.connect(buyer).buy(1n, { value: 10n ** 17n });
    expect(await sale.isListed(1n)).to.equal(false);
  });

  it('lets the owner delist and withdraw', async () => {
    const { owner, sale, buyer } = await loadFixture(deployFixture);
    await sale.delist([1n]);
    await expect(
      sale.connect(buyer).buy(1n, { value: 10n ** 17n }),
    ).to.be.revertedWithCustomError(sale, 'NotListed');

    await buyer.sendTransaction({ to: await sale.getAddress(), value: ONE });
    const before = await ethers.provider.getBalance(owner.address);
    await sale.withdraw(owner.address);
    const after = await ethers.provider.getBalance(owner.address);
    // owner received the full contract balance minus their own tx gas
    expect(after - before).to.be.greaterThan(99n * 10n ** 16n);
    expect(after - before).to.be.lessThanOrEqual(ONE);
  });
});
