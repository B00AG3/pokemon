import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const ONE = 10n ** 18n;

describe('CardSwap', () => {
  async function deployFixture() {
    const [treasury, keeper, alice, bob] = await ethers.getSigners();
    const oracle = await (
      await ethers.getContractFactory('MockMilestonePriceOracle')
    ).deploy();
    const thresholds = [5000n * ONE, 10_000n * ONE];
    const cards = await (
      await ethers.getContractFactory('MilestoneCards')
    ).deploy(await oracle.getAddress(), keeper.address, 'ipfs://pokecard-lab/', thresholds, 0);
    const swap = await (
      await ethers.getContractFactory('CardSwap')
    ).deploy(await cards.getAddress());

    // mint card 01 (goes to the treasury) and hand card 02 to alice
    await oracle.setMarketCap(5000n * ONE);
    await cards.connect(keeper).mintNext();
    await oracle.setMarketCap(10_000n * ONE);
    await cards.connect(keeper).mintNext();
    await cards.transferFrom(treasury.address, alice.address, 2n);

    return { treasury, keeper, alice, bob, oracle, cards, swap };
  }

  it('escrows the card on list and returns it on cancel', async () => {
    const { alice, cards, swap } = await loadFixture(deployFixture);
    await cards.connect(alice).approve(await swap.getAddress(), 2n);
    await swap.connect(alice).list(2n, 5n * 10n ** 16n);

    expect(await cards.ownerOf(2n)).to.equal(await swap.getAddress());
    const l = await swap.listings(2n);
    expect(l.seller).to.equal(alice.address);
    expect(l.price).to.equal(5n * 10n ** 16n);

    await swap.connect(alice).cancelListing(2n);
    expect(await cards.ownerOf(2n)).to.equal(alice.address);
    expect((await swap.listings(2n)).seller).to.equal(ethers.ZeroAddress);
  });

  it('sells an escrowed listing, splits royalties, and refunds overpayment', async () => {
    const { treasury, alice, bob, cards, swap } = await loadFixture(deployFixture);
    await cards.connect(alice).setApprovalForAll(await swap.getAddress(), true);
    await swap.connect(alice).list(2n, ONE);

    const sellerBefore = await ethers.provider.getBalance(alice.address);
    const royaltyBefore = await ethers.provider.getBalance(treasury.address);
    await swap.connect(bob).buy(2n, { value: ONE + 10n ** 16n });

    expect(await cards.ownerOf(2n)).to.equal(bob.address);
    // 2.5% royalty to the treasury, 97.5% to the seller (both plus gas)
    const royalty = (ONE * 25n) / 1000n;
    expect(await ethers.provider.getBalance(treasury.address) - royaltyBefore).to.equal(royalty);
    expect(await ethers.provider.getBalance(alice.address) - sellerBefore).to.equal(ONE - royalty);
    // listing is gone
    expect((await swap.listings(2n)).seller).to.equal(ethers.ZeroAddress);
  });

  it('reverts buying without payment or an active listing', async () => {
    const { alice, bob, cards, swap } = await loadFixture(deployFixture);
    await cards.connect(alice).approve(await swap.getAddress(), 2n);
    await swap.connect(alice).list(2n, ONE);
    await expect(swap.connect(bob).buy(2n, { value: ONE - 1n })).to.be.revertedWithCustomError(
      swap,
      'InsufficientPayment',
    );

    await swap.connect(alice).cancelListing(2n);
    await expect(swap.connect(bob).buy(2n, { value: ONE })).to.be.revertedWithCustomError(
      swap,
      'NotListed',
    );
  });

  it('runs a card-for-card swap with an ETH ask', async () => {
    const { treasury, alice, bob, cards, swap } = await loadFixture(deployFixture);
    // bob owns card 01 (bought from the treasury directly), alice owns card 02
    await cards.connect(treasury).transferFrom(treasury.address, bob.address, 1n);

    // alice offers card 02 for card 01 plus 0.05 ETH
    await cards.connect(alice).approve(await swap.getAddress(), 2n);
    await swap.connect(alice).offerSwap(2n, 1n, 5n * 10n ** 16n);
    expect(await cards.ownerOf(2n)).to.equal(await swap.getAddress());
    expect(await swap.offerCount()).to.equal(1n);

    const offer = await swap.offers(0);
    expect(offer.maker).to.equal(alice.address);
    expect(offer.giveTokenId).to.equal(2n);
    expect(offer.wantTokenId).to.equal(1n);

    // bob approves and accepts, paying the ask
    await cards.connect(bob).setApprovalForAll(await swap.getAddress(), true);
    const aliceBefore = await ethers.provider.getBalance(alice.address);
    await swap.connect(bob).acceptSwap(0n, { value: 5n * 10n ** 16n });

    expect(await cards.ownerOf(1n)).to.equal(alice.address);
    expect(await cards.ownerOf(2n)).to.equal(bob.address);
    expect(await ethers.provider.getBalance(alice.address) - aliceBefore).to.equal(5n * 10n ** 16n);
    expect((await swap.offers(0n)).active).to.equal(false);
  });

  it('lets only the wanted-card holder accept and the maker cancel', async () => {
    const { treasury, alice, bob, cards, swap } = await loadFixture(deployFixture);
    await cards.connect(treasury).transferFrom(treasury.address, bob.address, 1n);

    await cards.connect(alice).approve(await swap.getAddress(), 2n);
    await swap.connect(alice).offerSwap(2n, 1n, 0n);

    // bob holds card 01 but alice holds nothing relevant to charlie... bob is
    // the holder; alice cannot accept because she does not hold card 01
    await expect(swap.connect(alice).acceptSwap(0n)).to.be.revertedWithCustomError(
      swap,
      'NotCardHolder',
    );

    // maker cancels and gets the card back
    await swap.connect(alice).cancelSwap(0n);
    expect(await cards.ownerOf(2n)).to.equal(alice.address);
    await expect(swap.connect(bob).acceptSwap(0n)).to.be.revertedWithCustomError(
      swap,
      'OfferInactive',
    );
  });

  it('pauses trading but keeps cancellations open', async () => {
    const { treasury, alice, bob, cards, swap } = await loadFixture(deployFixture);
    await cards.connect(alice).approve(await swap.getAddress(), 2n);
    await swap.connect(alice).list(2n, ONE);

    const nonOwner = swap.connect(bob);
    await expect(nonOwner.pause()).to.be.revertedWithCustomError(swap, 'OwnableUnauthorizedAccount');

    await swap.pause();
    await expect(swap.connect(bob).buy(2n, { value: ONE })).to.be.revertedWithCustomError(swap, 'EnforcedPause');
    await expect(swap.connect(alice).offerSwap(2n, 1n, 0n)).to.be.revertedWithCustomError(swap, 'EnforcedPause');
    // escrowed cards can always be pulled back out
    await swap.connect(alice).cancelListing(2n);
    expect(await cards.ownerOf(2n)).to.equal(alice.address);

    await swap.unpause();
    await cards.connect(alice).approve(await swap.getAddress(), 2n);
    await swap.connect(alice).list(2n, ONE);
    await swap.connect(bob).buy(2n, { value: ONE });
    expect(await cards.ownerOf(2n)).to.equal(bob.address);
    // silence unused warning for treasury in this fixture scope
    void treasury;
  });

  it('rejects bad offers and non-owners', async () => {
    const { alice, bob, cards, swap } = await loadFixture(deployFixture);
    await expect(
      swap.connect(bob).offerSwap(2n, 1n, 0n),
    ).to.be.revertedWithCustomError(swap, 'NotOwner');
    await expect(
      swap.connect(alice).offerSwap(2n, 2n, 0n),
    ).to.be.revertedWithCustomError(swap, 'SelfSwap');
    await expect(
      swap.connect(alice).list(2n, 0n),
    ).to.be.revertedWithCustomError(swap, 'ZeroPrice');

    await cards.connect(alice).approve(await swap.getAddress(), 2n);
    await swap.connect(alice).list(2n, ONE);
    await expect(
      swap.connect(bob).cancelListing(2n),
    ).to.be.revertedWithCustomError(swap, 'NotSeller');
  });
});
