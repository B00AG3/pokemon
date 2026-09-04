import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const ONE = 10n ** 18n;
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const ETH_USD_8 = 3000n * 10n ** 8n; // $3000, 8 decimals
const SUPPLY = 1_000_000_000n * ONE; // 1B POKE, 18 decimals

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

/**
 * The ladder runs $5k to $1M caps on a fixed 1B supply, so POKE lives at
 * $0.000005 to $0.001 for the whole product life. These cases cover that
 * range plus one far-future price; the oracle's job is to not floor to zero
 * anywhere inside it.
 */
const CASES = [
  { label: '$0.000005 POKE -> $5k cap (first milestone)', usdPerPoke: 5n * 10n ** 12n },
  { label: '$0.001 POKE -> $1M cap (last milestone)', usdPerPoke: 10n ** 15n },
  { label: '$0.10 POKE -> $100M cap', usdPerPoke: 10n ** 17n },
  { label: '$9000 POKE -> $9T cap (smoke)', usdPerPoke: 9000n * ONE },
];

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
  for (const { label, usdPerPoke } of CASES) {
    for (const pokeIsCurrency0 of [true, false]) {
      it(`prices ${label} from the currency${pokeIsCurrency0 ? '0' : '1'} side`, async () => {
        const { stateView, oracle, poolId, token } = await loadFixture(
          fixtureFor(pokeIsCurrency0),
        );

        // raw pool price = WETHwei per POKEwei = usdPerPoke / ethUsd, kept
        // as a fraction numerator/denominator so sub-ETH prices stay exact
        const rawN = usdPerPoke * 10n ** 8n;
        const rawD = ETH_USD_8 * ONE;
        const pokeIsC0 = await oracle.pokeIsCurrency0();
        const sqrtP = pokeIsC0
          ? isqrt((rawN * 2n ** 192n) / rawD) + 1n // round up so floor(sqrtP^2 / 2^192) covers the price
          : isqrt((rawD * 2n ** 192n) / rawN); // POKE per WETH side: invert the fraction
        await stateView.setSqrtPriceX96(poolId, sqrtP);

        const expectedCap = (usdPerPoke * SUPPLY) / ONE;
        // mirror math, tolerating isqrt + division drift (0.1% of the cap)
        const tolerance = expectedCap / 1000n;
        expect(await oracle.marketCap()).to.be.closeTo(expectedCap, tolerance);
        expect(await oracle.usdPerPoke()).to.be.closeTo(usdPerPoke, usdPerPoke / 1000n);
        expect(await token.totalSupply()).to.equal(SUPPLY);
      });
    }
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
    expect(await oracleNoFeed.usdPerPoke()).to.equal(3000n * ONE);
  });
});

describe('UniswapV3SpotOracle (Pons pools)', () => {
  for (const { label, usdPerPoke } of CASES) {
    for (const pokeIsToken0 of [true, false]) {
      it(`prices ${label} with POKE as token${pokeIsToken0 ? '0' : '1'}`, async () => {
        const [owner] = await ethers.getSigners();
        const token = await (
          await ethers.getContractFactory('PokeCardToken')
        ).deploy(owner.address);
        const tokenAddress = await token.getAddress();

        // pool ordering is decided by address sort, so read the real placement
        // back instead of trusting the loop variable
        const poolIsToken0First =
          tokenAddress.toLowerCase() < WETH.toLowerCase();
        const pool = await (
          await ethers.getContractFactory('MockV3Pool')
        ).deploy(
          poolIsToken0First ? tokenAddress : WETH,
          poolIsToken0First ? WETH : tokenAddress,
        );

        const aggregator = await (
          await ethers.getContractFactory('MockAggregator')
        ).deploy();

        const oracle = await (
          await ethers.getContractFactory('UniswapV3SpotOracle')
        ).deploy(await pool.getAddress(), tokenAddress, WETH, await aggregator.getAddress(), 3600);

        const pokeIs0 = await oracle.pokeIsToken0();
        // raw pool price = WETHwei per POKEwei = usdPerPoke / ethUsd, kept
        // as a fraction so sub-ETH prices stay exact
        const rawN = usdPerPoke * 10n ** 8n;
        const rawD = ETH_USD_8 * ONE;
        const sqrtP = pokeIs0
          ? isqrt((rawN * 2n ** 192n) / rawD) + 1n
          : isqrt((rawD * 2n ** 192n) / rawN);
        await pool.setSqrtPriceX96(sqrtP);

        const expectedCap = (usdPerPoke * SUPPLY) / ONE;
        const tolerance = expectedCap / 1000n;
        expect(await oracle.marketCap()).to.be.closeTo(expectedCap, tolerance);
        expect(await oracle.usdPerPoke()).to.be.closeTo(usdPerPoke, usdPerPoke / 1000n);
      });
    }
  }

  it('rejects a pool that does not pair POKE with WETH', async () => {
    const [owner] = await ethers.getSigners();
    const token = await (
      await ethers.getContractFactory('PokeCardToken')
    ).deploy(owner.address);
    const other = await (
      await ethers.getContractFactory('PokeCardToken')
    ).deploy(owner.address);
    const pool = await (
      await ethers.getContractFactory('MockV3Pool')
    ).deploy(await other.getAddress(), await token.getAddress());
    await expect(
      (await ethers.getContractFactory('UniswapV3SpotOracle')).deploy(
        await pool.getAddress(),
        await token.getAddress(),
        WETH,
        ethers.ZeroAddress,
        3600,
      ),
    ).to.be.revertedWithCustomError(
      await ethers.getContractFactory('UniswapV3SpotOracle'),
      'InvalidPool',
    );
  });

  it('supports a manual ETH/USD price when no feed is configured', async () => {
    const [owner] = await ethers.getSigners();
    const token = await (
      await ethers.getContractFactory('PokeCardToken')
    ).deploy(owner.address);
    const tokenAddress = await token.getAddress();
    const pokeFirst = tokenAddress.toLowerCase() < WETH.toLowerCase();
    const pool = await (
      await ethers.getContractFactory('MockV3Pool')
    ).deploy(pokeFirst ? tokenAddress : WETH, pokeFirst ? WETH : tokenAddress);
    const oracle = await (
      await ethers.getContractFactory('UniswapV3SpotOracle')
    ).deploy(await pool.getAddress(), tokenAddress, WETH, ethers.ZeroAddress, 3600);

    await expect(oracle.marketCap()).to.be.reverted;
    await oracle.setManualEthUsdPrice(ETH_USD_8);
    await pool.setSqrtPriceX96(2n ** 96n);
    expect(await oracle.usdPerPoke()).to.equal(3000n * ONE);
  });
});
