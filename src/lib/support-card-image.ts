import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { renderAsync } from '@resvg/resvg-js';
import { aspirationLabel, percentageLabel } from './aspiration';
import type { SupportCard } from './support-card';
import { money } from './model';
import brandIcon from '../assets/brand-icon.json';

const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
// Bound text by conservative glyph widths, including unbroken words and CJK.
const fit = (value: string, budget: number) => {
  let used = 0;
  const chars = Array.from(value);
  const end = chars.findIndex((c) => { used += /[MW@%]/.test(c) || c.codePointAt(0)! > 255 ? 1.05 : /[ilI.,' ]/.test(c) ? .35 : /[A-Z0-9]/.test(c) ? .75 : .6; return used > budget; });
  return end < 0 ? value : `${chars.slice(0, Math.max(0, end - 1)).join('').trimEnd()}…`;
};
const text = (x: number, y: number, value: string, size = 20, color = '#26334b', bold = false) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${bold ? 700 : 400}">${xml(value)}</text>`;
const bar = (x: number, y: number, width: number, height: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${fill}"/>`;

// No remote assets, user SVG, HTML, URLs, or receipt data enter the renderer.
export const supportCardSvg = (card: SupportCard, demo = false) => {
  const rows = Math.ceil(card.projects.length / 2);
  const height = rows === 1 ? 266 : rows === 2 ? 176 : 116;
  const gap = 14;
  const start = rows === 1 ? 226 : 198;
  const cells = card.projects.map((project, index) => {
    const x = 52 + index % 2 * 554;
    const width = card.projects.length === 1 ? 1094 : 540;
    const y = start + Math.floor(index / 2) * (height + gap);
    const pct = percentageLabel(project.percentage);
    const progress = project.progress;
    const label = card.pickMode ? (project.target ? `${money(project.target)} aspiration` : 'A suggestion, freely given') : progress ? aspirationLabel(progress) : 'Ongoing work · every bit helps';
    const titleY = y + (rows === 1 ? 61 : rows === 2 ? 43 : 29);
    const barY = titleY + (rows === 1 ? 50 : rows === 2 ? 31 : 20);
    const goalY = y + height - 21;
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="16" fill="#ffffff" stroke="#e1e8f2"/>
      ${text(x + 22, titleY, fit(project.title, width === 540 ? 17.5 : 40), 22, '#192940', true)}
      ${text(x + width - 108, titleY, pct, 26, '#0866ff', true)}
      ${card.pickMode ? '' : `${bar(x + 22, barY, width - 44, 8, '#edf2fa')}${bar(x + 22, barY, Math.max(2, (width - 44) * project.percentage / 100), 8, '#0866ff')}`}
      ${rows === 1 ? text(x + 22, barY + 40, card.pickMode ? 'of these picks' : 'of this support', 18, '#627088') : ''}
      ${progress ? text(x + 22, goalY - 20, `${money(project.target)} aspiration`, 16, '#26334b', true) : ''}
      ${text(x + 22, goalY, fit(label, 28), 16, progress?.exceeded ? '#7246b5' : '#627088')}
      ${progress ? `${bar(x + width - 170, goalY - 9, 148, 5, '#edf2fa')}${bar(x + width - 170, goalY - 9, 148 * progress.fill / 100, 5, '#a9caff')}${progress.exceeded ? bar(x + width - 170, goalY - 9, Math.max(2, 148 * progress.surplusFill / 100), 5, 'url(#rainbow)') : ''}` : ''}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs><linearGradient id="wash" x2="1" y2="1"><stop stop-color="#f5f9ff"/><stop offset="1" stop-color="#f8f6ff"/></linearGradient><linearGradient id="rainbow"><stop stop-color="#7764f4"/><stop offset=".25" stop-color="#eb67ab"/><stop offset=".5" stop-color="#f6b753"/><stop offset=".75" stop-color="#4cc8a2"/><stop offset="1" stop-color="#479bff"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#wash)"/>
    <g font-family="Lato">
      <image href="${brandIcon.dataUrl}" x="52" y="37" width="36" height="36"/>${text(99, 64, 'feedme', 26, '#192940', true)}
      ${text(930, 61, demo ? 'DEMO · NO PAYMENT' : 'MY SUPPORT SPLIT', 16, '#627088', true)}
      ${text(52, 127, card.pickMode ? 'More of what matters.' : 'Good things, backed.', 46, '#192940', true)}
      ${text(52, 165, `Supporting ${fit(card.creator.name, 40)}`, 24, '#627088')}
      ${cells}
      ${text(52, 608, card.other.count ? `+ ${card.other.count} other ${card.other.count === 1 ? 'project' : 'projects'} · ${percentageLabel(card.other.percentage)} of this support` : 'A little support. A lot of possibility.', 17, '#627088')}
      ${text(916, 608, 'Your split. Their next chapter.', 16, '#627088')}
    </g></svg>`;
};

const images = new Map<string, Promise<Buffer>>();
export const supportCardPng = (card: SupportCard, demo = false): Promise<Buffer> => {
  const svg = supportCardSvg(card, demo);
  const key = createHash('sha256').update(svg).digest('hex');
  const cached = images.get(key);
  if (cached) return cached;
  // Bundled OFL fonts make VPS/container rendering independent of system fonts.
  const fontFiles = ['Lato-Regular.ttf', 'Lato-Bold.ttf'].map((name) => resolve(import.meta.env.PROD ? 'dist/client/fonts' : 'public/fonts', name));
  const pending = renderAsync(svg, { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'Lato' } })
    .then((image) => image.asPng()).catch((error) => { images.delete(key); throw error; });
  images.set(key, pending);
  if (images.size > 32) images.delete(images.keys().next().value!);
  return pending;
};
