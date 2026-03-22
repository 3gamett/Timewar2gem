// キャッシュによるバグを防ぐためバージョンを v5 に変更
const STORAGE = {
  heroes: 'timewar.v5.heroes',
  skills: 'timewar.v5.skills',
  teams: 'timewar.v5.teams'
};

const DEFAULT_HEROES = [
  { id: "zenobia", name: "ゼノビア", uniqueSkill: "パルメラの抵抗", stats: { atk: 180, def: 200, int: 150, agi: 120 } },
  { id: "lincoln", name: "リンカーン", uniqueSkill: "自由の宣言", stats: { atk: 150, def: 150, int: 220, agi: 140 } },
  { id: "kublai", name: "フビライ・ハン", uniqueSkill: "モンゴルの拡張", stats: { atk: 210, def: 170, int: 160, agi: 180 } },
  { id: "rin", name: "リン", uniqueSkill: "赤眼の眼光", stats: { atk: 140, def: 130, int: 250, agi: 210 } },
  { id: "monet", name: "モネ", uniqueSkill: "幻影の芸術", stats: { atk: 100, def: 160, int: 270, agi: 110 } },
  { id: "carl", name: "カール", uniqueSkill: "岩壁の鉄槌", stats: { atk: 230, def: 250, int: 120, agi: 80 } },
  { id: "mark", name: "マーク", uniqueSkill: "正義の心", stats: { atk: 190, def: 190, int: 190, agi: 190 } },
  { id: "zono", name: "ゾノ", uniqueSkill: "狂気のバーサーカー", stats: { atk: 300, def: 80, int: 80, agi: 280 } },
  { id: "george", name: "ジョージ", uniqueSkill: "鉄砲王", stats: { atk: 200, def: 140, int: 200, agi: 170 } },
  { id: "nobunaga", name: "織田信長", uniqueSkill: "流焔乱舞", stats: { atk: 260, def: 150, int: 180, agi: 240 } },
  { id: "galileo", name: "ガリレオ・ガリレイ", uniqueSkill: "静止の祈り", stats: { atk: 120, def: 180, int: 280, agi: 150 } }
];

const DEFAULT_SKILLS = [
  { id: "zangeki", name: "斬撃", category: "active", chance: 35, description: "ランダム敵に75%の2回攻撃。" },
  { id: "nenriki_heal", name: "念力の治癒", category: "active", chance: 35, description: "自軍2人を回復(120%)し制御解除。" },
  { id: "vampire", name: "吸血", category: "passive", chance: 100, description: "離反獲得、与ダメの20%回復。" },
  { id: "follow_shot", name: "追撃の銃弾", category: "combo", chance: 35, description: "通常攻撃後、110%の知力ダメ2回。" },
  { id: "supply", name: "継戦補給", category: "combo", chance: 40, description: "通常攻撃後、知力ダメ70%と味方2人回復。" },
  { id: "all_heal", name: "全面治癒", category: "engage", chance: 40, description: "ターン開始時、自軍全体を回復。" },
  { id: "dragon_roar", name: "龍の咆哮", category: "active", chance: 50, description: "与ダメ10%上昇、敵全体知力ダメ120%。" },
  { id: "sniper", name: "狙撃者の心得", category: "passive", chance: 100, description: "必中、クリティカル25%。" },
  { id: "rainbow", name: "虹の景色", category: "engage", chance: 100, description: "沈黙付与、4ターン目以降破陣・自己回復。" },
  { id: "rock_hammer_sub", name: "岩壁の鉄槌", category: "active", chance: 45, description: "準備後、敵全体300%物理ダメ。" },
  { id: "iron_guard", name: "鉄壁の守護", category: "engage", chance: 100, description: "2ターン、味方2人の被ダメ30%減。" },
  { id: "gather_power", name: "機を蓄える", category: "passive", chance: 100, description: "行動開始時、回復と防御10%上昇。" },
  
  // ▼ 新規追加スキル 6種 ▼
  { id: "repair_defense", name: "修復防御", category: "active", chance: 55, description: "自身と最も兵力が低い味方回復(250%)。自身の防御20アップ(3T)。" },
  { id: "budo", name: "文武両道", category: "active", chance: 50, description: "敵2人に知力ダメ(180%)、与ダメ12%低下(2T)。" },
  { id: "sage_plot", name: "賢者の謀", category: "active", chance: 40, description: "敵2人に回復禁止(1T)と知力ダメ(160%)。" },
  { id: "eloquence", name: "巧みな弁舌", category: "active", chance: 40, description: "回避状態(25%)。敵2人を挑発し攻撃30ダウン(2T)。" },
  { id: "final_battle", name: "最終決戦", category: "passive", chance: 100, description: "アクティブ発動率12%UP。発動時与ダメ6%UP(最大5回)。" },
  { id: "purge", name: "祓いの加護", category: "active", chance: 35, description: "味方3人のデバフ解除。攻撃・知力50アップ(2T)。" }
];

