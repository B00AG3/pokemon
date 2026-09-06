import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

/**
 * Points a Pons token's creator fees at the keeper wallet. Use this right
 * after launching on the Pons WEBSITE: the site makes the launching wallet
 * the fee recipient, so the 70% creator share would strand there where the
 * keeper can never sweep it into the redemption pool. One call from the
 * wallet that launched (the current recipient), effective immediately:
 *
 *   transferCreatorFeeRecipient(keeper)
 *
 * Env (contracts/.env):
 *   TOKEN_ADDRESS        REQUIRED - the Pons-launched token
 *   PRIVATE_KEY          REQUIRED - the wallet that LAUNCHED the token
 *                        (the current fee recipient); set it here or inline
 *                        for this one command, never commit it
 *   KEEPER_ADDRESS       destination (default: the Fly keeper wallet)
 *   EXECUTE              1 = actually send (default: dry run)
 *
 * Run: npx ts-node scripts/point-fees-at-keeper.ts
 */

const RPC = process.env.KEEPER_RPC_URL_MAINNET ?? 'https://rpc.mainnet.chain.robinhood.com';
const KEEPER_DEFAULT = '0xD805A36605391b1ed8C3E7d1C846d2D161541d6f'; // Fly keeper

const tokenAbi = [
  'function transferCreatorFeeRecipient(address newRecipient)',
  'function creatorFeeRecipient() view returns (address)',
];

async function main() {
  const tokenAddress = process.env.TOKEN_ADDRESS;
  if (!tokenAddress) throw new Error('TOKEN_ADDRESS is required (the Pons-launched token)');
  const key = process.env.PRIVATE_KEY;
  if (!key) throw new Error('PRIVATE_KEY missing: this must run from the wallet that launched the token');
  const keeper = process.env.KEEPER_ADDRESS ?? KEEPER_DEFAULT;

  const provider = new ethers.JsonRpcProvider(RPC);
  const signer = new ethers.Wallet(key, provider);
  const token = new ethers.Contract(tokenAddress, tokenAbi, signer);

  let current: string | null = null;
  try {
    current = await token.creatorFeeRecipient();
  } catch {
    /* getter name differs across versions; the transfer below still works */
  }
  console.log(`token:            ${tokenAddress}`);
  console.log(`sender:           ${signer.address} (must be the current fee recipient)`);
  console.log(`current fees to:  ${current ?? '(unreadable - check the Pons site)'}`);
  console.log(`moving fees to:   ${keeper} (keeper wallet; sweeps them into the card pool)`);

  if (current !== null && current.toLowerCase() === keeper.toLowerCase()) {
    console.log('\nFees already land on the keeper - nothing to do.');
    return;
  }

  if (process.env.EXECUTE !== '1') {
    console.log('\nDRY RUN - nothing sent. Re-run with EXECUTE=1 to move the fees.');
    return;
  }

  const tx = await token.transferCreatorFeeRecipient(keeper);
  console.log(`tx ${tx.hash} - waiting for confirmation`);
  await tx.wait();
  try {
    const now: string = await token.creatorFeeRecipient();
    console.log(`fee recipient is now: ${now}`);
  } catch {
    console.log('sent - verify the new recipient on the Pons site or Blockscout.');
  }
}

main().catch((e) => {
  console.error('point-fees failed:', (e as Error).message ?? e);
  process.exit(1);
});
