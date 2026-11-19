const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const suitePath = path.join(__dirname, 'mechanics-suite.browser.js');
if (!fs.existsSync(htmlPath) || !fs.existsSync(suitePath)) {
  throw new Error('Missing index.html or tests/mechanics-suite.browser.js');
}

const html = fs.readFileSync(htmlPath, 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('http://127.0.0.1:')) return route.continue();
      return route.abort();
    });
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: suitePath });
    const report = await page.evaluate(() => window.runMonopolyMechanicsSuite());
    console.log('\n=== MONOPOLY MECHANICS AUTOTEST ===');
    for (const name of report.passed) console.log('PASS  ' + name);
    for (const gap of report.knownGaps) console.log('GAP   ' + gap);
    for (const fail of report.failed) console.log('FAIL  ' + fail.name + ': ' + fail.error);
    if (pageErrors.length) {
      console.log('FAIL  Browser errors: ' + pageErrors.join(' | '));
    }
    console.log('\nSUMMARY ' + JSON.stringify(report.summary));
    console.log('KNOWN GAPS\n' + report.knownGaps.map((x,i) => (i+1)+'. '+x).join('\n'));
    if (report.failed.length || pageErrors.length) process.exitCode = 1;
    if (process.env.STRICT_MECHANICS === '1' && report.knownGaps.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 2;
  server.close();
});