// ご指定の初期軍団セット
const DEFAULT_TEAMS = {
  left: [
    { id: "george", troops: 10000, subSkills: ["supply", "follow_shot"] },
    { id: "rin", troops: 10000, subSkills: ["dragon_roar", "all_heal"] },
    { id: "mark", troops: 10000, subSkills: ["repair_defense", "nenriki_heal"] }
  ],
  right: [
    { id: "lincoln", troops: 10000, subSkills: ["budo", "sage_plot"] },
    { id: "kublai", troops: 10000, subSkills: ["purge", "sniper"] },
    { id: "zenobia", troops: 10000, subSkills: ["repair_defense", "eloquence"] }
  ]
};

let state = {
  heroes: [],
  skills: [],
  teams: null,
  battle: null,
  viewTurn: 0,
  autoTimer: null
};

// --- 初期化 ---
function init() {
  loadData();
  renderAll();
  bindEvents();
}

function loadData() {
  state.heroes = JSON.parse(localStorage.getItem(STORAGE.heroes)) || DEFAULT_HEROES;
  state.skills = JSON.parse(localStorage.getItem(STORAGE.skills)) || DEFAULT_SKILLS;
  
  const savedTeams = JSON.parse(localStorage.getItem(STORAGE.teams));
  // 過去のデータが壊れているのを防ぐため、新しいデフォルト構成で上書き
  if (savedTeams && savedTeams.left && savedTeams.left.length === 3) {
    state.teams = savedTeams;
  } else {
    state.teams = JSON.parse(JSON.stringify(DEFAULT_TEAMS));
  }
  
  document.getElementById('heroesJson').value = JSON.stringify(state.heroes, null, 2);
  document.getElementById('skillsJson').value = JSON.stringify(state.skills, null, 2);
}

// --- 戦闘エンジン ---
class Battle {
  constructor(left, right) {
    this.sides = { left: this.initTeam(left, 'left'), right: this.initTeam(right, 'right') };
    this.turn = 0;
    this.phase = 'opening';
    this.logs = { 0: [] };
    this.finished = false;
    this.order = [];
    this.actorIdx = 0;
  }

  initTeam(teamData, side) {
    return teamData.map((slot, idx) => {
      const h = state.heroes.find(hero => hero.id === slot.id);
      if (!h) return null;
      return { ...h, side, pos: idx, currentTroops: slot.troops, maxTroops: slot.troops, subSkills: slot.subSkills };
    }).filter(Boolean);
  }

  addLog(msg) {
    if (!this.logs[this.turn]) this.logs[this.turn] = [];
    this.logs[this.turn].push(msg);
  }

  nextChunk() {
    if (this.finished) return;
    if (this.phase === 'opening') {
      this.addLog("準備フェーズ：各英傑が布陣につきました。");
      this.phase = 'start';
    } else if (this.phase === 'start') {
      this.addLog(`--- ターン ${this.turn} ---`);
      this.order = [...this.sides.left, ...this.sides.right].filter(u => u.currentTroops > 0).sort((a,b) => b.stats.agi - a.stats.agi);
      this.actorIdx = 0;
      this.phase = 'action';
    } else if (this.phase === 'action') {
      const actor = this.order[this.actorIdx];
      if (actor && actor.currentTroops > 0) this.executeTurn(actor);
      this.actorIdx++;
      if (this.actorIdx >= this.order.length) this.phase = 'end';
    } else if (this.phase === 'end') {
      this.turn++;
      this.phase = 'start';
      if (this.turn > 10) { this.addLog("規定ターン終了。"); this.finished = true; }
    }
    this.checkVictory();
  }

  executeTurn(actor) {
    const targetSide = actor.side === 'left' ? 'right' : 'left';
    const targets = this.sides[targetSide].filter(u => u.currentTroops > 0);
    if (targets.length === 0) return;
    const target = targets[0];
    const dmg = Math.max(100, Math.round(actor.stats.atk * 1.2 - target.stats.def));
    target.currentTroops -= dmg;
    this.addLog(`${actor.name} の行動！ ${target.name} に ${dmg} のダメージ。(残り: ${Math.max(0, target.currentTroops)})`);
  }

  checkVictory() {
    const lAlive = this.sides.left.some(u => u.currentTroops > 0);
    const rAlive = this.sides.right.some(u => u.currentTroops > 0);
    if (!lAlive) { this.addLog("自軍全滅。敵軍の勝利！"); this.finished = true; }
    else if (!rAlive) { this.addLog("敵軍全滅。自軍の勝利！"); this.finished = true; }
  }
}

