const STORE = { heroes: 'tw.uni.heroes.v5', skills: 'tw.uni.skills.v5', teams: 'tw.uni.teams.v5' };

// --- 初期データ (fetch失敗時のフォールバック用) ---
const DEFAULT_HEROES = [{ id: "test_hero", name: "テスト英傑", stats: { atk: 100, def: 100, int: 100, agi: 100, rng: 3 } }];
const DEFAULT_SKILLS = [{ id: "test_skill", name: "テストスキル", trigger: "action", chance: 100, effects: [] }];
const DEFAULT_TEAMS = {
  left: [{ id: "test_hero", troops: 10000, subSkills: ["", ""] }, { id: "", troops: 10000, subSkills: ["", ""] }, { id: "", troops: 10000, subSkills: ["", ""] }],
  right: [{ id: "", troops: 10000, subSkills: ["", ""] }, { id: "", troops: 10000, subSkills: ["", ""] }, { id: "", troops: 10000, subSkills: ["", ""] }]
};

const POSITIONS = ['指揮官', '中軍', '前衛'];
const CONTROL_SET = new Set(['stun', 'silence', 'disarm', 'confusion', 'frenzy', 'exhaustion', 'noheal', 'taunt']);

let app = { heroes: [], skills: [], teams: null, battle: null, auto: null };

// --- ユーティリティ ---
function num(v, d=0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function rand() { return Math.random(); }
function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function sample(arr, n) {
  const pool = (arr || []).slice();
  const out = [];
  while(pool.length && out.length < n) out.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
  return out;
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function getHero(id) { return app.heroes.find(h => h.id === id); }
function getSkill(id) { return app.skills.find(s => s.id === id); }
function sideLabel(side) { return side === 'left' ? '自軍' : '敵軍'; }

// --- DOM操作 (リッチログ) ---
function addHtmlLog(html) {
  const area = document.getElementById('logArea');
  const content = document.getElementById('logContent');
  if(!area || !content) return;
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = html;
  content.appendChild(div);
  area.scrollTop = area.scrollHeight; // 自動スクロール
}
function clearHtmlLog() {
  const content = document.getElementById('logContent');
  if(content) content.innerHTML = '';
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
    this.customState = {}; // 汎用的状態エリア
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
    if(this.viewTurn === this.turn) addHtmlLog(htmlMsg);
  }

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

  // --- 計算式 (Rule 10, Rule 15適用) ---
  getStat(unit, statName) {
    // データ駆動用にIDから基礎値を取得
    const hero = getHero(unit.id);
    let base = num(unit.baseStats[statName] || (hero ? hero.stats[statName] : 0));
    let flatMod = unit.buffs.filter(b => b.stat === statName && b.type === 'flat').reduce((sum, b) => sum + b.value, 0);
    let pctMod = unit.buffs.filter(b => b.stat === statName && b.type === 'pct').reduce((sum, b) => sum + b.value, 0);
    let value = Math.max(0, (base + flatMod) * (1 + pctMod / 100));
    // Rule 15: 属性値による増幅
    let scale = 1 + (Math.floor(value / 50) * 0.1);
    return { value, scale };
  }
  getCurrentStat(unit, statName) { return this.getStat(unit, statName).value; }

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

  calcDamage(attacker, target, rate, basis) {
    const atk = this.getStat(attacker, basis);
    const def = this.getStat(target, basis === 'int' ? 'int' : 'def');
    let base = basis === 'int' ? (atk.value * 1.5) : ((atk.value - def.value) * 1.5);
    base += ((-0.05/10000) * attacker.hp + 0.1) * attacker.hp;
    const isCrit = rand()*100 < this.getCurrentStat(attacker, 'critRate');
    return Math.max(1, Math.round(base * rate * atk.scale * (isCrit?2:1) * (0.975 + rand()*0.05)));
  }

  applyDamage(attacker, target, damage, label, isSplash=false) {
    if(target.hp <= 0) return;
    const finalDamage = Math.max(1, Math.round(damage * (1 + this.getCurrentStat(target, 'dmgTakenPct')/100)));
    target.hp -= finalDamage;
    this.log(`  -> ${target.name} に <span class="log-damage">${finalDamage} ダメージ</span> (${label})`);
    this.emit('onDamageTaken', { target, attacker, damage: finalDamage });
    if(attacker) this.emit('onDamageDealt', { target, attacker, damage: finalDamage });
  }

  calcHeal(healer, target, rate, basis) {
    const stat = this.getStat(healer, basis).value;
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
      return true;
    });
  }

  hasStatus(unit, name) { return unit.statuses.some(s => s.name === name); }
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
        <label>${POSITIONS[i]}</label>
        <select onchange="updateSlot('${side}', ${i}, 'id', this.value)">
          <option value="">英傑選択</option>
          ${app.heroes.map(h => `<option value="${h.id}" ${slot.id===h.id?'selected':''}>${h.name}</option>`).join('')}
        </select>
        <input type="number" value="${slot.troops}" onchange="updateSlot('${side}', ${i}, 'troops', this.value)" placeholder="兵力">
        <div style="display:flex;gap:5px;margin-top:5px">
          <select onchange="updateSlot('${side}', ${i}, 'sub1', this.value)" title="スキル1">
            <option value="">スキル1</option>
            ${app.skills.map(s => `<option value="${s.id}" ${slot.subSkills[0]===s.id?'selected':''}>${s.name}</option>`).join('')}
          </select>
          <select onchange="updateSlot('${side}', ${i}, 'sub2', this.value)" title="スキル2">
            <option value="">スキル2</option>
            ${app.skills.map(s => `<option value="${s.id}" ${slot.subSkills[1]===s.id?'selected':''}>${s.name}</option>`).join('')}
          </select>
        </div>
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
  if(!hSel || !sSel) return;

  // プルダウンを満たす
  hSel.innerHTML = '<option value="">英傑を選択</option>' + app.heroes.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
  sSel.innerHTML = '<option value="">スキルを選択</option>' + app.skills.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  // 変更イベント
  hSel.onchange = () => {
    const h = getHero(hSel.value);
    const d = document.getElementById('heroViewerDetail');
    if(!h) { d.textContent = '英傑を選択してください。'; return; }
    d.innerHTML = `<b>${h.name}</b> (${h.unitType})<br>ATK:${h.stats.atk} DEF:${h.stats.def} INT:${h.stats.int} AGI:${h.stats.agi} RNG:${h.stats.rng}`;
  };
  sSel.onchange = () => {
    const s = getSkill(sSel.value);
    const d = document.getElementById('skillViewerDetail');
    if(!s) { d.textContent = 'スキルを選択してください。'; return; }
    d.innerHTML = `<b>${s.name}</b> (Type: ${s.trigger})<br>Chance: ${s.chance||100}%<br><br>${s.detail||''}`;
  };
}

