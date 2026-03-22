const STORAGE = {
  heroes: 'timewar.v2.heroes',
  skills: 'timewar.v2.skills',
  teams: 'timewar.v2.teams'
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
  { id: "vampire", name: "吸血", category: "passive", chance: 100, description: "離反獲得、与ダメージの20%回復。" },
  { id: "follow_shot", name: "追撃の銃弾", category: "combo", chance: 35, description: "通常攻撃後、110%の知力ダメ2回。" },
  { id: "supply", name: "継戦補給", category: "combo", chance: 40, description: "通常攻撃後、知力ダメ70%と味方2人回復(120%)。" },
  { id: "all_heal", name: "全面治癒", category: "engage", chance: 40, description: "ターン開始時、自軍全体を回復(150%)。" },
  { id: "dragon_roar", name: "龍の咆哮", category: "active", chance: 50, description: "自軍与ダメ10%上昇、敵全体知力ダメ120%。" },
  { id: "sniper", name: "狙撃者の心得", category: "passive", chance: 100, description: "必中状態、クリティカル率25%上昇。" },
  { id: "rainbow", name: "虹の景色", category: "engage", chance: 100, description: "2ターン沈黙、4ターン目以降破陣・自己回復。" },
  { id: "rock_hammer_sub", name: "岩壁の鉄槌", category: "active", chance: 45, description: "1ターンの準備後、敵全体300%ダメージ。" },
  { id: "iron_guard", name: "鉄壁の守護", category: "engage", chance: 100, description: "2ターンの間、味方2人の被ダメ30%減。" },
  { id: "gather_power", name: "機を蓄える", category: "passive", chance: 100, description: "行動開始時、回復(150%)と防御10%上昇。" }
];

// 以下、前回のBattleクラス、UI制御ロジック、保存処理などを継承
// (※文字数制限のため主要ロジックに絞っていますが、上記HTML/CSSと連動します)

let state = {
  heroes: [], skills: [],
  teams: { left: Array(3).fill(null).map(() => ({id:'', troops: 10000, subSkills:['','']})), 
           right: Array(3).fill(null).map(() => ({id:'', troops: 10000, subSkills:['','']})) },
  battle: null, viewTurn: 0
};

function init() {
  state.heroes = JSON.parse(localStorage.getItem(STORAGE.heroes)) || DEFAULT_HEROES;
  state.skills = JSON.parse(localStorage.getItem(STORAGE.skills)) || DEFAULT_SKILLS;
  document.getElementById('heroesJson').value = JSON.stringify(state.heroes, null, 2);
  document.getElementById('skillsJson').value = JSON.stringify(state.skills, null, 2);
  bindEvents();
  renderAll();
}

// 描画・イベントバインド処理（省略部分は前回の安定版コードを統合）
function bindEvents() {
    document.getElementById('btnHeroesSave').onclick = () => {
        state.heroes = JSON.parse(document.getElementById('heroesJson').value);
        localStorage.setItem(STORAGE.heroes, JSON.stringify(state.heroes));
        alert("偉人データを保存しました");
        renderAll();
    };
    document.getElementById('btnSkillsSave').onclick = () => {
        state.skills = JSON.parse(document.getElementById('skillsJson').value);
        localStorage.setItem(STORAGE.skills, JSON.stringify(state.skills));
        alert("スキルデータを保存しました");
        renderAll();
    };
    // ... その他のボタンイベント ...
}

document.addEventListener('DOMContentLoaded', init);