// --- 描画関数群 ---
function renderAll() {
  renderFormation();
  renderLog();
  updateStatusUI();
}

function renderFormation() {
  const POS_LABELS = ['指揮官', '中軍', '前衛'];
  ['left', 'right'].forEach(side => {
    const container = document.getElementById(`team${side.charAt(0).toUpperCase() + side.slice(1)}Slots`);
    container.innerHTML = state.teams[side].map((slot, i) => `
      <div class="slot">
        <div class="slot-label">${POS_LABELS[i]}</div>
        <select onchange="updateSlot('${side}', ${i}, 'id', this.value)">
          <option value="">英傑選択</option>
          ${state.heroes.map(h => `<option value="${h.id}" ${slot.id === h.id ? 'selected' : ''}>${h.name}</option>`).join('')}
        </select>
        <input type="number" step="1000" value="${slot.troops}" onchange="updateSlot('${side}', ${i}, 'troops', this.value)">
        <select onchange="updateSlot('${side}', ${i}, 'sub1', this.value)">
          <option value="">スキル1</option>
          ${state.skills.map(s => `<option value="${s.id}" ${slot.subSkills[0] === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
        <select onchange="updateSlot('${side}', ${i}, 'sub2', this.value)">
          <option value="">スキル2</option>
          ${state.skills.map(s => `<option value="${s.id}" ${slot.subSkills[1] === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
      </div>
    `).join('');
  });
}

function renderLog() {
  const logView = document.getElementById('logView');
  const turnLabel = document.getElementById('currentTurnLabel');
  if (!state.battle) {
    logView.textContent = "戦闘を開始してください。";
    return;
  }
  turnLabel.textContent = `Turn ${state.viewTurn}`;
  logView.textContent = (state.battle.logs[state.viewTurn] || []).join('\n');
  const area = document.getElementById('logScrollArea');
  area.scrollTop = area.scrollHeight;
}

function updateStatusUI() {
  if (!state.battle) return;
  document.getElementById('battleStatus').textContent = state.battle.finished ? "終了" : "進行中";
  document.getElementById('turnStatus').textContent = `Turn: ${state.battle.turn}`;
  document.getElementById('chunkStatus').textContent = `Phase: ${state.battle.phase}`;
}

// --- イベント ---
function bindEvents() {
  document.getElementById('btnStartBattle').onclick = () => {
    state.battle = new Battle(state.teams.left, state.teams.right);
    state.viewTurn = 0;
    renderAll();
  };
  document.getElementById('btnNextChunk').onclick = () => {
    if (state.battle && !state.battle.finished) {
      state.battle.nextChunk();
      state.viewTurn = state.battle.turn;
      renderAll();
    }
  };
  document.getElementById('btnAutoRun').onclick = () => {
    if (state.autoTimer) return;
    state.autoTimer = setInterval(() => {
      if (!state.battle || state.battle.finished) {
        clearInterval(state.autoTimer);
        state.autoTimer = null;
        return;
      }
      state.battle.nextChunk();
      state.viewTurn = state.battle.turn;
      renderAll();
    }, 600);
  };
  document.getElementById('btnStopAuto').onclick = () => {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
  };
  document.getElementById('btnPrevTurn').onclick = () => { if (state.viewTurn > 0) { state.viewTurn--; renderLog(); } };
  document.getElementById('btnNextTurn').onclick = () => { if (state.battle && state.viewTurn < state.battle.turn) { state.viewTurn++; renderLog(); } };
  
  document.getElementById('btnHeroesSave').onclick = () => {
    state.heroes = JSON.parse(document.getElementById('heroesJson').value);
    localStorage.setItem(STORAGE.heroes, JSON.stringify(state.heroes));
    renderAll();
    alert("英傑データを保存しました");
  };
  document.getElementById('btnSkillsSave').onclick = () => {
    state.skills = JSON.parse(document.getElementById('skillsJson').value);
    localStorage.setItem(STORAGE.skills, JSON.stringify(state.skills));
    renderAll();
    alert("スキルデータを保存しました");
  };
  document.getElementById('btnLoadDefaults').onclick = () => {
    if(confirm("データを初期化しますか？")) {
      localStorage.clear();
      location.reload();
    }
  };
}

window.updateSlot = (side, idx, field, value) => {
  if (field === 'id') state.teams[side][idx].id = value;
  if (field === 'troops') state.teams[side][idx].troops = parseInt(value) || 0;
  if (field === 'sub1') state.teams[side][idx].subSkills[0] = value;
  if (field === 'sub2') state.teams[side][idx].subSkills[1] = value;
  localStorage.setItem(STORAGE.teams, JSON.stringify(state.teams));
};

document.addEventListener('DOMContentLoaded', init);
