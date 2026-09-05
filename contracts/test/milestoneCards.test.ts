import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const ONE = 10n ** 18n;
const SIX_HOURS = 6n * 3600n; // matches the deployment redeem delay

/** Set the oracle cap, checkpoint it, and age it past the redeem delay. */
async function seedAgedCap(
  oracle: { setMarketCap(v: bigint): Promise<unknown> },
  cards: { connect(s: unknown): { checkpointCap(): Promise<unknown> } },
  keeper: unknown,
  cap: bigint,
  warper: { increase(s: bigint): Promise<unknown> },
) {
  await oracle.setMarketCap(cap);
  await cards.connect(keeper).checkpointCap();
  await warper.increase(SIX_HOURS + 1n);
}

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
    const [owner, keeper, alice, bob] = await ethers.getSigners();
    const oracle = await (await ethers.getContractFactory('MockMilestonePriceOracle')).deploy();
    const token = await (await ethers.getContractFactory('PokeCardToken')).deploy(owner.address);
    const thresholds = [5000n * ONE, 10_000n * ONE, 25_000n * ONE];
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
    // seed the redemption pool so redeem tests can pay out
    await owner.sendTransaction({ to: await cards.getAddress(), value: 10n * ONE });
    return { owner, keeper, alice, bob, oracle, token, cards, thresholds };
  }

  async function deployWithWindowFixture() {
    const base = await deployFixture();
    const cards = await (
      await ethers.getContractFactory('MilestoneCards')
    ).deploy(
      await base.oracle.getAddress(),
      base.keeper.address,
      await base.token.getAddress(),
      10n ** 16n,
      'ipfs://pokecard-lab/',
      base.thresholds,
      60,
      SIX_HOURS,
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
    const { oracle, cards, alice } = await loadFixture(deployFixture);
    await oracle.setMarketCap(5000n * ONE);
    await expect(cards.connect(alice).mintNext()).to.be.revertedWithCustomError(
      cards,
      'NotKeeper',
    );
    await expect(cards.connect(alice).confirmCrossing()).to.be.revertedWithCustomError(
      cards,
      'NotKeeper',
    );
    await expect(cards.connect(alice).checkpointCap()).to.be.revertedWithCustomError(
      cards,
      'NotKeeper',
    );
  });

  it('pauses minting as an emergency stop and unpauses to restore', async () => {
    const { oracle, cards, keeper, alice } = await loadFixture(deployFixture);
    await oracle.setMarketCap(5000n * ONE);

    await expect(cards.connect(alice).pause()).to.be.revertedWithCustomError(
      cards,
      'OwnableUnauthorizedAccount',
    );
    await cards.pause();
    await expect(cards.connect(keeper).mintNext()).to.be.revertedWithCustomError(
      cards,
      'EnforcedPause',
    );
    // draw entries are halted too, but confirmations still record
    await expect(cards.connect(alice).enterDraw()).to.be.revertedWithCustomError(
      cards,
      'EnforcedPause',
    );
    await cards.connect(keeper).confirmCrossing();
    await cards.unpause();
    await cards.connect(keeper).mintNext();
    expect(await cards.totalMinted()).to.equal(1n);
  });

  describe('the holder draw', () => {
    it('rejects entrants without POKE and double entries', async () => {
      const { token, cards, alice, bob } = await loadFixture(deployFixture);
      await expect(cards.connect(bob).enterDraw()).to.be.revertedWithCustomError(cards, 'NotHolder');

      await token.transfer(alice.address, 100n * ONE);
      await cards.connect(alice).enterDraw();
      await expect(cards.connect(alice).enterDraw()).to.be.revertedWithCustomError(
        cards,
        'AlreadyEntered',
      );
      expect(await cards.entrantCount()).to.equal(1n);
      expect(await cards.isEntered(alice.address)).to.equal(true);
    });

    it('lets an entrant leave and re-enter', async () => {
      const { token, cards, alice } = await loadFixture(deployFixture);
      await token.transfer(alice.address, 100n * ONE);
      await cards.connect(alice).enterDraw();
      await cards.connect(alice).leaveDraw();
      expect(await cards.entrantCount()).to.equal(0n);
      expect(await cards.isEntered(alice.address)).to.equal(false);
      await expect(cards.connect(alice).leaveDraw()).to.be.revertedWithCustomError(cards, 'NotEntered');
      await cards.connect(alice).enterDraw();
      expect(await cards.entrantCount()).to.equal(1n);
    });

    it('airdrops the mint to the sole entrant for free', async () => {
      const { oracle, token, cards, keeper, alice } = await loadFixture(deployFixture);
      await token.transfer(alice.address, 100n * ONE);
      await cards.connect(alice).enterDraw();
      await oracle.setMarketCap(5000n * ONE);

      await expect(cards.connect(keeper).mintNext())
        .to.emit(cards, 'MilestoneMinted')
        .withArgs(0, 1n, 5000n * ONE, alice.address);

      expect(await cards.ownerOf(1n)).to.equal(alice.address);
      expect(await token.balanceOf(alice.address)).to.equal(100n * ONE); // nothing taken
      expect(await cards.tokenURI(1n)).to.equal('ipfs://pokecard-lab/1.json');

      // card 01 can never mint again: the next threshold is now milestone 1
      const [index, marketCap] = await cards.nextMilestone();
      expect(index).to.equal(1n);
      expect(marketCap).to.equal(10_000n * ONE);
    });

    it('never airdrops to a holder that never entered, even a whale LP', async () => {
      const { oracle, token, cards, keeper, alice } = await loadFixture(deployFixture);
      // the liquidity pool stand-in: holds the lion's share of POKE. It can
      // never win because only the wallet itself can call enterDraw, and the
      // draw picks exclusively from the entrant list.
      const [, , , , pool] = await ethers.getSigners();
      await token.transfer(pool.address, 900_000_000n * ONE);
      await token.transfer(alice.address, 100n * ONE);
      await cards.connect(alice).enterDraw();
      expect(await cards.entrantCount()).to.equal(1n); // the pool is not in the draw

      await oracle.setMarketCap(5000n * ONE);
      await expect(cards.connect(keeper).mintNext())
        .to.emit(cards, 'MilestoneMinted')
        .withArgs(0, 1n, 5000n * ONE, alice.address);
      expect(await cards.ownerOf(1n)).to.equal(alice.address);
      expect(await cards.balanceOf(pool.address)).to.equal(0);
    });

    it('skips entrants who sold their POKE and falls back to the treasury when none remain', async () => {
      const { oracle, token, cards, keeper, owner, alice, bob } = await loadFixture(deployFixture);
      await token.transfer(alice.address, 100n * ONE);
      await token.transfer(bob.address, 100n * ONE);
      await cards.connect(alice).enterDraw();
      await cards.connect(bob).enterDraw();
      // alice sells out; the draw must skip her and pick bob
      await token.connect(alice).transfer(owner.address, 100n * ONE);

      await oracle.setMarketCap(5000n * ONE);
      await cards.connect(keeper).mintNext();
      expect(await cards.ownerOf(1n)).to.equal(bob.address);

      // everyone sold: the empty-handed draw falls back to the treasury
      await token.connect(bob).transfer(owner.address, 100n * ONE);
      await oracle.setMarketCap(10_000n * ONE);
      await cards.connect(keeper).mintNext();
      expect(await cards.ownerOf(2n)).to.equal(owner.address);
      expect(await cards.totalMinted()).to.equal(2n);
    });
  });

  describe('chart-value redemption', () => {
    it('prices a card at base x cap / launch and pays the holder on redeem', async () => {
      const { oracle, token, cards, keeper, alice } = await loadFixture(deployFixture);
      await token.transfer(alice.address, 100n * ONE);
      await cards.connect(alice).enterDraw();
      await oracle.setMarketCap(5000n * ONE);
      await cards.connect(keeper).mintNext();
      expect(await cards.ownerOf(1n)).to.equal(alice.address);

      // minting alone prices nothing: the chart value needs an aged checkpoint
      await expect(cards.chartPriceOf(1n)).to.be.revertedWithCustomError(cards, 'ChartNotReady');

      // at its own launch cap the card is worth exactly the base price;
      // double the aged cap doubles the chart value
      await seedAgedCap(oracle, cards, keeper, 5000n * ONE, time);
      expect(await cards.chartPriceOf(1n)).to.equal(10n ** 16n);
      await seedAgedCap(oracle, cards, keeper, 10_000n * ONE, time);
      expect(await cards.chartPriceOf(1n)).to.equal(10n ** 16n * 2n);

      const aliceBefore = await ethers.provider.getBalance(alice.address);
      await expect(cards.connect(alice).redeem(1n))
        .to.emit(cards, 'CardRedeemed')
        .withArgs(1n, alice.address, 10n ** 16n * 2n);
      expect(await ethers.provider.getBalance(alice.address)).to.be.gte(
        aliceBefore + 10n ** 16n * 2n - 10n ** 15n, // payout minus a gas allowance
      );
      // the card burns on redemption; the milestone stays consumed
      await expect(cards.ownerOf(1n)).to.be.revertedWithCustomError(cards, 'ERC721NonexistentToken');
      expect(await cards.totalMinted()).to.equal(1n);
    });

    it('prices redemption off the aged checkpoint, never a live spot spike', async () => {
      const { oracle, token, cards, keeper, alice } = await loadFixture(deployFixture);
      await token.transfer(alice.address, 100n * ONE);
      await cards.connect(alice).enterDraw();
      await oracle.setMarketCap(5000n * ONE);
      await cards.connect(keeper).mintNext();
      await seedAgedCap(oracle, cards, keeper, 5000n * ONE, time);

      // someone pumps the pool 200x for one block: the payout must not move
      await oracle.setMarketCap(1_000_000n * ONE);
      expect(await cards.chartPriceOf(1n)).to.equal(10n ** 16n);

      const aliceBefore = await ethers.provider.getBalance(alice.address);
      await cards.connect(alice).redeem(1n);
      expect(await ethers.provider.getBalance(alice.address)).to.be.gte(
        aliceBefore + 10n ** 16n - 10n ** 15n, // base price, not 200x it
      );
    });

    it('only the card holder can redeem, and an empty pool blocks payouts', async () => {
      const { oracle, cards, keeper, owner, bob } = await loadFixture(deployFixture);
      // no entrants: the mint falls back to the treasury (owner)
      await oracle.setMarketCap(5000n * ONE);
      await cards.connect(keeper).mintNext();
      expect(await cards.ownerOf(1n)).to.equal(owner.address);

      await expect(cards.connect(bob).redeem(1n)).to.be.revertedWithCustomError(
        cards,
        'NotCardHolder',
      );

      // drain the pool: redemption reverts until it is funded again
      const pool: bigint = await ethers.provider.getBalance(await cards.getAddress());
      await cards.withdrawPool(owner.address, pool);
      await seedAgedCap(oracle, cards, keeper, 50_000n * ONE, time);
      await expect(cards.connect(owner).redeem(1n)).to.be.revertedWithCustomError(
        cards,
        'InsufficientPool',
      );

      // refill and redeem succeeds
      await owner.sendTransaction({ to: await cards.getAddress(), value: 10n * ONE });
      await cards.connect(owner).redeem(1n);
      expect(await cards.totalMinted()).to.equal(1n);
      await expect(cards.ownerOf(1n)).to.be.revertedWithCustomError(cards, 'ERC721NonexistentToken');
    });
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
      const { oracle, cards, keeper, owner } = await loadFixture(deployWithWindowFixture);
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

      // window elapses while still above the threshold; with no entrants the
      // card falls back to the treasury (owner)
      await time.increase(61);
      await expect(cards.connect(keeper).mintNext())
        .to.emit(cards, 'MilestoneMinted')
        .withArgs(0, 1n, 5000n * ONE, owner.address);
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

    it('keeps the first crossing stamp: re-confirming never extends the window', async () => {
      const { oracle, cards, keeper, owner } = await loadFixture(deployWithWindowFixture);
      await oracle.setMarketCap(5000n * ONE);
      await cards.connect(keeper).confirmCrossing();
      const crossedAt = await cards.crossingAt(0);

      // a keeper polling every interval inside the window must not push the
      // mint out forever; the second confirm is a no-op
      await time.increase(30);
      await cards.connect(keeper).confirmCrossing();
      expect(await cards.crossingAt(0)).to.equal(crossedAt);

      await time.increase(31);
      await expect(cards.connect(keeper).mintNext())
        .to.emit(cards, 'MilestoneMinted')
        .withArgs(0, 1n, 5000n * ONE, owner.address);
    });
  });
});