async function fetchInitialData() {
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
    console.error("データのフェッチに失敗。デフォルト値を使用します:", err);
    app.heroes = clone(DEFAULT_HEROES); app.skills = clone(DEFAULT_SKILLS);
  }
}

// --- 初期化 ---
window.onload = async () => {
  // データのロード
  app.heroes = JSON.parse(localStorage.getItem(STORE.heroes)) || [];
  app.skills = JSON.parse(localStorage.getItem(STORE.skills)) || [];
  
  if (!app.heroes.length || !app.skills.length) {
    await fetchInitialData();
  }
  
  app.teams = JSON.parse(localStorage.getItem(STORE.teams)) || clone(DEFAULT_TEAMS);
  
  // 描画とビューアの初期化
  renderTeams();
  document.getElementById('heroesJson').value = JSON.stringify(app.heroes, null, 2);
  document.getElementById('skillsJson').value = JSON.stringify(app.skills, null, 2);
  initViewers();

  // ボタンイベント
  document.getElementById('btnStart').onclick = () => {
    app.battle = new BattleEngine(clone(app.teams));
    document.getElementById('stateBadge').textContent = '進行中';
    app.battle.nextChunk();
  };
  document.getElementById('btnNext').onclick = () => { if(app.battle) { app.battle.nextChunk(); document.getElementById('turnBadge').textContent = `Turn ${app.battle.turn}`; } };
  
  document.getElementById('btnRefresh').onclick = () => { renderTeams(); };
  
  document.getElementById('btnSaveHeroes').onclick = () => {
    try {
      const data = JSON.parse(document.getElementById('heroesJson').value);
      app.heroes = data; // メモリを更新
      localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes)); // 保存
      initViewers(); // ビューアを再読込
      renderTeams(); // 編成セレクトボックスを再読込
      alert('英傑データを保存しました');
    } catch (err) { alert('JSON形式が正しくありません'); }
  };
  document.getElementById('btnSaveSkills').onclick = () => {
    try {
      const data = JSON.parse(document.getElementById('skillsJson').value);
      app.skills = data; // メモリを更新
      localStorage.setItem(STORE.skills, JSON.stringify(app.skills)); // 保存
      initViewers(); // ビューアを再読込
      renderTeams(); // 編成セレクトボックスを再読込
      alert('スキルデータを保存しました');
    } catch (err) { alert('JSON形式が正しくありません'); }
  };
  
  document.getElementById('btnSyncFile').onclick = async () => {
    if (confirm("外部JSONファイルの内容で現在のデータを上書きしますか？")) {
      await fetchInitialData();
      renderTeams(); document.getElementById('heroesJson').value = JSON.stringify(app.heroes, null, 2); document.getElementById('skillsJson').value = JSON.stringify(app.skills, null, 2); initViewers();
    }
  };
};
