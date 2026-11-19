function runMonopolyMechanicsSuite() {
  const report = { passed: [], failed: [], knownGaps: [] };
  const p = (id, money = 1500, pos = 0, name = id, color = '#3b82f6') => ({
    id, name, money, pos, color, icon: '🚗', inJail: false, jailTurns: 0, jailCards: []
  });
  function reset(playersInput = [p('p1'), p('p2', 1500, 0, 'Игрок 2', '#ef4444')]) {
    players = playersInput;
    ownedCells = {};
    currentTurnIndex = 0;
    turnPhase = 'ACTION';
    selectedCellId = players[0]?.pos ?? 0;
    pendingTrade = null;
    consecutiveDoubles = 0;
    lastDice = [1, 1];
    gameOver = false;
    winnerId = null;
    auctionState = null;
    bankHouses = 32;
    bankHotels = 12;
    pendingDebt = null;
    pendingCardPayments = null;
    pendingCardAckId = null;
    bankruptcyAuctionQueue = [];
    pendingTradeOffers = {};
    pendingDrawnCard = null;
    chanceDeck = [...CHANCE_CARDS];
    chestDeck = [...CHEST_CARDS];
    clientConns = [];
    myId = players[0]?.id ?? 'p1';
    isHost = true;
    window.broadcastState = () => {};
    window.broadcastLog = () => {};
    window.showDrawnCard = () => {};
    window.playDiceAnim = () => {};
    window.renderAuction = () => {};
    window.appendLog = () => {};
  }
  function own(ids, owner = 'p1', houses = 0) {
    for (const id of ids) ownedCells[id] = {
      ownerId: owner,
      color: players.find(x => x.id === owner)?.color || '#3b82f6',
      houses,
      mortgaged: false
    };
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
  }
  function test(name, fn) {
    try {
      fn();
      report.passed.push(name);
    } catch (error) {
      report.failed.push({ name, error: String(error?.message || error) });
    }
  }
  function knownGap(name, detectGap) {
    try {
      if (detectGap()) report.knownGaps.push(name);
      else report.passed.push('Закрыт ранее известный пробел: ' + name);
    } catch (error) {
      report.failed.push({ name: 'Проверка известного пробела: ' + name, error: String(error?.message || error) });
    }
  }

  // Every test starts from an isolated in-memory match. No real P2P connections are opened.
  test('Лобби поддерживает до восьми игроков с уникальными цветами и фишками', () => {
    assert(MAX_PLAYERS === 8, 'Maximum player count should be eight');
    assert(TOKEN_IDS.length >= MAX_PLAYERS, 'Not enough token icons for all players');
    assert(PAWN_SHAPES.length >= MAX_PLAYERS, 'Not enough pawn designs for all players');
    assert(new Set(PAWN_SHAPES.slice(0, MAX_PLAYERS)).size === MAX_PLAYERS, 'Pawn designs must be unique');
    assert(PLAYER_COLORS.length >= MAX_PLAYERS, 'Not enough player colors');
    assert(new Set(PLAYER_COLORS.slice(0, MAX_PLAYERS)).size === MAX_PLAYERS, 'Player colors must be unique');
  });

  test('Фигурки игроков: восемь уникальных металлических SVG-миниатюр без emoji', () => {
    assert(TOKEN_IDS.length === MAX_PLAYERS, 'Expected one token ID for each player');
    assert(PAWN_NAMES.length === MAX_PLAYERS, 'Every pawn must have a display name');
    assert(new Set(PAWN_NAMES).size === MAX_PLAYERS, 'Pawn labels must be unique');
    assert(new Set(PAWN_SHAPES).size === MAX_PLAYERS, 'Every pawn must have a distinct silhouette');
    const rendered = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const markup = renderPawn(i, PLAYER_COLORS[i], 'board');
      rendered.push(markup);
      assert(markup.includes('<svg viewBox="0 0 64 64"'), 'Pawn ' + i + ' is not rendered as SVG');
      assert(markup.includes('Игровая фигурка: ' + PAWN_NAMES[i]), 'Pawn ' + i + ' has no accessible display name');
      assert(/pawn-instance-\\d+-metal/.test(markup), 'Pawn ' + i + ' has no metallic gradient');
      assert(!markup.includes(LEGACY_TOKEN_EMOJIS[i]), 'Legacy emoji leaked into pawn rendering');
      assert(!markup.includes('__'), 'Pawn ' + i + ' has an unresolved material placeholder');
      assert(getPawnIndex(LEGACY_TOKEN_EMOJIS[i]) === i, 'Legacy saved token is not mapped for player ' + i);
    }
    const combined = rendered.join('');
    const ids = [...combined.matchAll(/\\bid="([^"]+)"/g)].map(match => match[1]);
    assert(ids.length === MAX_PLAYERS * 4, 'Every rendered token must define four local gradients');
    assert(new Set(ids).size === ids.length, 'SVG gradient IDs collide across rendered player tokens');
    const references = [...combined.matchAll(/url\\(#([^)]+)\\)/g)].map(match => match[1]);
    assert(references.every(id => ids.includes(id)), 'A pawn references a missing local SVG gradient');
  });

  test('Игровое поле: 40 уникальных клеток', () => {
    assert(BOARD_CELLS.length === 40, 'Expected 40 board cells');
    assert(new Set(BOARD_CELLS.map(c => c.id)).size === 40, 'Cell IDs are not unique');
    assert(BOARD_CELLS.every((c, i) => c.id === i), 'Cell IDs must be sequential 0..39');
  });

  test('Колоды: по 16 карт Шанса и Казны', () => {
    assert(CHANCE_CARDS.length === 16, 'Chance deck should have 16 cards');
    assert(CHEST_CARDS.length === 16, 'Community Chest deck should have 16 cards');
    assert(CHANCE_CARDS.filter(c => c.type === 'jailFree').length === 1, 'Chance should contain one jail-free card');
    assert(CHEST_CARDS.filter(c => c.type === 'jailFree').length === 1, 'Chest should contain one jail-free card');
  });

  test('Базовая аренда и удвоение за полную цветовую группу', () => {
    reset();
    own([1], 'p2');
    assert(calculateRent(1) === 2, 'Base rent on Житная should be 2');
    own([3], 'p2');
    assert(calculateRent(1) === 4, 'Monopoly rent without houses should double');
  });

  test('Улицы: корректная аренда за 3/4 дома и отель', () => {
    reset();
    own([1], 'p2');
    ownedCells[1].houses = 3;
    assert(calculateRent(1) === 90, 'Three houses should charge 90');
    ownedCells[1].houses = 4;
    assert(calculateRent(1) === 160, 'Four houses should charge 160');
    ownedCells[1].houses = 5;
    assert(calculateRent(1) === 250, 'Hotel should charge 250');
  });

  test('Железные дороги: тарифы за 1–4 станции', () => {
    reset();
    const ids = [5, 15, 25, 35];
    const expected = [25, 50, 100, 200];
    for (let n = 1; n <= 4; n++) {
      ownedCells = {};
      own(ids.slice(0, n), 'p2');
      assert(calculateRent(ids[0]) === expected[n - 1], 'Railroad count ' + n + ' returned wrong rent');
    }
  });

  test('Коммунальные предприятия: множители 4x и 10x', () => {
    reset();
    own([12], 'p2');
    assert(calculateRent(12, 8) === 32, 'One utility should charge 4x dice');
    own([28], 'p2');
    assert(calculateRent(12, 8) === 80, 'Two utilities should charge 10x dice');
  });

  test('Покупка дома: полная группа и списание денег', () => {
    reset();
    own([11, 13, 14]);
    const money = players[0].money;
    processBuild('p1', 11);
    assert(ownedCells[11].houses === 1, 'House was not built');
    assert(players[0].money === money - BOARD_CELLS[11].housePrice, 'House price was not deducted');
    assert(bankHouses === 31, 'Bank house inventory not decremented');
  });

  test('Строительство запрещено без полного цветового комплекта', () => {
    reset();
    own([11, 13]);
    processBuild('p1', 11);
    assert((ownedCells[11].houses || 0) === 0, 'House built without owning whole group');
    assert(players[0].money === 1500, 'Money changed despite rejected build');
  });

  test('Равномерная застройка: нельзя строить второй дом на одной улице раньше соседней', () => {
    reset();
    own([11, 13, 14]);
    ownedCells[11].houses = 1;
    processBuild('p1', 11);
    assert(ownedCells[11].houses === 1, 'Uneven build was accepted');
    processBuild('p1', 13);
    assert(ownedCells[13].houses === 1, 'Building on the lowest street was rejected');
  });

  test('Ипотека любой улицы группы блокирует строительство', () => {
    reset();
    own([11, 13, 14]);
    ownedCells[13].mortgaged = true;
    processBuild('p1', 11);
    assert(ownedCells[11].houses === 0, 'Build accepted while a group property is mortgaged');
  });

  test('Четыре дома превращаются в отель и возвращают четыре дома банку', () => {
    reset();
    own([11, 13, 14], 'p1', 4);
    bankHouses = 0;
    bankHotels = 12;
    processBuild('p1', 11);
    assert(ownedCells[11].houses === 5, 'Hotel was not built');
    assert(bankHotels === 11, 'Hotel inventory not decremented');
    assert(bankHouses === 4, 'Four houses were not returned to bank');
  });

  test('Продажа дома: возврат половины стоимости', () => {
    reset();
    own([11, 13, 14], 'p1', 1);
    const money = players[0].money;
    const stock = bankHouses;
    processSellAsset('p1', 11);
    assert(ownedCells[11].houses === 0, 'House was not sold');
    assert(players[0].money === money + 50, 'House refund should be half of 100');
    assert(bankHouses === stock + 1, 'House was not returned to bank');
  });

  test('Ипотека и выкуп: 50% выдача, 55% погашение', () => {
    reset();
    own([11]);
    processMortgage('p1', 11);
    assert(ownedCells[11].mortgaged === true, 'Property was not mortgaged');
    assert(players[0].money === 1570, 'Mortgage payout should be 70');
    processRedeem('p1', 11);
    assert(ownedCells[11].mortgaged === false, 'Property was not redeemed');
    assert(players[0].money === 1493, 'Redemption should cost 77');
  });

  test('Аукцион: высокая ставка получает недвижимость после пасов', () => {
    reset([p('p1', 1500, 1), p('p2'), p('p3')]);
    processAuctionStart('p1');
    assert(auctionState?.active, 'Auction did not start');
    processAuctionBid('p2', 80);
    processAuctionPass('p1');
    processAuctionPass('p3');
    assert(auctionState === null, 'Auction did not finish');
    assert(ownedCells[1]?.ownerId === 'p2', 'Highest bidder did not receive property');
    assert(players[1].money === 1420, 'Winning bid was not charged');
  });

  test('Обмен: деньги и недвижимость переходят обеим сторонам', () => {
    reset();
    own([1], 'p1');
    own([3], 'p2');
    const tradeOffer={
      fromId: 'p1', toId: 'p2', offerMoney: 100, requestMoney: 50,
      offerProps: [1], requestProps: [3]
    };
    pendingTradeOffers.p2=tradeOffer;
    processTradeAccept(tradeOffer, 'p2');
    assert(ownedCells[1].ownerId === 'p2' && ownedCells[3].ownerId === 'p1', 'Properties were not swapped');
    assert(players[0].money === 1450 && players[1].money === 1550, 'Trade cash transfer is wrong');
  });

  test('Карта: эффект применяется, ход блокируется до подтверждения', () => {
    reset();
    chanceDeck = [{ text: 'Получите 50', type: 'cash', amount: 50 }];
    drawCard('chance', players[0]);
    assert(players[0].money === 1550, 'Card cash effect was not applied');
    assert(pendingCardAckId === 'p1', 'Card acknowledgement lock was not set');
    processEndTurn('p1');
    assert(currentTurnIndex === 0, 'Turn ended before card acknowledgement');
    processAcknowledgeCard('p1');
    assert(pendingCardAckId === null, 'Card lock did not clear');
    processEndTurn('p1');
    assert(currentTurnIndex === 1, 'Turn did not advance after card acknowledgement');
  });

  test('Тюрьма: выход за 50 и использование карты освобождения', () => {
    reset();
    players[0].inJail = true;
    turnPhase = 'ROLL';
    processPayJail('p1');
    assert(!players[0].inJail && players[0].money === 1450, 'Jail payment did not release player');
    players[0].inJail = true;
    players[0].jailCards = ['chance'];
    processUseJailCard('p1');
    assert(!players[0].inJail && players[0].jailCards.length === 0, 'Jail-free card did not release player');
    assert(chanceDeck.some(c => c?.type === 'jailFree'), 'Jail-free card was not returned to deck');
  });

  test('Три дубля подряд отправляют игрока в тюрьму', () => {
    reset();
    turnPhase = 'ROLL';
    consecutiveDoubles = 2;
    const oldRandom = Math.random;
    Math.random = () => 0.2; // two 2s
    try { processRoll('p1'); } finally { Math.random = oldRandom; }
    assert(players[0].inJail && players[0].pos === 10, 'Third consecutive double did not send player to jail');
  });

  test('Банкротство кредитору: деньги и актив передаются, дома возвращаются банку', () => {
    reset([p('p1', 120), p('p2', 1000), p('p3', 1000)]);
    own([11], 'p1', 2);
    const stock = bankHouses;
    handleBankruptcy(players[0], 'p2');
    assert(!players.some(x => x.id === 'p1'), 'Bankrupt player was not removed');
    assert(players.find(x => x.id === 'p2').money === 1120, 'Remaining cash not given to creditor');
    assert(ownedCells[11].ownerId === 'p2' && ownedCells[11].houses === 0, 'Property/buildings transfer incorrect');
    assert(bankHouses === stock + 2, 'Houses not returned to bank');
  });

  // Full per-deed schedule from the classic U.S. Monopoly title deeds.
  test('Аренда всех 22 улиц: полная таблица домов и отелей', () => {
    const expected = {
      1:[2,10,30,90,160,250], 3:[4,20,60,180,320,450],
      6:[6,30,90,270,400,550], 8:[6,30,90,270,400,550], 9:[8,40,100,300,450,600],
      11:[10,50,150,450,625,750], 13:[10,50,150,450,625,750], 14:[12,60,180,500,700,900],
      16:[14,70,200,550,750,950], 18:[14,70,200,550,750,950], 19:[16,80,220,600,800,1000],
      21:[18,90,250,700,875,1050], 23:[18,90,250,700,875,1050], 24:[20,100,300,750,925,1100],
      26:[22,110,330,800,975,1150], 27:[22,110,330,800,975,1150], 29:[24,120,360,850,1025,1200],
      31:[26,130,390,900,1100,1275], 32:[26,130,390,900,1100,1275], 34:[28,150,450,1000,1200,1400],
      37:[35,175,500,1100,1300,1500], 39:[50,200,600,1400,1700,2000]
    };
    assert(Object.keys(expected).length === 22, 'Expected a rent schedule for all 22 streets');
    assert(Object.keys(STREET_RENT_LEVELS).length === 22, 'Game data must define all 22 rent schedules');
    for (const [rawId, levels] of Object.entries(expected)) {
      const id = Number(rawId);
      reset();
      own([id], 'p2');
      for (let houses = 0; houses <= 5; houses++) {
        if (houses > 0) ownedCells[id].houses = houses;
        assert(calculateRent(id) === levels[houses], 'Wrong rent for ' + BOARD_CELLS[id].name + ' at level ' + houses);
      }
      assert(JSON.stringify(getStreetRentLevels(id)) === JSON.stringify(levels), 'Property detail schedule differs for ' + BOARD_CELLS[id].name);
    }
  });

  test('HTML-экранирование имён участников и безопасная отрисовка предложения обмена', () => {
    reset();
    const hostileName = '<img src=x onerror=alert(1)>';
    const escaped = escapeFinanceText(hostileName);
    assert(escaped === '&lt;img src=x onerror=alert(1)&gt;', 'HTML metacharacters were not escaped');
    handleTradeRequest({fromName:hostileName,requestMoney:0,requestProps:[],offerMoney:0,offerProps:[]});
    const details = document.getElementById('trade-request-details');
    assert(!details.querySelector('img'), 'Trade request rendered attacker-controlled HTML');
    assert(details.textContent.includes(hostileName), 'Escaped player name is not visible as text');
  });

  // These probes are expected to expose any unrelated rules gaps. They do not hide failures:
  // they are reported separately and can be promoted to hard failures after repair.

  knownGap('Карта ближайшей коммунальной службы использует старый бросок вместо нового', () => {
    reset([p('p1',1500,8),p('p2',1500)]);
    own([12,28], 'p2');
    lastDice = [1,1];
    chanceDeck = [{text:'Ближайшая коммунальная служба',type:'nearestUtility'}];
    const oldRandom=Math.random;
    Math.random=()=>0.6;
    try { drawCard('chance',players[0]); } finally { Math.random=oldRandom; }
    return players[0].money !== 1420;
  });

  knownGap('Отказ от свободной собственности позволяет закончить ход без обязательного аукциона', () => {
    reset([p('p1',1500,1),p('p2')]);
    turnPhase='ACTION';
    lastDice=[1,2];
    processEndTurn('p1');
    return auctionState === null && currentTurnIndex === 1;
  });

  test('Свободная недвижимость: завершение хода запускает обязательный аукцион', () => {
    reset([p('p1',1500,1),p('p2',1500)]);
    turnPhase='ACTION';
    lastDice=[1,2];
    processEndTurn('p1');
    assert(auctionState?.active && auctionState.cellId===1, 'Ending action skipped the mandatory auction');
    processAuctionBid('p2',60);
    processAuctionPass('p1');
    assert(ownedCells[1]?.ownerId==='p2' && players[1].money===1440, 'Mandatory auction did not award property correctly');
    assert(currentTurnIndex===0 && turnPhase==='ACTION', 'Auction unexpectedly advanced the turn');
    processEndTurn('p1');
    assert(currentTurnIndex===1 && turnPhase==='ROLL', 'Turn did not advance after auction was settled');
  });

  test('День рождения: должник может заложить имущество и погасить $10', () => {
    reset([p('p1',1500),p('p2',5)]);
    own([3],'p2');
    chestDeck=[{text:'День рождения',type:'birthday'}];
    drawCard('chest',players[0]);
    assert(pendingDebt?.debtorId==='p2' && pendingDebt.amount===10, 'Birthday debt was not opened for the player who cannot pay');
    assert(players.some(x=>x.id==='p2') && ownedCells[3]?.ownerId==='p2', 'Debtor was bankrupted before liquidation');
    assert(document.getElementById('drawn-card-overlay').style.display==='none', 'Card overlay blocked the debtor during payment');
    processMortgage('p2',3);
    assert(!pendingDebt, 'Mortgage proceeds did not settle birthday debt');
    assert(players.find(x=>x.id==='p1').money===1510, 'Birthday payment did not reach the card owner');
    assert(players.find(x=>x.id==='p2').money===25 && ownedCells[3].mortgaged, 'Debtor mortgage result is incorrect');
    assert(currentTurnIndex===0 && pendingCardAckId==='p1' && !pendingCardPayments, 'Turn did not return to the card owner');
    assert(document.getElementById('drawn-card-overlay').style.display==='flex', 'Card overlay was not restored for the card owner');
  });

  knownGap('Карточка дня рождения немедленно банкротит должника вместо разрешения долга', () => {
    reset([p('p1',1500),p('p2',5)]);
    own([3],'p2');
    chestDeck=[{text:'День рождения',type:'birthday'}];
    drawCard('chest',players[0]);
    return !players.some(x=>x.id==='p2') && ownedCells[3]?.ownerId==='p1';
  });

  knownGap('При банкротстве перед банком имущество удаляется без аукциона', () => {
    reset([p('p1',0),p('p2',1500),p('p3',1500)]);
    own([1],'p1');
    handleBankruptcy(players[0],null);
    return !ownedCells[1] && auctionState===null;
  });

  test('Банкротство перед банком: имущество продаётся через аукцион', () => {
    reset([p('p1',0),p('p2',1500),p('p3',1500)]);
    own([1],'p1');
    handleBankruptcy(players[0],null);
    assert(auctionState?.active && auctionState.cellId===1, 'Bankruptcy did not start auction for released property');
    processAuctionBid('p2',75);
    processAuctionPass('p3');
    assert(auctionState===null, 'Bankruptcy auction did not close after all opponents passed');
    assert(ownedCells[1]?.ownerId==='p2' && players.find(x=>x.id==='p2').money===1425, 'Auction winner did not receive property at winning bid');
  });

  knownGap('Банкротство во время отрицательной карточки оставляет подтверждение карты заблокированным', () => {
    reset([p('p1',0),p('p2',1500)]);
    chanceDeck=[{text:'Штраф 15',type:'cash',amount:-15}];
    drawCard('chance',players[0]);
    return pendingCardAckId==='p1' && !players.some(x=>x.id==='p1');
  });

  knownGap('Сторона может принять неподтверждённое предложение обмена, передав поддельный payload', () => {
    reset();
    own([1],'p1');
    const before = players[1].money;
    processTradeAccept({fromId:'p1',toId:'p2',offerMoney:0,requestMoney:0,offerProps:[1],requestProps:[]},'p2');
    return ownedCells[1]?.ownerId==='p2' && players[1].money===before;
  });

  test('Обмен: изменённый payload не совпадает с предложением хоста', () => {
    reset();
    own([1],'p1');
    const canonical={fromId:'p1',toId:'p2',offerMoney:100,requestMoney:0,offerProps:[1],requestProps:[]};
    pendingTradeOffers.p2=canonical;
    processTradeAccept({...canonical,offerMoney:0},'p2');
    assert(ownedCells[1].ownerId==='p1' && players[0].money===1500 && players[1].money===1500, 'Modified offer payload was accepted');
  });

  report.summary = {
    passed: report.passed.length,
    failed: report.failed.length,
    knownGaps: report.knownGaps.length,
    total: report.passed.length + report.failed.length + report.knownGaps.length
  };
  window.__MONOPOLY_MECHANICS_REPORT__ = report;
  return report;
}
window.runMonopolyMechanicsSuite = runMonopolyMechanicsSuite;

