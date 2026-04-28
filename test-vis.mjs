/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('http://localhost:5173/#/visualiser');
  await page.waitForTimeout(20000);

  await page.screenshot({ path: '/tmp/vis-screenshot.png' });

  for (const log of logs) {
    console.log(log);
  }

  await browser.close();
})();
