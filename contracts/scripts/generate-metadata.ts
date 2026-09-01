/**
 * PokeCard milestone metadata generator.
 *
 * Takes an ordered list of TCGdex card ids (index 0 = card #01 = the first
 * milestone), downloads the high-res artwork, and produces ERC-721 metadata
 * JSON per milestone. With a Pinata JWT it pins everything to IPFS and
 * prints the BASE_TOKEN_URI for MilestoneCards; without one it writes the
 * files locally for manual pinning.
 *
 * Env:
 *   MILESTONE_CARDS   comma-separated ordered TCGdex card ids
 *                     (default: a starter Base Set ladder)
 *   THRESHOLDS        comma-separated USD market caps, matching the contract
 *   PINATA_JWT        Pinata API JWT (optional - enables IPFS pinning)
 *   OUT_DIR           local output directory (default ./metadata-out)
 *
 * Run: npm run metadata
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const API = 'https://api.tcgdex.net/v2/en/cards';
const DEFAULT_CARDS = 'base1-4,base1-2,base1-1,base1-6,base1-15';
const DEFAULT_THRESHOLDS = '5000,10000,25000,50000,100000,250000,500000,1000000';

const cards = (process.env.MILESTONE_CARDS ?? DEFAULT_CARDS)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const thresholds = (process.env.THRESHOLDS ?? DEFAULT_THRESHOLDS)
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const pinataJwt = process.env.PINATA_JWT;
const outDir = path.resolve(process.env.OUT_DIR ?? 'metadata-out');

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function fetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function pinFile(name: string, data: Buffer, contentType: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)], { type: contentType }), name);
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pinataJwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata pin failed for ${name}: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { IpfsHash: string };
  return json.IpfsHash;
}

async function main() {
  if (cards.length === 0) throw new Error('no cards configured');
  fs.mkdirSync(outDir, { recursive: true });

  const imageHashes: (string | null)[] = [];

  for (let i = 0; i < cards.length; i++) {
    const id = cards[i];
    const milestone = i + 1;
    const cap = thresholds[i] ?? thresholds[thresholds.length - 1] ?? 5000;
    console.log(`[${milestone}] ${id} (${usd(cap)} milestone)`);

    const info = (await fetchJson(`${API}/${encodeURIComponent(id)}`)) as {
      name: string;
      image?: string;
      rarity?: string;
      set?: { name?: string };
    };

    let imageUri = '';
    if (info.image) {
      const png = `${info.image}/high.png`;
      const buf = await fetchImage(png);
      if (pinataJwt) {
        const hash = await pinFile(`pokecard-${milestone}.png`, buf, 'image/png');
        imageUri = `ipfs://${hash}`;
        console.log(`  image pinned: ${imageUri}`);
      } else {
        fs.writeFileSync(path.join(outDir, `pokecard-${milestone}.png`), buf);
        console.log(`  image saved locally (no PINATA_JWT)`);
      }
    } else {
      console.log(`  no artwork on TCGdex for ${id} - pick a different card`);
    }

    const metadata = {
      name: `${info.name} - Card #${String(milestone).padStart(2, '0')}`,
      description:
        `Official PokeCard Lab milestone card. Minted once when the token crossed ` +
        `${usd(cap)} market cap on the Robinhood Chain. One of a kind: this card ` +
        `will never be minted again.`,
      image: imageUri || undefined,
      external_url: 'https://tcgdex.dev',
      attributes: [
        { trait_type: 'Card Number', value: `#${String(milestone).padStart(2, '0')}` },
        { trait_type: 'Milestone Market Cap', value: usd(cap) },
        { trait_type: 'TCGdex Card', value: info.name },
        { trait_type: 'TCG Set', value: info.set?.name ?? id },
        { trait_type: 'Rarity (TCG)', value: info.rarity ?? 'Unknown' },
        { trait_type: 'Single Mint', value: 'true' },
      ],
    };

    const jsonPath = path.join(outDir, `${milestone}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
    console.log(`  metadata: ${jsonPath}`);
  }

  if (pinataJwt) {
    // pin the JSONs as one IPFS directory so baseTokenURI is stable
    const form = new FormData();
    for (let i = 0; i < cards.length; i++) {
      const file = path.join(outDir, `${i + 1}.json`);
      form.append(
        'file',
        new Blob([new Uint8Array(fs.readFileSync(file))], { type: 'application/json' }),
        `pokecard-metadata/${i + 1}.json`,
      );
    }
    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pinataJwt}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Pinata folder pin failed: ${res.status} ${await res.text()}`);
    const { IpfsHash } = (await res.json()) as { IpfsHash: string };
    console.log('\nSet this on the MilestoneCards contract:');
    console.log(`BASE_TOKEN_URI=ipfs://${IpfsHash}/`);
  } else {
    console.log(
      `\nJSONs written to ${outDir}. Pin that directory to IPFS (e.g. Pinata ` +
        `"upload folder"), then call setBaseTokenURI("ipfs://<cid>/").`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
