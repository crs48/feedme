import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

// Deterministic format/size exports of the supplied artwork; no redrawing/cropping.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = `data:image/jpeg;base64,${(await readFile(join(root, 'public/brand/feedme.jpg'))).toString('base64')}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1408" height="1408"><image href="${source}" width="1408" height="1408"/></svg>`;
const exports = [
  ['favicon-16.png', 16], ['favicon-32.png', 32], ['favicon-48.png', 48],
  ['icon-64.png', 64], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512],
];
await mkdir(join(root, 'public/icons'), { recursive: true });
const pngs = new Map();
for (const [name, size] of exports) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  pngs.set(size, png);
  await writeFile(join(root, 'public/icons', name), png);
}

// ICO directory with PNG frames, supported by modern browsers and Windows.
const frames = [16, 32, 48];
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
let offset = header.length;
for (const [index, size] of frames.entries()) {
  const entry = 6 + 16 * index, png = pngs.get(size);
  header[entry] = size; header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
}
await writeFile(join(root, 'public/favicon.ico'), Buffer.concat([header, ...frames.map(size => pngs.get(size))]));
await writeFile(join(root, 'public/apple-touch-icon.png'), pngs.get(180));
const dataUrl = `data:image/png;base64,${pngs.get(64).toString('base64')}`;
await writeFile(join(root, 'public/favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image href="${dataUrl}" width="64" height="64"/></svg>\n`);
await mkdir(join(root, 'src/assets'), { recursive: true });
await writeFile(join(root, 'src/assets/brand-icon.json'), `${JSON.stringify({ dataUrl })}\n`);

// Update the existing code-native share card with the same embedded brand image.
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><clipPath id="icon"><rect x="72" y="64" width="56" height="56" rx="12"/></clipPath></defs><rect width="1200" height="630" fill="white"/><image href="${dataUrl}" x="72" y="64" width="56" height="56" clip-path="url(#icon)"/><g font-family="Lato"><text x="146" y="104" font-size="40" font-weight="bold" letter-spacing="-2" fill="#1a1f36">feedme</text><text x="72" y="290" font-size="76" font-weight="bold" letter-spacing="-3" fill="#1a1f36">Independent work.</text><text x="72" y="386" font-size="76" font-weight="bold" letter-spacing="-3" fill="#0866ff">Supported.</text><path d="M72 466h1056" stroke="#e3e8ee"/><text x="72" y="534" font-size="25" fill="#596579">Support projects. Follow their progress. Connect through AT Protocol.</text></g></svg>`;
await writeFile(join(root, 'public/social-card.svg'), `${card}\n`);
await writeFile(join(root, 'public/social-card.png'), new Resvg(card, { font: { loadSystemFonts: false, fontFiles: ['Lato-Regular.ttf', 'Lato-Bold.ttf'].map(name => join(root, 'public/fonts', name)), defaultFontFamily: 'Lato' } }).render().asPng());
console.log('Exported Feedme browser, home-screen and share-card icons from the supplied artwork.');
