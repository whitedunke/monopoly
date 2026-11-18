const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const helperPath = path.join(__dirname, 'building-user-path.browser.js');
if (!fs.existsSync(htmlPath) || !fs.existsSync(helperPath)) throw new Error('Missing game or browser test helper');

const html = fs.readFileSync(htmlPath, 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
  res.end(html);
});
const passed = [];
const failed = [];

function check(value, message) {
  if (!value) throw new Error(message);
}
async function runCase(browser, name, viewport, seed, action) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(7000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url().startsWith('http://127.0.0.1:')) return route.continue();
    return route.abort();
  });
  try {
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil:'domcontentloaded' });
    await page.addScriptTag({ path:helperPath });
    await page.evaluate(options => window.__MONOPOLY_UI_TEST__.seed(options), seed);

    // Real UI path: open the property manager, click a rendered property card, then use its build button.
    const manager = page.getByRole('button', { name:/Управление недвижимостью/ });
    await manager.evaluate(el => el.click());
    const card = page.locator('#estate-property-list .estate-property').filter({ hasText:seed.selectName });
    check(await card.count() === 1, name + ': property card not found: ' + seed.selectName);
    await card.click();
    const before = await page.evaluate(() => window.__MONOPOLY_UI_TEST__.snapshot());
    check(before.button.visible, name + ': build button is not visible');
    await action(page, before);
    check(pageErrors.length === 0, name + ': browser errors: ' + pageErrors.join(' | '));
    passed.push(name);
  } catch (error) {
    failed.push({ name, error:String(error?.message || error) });
    await page.screenshot({ path:path.join(root, 'building-ui-failure-' + name + '.png'), fullPage:true }).catch(()=>{});
  } finally {
    await page.close();
  }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true });
  try {
    // Reported case: selected red street costs 150, player has 120, but complete pink group costs 100.
    await runCase(browser, 'alternative-affordable-group-desktop', {width:1366,height:900}, {
      money:120, owned:[11,13,14,21,23,24], selected:24, selectName:'Пл. Маяковского'
    }, async (page, before) => {
      check(!before.button.disabled, 'expected enabled build button for an affordable owned group');
      check(before.button.targetId === '11', 'expected target cell 11 (Полянка), got ' + before.button.targetId);
      check(/Полянка/.test(before.button.text), 'button does not name the offered street: ' + before.button.text);
      await page.locator('#estate-build-btn').click();
      const after = await page.evaluate(() => window.__MONOPOLY_UI_TEST__.snapshot());
      check(after.money === 20, 'expected balance 20 after building for 100; got ' + after.money);
      check(after.properties['11']?.houses === 1, 'house missing from Полянка property record');
      check(after.properties['13']?.houses === 0 && after.properties['14']?.houses === 0, 'house was built on the wrong pink street');
      check(after.boardHouseCounts[11] === 1, 'house not rendered on Полянка board cell');
      check(after.estateCards.some(x => /Полянка.*1 дом/.test(x)), 'property card did not refresh to 1 house');
      check(after.bankHouses === 31, 'bank stock should decrease to 31');
    });

    // Same purchase through the controls on a 390px phone viewport.
    await runCase(browser, 'direct-build-mobile-390px', {width:390,height:844}, {
      money:120, owned:[11,13,14], selected:11, selectName:'Полянка'
    }, async (page, before) => {
      check(!before.button.disabled, 'mobile build button should be enabled');
      check(before.button.targetId === '11', 'mobile button should target Полянка');
      await page.locator('#estate-build-btn').click();
      const after = await page.evaluate(() => window.__MONOPOLY_UI_TEST__.snapshot());
      check(after.money === 20 && after.properties['11']?.houses === 1, 'mobile click did not complete purchase');
      check(after.boardHouseCounts[11] === 1, 'mobile board cell did not show house');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page has horizontal overflow');
    });

    await runCase(browser, 'insufficient-money-disabled-in-ui', {width:1366,height:900}, {
      money:90, owned:[11,13,14], selected:11, selectName:'Полянка'
    }, async (_page, before) => {
      check(before.button.disabled, 'button should be disabled when player has only 90');
      check(/не хватает|недостаточно/i.test(before.button.title), 'disabled control should explain the money shortfall');
    });

    await runCase(browser, 'incomplete-group-disabled-in-ui', {width:1366,height:900}, {
      money:120, owned:[11,13], selected:11, selectName:'Полянка'
    }, async (_page, before) => {
      check(before.button.disabled, 'button should be disabled when the color group is incomplete');
    });

    await runCase(browser, 'mortgaged-group-disabled-in-ui', {width:1366,height:900}, {
      money:120, owned:[11,13,14], mortgaged:[13], selected:11, selectName:'Полянка'
    }, async (_page, before) => {
      check(before.button.disabled, 'button should be disabled while a group street is mortgaged');
    });

    // Existing 1/0/0 distribution: button must offer the next eligible lowest street.
    await runCase(browser, 'even-building-guides-user-to-lowest-street', {width:1366,height:900}, {
      money:120, owned:[11,13,14], houses:{11:1}, selected:11, selectName:'Полянка'
    }, async (page, before) => {
      check(!before.button.disabled, 'a least-developed street should remain buildable');
      check(['13','14'].includes(before.button.targetId), 'button should target Sretenka or Rostovskaya, got ' + before.button.targetId);
      const expectedName = before.button.targetId === '13' ? 'Сретенка' : 'Ростовская';
      check(before.button.text.includes(expectedName), 'button label does not name the least-developed street');
      await page.locator('#estate-build-btn').click();
      const after = await page.evaluate(() => window.__MONOPOLY_UI_TEST__.snapshot());
      check(after.properties[before.button.targetId]?.houses === 1, 'house was not built on the offered lowest street');
      check(after.properties['11'].houses === 1, 'existing house count changed');
      check(after.money === 20, 'incorrect balance after construction');
    });

    // Tax spaces are not purchasable. Use the visible Roll button and deterministic dice.
    for (const taxCase of [
      { name:'income-tax-cell-4', start:0, dice:[0,0.34], expectedPos:4, tax:200 },
      { name:'luxury-tax-cell-38', start:36, dice:[0,0], expectedPos:38, tax:100 }
    ]) {
      const page = await browser.newPage({ viewport:{width:390,height:844} });
      page.setDefaultTimeout(7000);
      const pageErrors=[];
      page.on('pageerror',error=>pageErrors.push(error.message));
      await page.route('**/*',route=>{
        if(route.request().url().startsWith('http://127.0.0.1:'))return route.continue();
        return route.abort();
      });
      try {
        await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
        await page.addScriptTag({path:helperPath});
        await page.evaluate(start=>window.__MONOPOLY_UI_TEST__.seed({money:500,owned:[],selected:start,phase:'ROLL'}),taxCase.start);
        const initial=await page.evaluate(()=>window.__MONOPOLY_UI_TEST__.snapshot());
        check(!initial.purchaseButton.visible,'tax path: purchase button should be hidden before roll');
        await page.evaluate(dice=>{
          const queue=[...dice];
          Math.random=()=>queue.length?queue.shift():0.17;
          window.playDiceAnim=()=>{};
        },taxCase.dice);
        await page.locator('#roll-btn').click();
        const landed=await page.evaluate(()=>window.__MONOPOLY_UI_TEST__.snapshot());
        check(landed.position===taxCase.expectedPos,'tax path: expected landing on '+taxCase.expectedPos+', got '+landed.position);
        check(landed.money===500-taxCase.tax,'tax path: expected tax payment '+taxCase.tax+', balance is '+landed.money);
        check(!landed.properties[String(taxCase.expectedPos)],'tax path: tax cell was incorrectly added to owned property');
        check(!landed.purchaseButton.visible,'tax path: purchase button appeared on a tax cell');
        check(!landed.centerAuctionVisible,'tax path: auction button appeared on a tax cell');
        check(landed.estateAuctionDisabled,'tax path: estate auction control should be disabled');
        await page.evaluate(()=>{
          processBuy('p1');
          processAuctionStart('p1');
        });
        const afterAttempt=await page.evaluate(()=>window.__MONOPOLY_UI_TEST__.snapshot());
        check(afterAttempt.money===500-taxCase.tax,'tax path: a direct buy/auction request changed money');
        check(!afterAttempt.properties[String(taxCase.expectedPos)],'tax path: a direct request acquired the tax cell');
        check(!afterAttempt.auctionActive,'tax path: a direct request opened an auction for tax cell');
        check(pageErrors.length===0,'tax path: browser errors: '+pageErrors.join(' | '));
        passed.push(taxCase.name+' — платёж без покупки и аукциона');
      } catch(error) {
        failed.push({name:taxCase.name,error:String(error?.message||error)});
        await page.screenshot({path:path.join(root,'tax-ui-failure-'+taxCase.name+'.png'),fullPage:true}).catch(()=>{});
      } finally {
        await page.close();
      }
    }

    // Mortgage confirmation and stable right-hand placement: only the left action changes from Roll to End Turn.
    for (const viewport of [
      { name:'desktop', size:{width:1366,height:900} },
      { name:'mobile-390px', size:{width:390,height:844} }
    ]) {
      const page=await browser.newPage({viewport:viewport.size});
      page.setDefaultTimeout(7000);
      const pageErrors=[];
      page.on('pageerror',error=>pageErrors.push(error.message));
      await page.route('**/*',route=>{
        if(route.request().url().startsWith('http://127.0.0.1:'))return route.continue();
        return route.abort();
      });
      try {
        await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
        await page.addScriptTag({path:helperPath});
        await page.evaluate(()=>window.__MONOPOLY_UI_TEST__.seed({money:500,owned:[24],selected:24,phase:'ROLL'}));
        check(await page.locator('#mortgage-btn').isVisible(),viewport.name+': mortgage button should be visible beside Roll');
        check(await page.locator('#roll-btn').isVisible(),viewport.name+': Roll button should be visible');
        const rollPhaseBox=await page.locator('#mortgage-btn').boundingBox();
        await page.evaluate(()=>{turnPhase='ACTION';syncUI();});
        check(await page.locator('#end-turn-btn').isVisible(),viewport.name+': End Turn button should replace Roll');
        const actionPhaseBox=await page.locator('#mortgage-btn').boundingBox();
        check(rollPhaseBox&&actionPhaseBox&&Math.abs(rollPhaseBox.x-actionPhaseBox.x)<1&&Math.abs(rollPhaseBox.y-actionPhaseBox.y)<1,
          viewport.name+': mortgage button moved when Roll changed to End Turn');

        const initial=await page.evaluate(()=>({money:players[0].money,asset:{...ownedCells[24]},cell:BOARD_CELLS[24]}));
        await page.locator('#mortgage-btn').evaluate(el => el.click());
        check(await page.locator('#modal-mortgage-confirm').isVisible(),viewport.name+': confirmation dialog did not open');
        check((await page.locator('#mortgage-confirm-property').textContent()).trim()===initial.cell.name,
          viewport.name+': confirmation shows the wrong property');
        const payout=Math.floor(initial.cell.price/2);
        check((await page.locator('#mortgage-confirm-payout').textContent()).includes(String(payout)),
          viewport.name+': confirmation shows the wrong mortgage payout');
        await page.locator('#mortgage-confirm-cancel').evaluate(el => el.click());
        const afterCancel=await page.evaluate(()=>({money:players[0].money,mortgaged:ownedCells[24].mortgaged}));
        check(afterCancel.money===initial.money&&!afterCancel.mortgaged,viewport.name+': cancel applied the mortgage');

        await page.locator('#mortgage-btn').evaluate(el => el.click());
        await page.locator('#mortgage-confirm-accept').evaluate(el => el.click());
        const afterConfirm=await page.evaluate(()=>({money:players[0].money,mortgaged:ownedCells[24].mortgaged}));
        check(afterConfirm.money===initial.money+payout,viewport.name+': confirmed mortgage did not credit the correct amount');
        check(afterConfirm.mortgaged===true,viewport.name+': confirmed mortgage did not mark the asset as mortgaged');
        check(pageErrors.length===0,viewport.name+': browser errors: '+pageErrors.join(' | '));
        passed.push(viewport.name+' — подтверждение ипотеки и фиксированное положение кнопки справа');
      } catch(error) {
        failed.push({name:'mortgage-confirm-'+viewport.name,error:String(error?.message||error)});
        await page.screenshot({path:path.join(root,'mortgage-confirm-failure-'+viewport.name+'.png'),fullPage:true}).catch(()=>{});
      } finally {
        await page.close();
      }
    }

    console.log('=== MONOPOLY BUILDING USER-PATH AUTOTEST ===');
    for (const name of passed) console.log('PASS  ' + name);
    for (const item of failed) console.log('FAIL  ' + item.name + ': ' + item.error);
    console.log('SUMMARY ' + JSON.stringify({ passed:passed.length, failed:failed.length, total:passed.length+failed.length }));
    if (failed.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 2;
  server.close();
});