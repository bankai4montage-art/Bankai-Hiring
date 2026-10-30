/**
 * Bankai-Hiring — self-hosted assets builder
 * 1. Compiles Tailwind CSS into public/assets/styles.css (no CDN at runtime)
 * 2. Fonts are self-hosted in public/assets/fonts (see fonts.css)
 *
 * Run: npm run build:css   (only needed when classes/markup change)
 */
import { execSync } from 'node:child_process';

execSync(
  'npx tailwindcss -i public/assets/tailwind.src.css -o public/assets/styles.css --minify',
  { stdio: 'inherit' }
);
console.log('✅ Tailwind compiled → public/assets/styles.css');
