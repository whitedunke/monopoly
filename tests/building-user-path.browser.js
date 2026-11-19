window.__MONOPOLY_UI_TEST__ = {
  seed(options = {}) {
    const money = options.money ?? 120;
    const owned = options.owned ?? [11, 13, 14, 21, 23, 24];
    const selected = options.selected ?? 24;
    const mortgaged = options.mortgaged ?? [];
    const houses = options.houses ?? {};
    players = [
      { id:'p1', name:'Тестовый игрок', money, pos:selected, color:'#3b82f6', icon:'🚗', inJail:false, jailTurns:0, jailCards:[] },
      { id:'p2', name:'Второй игрок', money:1500, pos:0, color:PLAYER_COLORS[0], icon:TOKEN_ICONS[1], inJail:false, jailTurns:0, jailCards:[] }
    ];
    myId = 'p1';
    isHost = true;
    activeRoomId = 'ui-test-room';
    hostConn = null;
    clientConns = [];
    currentTurnIndex = 0;
    turnPhase = options.phase || 'ACTION';
    selectedCellId = selected;
    pendingTrade = null;
    consecutiveDoubles = 0;
    lastDice = [1, 2];
    gameOver = false;
    winnerId = null;
    auctionState = null;
    bankHouses = options.bankHouses ?? 32;
    bankHotels = options.bankHotels ?? 12;
    pendingDebt = null;
    pendingCardAckId = null;
    pendingDrawnCard = null;
    chanceDeck = [...CHANCE_CARDS];
    chestDeck = [...CHEST_CARDS];
    ownedCells = {};
    owned.forEach(id => {
      const cell = BOARD_CELLS[id];
      ownedCells[id] = {
        ownerId:'p1', color:players[0].color,
        houses:houses[id] || 0, mortgaged:mortgaged.includes(id)
      };
    });
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game-screen').style.display = 'grid';
    syncUI();
    return this.snapshot();
  },
  snapshot() {
    const button = document.getElementById('estate-build-btn');
    const purchase = document.getElementById('buy-btn');
    const centerAuction = document.getElementById('auction-start-btn');
    const estateAuction = document.getElementById('estate-auction-btn');
    const properties = {};
    Object.keys(ownedCells).forEach(id => properties[id] = { ...ownedCells[id] });
    const boardCells = [...document.querySelectorAll('#board > .cell')];
    return {
      money:players.find(p => p.id === myId)?.money,
      position:players.find(p => p.id === myId)?.pos,
      purchaseButton:{visible:!!purchase&&getComputedStyle(purchase).display!=='none',disabled:!!purchase?.disabled,text:purchase?.textContent?.trim()||''},
      centerAuctionVisible:!!centerAuction&&getComputedStyle(centerAuction).display!=='none',
      estateAuctionDisabled:!!estateAuction?.disabled,
      properties,
      auctionActive:!!auctionState,
      bankHouses,
      bankHotels,
      selectedCellId,
      button:{
        visible:!!button && getComputedStyle(button).display !== 'none',
        disabled:!!button?.disabled,
        text:button?.textContent?.trim() || '',
        targetId:button?.dataset?.cellId || '',
        title:button?.title || ''
      },
      boardHouseCounts:boardCells.map(cell => cell.querySelectorAll('.buildings-layer .house').length),
      estateCards:[...document.querySelectorAll('#estate-property-list .estate-property')].map(el=>el.innerText.replace(/\s+/g,' ').trim())
    };
  }
};
