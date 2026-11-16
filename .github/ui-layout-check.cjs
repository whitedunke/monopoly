const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const cases = [
    { name: 'mobile-370-empty', width: 370, height: 800, assets: 0 },
    { name: 'mobile-370-full', width: 370, height: 800, assets: 12 },
    { name: 'mobile-390-full', width: 390, height: 844, assets: 12 },
    { name: 'mobile-430-full', width: 430, height: 900, assets: 12 },
    { name: 'tablet-768-full', width: 768, height: 1024, assets: 12 },
    { name: 'tablet-1024-full', width: 1024, height: 768, assets: 12 },
    { name: 'desktop-1366-full', width: 1366, height: 900, assets: 12 },
    { name: 'desktop-1920-full', width: 1920, height: 1080, assets: 12 }
  ];
  const failures = [];
  const results = [];
  fs.mkdirSync('screenshots', { recursive: true });

  for (const c of cases) {
    const page = await browser.newPage({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'load' });

    await page.evaluate(({ assets }) => {
      document.getElementById('lobby').style.display = 'none';
      const game = document.getElementById('game-screen');
      game.style.display = 'grid';
      document.getElementById('estate-player-name').textContent = 'Игрок 1';
      document.getElementById('estate-balance').textContent = '$1 500';
      document.getElementById('estate-income').textContent = '▲ $200 за прохождение ВПЕРЁД';
      const list = document.getElementById('estate-property-list');
      if (assets === 0) {
        list.innerHTML = '<span>Пока нет недвижимости</span>';
      } else {
        list.innerHTML = Array.from({ length: assets }, (_, i) => {
          const names = ['Житная ул.', 'Нагатинская ул.', 'Арбат', 'Полянка ул.', 'Сретенка ул.', 'Курская ж/д', 'Рижская ж/д', 'Варшавское ш.', 'Электросеть', 'Смоленская пл.', 'Тверская ул.', 'Рублёвское ш.'];
          const colors = ['#8a5a2b','#8a5a2b','#2764dc','#d92f83','#d92f83','#334155','#334155','#0284c7','#149688','#c58a05','#dc2626','#ed6a0c'];
          return '<button class="estate-property"><span class="estate-property-bar" style="background:'+colors[i]+'"></span><span class="estate-property-name">'+names[i]+'</span><span class="estate-property-price">$'+(60+i*20)+'</span><span class="estate-property-state">'+(i%4===0?'1 дом':'Недвижимость')+'</span></button>';
        }).join('');
      }
      document.getElementById('left-players').innerHTML = Array.from({length:3}, (_,i) =>
        '<div class="player-card"><div class="player-identity"><span class="player-token-icon">🚗</span><span class="player-name-wrap"><span class="player-seat">Игрок '+(i+1)+'</span><span class="player-name">Игрок '+(i+1)+'</span></span></div><div class="player-money">$'+(1500-i*200)+'</div></div>'
      ).join('');
    }, { assets: c.assets });

    await page.screenshot({ path: 'screenshots/' + c.name + '.png', fullPage: true });
    const metrics = await page.evaluate(() => {
      const rect = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom };
      };
      const overlap = (a,b) => a && b && Math.min(a.right,b.right)-Math.max(a.x,b.x)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1;
      const game = document.getElementById('game-screen');
      const panel = document.getElementById('estate-dashboard');
      const wallet = document.querySelector('.estate-wallet');
      const player = document.querySelector('.estate-wallet .estate-player');
      const balance = document.querySelector('.estate-wallet > div:last-child');
      const heading = document.querySelector('.estate-panel-heading > div');
      const manage = document.querySelector('.estate-open-manager');
      const board = document.querySelector('.board');
      const actions = [...document.querySelectorAll('.estate-actions .btn')];
      const buttonsInside = actions.every(b => {
        const r=b.getBoundingClientRect(), p=panel.getBoundingClientRect();
        return r.left >= p.left-1 && r.right <= p.right+1;
      });
      return {
        viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth},
        game:rect(game), panel:rect(panel), wallet:rect(wallet), player:rect(player), balance:rect(balance),
        heading:rect(heading), manager:rect(manage), board:rect(board),
        boardSquare:!board || Math.abs(board.getBoundingClientRect().width-board.getBoundingClientRect().height)<=2,
        walletOverlap:overlap(rect(player),rect(balance)),
        managerOverlap:overlap(rect(heading),rect(manage)),
        buttonsInside,
        panelScrollWidth:panel.scrollWidth, panelClientWidth:panel.clientWidth
      };
    });

    const problems=[];
    if (metrics.viewport.scrollWidth > c.width + 1) problems.push('page horizontal overflow');
    if (metrics.walletOverlap) problems.push('wallet player/balance overlap');
    if (metrics.managerOverlap) problems.push('heading/manager button overlap');
    if (!metrics.buttonsInside) problems.push('action button outside panel');
    if (metrics.panel && metrics.panel.right > c.width + 1) problems.push('estate panel outside viewport');
    if (metrics.board && (metrics.board.x < -1 || metrics.board.right > c.width + 1)) problems.push('board outside viewport');
    if (!metrics.boardSquare) problems.push('board is not square');
    if (pageErrors.length) problems.push('browser JS errors: ' + pageErrors.join(' | '));

    results.push({ case:c.name, metrics, problems, pageErrors });
    for (const problem of problems) failures.push(c.name + ': ' + problem);
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify({ results, failures }, null, 2));
  if (failures.length) process.exit(1);
})().catch(error => { console.error(error); process.exit(2); });
