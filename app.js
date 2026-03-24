const STORE = { heroes: 'tw.uni.heroes.v5', skills: 'tw.uni.skills.v5', teams: 'tw.uni.teams.v5' };

// --- フォールバック用初期データ (fetch失敗時のみ使用) ---
const DEFAULT_HEROES = [
  { id: "test_hero", name: "テスト英傑", unitType: "infantry", stats: { atk: 100, def: 100, int: 100, agi: 100, rng: 3 } }
];
const DEFAULT_SKILLS = [
  { id: "test_skill", name: "テストスキル", trigger: "action", chance: 100, effects: [] }
];
const DEFAULT_TEAMS = {
  left: Array(3).fill({ id: "", troops: 10000, subSkills: ["", ""] }),
  right: Array(3).fill({ id: "", troops: 10000, subSkills: ["", ""] })
};

const POSITIONS = ['指揮官', '中軍', '前衛'];
const CONTROL_SET = new Set(['stun', 'silence', 'disarm', 'confusion', 'frenzy', 'exhaustion', 'noheal', 'taunt']);

let app = { heroes: [], skills: [], teams: null, battle: null, auto: null };

// --- ユーティリティ ---
function num(v, d=0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function rand() { return Math.random(); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function getHero(id) { return app.heroes.find(h => h.id === id); }
function getSkill(id) { return app.skills.find(s => s.id === id); }
function sideLabel(side) { return side === 'left' ? '自軍' : '敵軍'; }

// --- DOM操作 (リッチログ) ---
function addHtmlLog(html) {
  const content = document.getElementById('logContent');
  if(!content) return;
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = html;
  content.appendChild(div);
}
function clearHtmlLog() {
  const content = document.getElementById('logContent');
  if(content) content.innerHTML = '';
}
function scrollLogToEnd() {
  const area = document.getElementById('logArea');
  if(area) area.scrollTop = area.scrollHeight;
}

// ==========================================
// UNIVERSAL EVENT-DRIVEN BATTLE ENGINE
// ==========================================
class Unit {
  constructor(heroData, teamData, side, posIdx) {
    this.uid = `${side}_${posIdx}`; this.id = heroData.id; this.name = heroData.name;
    this.side = side; this.posIdx = posIdx; this.posLabel = POSITIONS[posIdx];
    this.maxHp = num(teamData.troops, 10000); this.hp = this.maxHp;
    this.stats = { ...heroData.stats }; this.rng = num(heroData.stats.rng, 1);
    this.uniqueSkillId = heroData.unique; this.subSkillIds = (teamData.subSkills || []).slice(0, 2);
    this.buffs = []; this.statuses = []; this.preps = {};
    this.customState = {}; // 風魔小太郎のカウント、ダーウィンのバフPOOL等を汎用的に保存する領域
  }
  isAlive() { return this.hp > 0; }
}

class BattleEngine {
  constructor(teams) {
    this.turn = 0; this.viewTurn = 0; this.phase = 'opening';
    this.logsByTurn = { 0: [] }; this.hooks = []; this.finished = false;
    this.sides = { left: this.initTeam(teams.left, 'left'), right: this.initTeam(teams.right, 'right') };
    this.units = [...this.sides.left, ...this.sides.right];
    this.registerPermanentSkills();
  }

  initTeam(teamData, side) {
    return teamData.map((slot, idx) => {
      const h = getHero(slot.id); return h ? new Unit(h, slot, side, idx) : null;
    }).filter(Boolean);
  }

  log(htmlMsg) {
    if (!this.logsByTurn[this.viewTurn]) this.logsByTurn[this.viewTurn] = [];
    this.logsByTurn[this.viewTurn].push(htmlMsg);
    if(this.viewTurn === this.turn) {
      addHtmlLog(htmlMsg); scrollLogToEnd();
    }
  }

  // --- イベント発行システム (emit) ---
  emit(eventName, context = {}) {
    const activeHooks = this.hooks.filter(h => h.event === eventName);
    for (const hook of activeHooks) {
      if (!hook.owner.isAlive() && !hook.isDeadHold) continue;
      if (hook.chance && rand() * 100 > hook.chance) continue;
      if (!this.checkConditions(hook.conditions, context, hook.owner)) continue;
      this.executeEffects(hook.owner, hook.effects, context, `<span class="log-skill">[${hook.skillLabel}]</span>`);
    }
  }

  registerPermanentSkills() {
    this.units.forEach(unit => {
      const allSkills = [getSkill(unit.uniqueSkillId), ...unit.subSkillIds.map(getSkill)].filter(Boolean);
      allSkills.forEach(skill => {
        if (['passive', 'engage'].includes(skill.trigger)) {
          this.executeEffects(unit, skill.effects, { triggerSkill: skill, isOpening: true }, `<span class="log-skill">[${skill.name}]</span>`);
        }
        if (skill.hooks) {
          skill.hooks.forEach(h => {
            this.hooks.push({
              event: h.event, chance: h.chance || 100, conditions: h.hookConditions || [],
              effects: h.effects, owner: unit, skillLabel: skill.name, isDeadHold: skill.trigger === 'engage'
            });
          });
        }
      });
    });
  }

  // --- メインループ ---
  nextChunk() {
    if (this.finished) return;
    try {
      if (this.phase === 'opening') { this.phaseOpening(); return; }
      if (this.phase === 'turnStart') { this.phaseTurnStart(); return; }
      if (this.phase === 'action') { this.phaseAction(); return; }
      if (this.phase === 'turnEnd') { this.phaseTurnEnd(); return; }
    } catch (err) {
      console.error(err); this.log(`<span style="color:red">【エラー】${err.message}</span>`); this.finish('error');
    }
  }

  phaseOpening() {
    clearHtmlLog();
    this.log("<div class='log-turn-start'>=== 戦闘開始（0ターン目） ===</div>");
    this.emit('onBattleStart');
    this.checkDeaths(); if (this.finished) return;
    this.turn = 1; this.viewTurn = 1; this.logsByTurn[1] = [];
    this.phase = 'turnStart';
  }

  phaseTurnStart() {
    this.viewTurn = this.turn;
    this.log(`<div class='log-turn-start'>--- Turn ${this.turn} 開始 ---</div>`);
    this.units.filter(u => u.isAlive()).forEach(u => this.tickTurnStart(u));
    this.emit('onTurnStart', { turn: this.turn });
    this.checkDeaths(); if (this.finished) return;
    
    // AGI順にソート
    this.turnOrder = this.units.filter(u => u.isAlive()).sort((a,b) => b.getCurrentStat('agi') - a.getCurrentStat('agi'));
    this.turnIndex = 0; this.phase = 'action';
  }

  phaseAction() {
    if (this.turnIndex >= this.turnOrder.length) { this.phase = 'turnEnd'; return; }
    const actor = this.turnOrder[this.turnIndex++];
    if (actor.isAlive()) {
      this.act(actor);
      this.emit('onActionEnd', { actor }); // ダーウィン等用
    }
    this.checkDeaths(); if (this.finished) return;
    if (this.turnIndex >= this.turnOrder.length) this.phase = 'turnEnd';
  }

  phaseTurnEnd() {
    this.units.filter(u => u.isAlive()).forEach(u => this.tickTurnEnd(u));
    this.emit('onTurnEnd', { turn: this.turn });
    this.checkDeaths(); if (this.finished) return;
    if (this.turn >= 8) { this.finish('draw'); return; }
    this.turn++; this.logsByTurn[this.turn] = []; this.phase = 'turnStart';
  }

  act(actor) {
    this.log(`▼ [行動] ${sideLabel(actor.side)} ${actor.posLabel} <b>${actor.name}</b> (兵力:${Math.round(actor.hp)})`);
    if (this.hasStatus(actor, 'stun')) { this.log(`  -> 眩暈で行動不能`); return; }

    this.emit('onActionStart', { actor });
    
    // アクティブスキル判定
    if (!this.hasStatus(actor, 'silence')) {
      const actives = [getSkill(actor.uniqueSkillId), ...actor.subSkillIds.map(getSkill)].filter(s => s && s.trigger === 'active');
      actives.forEach(skill => {
        this.emit('onSkillAttempt', { actor, skill }); // リンカーン等用
        if (rand() * 100 < skill.chance) {
          this.log(`  ★ <span class="log-skill">[${skill.name}]</span> 発動！`);
          this.executeEffects(actor, skill.effects, { triggerSkill: skill }, `<span class="log-skill">[${skill.name}]</span>`);
          this.emit('onSkillSuccess', { actor, skill });
        }
      });
    }

    // 通常攻撃
    if (!this.hasStatus(actor, 'disarm')) {
      const target = this.selectTargets(actor, 'randomEnemy', 1)[0];
      if (target) {
        const dmg = this.calcDamage(actor, target, 1.0, 'atk');
        this.applyDamage(actor, target, dmg, '通常攻撃');
        this.emit('onNormalAttack', { actor, target, damage: dmg });
      }
    }
  }

  // ==========================================
  // UNIVERSAL EFFECT EXECUTOR
  // ==========================================
  executeEffects(caster, effects, context = {}, label = '') {
    if (!effects) return;
    effects.forEach(eff => {
      if (eff.chance && rand() * 100 > eff.chance) return;
      if (!this.checkConditions(eff.conditions, context, caster)) return;

      const repeats = eff.repeat || 1;
      for (let i = 0; i < repeats; i++) {
        const targets = this.selectTargets(caster, eff.target, eff.count || 1, context);
        targets.forEach(target => this.applySingleEffect(caster, target, eff, label, i+1, repeats>1));
      }
    });
  }

  applySingleEffect(caster, target, eff, label, hitNum, isMulti) {
    const effLabel = `${label}${isMulti ? `(${hitNum})` : ''}`;
    let scale = 1; if (eff.scalingStat) scale = caster.getScaledStat(eff.scalingStat).scale;

    switch (eff.type) {
      case 'damage':
        let basis = eff.basis === 'highest' ? (caster.getCurrentStat('atk') > caster.getCurrentStat('int') ? 'atk' : 'int') : eff.basis;
        const dmg = this.calcDamage(caster, target, (eff.rate||1) * scale, basis || 'atk');
        this.applyDamage(caster, target, dmg, effLabel, eff.isSplash);
        break;
      case 'heal':
        const heal = this.calcHeal(caster, target, (eff.rate||1) * scale, eff.basis || 'int');
        this.applyHeal(caster, target, heal, effLabel);
        break;
      case 'buff':
        target.buffs.push({ stat: eff.stat, value: eff.value * scale, duration: eff.duration, type: eff.statType || 'flat' });
        break;
      case 'status':
        if(CONTROL_SET.has(eff.status) && target.invincibleTurns > 0) { this.log(`  -> 〔無敵〕${target.name}は制御効果を弾いた`); break; }
        target.statuses.push({ name: eff.status, duration: eff.duration });
        this.log(`  -> ${target.name} に【${eff.status}】付与`);
        break;
      case 'absorb': // ステータス吸収
        const val = eff.value * scale;
        target.buffs.push({ stat: eff.stat, value: -val, duration: eff.duration, type: 'flat' });
        caster.buffs.push({ stat: eff.stat, value: val, duration: eff.duration, type: 'flat' });
        this.log(`  -> ${caster.name} が ${target.name} の ${eff.stat} を ${val} 吸収 (${label})`);
        break;
      case 'custom_state_set':
        caster.customState[eff.key] = eff.value; break;
      case 'increment_counter':
        caster.customState[eff.key] = (caster.customState[eff.key] || 0) + eff.value; break;
    }
  }

  selectTargets(caster, type, count, context) {
    const enemies = this.units.filter(u => u.side !== caster.side && u.isAlive());
    const allies = this.units.filter(u => u.side === caster.side && u.isAlive());
    let pool = [];
    switch(type) {
      case 'self': return [caster];
      case 'contextTarget': return [context.target].filter(Boolean);
      case 'randomEnemy': pool = enemies; break;
      case 'lowestHpAlly': pool = allies.sort((a,b) => a.hp - b.hp); break;
      case 'mostWoundedAlly': pool = allies.sort((a,b) => (b.maxHp - b.hp) - (a.maxHp - a.hp)); break;
      default: pool = enemies;
    }
    return sample(pool, count);
  }

  // --- 計算式 (Rule 10, Rule 15適用) ---
  getStat(unit, statName) {
    let base = num(unit.baseStats[statName] || (getHero(unit.id).stats[statName]));
    let flatMod = unit.buffs.filter(b => b.stat === statName && b.type === 'flat').reduce((sum, b) => sum + b.value, 0);
    let pctMod = unit.buffs.filter(b => b.stat === statName && b.type === 'pct').reduce((sum, b) => sum + b.value, 0);
    let value = Math.max(0, (base + flatMod) * (1 + pctMod / 100));
    // Rule 15: 属性値による増幅
    let scale = 1 + (Math.floor(value / 50) * 0.1);
    return { value, scale };
  }

  getCurrentStat(unit, statName) { return this.getStat(unit, statName).value; }

  calcDamage(attacker, target, rate, basis) {
    const atk = this.getStat(attacker, basis);
    const def = this.getStat(target, basis === 'int' ? 'int' : 'def');
    const base = ((atk.value - def.value) * 1.5) + ((-0.05/10000) * attacker.hp + 0.1) * attacker.hp;
    // Rule 10: 知力ダメージは defVal=0 とする仕様
    let dmg = basis === 'int' ? ((atk.value) * 1.5) + ((-0.05/10000) * attacker.hp + 0.1) * attacker.hp : base;
    
    // Rule 15増幅とクリティカル
    let scale = atk.scale;
    const isCrit = rand()*100 < this.getCurrentStat(attacker, 'critRate');
    dmg = Math.max(1, Math.round(dmg * rate * scale * (isCrit?2:1) * (0.975 + rand()*0.05)));
    if(isCrit) this.log(`  -> <span style="color:#ffcc00;font-weight:bold">Painful Blow!</span>`);
    return dmg;
  }

  applyDamage(attacker, target, damage, label, isSplash=false) {
    if(target.hp <= 0) return;
    damage = Math.max(1, Math.round(damage * (1 + this.getCurrentStat(target, 'dmgTakenPct')/100)));
    target.hp -= damage;
    this.log(`  -> ${target.name} に <span class="log-damage">${damage} ダメージ</span> (${label})`);
    
    this.emit('onDamageTaken', { target, attacker, damage });
    if(attacker) this.emit('onDamageDealt', { target, attacker, damage });
  }

  calcHeal(healer, target, rate, basis) {
    const stat = this.getStat(healer, basis).value;
    // 負傷兵数に基づく簡易計算
    const raw = (145 * Math.log(Math.max(1, healer.hp)) - 900) * rate;
    return Math.max(0, Math.round(raw));
  }

  applyHeal(healer, target, amount, label) {
    if(target.hp <= 0 || this.hasStatus(target, 'noheal')) return;
    const actual = Math.min(target.maxHp - target.hp, amount);
    target.hp += actual;
    this.log(`  -> ${target.name} を <span class="log-heal">${actual} 回復</span> (${label})`);
  }

  checkConditions(conditions, context, owner) {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every(cond => {
      if(cond.type === 'isControlled') return context.target && context.target.statuses.some(s => CONTROL_SET.has(s.name));
      if(cond.type === 'hasAllyBelowPct') return this.units.some(u => u.side === owner.side && u.hp/u.maxHp*100 <= cond.value);
      return true;
    });
  }

  hasStatus(unit, name) { return unit.statuses.some(s => s.name === name); }
  getCurrentStat(unit, name) { // 簡易版
     return num(getHero(unit.id).stats[name]) + unit.buffs.filter(b=>b.stat===name).reduce((sum,b)=>sum+b.value,0);
  }

  tickTurnStart(u) { if(u.invincibleTurns>0) u.invincibleTurns--; }
  tickTurnEnd(u) {
    u.buffs = u.buffs.map(b => ({...b, duration: b.duration-1})).filter(b => b.duration>0 || b.duration<0);
    u.statuses = u.statuses.map(s => ({...s, duration: s.duration-1})).filter(s => s.duration>0);
  }

  checkDeaths() {
    this.units.forEach(u => {
      if(u.hp <= 0 && !u.isDead) {
        u.isDead = true; u.hp = 0;
        this.log(`✝ <b>${u.name}</b> は撤退した`);
      }
    });
    if(this.sides.left[0].hp <= 0 && this.sides.right[0].hp <= 0) this.finish('draw');
    else if(this.sides.left[0].hp <= 0) this.finish('right_win');
    else if(this.sides.right[0].hp <= 0) this.finish('left_win');
  }

  finish(reason) {
    this.finished = true; this.phase = 'finished';
    this.log("<div class='log-turn-start'>=== 戦闘終了 ===</div>");
    if(reason==='draw') this.log('引き分け！');
    if(reason==='left_win') this.log('自軍（Left）の勝利！');
    if(reason==='right_win') this.log('敵軍（Right）の勝利！');
    document.getElementById('stateBadge').textContent = '終了';
  }
}

// ==========================================
// UI & ビューア管理
// ==========================================
function renderTeams() {
  ['left', 'right'].forEach(side => {
    document.getElementById(`${side}Slots`).innerHTML = app.teams[side].map((slot, i) => `
      <div class="slot">
        <div class="label">${POSITIONS[i]}</div>
        <select onchange="updateSlot('${side}', ${i}, 'id', this.value)">
          <option value="">英傑選択</option>
          ${app.heroes.map(h => `<option value="${h.id}" ${slot.id===h.id?'selected':''}>${h.name}</option>`).join('')}
        </select>
        <input type="number" value="${slot.troops}" onchange="updateSlot('${side}', ${i}, 'troops', this.value)">
        <select onchange="updateSlot('${side}', ${i}, 'sub1', this.value)">
          <option value="">スキル1</option>
          ${app.skills.map(s => `<option value="${s.id}" ${slot.subSkills[0]===s.id?'selected':''}>${s.name}</option>`).join('')}
        </select>
        <select onchange="updateSlot('${side}', ${i}, 'sub2', this.value)">
          <option value="">スキル2</option>
          ${app.skills.map(s => `<option value="${s.id}" ${slot.subSkills[1]===s.id?'selected':''}>${s.name}</option>`).join('')}
        </select>
      </div>
    `).join('');
  });
}

function updateSlot(side, idx, field, value) {
  const slot = app.teams[side][idx];
  if(field === 'id') slot.id = value;
  if(field === 'troops') slot.troops = num(value, 10000);
  if(field === 'sub1') slot.subSkills[0] = value;
  if(field === 'sub2') slot.subSkills[1] = value;
  localStorage.setItem(STORE.teams, JSON.stringify(app.teams));
}

// 【デバッグ・新設】ビューアの初期化と更新
function initViewers() {
  const hSel = document.getElementById('heroViewerSelect');
  const sSel = document.getElementById('skillViewerSelect');

  // プルダウンを満たす
  hSel.innerHTML = '<option value="">英傑を選択</option>' + app.heroes.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
  sSel.innerHTML = '<option value="">スキルを選択</option>' + app.skills.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  // 変更イベント
  hSel.onchange = () => {
    const h = getHero(hSel.value);
    const d = document.getElementById('heroViewerDetail');
    if(!h) { d.textContent = '英傑を選択してください。'; return; }
    const u = getSkill(h.unique);
    d.innerHTML = `<b>${h.name}</b> (${h.unitType})<br>ATK:${h.stats.atk} DEF:${h.stats.def} INT:${h.stats.int} AGI:${h.stats.agi} RNG:${h.stats.rng}<br><br>固有: <b>${u?u.name:'なし'}</b><br>${u?u.detail:''}`;
  };
  sSel.onchange = () => {
    const s = getSkill(sSel.value);
    const d = document.getElementById('skillViewerDetail');
    if(!s) { d.textContent = 'スキルを選択してください。'; return; }
    d.innerHTML = `<b>${s.name}</b> (Type: ${s.trigger})<br>Chance: ${s.chance||100}%<br><br>${s.detail||''}`;
  };
}

function loadState(forceFetch = false) {
  // fetch対応のため、async/awaitが必要だが、window.onloadで行うため、ここは同期処理のLocalStorageのみ
  const localH = localStorage.getItem(STORE.heroes);
  const localS = localStorage.getItem(STORE.skills);
  const localT = localStorage.getItem(STORE.teams);

  if (localH) app.heroes = JSON.parse(localH);
  if (localS) app.skills = JSON.parse(localS);
  if (localT) app.teams = JSON.parse(localT);
}

async function fetchAndSaveInitialData() {
  console.log("外部JSONファイルからデータを取得中...");
  try {
    const [hRes, sRes] = await Promise.all([
      fetch('heroes_all.json').then(r => r.json()),
      fetch('skills_all.json').then(r => r.json())
    ]);
    app.heroes = hRes; localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
    app.skills = sRes; localStorage.setItem(STORE.skills, JSON.stringify(app.skills));
    console.log("データロード完了");
  } catch (err) {
    console.error("データのフェッチに失敗しました。デフォルト値を使用します:", err);
    app.heroes = clone(DEFAULT_HEROES); app.skills = clone(DEFAULT_SKILLS);
  }
}

function renderAll() {
  renderTeams();
  document.getElementById('heroesJson').value = JSON.stringify(app.heroes, null, 2);
  document.getElementById('skillsJson').value = JSON.stringify(app.skills, null, 2);
}

// --- 初期化 ---
window.onload = async () => {
  // 非同期でデータをロード
  loadState();
  if (!app.heroes.length || !app.skills.length) {
    await fetchAndSaveInitialData();
  } else {
    // LocalStorageにある場合はDEFAULT_TEAMSが空にならないように設定
    if(!app.teams) app.teams = clone(DEFAULT_TEAMS);
  }

  // 描画とビューアの初期化
  renderAll();
  initViewers();

  // ボタンイベント
  document.getElementById('btnStart').onclick = () => {
    app.battle = new BattleEngine(clone(app.teams));
    document.getElementById('stateBadge').textContent = '進行中';
    app.battle.nextChunk();
    document.getElementById('turnBadge').textContent = `Turn ${app.battle.turn}`;
  };
  document.getElementById('btnNext').onclick = () => { if(app.battle) { app.battle.nextChunk(); document.getElementById('turnBadge').textContent = `Turn ${app.battle.turn}`; } };
  
  document.getElementById('btnPrevTurn').onclick = () => {
    if(app.battle && app.battle.viewTurn > 0) {
      app.battle.viewTurn--;
      document.getElementById('currentTurnLabel').textContent = `Turn ${app.battle.viewTurn}`;
      clearHtmlLog();
      app.battle.logsByTurn[app.battle.viewTurn].forEach(l => addHtmlLog(l));
    }
  };
  document.getElementById('btnNextTurn').onclick = () => {
    if(app.battle && app.battle.viewTurn < app.battle.turn) {
      app.battle.viewTurn++;
      document.getElementById('currentTurnLabel').textContent = `Turn ${app.battle.viewTurn}`;
      clearHtmlLog();
      app.battle.logsByTurn[app.battle.viewTurn].forEach(l => addHtmlLog(l));
    }
  };

  // 【デバッグ】保存時にメモリ上の配列を更新し、セレクトボックスを再読込
  document.getElementById('btnSaveHeroes').onclick = () => {
    try {
      const data = JSON.parse(document.getElementById('heroesJson').value);
      app.heroes = data; // メモリを更新
      localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes)); // 保存
      initViewers(); // ビューアを再読込
      renderTeams(); // 編成セレクトボックスを再読込
      alert('英傑データを保存しました');
    } catch (err) { alert('JSONの形式が正しくありません'); }
  };
  document.getElementById('btnSaveSkills').onclick = () => {
    try {
      const data = JSON.parse(document.getElementById('skillsJson').value);
      app.skills = data; // メモリを更新
      localStorage.setItem(STORE.skills, JSON.stringify(app.skills)); // 保存
      initViewers(); // ビューアを再読込
      renderTeams(); // 編成セレクトボックスを再読込
      alert('スキルデータを保存しました');
    } catch (err) { alert('JSONの形式が正しくありません'); }
  };

  // 【機能追加】ファイルからデータを強制同期（初期化）
  document.getElementById('btnLoadDefaultHeroes').onclick = async () => {
    if (confirm("外部JSONファイルの内容で現在のデータを上書きしますか？")) {
      await fetchAndSaveInitialData();
      renderAll();
      initViewers();
    }
  };
  document.getElementById('btnLoadDefaultSkills').onclick = async () => {
    if (confirm("外部JSONファイルの内容で現在のデータを上書きしますか？")) {
      await fetchAndSaveInitialData();
      renderAll();
      initViewers();
    }
  };

  document.getElementById('btnRefresh').onclick = () => { renderTeams(); };
};
