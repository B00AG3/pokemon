import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const ONE = 10n ** 18n;
const SUPPLY = 1_000_000_000n * ONE; // Pons config #0: 1B tokens
const ETH_USD = 3000n * 10n ** 8n; // manual price format matches Chainlink: 8 decimals
const PHANTOM = 168n * 10n ** 16n; // config #0 phantom quote: 1.68 ETH

describe('PonsCurveOracle', () => {
  async function deployFixture() {
    const [owner] = await ethers.getSigners();
    const curve = await (await ethers.getContractFactory('MockPonsCurve')).deploy();
    const token = await (await ethers.getContractFactory('PokeCardToken')).deploy(owner.address);
    const oracle = await (
      await ethers.getContractFactory('PonsCurveOracle')
    ).deploy(await curve.getAddress(), await token.getAddress(), ethers.ZeroAddress, 3600);
    // config #0 spawn state: the phantom quote priced against the full supply
    await curve.setReserves(PHANTOM, SUPPLY);
    return { owner, curve, token, oracle };
  }

  it('prices the spawn cap at phantom quote x ethUsd ($5,040 at $3000/ETH)', async () => {
    const { oracle } = await loadFixture(deployFixture);
    await oracle.setManualEthUsdPrice(ETH_USD);
    expect(await oracle.marketCap()).to.equal(5040n * ONE);
    const usdPerPoke = await oracle.usdPerPoke();
    expect(usdPerPoke).to.equal((5040n * ONE * ONE) / SUPPLY); // $0.00000504 per POKE
  });

  it('tracks the marginal price as buys move the reserves', async () => {
    const { curve, oracle } = await loadFixture(deployFixture);
    await oracle.setManualEthUsdPrice(ETH_USD);
    // a real buy: net quote enters the reserve, tokens leave it. Constant
    // product keeps quoteReserve x tokenReserve = phantom x supply, so this
    // state is exactly "1.68 ETH phantom + 1 ETH of net buys":
    const quoteReserve = PHANTOM + ONE;
    const tokenReserve = (PHANTOM * SUPPLY) / (PHANTOM + ONE);
    await curve.setReserves(quoteReserve, tokenReserve);

    // the contract computes cap(ETH) = quoteReserve x supply / tokenReserve
    // and floors only at the final USD multiply - mirror that exactly
    const capEth = (quoteReserve * SUPPLY) / tokenReserve;
    expect(await oracle.marketCap()).to.equal((capEth * ETH_USD) / 10n ** 8n);

    // cross-check against the docs' closed form (P+Q)^2/P: they agree
    const closedFormEth = ((PHANTOM + ONE) * (PHANTOM + ONE)) / PHANTOM;
    const closedFormUsd = (closedFormEth * ETH_USD) / 10n ** 8n;
    const diff = capEth > closedFormEth
      ? ((capEth - closedFormEth) * ETH_USD) / 10n ** 8n
      : ((closedFormEth - capEth) * ETH_USD) / 10n ** 8n;
    expect(diff).to.be.lessThanOrEqual(2n);
  });

  it('reverts on an empty curve instead of reporting a zero cap', async () => {
    const { curve, oracle } = await loadFixture(deployFixture);
    await oracle.setManualEthUsdPrice(ETH_USD);
    await curve.setReserves(0n, 0n);
    await expect(oracle.marketCap()).to.be.revertedWithCustomError(oracle, 'CurveEmpty');
  });

  it('needs an ETH/USD source before it reports anything', async () => {
    const { oracle } = await loadFixture(deployFixture);
    await expect(oracle.marketCap()).to.be.revertedWith('eth usd unset');
    await oracle.setManualEthUsdPrice(0); // zero clears the manual price too
    await expect(oracle.marketCap()).to.be.revertedWith('eth usd unset');
  });

  it('reads a live ETH/USD feed and reverts when it goes stale', async () => {
    const { oracle } = await loadFixture(deployFixture);
    const feed = await (await ethers.getContractFactory('MockAggregator')).deploy();
    await oracle.setEthUsdFeed(await feed.getAddress());
    // feed starts at $3000 with a fresh timestamp: no manual price needed
    expect(await oracle.marketCap()).to.equal(5040n * ONE);

    // push chain time past maxStaleness (3600s); the feed's updatedAt stays
    // at its deployment block, so the read now reverts
    await time.increase(3601);
    await expect(oracle.marketCap()).to.be.revertedWithCustomError(oracle, 'StaleEthUsdPrice');
  });
});
