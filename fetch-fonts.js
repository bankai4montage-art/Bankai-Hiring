/**
 * One-time script: downloads Inter + Cairo woff2 subsets from Google Fonts
 * and rewrites the CSS to local paths → public/assets/fonts.css + fonts/.
 * Run: node fetch-fonts.js
 */
import fs from 'node:fs';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Inter:wght@400;500;600;700;800&display=swap';
const OUT_DIR = path.resolve('public/assets');
const FONT_DIR = path.join(OUT_DIR, 'fonts');
fs.mkdirSync(FONT_DIR, { recursive: true });

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();

// Rewrite each woff2 URL to a local file
const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
const uniq = [...new Set(urls)];
let out = css;
let i = 0;
for (const url of uniq) {
  const file = url.split('/').pop().split('?')[0]; // hash.woff2
  const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
  fs.writeFileSync(path.join(FONT_DIR, file), buf);
  out = out.replaceAll(url, `fonts/${file}`);
  i++;
  console.log(`⬇  ${file} (${(buf.length / 1024).toFixed(1)} KB)`);
}
fs.writeFileSync(path.join(OUT_DIR, 'fonts.css'), out);
console.log(`✅ fonts.css generated with ${i} self-hosted font files`);
