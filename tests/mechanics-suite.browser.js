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
    pendingCardAckId = null;
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
    processTradeAccept({
      fromId: 'p1', toId: 'p2', offerMoney: 100, requestMoney: 50,
      offerProps: [1], requestProps: [3]
    }, 'p2');
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

  // These probes are expected to expose existing rules gaps. They do not hide failures:
  // they are reported separately and can be promoted to hard failures after repair.
  knownGap('Тарифы улиц с 3/4 домами и отелем отличаются от классических', () => {
    reset();
    own([1], 'p2');
    ownedCells[1].houses = 3;
    const rent3 = calculateRent(1);
    ownedCells[1].houses = 4;
    const rent4 = calculateRent(1);
    ownedCells[1].houses = 5;
    const hotel = calculateRent(1);
    return rent3 !== 90 || rent4 !== 160 || hotel !== 250;
  });

  knownGap('Карта ближайшей коммунальной службы использует старый бросок вместо нового', () => {
    reset([p('p1',1500,8),p('p2',1500)]);
    own([12,28], 'p2');
    lastDice = [1,1];
    chanceDeck = [{text:'Ближайшая коммунальная служба',type:'nearestUtility'}];
    drawCard('chance',players[0]);
    // For two utilities the card requires a fresh roll; deterministic fresh 4+4 => 80.
    // Current code reuses the prior dice sum (2) and charges 20.
    return players[0].money !== 1420;
  });

  knownGap('Отказ от свободной собственности позволяет закончить ход без обязательного аукциона', () => {
    reset([p('p1',1500,1),p('p2')]);
    turnPhase='ACTION';
    lastDice=[1,2];
    processEndTurn('p1');
    return auctionState === null && currentTurnIndex === 1;
  });

  knownGap('Карточка дня рождения немедленно банкротит должника вместо разрешения долга', () => {
    reset([p('p1',1500),p('p2',5)]);
    own([3],'p2');
    chestDeck=[{text:'День рождения',type:'birthday'}];
    drawCard('chest',players[0]);
    return !players.some(x=>x.id==='p2') && ownedCells[3]?.ownerId==='p1';
  });

  knownGap('При банкротстве перед банком имущество удаляется без аукциона', () => {
    reset([p('p1',0),p('p2',1500)]);
    own([1],'p1');
    handleBankruptcy(players[0],null);
    return !ownedCells[1] && auctionState===null;
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
