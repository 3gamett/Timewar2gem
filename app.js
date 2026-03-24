const STORE = { heroes: 'tw.uni.heroes.v4', skills: 'tw.uni.skills.v4', teams: 'tw.uni.teams.v4' };

// --- 初期データ (フォールバック用) ---
const DEFAULT_HEROES = [
  { id: "lincoln", name: "リンカーン", unitType: "infantry", stats: { atk: 128, def: 136, int: 214, agi: 128, rng: 4 }, unique: "freedom_proclamation" }
];
const DEFAULT_SKILLS = [
  { id: "freedom_proclamation", name: "自由の宣言", trigger: "action", chance: 100, effects: [] }
];
const DEFAULT_TEAMS = {
  left: [{ id: "lincoln", troops: 10000, subSkills: ["", ""] }, { id: "", troops: 10000, subSkills: ["", ""] }, { id: "", troops: 10000, subSkills: ["", ""] }],
  right: [{ id: "", troops: 10000, subSkills: ["", ""] }, { id: "", troops: 10000, subSkills: ["", ""] }, { id: "", troops: 10000, subSkills: ["", ""] }]
};

// --- 状態管理 ---
let app = { heroes: [], skills: [], teams: null, battle: null, auto: null };

// --- ユーティリティ ---
function num(v, d=0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function rand() { return Math.random(); }
function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function getHero(id) { return app.heroes.find(h => h.id === id); }
function getSkill(id) { return app.skills.find(s => s.id === id); }

/**
 * データの読み込み処理 (fetch対応版)
 * @param {boolean} forceFetch - trueの場合、LocalStorageを無視してJSONファイルを読み込む
 */
async function loadState(forceFetch = false) {
  try {
    const localH = localStorage.getItem(STORE.heroes);
    const localS = localStorage.getItem(STORE.skills);
    const localT = localStorage.getItem(STORE.teams);

    // 1. 英傑・スキルデータの取得
    if (forceFetch || !localH || !localS) {
      console.log("外部JSONファイルからデータを取得中...");
      // 同時に2つのファイルをフェッチ
      const [hRes, sRes] = await Promise.all([
        fetch('heroes_all.json').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('skills_all.json').then(r => r.ok ? r.json() : null).catch(() => null)
      ]);

      app.heroes = hRes || DEFAULT_HEROES;
      app.skills = sRes || DEFAULT_SKILLS;

      // 取得したデータをLocalに保存（次回以降の高速化のため）
      localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
      localStorage.setItem(STORE.skills, JSON.stringify(app.skills));
    } else {
      app.heroes = JSON.parse(localH);
      app.skills = JSON.parse(localS);
    }

    // 2. チームデータの取得
    if (localT) {
      try { app.teams = JSON.parse(localT); } catch(e) { app.teams = clone(DEFAULT_TEAMS); }
    } else {
      app.teams = clone(DEFAULT_TEAMS);
    }

    // 3. UIへの反映
    document.getElementById('heroesJson').value = JSON.stringify(app.heroes, null, 2);
    document.getElementById('skillsJson').value = JSON.stringify(app.skills, null, 2);

    console.log("データロード完了");
  } catch (err) {
    console.error("ロードエラー:", err);
    app.heroes = clone(DEFAULT_HEROES);
    app.skills = clone(DEFAULT_SKILLS);
    app.teams = clone(DEFAULT_TEAMS);
  }
}

function saveState() {
  localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
  localStorage.setItem(STORE.skills, JSON.stringify(app.skills));
  localStorage.setItem(STORE.teams, JSON.stringify(app.teams));
}

// --- 初期化 ---
window.onload = async () => {
  // データの読み込み完了を待機
  await loadState();
  
  // 描画とビューアの初期化
  if (typeof renderAll === 'function') renderAll();
  if (typeof initViewers === 'function') initViewers();

  // --- イベントリスナー ---

  // 戦闘開始
  document.getElementById('btnStart').onclick = () => {
    try {
      if (!app.teams) return;
      app.battle = new BattleEngine(clone(app.teams));
      app.battle.nextChunk();
      if (typeof renderAll === 'function') renderAll();
    } catch (err) { 
      console.error(err);
      alert(`開始エラー: ${err.message}`); 
    }
  };

  // 次の挙動
  document.getElementById('btnNext').onclick = () => { 
    if(app.battle) { app.battle.nextChunk(); if (typeof renderAll === 'function') renderAll(); } 
  };

  // 保存ボタン（英傑）
  document.getElementById('btnSaveHeroes').onclick = () => {
    try {
      app.heroes = JSON.parse(document.getElementById('heroesJson').value);
      localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
      if (typeof initViewers === 'function') initViewers();
      if (typeof renderTeams === 'function') renderTeams();
      alert('英傑データを保存しました');
    } catch (err) { alert('JSON形式が正しくありません'); }
  };

  // 保存ボタン（スキル）
  document.getElementById('btnSaveSkills').onclick = () => {
    try {
      app.skills = JSON.parse(document.getElementById('skillsJson').value);
      localStorage.setItem(STORE.skills, JSON.stringify(app.skills));
      if (typeof initViewers === 'function') initViewers();
      if (typeof renderTeams === 'function') renderTeams();
      alert('スキルデータを保存しました');
    } catch (err) { alert('JSON形式が正しくありません'); }
  };

  // 初期化（外部ファイルから強制再読込）
  document.getElementById('btnLoadDefault').onclick = async () => {
    if (confirm("外部JSONファイルから最新データを読み込みますか？（現在の編集内容は上書きされます）")) {
      await loadState(true);
      if (typeof renderAll === 'function') renderAll();
      alert("ファイルを再読み込みしました。");
    }
  };

  // 反映ボタン
  const refreshBtn = document.getElementById('btnRefresh');
  if(refreshBtn) refreshBtn.onclick = () => { if (typeof renderAll === 'function') renderAll(); };
};
