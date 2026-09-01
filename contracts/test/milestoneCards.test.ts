import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const ONE = 10n ** 18n;

describe('PokeCardToken', () => {
  it('mints the full supply to the initial holder', async () => {
    const [deployer] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory('PokeCardToken')).deploy(deployer.address);
    expect(await token.balanceOf(deployer.address)).to.equal(1_000_000_000n * ONE);
    expect(await token.name()).to.equal('PokeCard');
  });
});

describe('MilestoneCards', () => {
  async function deployFixture() {
    const [owner, keeper, other] = await ethers.getSigners();
    const oracle = await (await ethers.getContractFactory('MockMilestonePriceOracle')).deploy();
    const thresholds = [5000n * ONE, 10_000n * ONE, 25_000n * ONE];
    const cards = await (
      await ethers.getContractFactory('MilestoneCards')
    ).deploy(await oracle.getAddress(), keeper.address, 'ipfs://pokecard-lab/', thresholds, 0);
    return { owner, keeper, other, oracle, cards, thresholds };
  }

  async function deployWithWindowFixture() {
    const base = await deployFixture();
    const cards = await (
      await ethers.getContractFactory('MilestoneCards')
    ).deploy(
      await base.oracle.getAddress(),
      base.keeper.address,
      'ipfs://pokecard-lab/',
      base.thresholds,
      60,
    );
    return { ...base, cards };
  }

  it('starts on milestone 0 with the right threshold', async () => {
    const { cards, thresholds } = await loadFixture(deployFixture);
    const [index, marketCap] = await cards.nextMilestone();
    expect(index).to.equal(0n);
    expect(marketCap).to.equal(thresholds[0]);
    expect(await cards.totalMilestones()).to.equal(3n);
    expect(await cards.totalMinted()).to.equal(0n);
  });

  it('rejects minting while below the threshold', async () => {
    const { oracle, cards, keeper } = await loadFixture(deployFixture);
    await oracle.setMarketCap(4999n * ONE);
    await expect(cards.connect(keeper).mintNext()).to.be.revertedWithCustomError(
      cards,
      'NotAboveThreshold',
    );
  });

  it('only the keeper can mint or confirm', async () => {
    const { oracle, cards, other } = await loadFixture(deployFixture);
    await oracle.setMarketCap(5000n * ONE);
    await expect(cards.connect(other).mintNext()).to.be.revertedWithCustomError(
      cards,
      'NotKeeper',
    );
    await expect(cards.connect(other).confirmCrossing()).to.be.revertedWithCustomError(
      cards,
      'NotKeeper',
    );
  });

  it('mints card 01 exactly once at the first milestone', async () => {
    const { oracle, cards, keeper, owner } = await loadFixture(deployFixture);
    await oracle.setMarketCap(5000n * ONE);

    await expect(cards.connect(keeper).mintNext())
      .to.emit(cards, 'MilestoneMinted')
      .withArgs(0, 1n, 5000n * ONE);

    expect(await cards.ownerOf(1n)).to.equal(owner.address);
    expect(await cards.totalMinted()).to.equal(1n);
    expect(await cards.tokenURI(1n)).to.equal('ipfs://pokecard-lab/1.json');

    // card 01 can never mint again: the next threshold is now milestone 1
    const [index, marketCap] = await cards.nextMilestone();
    expect(index).to.equal(1n);
    expect(marketCap).to.equal(10_000n * ONE);
    await expect(
      cards.connect(keeper).mintNext(),
    ).to.be.revertedWithCustomError(cards, 'NotAboveThreshold');
  });

  it('walks the whole ladder and then stops forever', async () => {
    const { oracle, cards, keeper } = await loadFixture(deployFixture);
    const levels = [5000n, 10_000n, 25_000n];
    for (let i = 0; i < levels.length; i++) {
      await oracle.setMarketCap(levels[i] * ONE);
      await cards.connect(keeper).mintNext();
    }
    expect(await cards.totalMinted()).to.equal(3n);
    const [index] = await cards.nextMilestone();
    expect(index).to.equal(ethers.MaxUint256);
    await expect(cards.connect(keeper).mintNext()).to.be.revertedWithCustomError(
      cards,
      'AllMilestonesMinted',
    );
  });

  it('pays royalties to the treasury on resale math', async () => {
    const { oracle, cards, keeper, owner } = await loadFixture(deployFixture);
    await oracle.setMarketCap(5000n * ONE);
    await cards.connect(keeper).mintNext();
    const [, royalty] = await cards.royaltyInfo(1n, 10_000n);
    expect(royalty).to.equal(250n); // 2.5% of 10000
    expect(await cards.ownerOf(1n)).to.equal(owner.address);
  });

  describe('with a confirmation window', () => {
    it('requires the crossing to hold before minting', async () => {
      const { oracle, cards, keeper } = await loadFixture(deployWithWindowFixture);
      await oracle.setMarketCap(5000n * ONE);

      // nothing recorded yet
      await expect(cards.connect(keeper).mintNext()).to.be.revertedWithCustomError(
        cards,
        'ConfirmationPending',
      );

      // record the crossing
      await cards.connect(keeper).confirmCrossing();
      const crossedAt = await cards.crossingAt(0);
      expect(crossedAt).to.not.equal(0n);

      // window has not elapsed
      await expect(cards.connect(keeper).mintNext()).to.be.revertedWithCustomError(
        cards,
        'ConfirmationPending',
      );

      // window elapses while still above the threshold
      await time.increase(61);
      await expect(cards.connect(keeper).mintNext())
        .to.emit(cards, 'MilestoneMinted')
        .withArgs(0, 1n, 5000n * ONE);
    });

    it('does not mint when the market cap falls back below', async () => {
      const { oracle, cards, keeper } = await loadFixture(deployWithWindowFixture);
      await oracle.setMarketCap(5000n * ONE);
      await cards.connect(keeper).confirmCrossing();
      await time.increase(61);

      await oracle.setMarketCap(1000n * ONE);
      await expect(cards.connect(keeper).mintNext()).to.be.revertedWithCustomError(
        cards,
        'NotAboveThreshold',
      );
      expect(await cards.totalMinted()).to.equal(0n);
    });
  });
});
