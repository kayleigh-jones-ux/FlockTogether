/* Throwaway: strip of the edited sprites, plus glasses composited on a sheep. */
import sharp from 'sharp';

const SP = process.argv[2];
const CHANGED = [
  'hat-sou-wester', 'hat-daisy-chain', 'hat-antlers', 'hat-deely-boppers',
  'hat-sunglasses', 'hat-reading-glasses', 'hat-ice-cream', 'hat-cactus', 'hat-flowerpot',
];

const CELL = 260;
const cols = 5;
const rows = Math.ceil(CHANGED.length / cols);
const cells = [];
for (let i = 0; i < CHANGED.length; i++) {
  const buf = await sharp(`assets/generated/${CHANGED[i]}.png`)
    .resize(CELL - 16, CELL - 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const x = (i % cols) * CELL;
  const y = Math.floor(i / cols) * (CELL + 26);
  cells.push({ input: buf, left: x + 8, top: y + 8 });
  cells.push({
    input: Buffer.from(
      `<svg width="${CELL}" height="26" xmlns="http://www.w3.org/2000/svg"><text x="${CELL / 2}" y="19" font-family="sans-serif" font-size="15" font-weight="700" fill="#f5efe0" text-anchor="middle">${CHANGED[i]}</text></svg>`,
    ),
    left: x,
    top: y + CELL,
  });
}
await sharp({ create: { width: cols * CELL, height: rows * (CELL + 26), channels: 4, background: '#2f6b33' } })
  .composite(cells).png().toFile(`${SP}/edited.png`);
console.log('edited.png');

/* The glasses only matter sitting on a sheep's face, so try it. The sheep art is
 * 448 wide with the head at the right; the eyes sit around x 0.72, y 0.28 of the
 * sprite. This is a sanity check of fit and see-through, not the real placement —
 * that gets tuned in /admin. */
const sheep = await sharp('assets/generated/sheep-idle.png').resize(560).toBuffer();
const meta = await sharp(sheep).metadata();
const tries = [];
for (const [i, id] of ['hat-sunglasses', 'hat-reading-glasses'].entries()) {
  const gw = Math.round(meta.width * 0.30);
  const g = await sharp(`assets/generated/${id}.png`).trim().resize(gw).toBuffer();
  const gm = await sharp(g).metadata();
  const composed = await sharp(sheep)
    .composite([{ input: g, left: Math.round(meta.width * 0.63), top: Math.round(meta.height * 0.20) }])
    .png().toBuffer();
  tries.push({ input: composed, left: i * meta.width, top: 0 });
  console.log(`${id} placed at ${gm.width}x${gm.height}`);
}
await sharp({ create: { width: meta.width * 2, height: meta.height, channels: 4, background: '#2f6b33' } })
  .composite(tries).png().toFile(`${SP}/glasses-on-sheep.png`);
console.log('glasses-on-sheep.png');
