// Real browser execution. AI responses in this suite are deliberately fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const puppeteer = require('../scripts/video/node_modules/puppeteer-core');

const root = path.resolve(__dirname, '..');
const python = process.env.AIDEBUGGER_TEST_PYTHON || ['python3.13', 'python3.12', 'python3'].find(
  name => spawnSync(name, ['-c', 'import sys; assert sys.version_info >= (3,12)']).status === 0);
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const goodCode = 'def average(numbers):\n    return sum(numbers) / len(numbers) if numbers else 0\nprint(average([]))\n';
const read = (page, selector) => page.$eval(selector, el => el.textContent);
async function settled(page) {
  await page.waitForFunction(() => document.querySelector('#stop').hidden, {timeout: 100000});
}
async function setCode(page, code, checks = '') {
  await page.$eval('#source', (el, text) => { el.value = text; el.dispatchEvent(new Event('input')); }, code);
  await page.$eval('#checks', (el, text) => { el.value = text; el.dispatchEvent(new Event('input')); }, checks);
}

(async () => {
  assert(python, 'Python 3.12+ is required');
  const server = spawn(python, ['tests/workspace_fixture.py'], {cwd: root});
  let browser;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidebugger-browser-'));
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server did not start')), 10000);
      server.stdout.on('data', data => {
        const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+\/debug\//);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      server.on('error', reject);
      server.on('exit', code => { if (code) reject(new Error('Server exited with ' + code)); });
    });
    browser = await puppeteer.launch({executablePath: chrome, headless: true});
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setViewport({width: 1440, height: 1100});
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#connection').textContent.includes('aren’t connected'));
    await page.click('#example');
    assert(await page.$eval('#debug', el => el.disabled));
    await page.click('#run'); await settled(page);
    assert.match(await read(page, '#runs'), /ZeroDivisionError/);
    assert.match(await read(page, '#runs'), /Average: 20/);
    console.log('PASS original code runs without an AI connection and captures real errors');

    const pyFile = path.join(tmp, 'uploaded.py');
    fs.writeFileSync(pyFile, 'print("hello from an actual upload")\n');
    await (await page.$('#file')).uploadFile(pyFile);
    await page.waitForFunction(() => document.querySelector('#filename').textContent === 'uploaded.py');
    await page.click('#run'); await settled(page);
    assert.match(await read(page, '#runs'), /hello from an actual upload/);
    assert.match(await read(page, '#status'), /Run completed/);
    const invalid = path.join(tmp, 'invalid.zip'); fs.writeFileSync(invalid, 'not Python');
    await (await page.$('#file')).uploadFile(invalid);
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Unsupported file');
    const large = path.join(tmp, 'large.py'); fs.writeFileSync(large, '#'.repeat(40001));
    await (await page.$('#file')).uploadFile(large);
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'File too large');
    console.log('PASS real file upload, wrong type, and size limit');

    const configure = async state => (await fetch(new URL('/__test/control', url), {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(state)
    })).json();
    const readState = async () => (await fetch(new URL('/__test/state', url))).json();
    await configure({ready: true, mode: 'retry', calls: 0, checks: []});
    await page.click('#reconnect');
    await page.waitForFunction(() => document.querySelector('#connection').textContent.includes('AI connected'));
    await page.click('#example');
    const originalChecks = await page.$eval('#checks', el => el.value);
    await page.click('#debug'); await settled(page);
    const state = await readState();
    assert.equal(state.calls, 2, await read(page, '#message'));
    assert(state.checks.every(value => value === originalChecks));
    assert.equal(await read(page, '#status'), 'Checks passed');
    assert.equal(await read(page, '#fixed-code'), goodCode);
    assert.equal(await page.$('#explanation script'), null);
    assert.equal(await page.$eval('#source', el => el.value.includes('return sum(numbers) / len(numbers)\n')), true);
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: tmp});
    await page.click('#download');
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const interval = setInterval(() => {
        if (fs.existsSync(path.join(tmp, 'average.fixed.py'))) { clearInterval(interval); resolve(); }
        else if (Date.now() - started > 5000) { clearInterval(interval); reject(new Error('Download failed')); }
      }, 50);
    });
    assert.equal(fs.readFileSync(path.join(tmp, 'average.fixed.py'), 'utf8'), goodCode);
    await page.screenshot({path: path.join(tmp, 'desktop.png'), fullPage: true});
    await page.setViewport({width: 390, height: 844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path: path.join(tmp, 'mobile.png'), fullPage: true});
    console.log('PASS repair retries, unchanged checks, real rerun, safe text, download, and mobile layout');

    await configure({mode: 'fail', calls: 0, checks: []});
    await page.click('#example'); await page.click('#debug'); await settled(page);
    assert.equal((await readState()).calls, 3); assert.equal(await read(page, '#status'), 'Still failing');
    await configure({mode: 'error', calls: 0});
    await page.click('#example'); await page.click('#debug'); await settled(page);
    assert.equal((await readState()).calls, 1); assert.match(await read(page, '#message'), /provider returned an incomplete response/);
    console.log('PASS bounded attempts and visible provider failures');

    await setCode(page, 'while True:\n    pass');
    await page.click('#run'); await settled(page);
    assert.match(await read(page, '#runs'), /Execution stopped after 5 seconds/);
    await page.click('#run');
    await page.click('#stop'); await settled(page);
    assert.equal(await read(page, '#status'), 'Stopped');
    await setCode(page, 'print("still responsive")');
    await page.click('#run'); await settled(page);
    assert.match(await read(page, '#runs'), /still responsive/);
    console.log('PASS infinite-loop timeout, cancellation, and runtime recovery');

    await setCode(page, 'from js import fetch\nfetch("https://example.com/should-be-blocked")\nprint("network attempted")');
    const outsideRequests = [];
    page.on('request', request => { if (request.url().includes('example.com/should-be-blocked')) outsideRequests.push(request.url()); });
    await page.click('#run'); await settled(page);
    assert.equal(outsideRequests.length, 0);
    assert.deepEqual(pageErrors, []);
    console.log('PASS sandbox blocks arbitrary network access; no page errors');
    console.log('Screenshots:', tmp);
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
