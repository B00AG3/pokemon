import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const ONE = 10n ** 18n;
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const ETH_USD_8 = 3000n * 10n ** 8n; // $3000, 8 decimals
const PRICE_RAW = 3n; // POKE costs 3 WETHwei per POKEwei = $9000 per POKE

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  // float seed can land below or above the true root by ~1e13, so lift above
  // first, Newton downward, then trim the exact integer root
  let x = BigInt(Math.floor(Math.sqrt(Number(n)))) + 2n;
  while (x * x < n) x *= 2n;
  let y = (x + n / x) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  while (x * x > n) {
    x -= 1n;
  }
  return x;
}

function fixtureFor(pokeIsCurrency0: boolean) {
  return async function deployFixture() {
    const [owner, buyer] = await ethers.getSigners();
    const token = await (
      await ethers.getContractFactory('PokeCardToken')
    ).deploy(owner.address);
    const tokenAddress = await token.getAddress();

    const pokeLower = tokenAddress.toLowerCase() < WETH.toLowerCase();
    const [c0, c1] =
      pokeLower === pokeIsCurrency0 ? [tokenAddress, WETH] : [WETH, tokenAddress];

    const stateView = await (
      await ethers.getContractFactory('MockStateView')
    ).deploy();
    const aggregator = await (
      await ethers.getContractFactory('MockAggregator')
    ).deploy();

    const poolKey = {
      currency0: c0,
      currency1: c1,
      fee: 3000,
      tickSpacing: 60,
      hooks: ZERO_ADDR,
    };
    const poolId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint24', 'int24', 'address'],
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      ),
    );

    const oracle = await (
      await ethers.getContractFactory('UniswapV4SpotOracle')
    ).deploy(
      await stateView.getAddress(),
      tokenAddress,
      WETH,
      poolKey,
      await aggregator.getAddress(),
      3600,
    );

    return { owner, buyer, token, stateView, aggregator, oracle, poolId, poolKey };
  };
}

describe('UniswapV4SpotOracle', () => {
  // Expected values for PRICE_RAW = 3 at $3000/ETH:
  //   $9000 per POKE -> usd18PerPokeWei = 9000
  //   1B supply      -> marketCap = $9T = 9e12 x 1e18 (USD 18 decimals)
  const EXPECTED_USD18_PER_WEI = 9000n;
  const EXPECTED_CAP = 9000n * 10n ** 9n * ONE;

  for (const pokeIsCurrency0 of [true, false]) {
    it(`prices from the currency${pokeIsCurrency0 ? '0' : '1'} side: $9000 POKE -> $9T cap`, async () => {
      const { stateView, oracle, poolId, token } = await loadFixture(
        fixtureFor(pokeIsCurrency0),
      );

      const sqrtP = pokeIsCurrency0
        ? isqrt(PRICE_RAW * 2n ** 192n) + 1n // round up: floor(sqrtP^2 / 2^192) must equal PRICE_RAW
        : isqrt(2n ** 192n / PRICE_RAW);
      await stateView.setSqrtPriceX96(poolId, sqrtP);

      const usd18PerWei = await oracle.usd18PerPokeWei();
      // mirror math, tolerating isqrt + double-rounding drift (sub-dollar-cent)
      expect(usd18PerWei).to.be.closeTo(EXPECTED_USD18_PER_WEI, 10n ** 12n);

      const cap = await oracle.marketCap();
      expect(cap).to.be.closeTo(EXPECTED_CAP, 10n ** 24n);
      expect(await token.totalSupply()).to.equal(1_000_000_000n * ONE);
    });
  }

  it('reverts when the pool has never been initialized', async () => {
    const { oracle } = await loadFixture(fixtureFor(true));
    await expect(oracle.marketCap()).to.be.revertedWithCustomError(
      oracle,
      'InvalidPool',
    );
  });

  it('reverts on a stale ETH/USD feed', async () => {
    const { stateView, oracle, poolId, aggregator } = await loadFixture(
      fixtureFor(true),
    );
    await stateView.setSqrtPriceX96(poolId, 2n ** 96n);
    await aggregator.setUpdatedAt(0);
    await expect(oracle.marketCap()).to.be.revertedWithCustomError(
      oracle,
      'StaleEthUsdPrice',
    );
  });

  it('supports a manual ETH/USD price when no feed is configured', async () => {
    const { owner, stateView } = await loadFixture(fixtureFor(true));
    const token2 = await (
      await ethers.getContractFactory('PokeCardToken')
    ).deploy(owner.address);
    const token2Address = await token2.getAddress();
    const poolKey2 = {
      currency0: token2Address.toLowerCase() < WETH.toLowerCase() ? token2Address : WETH,
      currency1: token2Address.toLowerCase() < WETH.toLowerCase() ? WETH : token2Address,
      fee: 3000,
      tickSpacing: 60,
      hooks: ZERO_ADDR,
    };
    const poolId2 = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint24', 'int24', 'address'],
        [poolKey2.currency0, poolKey2.currency1, poolKey2.fee, poolKey2.tickSpacing, poolKey2.hooks],
      ),
    );
    const oracleNoFeed = await (
      await ethers.getContractFactory('UniswapV4SpotOracle')
    ).deploy(
      await stateView.getAddress(),
      token2Address,
      WETH,
      poolKey2,
      ZERO_ADDR,
      3600,
    );

    await expect(oracleNoFeed.marketCap()).to.be.reverted;
    await oracleNoFeed.setManualEthUsdPrice(ETH_USD_8);
    await stateView.setSqrtPriceX96(poolId2, 2n ** 96n);

    // sqrtP = 2^96 -> 1 POKEwei = 1 WETHwei -> $3000 per POKE (18 decimals),
    // regardless of which side of the pool POKE sits on
    expect(await oracleNoFeed.usd18PerPokeWei()).to.equal(3000n);
  });
});
