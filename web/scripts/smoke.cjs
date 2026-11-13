// Smoke test: builds must already exist (npm run build). Starts `vite preview`, drives the app in
// headless Chromium and exits non-zero on any failure. Needs the `playwright` package and a Chromium.
// Pass --figures <dir> to also save the three seam screenshots used on the submission page.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const PORT = 4179, B = `http://localhost:${PORT}`;
const figDir = process.argv.includes('--figures') ? path.resolve(process.argv[process.argv.indexOf('--figures') + 1]) : null;
const fail = (msg) => { throw new Error(msg); };

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch(B)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }
    browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    // 0. system view: three bodies, pick Mars, pick a target, land on Earth's ranked list
    await page.goto(`${B}/?nointro`);
    await page.waitForSelector('canvas');
    await page.getByRole('button', { name: 'Mars', exact: true }).first().click();
    await page.getByRole('button', { name: /Gale crater/ }).first().click();
    await page.waitForSelector('text=Ground like Gale crater');
    if (figDir) { await page.waitForTimeout(2500); await page.screenshot({ path: path.join(figDir, 'system-earth.png') }); }

    // 1. data loads and the ribbon list renders
    await page.goto(`${B}/sol?nointro`);
    await page.waitForSelector('ol li a');
    const rows = await page.locator('ol li').count();
    if (rows < 1) fail('no site ribbons rendered');

    // 2. open a seam view
    await page.locator('ol li a').first().click();
    await page.waitForSelector('canvas');
    await page.waitForTimeout(2500);
    const clock = page.locator('.clock');
    const canvas = page.locator('canvas').first();

    // 3. scrub the clock: readout and terrain colour must both change
    const setHour = async (h) => { await page.locator('input.scrub').first().fill(String(h)); await page.waitForTimeout(700); };
    await setHour(6);
    const t6 = await clock.textContent(), shot6 = await canvas.screenshot();
    if (figDir) await page.screenshot({ path: path.join(figDir, 'seam-0600.png') });
    await setHour(14);
    const t14 = await clock.textContent(), shot14 = await canvas.screenshot();
    if (figDir) await page.screenshot({ path: path.join(figDir, 'seam-1400.png') });
    if (t6 !== '06:00' || t14 !== '14:00') fail(`clock readout wrong: ${t6}, ${t14}`);
    if (shot6.equals(shot14)) fail('terrain did not change between 06:00 and 14:00');
    if (figDir) { await setHour(22); await page.screenshot({ path: path.join(figDir, 'seam-2200.png') }); }

    // 4. layer switch and camera preset change the picture
    await page.getByRole('button', { name: 'Satellite' }).click();
    await page.waitForTimeout(700);
    if ((await canvas.screenshot()).equals(shot14)) fail('satellite layer did not change the terrain');
    await page.getByRole('button', { name: 'Overhead' }).click();
    await page.waitForTimeout(1200);

    // 5. rover trial runs to a result
    await page.getByRole('button', { name: /Details/ }).first().click();
    await page.getByRole('link', { name: 'Run this trial' }).click();
    await page.waitForSelector('canvas');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Run the trial' }).click();
    await page.waitForSelector('text=/EARTH (PASS|STUCK) \\/ MARS (PASS|STUCK)/', { timeout: 20000 });

    // 6. evidence and method render
    for (const [route, text] of [['/evidence', 'Controls'], ['/method', 'Closeness formula']]) {
      await page.goto(`${B}${route}?nointro`);
      await page.waitForSelector(`text=${text}`);
    }
    if (errors.length) fail(`console errors:\n${errors.join('\n')}`);
    console.log('smoke: PASS');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => { console.error('smoke: FAIL\n' + e.message); process.exit(1); });
