import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SmokeSwapper } from '../typechain-types';

const ONE = 10n ** 18n;
const SQRT_ONE = 1n << 96n; // sqrtPriceX96 for a 1:1 price

describe('SmokeSwapper', () => {
  async function deployFixture(wethIsToken0: boolean) {
    const [owner, alice] = await ethers.getSigners();
    const weth = await (await ethers.getContractFactory('MockWETH9')).deploy();
    const poke = await (await ethers.getContractFactory('PokeCardToken')).deploy(owner.address);
    const [t0, t1] = wethIsToken0
      ? [await weth.getAddress(), await poke.getAddress()]
      : [await poke.getAddress(), await weth.getAddress()];
    const pool = await (await ethers.getContractFactory('MockV3SwapPool')).deploy(t0, t1);
    await pool.setSqrtPriceX96(SQRT_ONE); // 1 POKE per WETH both ways
    // the pool pays swaps out of its POKE float
    await (poke as unknown as { transfer: (to: string, v: bigint) => Promise<unknown> })
      .transfer(await pool.getAddress(), 1000n * ONE);
    const swapper = (await (
      await ethers.getContractFactory('SmokeSwapper')
    ).deploy(await weth.getAddress())) as SmokeSwapper;
    return { owner, alice, weth, poke, pool, swapper };
  }

  it('swaps ETH to POKE when WETH is token0', async () => {
    const { alice, poke, pool, swapper } = await deployFixture(true);
    await swapper.swapEthToToken(await pool.getAddress(), await poke.getAddress(), alice.address, ONE, {
      value: ONE,
    });
    expect(await poke.balanceOf(alice.address)).to.equal(ONE);
  });

  it('swaps ETH to POKE when WETH is token1', async () => {
    const { alice, poke, pool, swapper } = await deployFixture(false);
    await swapper.swapEthToToken(await pool.getAddress(), await poke.getAddress(), alice.address, ONE, {
      value: ONE,
    });
    expect(await poke.balanceOf(alice.address)).to.equal(ONE);
  });

  it('reverts when the fill lands under minOut', async () => {
    const { alice, poke, pool, swapper } = await deployFixture(true);
    await expect(
      swapper.swapEthToToken(await pool.getAddress(), await poke.getAddress(), alice.address, 2n * ONE, {
        value: ONE,
      }),
    ).to.be.revertedWithCustomError(swapper, 'Slippage');
  });

  it('refuses non-owners and rejects callbacks from non-pools', async () => {
    const { alice, poke, pool, swapper } = await deployFixture(true);
    await expect(
      swapper
        .connect(alice)
        .swapEthToToken(await pool.getAddress(), await poke.getAddress(), alice.address, 0, { value: ONE }),
    ).to.be.revertedWithCustomError(swapper, 'NotOwner');
    await expect(
      swapper.connect(alice).uniswapV3SwapCallback(ONE, 0, '0x'),
    ).to.be.reverted; // staticcall to token0() on an EOA fails the pool check
  });

  it('lets the owner recover stray tokens and rejects plain ETH transfers', async () => {
    const { owner, alice, poke, swapper } = await deployFixture(true);
    await (poke as unknown as { transfer: (to: string, v: bigint) => Promise<unknown> }).transfer(
      await swapper.getAddress(),
      5n * ONE,
    );
    await swapper.recover(await poke.getAddress(), alice.address);
    expect(await poke.balanceOf(alice.address)).to.equal(5n * ONE);
    // no receive(): plain ETH transfers cannot get stuck in the helper
    await expect(
      owner.sendTransaction({ to: await swapper.getAddress(), value: 123n }),
    ).to.be.reverted;
  });
});
