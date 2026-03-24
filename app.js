const STORE = { heroes: 'tw.uni.heroes.v2', skills: 'tw.uni.skills.v2', teams: 'tw.uni.teams.v2' };

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
function setLog(text) { const el = document.getElementById('log'); if(el) el.textContent = text; }

// --- 定数 ---
const POSITIONS = ['指揮官', '中軍', '前衛'];
// 制御効果の定義
const CONTROL_SET = new Set(['stun', 'silence', 'disarm', 'confusion', 'frenzy', 'exhaustion', 'noheal', 'unableHeal', 'capture', 'taunt', 'fakeReport']);

// プレースホルダー（後でJSONで上書きされる）
const DEFAULT_HEROES = [];
const DEFAULT_SKILLS = [];
const DEFAULT_TEAMS = {
  left: Array(3).fill({ id: "", troops: 10000, subSkills: ["", ""] }),
  right: Array(3).fill({ id: "", troops: 10000, subSkills: ["", ""] })
};

let app = { heroes: [], skills: [], teams: null, battle: null, auto: null };

// ==========================================
// BATTLE UNIT (英雄実体)
// ==========================================
class Unit {
  constructor(heroData, teamData, side, posIdx) {
    this.uid = `${side}_${posIdx}`;
    this.id = heroData.id;
    this.name = heroData.name;
    this.side = side;
    this.posIdx = posIdx;
    this.posLabel = POSITIONS[posIdx];
    this.unitType = heroData.unitType || 'infantry'; // 兵種

    this.maxHp = num(teamData.troops, 10000);
    this.hp = this.maxHp;
    this.wounded = 0; // 負傷兵

    // 基礎ステータス
    this.stats = { ...heroData.stats };
    this.rng = num(heroData.stats.rng, 1);

    // スキルIDの保持
    this.uniqueSkillId = heroData.unique;
    this.subSkillIds = (teamData.subSkills || []).slice(0, 2);

    // 動的な状態
    this.buffs = []; // { stat, value, duration, type('flat'/'pct') }
    this.statuses = []; // { name, duration, casterUid, value }
    this.preps = {}; // 準備ターンのタイマー { skillId: turns }
    this.shields = 0;
    this.invincibleTurns = 0; // 無敵フラグ
    this.commandBuffTurns = 0; // 指揮官バフ持続

    this.normalHits = 1; // 通常攻撃回数（連撃・奇襲）
    this.countersThisTurn = 0; // パルメラ用カウンタ

    // データ駆動用カスタム状態エリア
    // 最終決戦のスタックや、風魔小太郎のカウント、ハンニバルのアシストカウント等を保存
    this.stackState = {}; 
    
    // エンゲージスキルの死亡後持続効果
    this.deadHoldEffects = []; 
  }

  isAlive() { return this.hp > 0; }
  
  // Rule 15: ステータス補正 (50毎に10%UP) の適用
  getScaledStat(statName) {
    let base = num(this.stats[statName]);
    let flatMod = this.buffs.filter(b => b.stat === statName && b.type === 'flat').reduce((sum, b) => sum + b.value, 0);
    let pctMod = this.buffs.filter(b => b.stat === statName && b.type === 'pct').reduce((sum, b) => sum + b.value, 0);
    
    let value = (base + flatMod) * (1 + pctMod / 100);
    
    // スキル発動時の影響度計算
    let scale = 1 + (Math.floor(value / 50) * 0.1);
    return { value, scale };
  }

  // 純粋な現在のステータス値を取得
  getCurrentStat(statName) {
    return this.getScaledStat(statName).value;
  }
}

// ==========================================
// UNIVERSAL EVENT-DRIVEN BATTLE ENGINE
// ==========================================
class BattleEngine {
  constructor(teams) {
    this.turn = 0; this.viewTurn = 0; this.phase = 'opening';
    this.logsByTurn = { 0: [] };
    this.finished = false;
    this.hooks = []; // イベントトリガーのリスト

    this.sides = { left: this.initTeam(teams.left, 'left'), right: this.initTeam(teams.right, 'right') };
    this.units = [...this.sides.left, ...this.sides.right];
    
    this.registerPermanentSkills();
  }

  initTeam(teamData, side) {
    return teamData.map((slot, idx) => {
      const h = getHero(slot.id);
      if (!h) return null;
      return new Unit(h, slot, side, idx);
    }).filter(Boolean);
  }

  log(msg) {
    if (!this.logsByTurn[this.viewTurn]) this.logsByTurn[this.viewTurn] = [];
    this.logsByTurn[this.viewTurn].push(msg);
  }

  // --- イベント発行システム (emit) ---
  emit(eventName, context = {}) {
    // グローバルフックをイベント名で検索
    const activeHooks = this.hooks.filter(h => h.event === eventName);
    for (const hook of activeHooks) {
      // 死亡チェック（エンゲージの死亡後持続以外は死亡者は発動不可）
      if (!hook.owner.isAlive() && !hook.isDeadHold) continue;
      
      // 確率判定
      if (hook.chance && rand() * 100 > hook.chance) continue;
      
      // 条件判定
      if (!this.checkConditions(hook.conditions, context, hook.owner)) continue;

      // エフェクト実行
      this.executeEffects(hook.owner, hook.effects, context, hook.skillLabel);
    }
  }

  // --- スキル登録システム ---
  registerPermanentSkills() {
    this.units.forEach(unit => {
      const allSkills = [getSkill(unit.uniqueSkillId), ...unit.subSkillIds.map(getSkill)].filter(Boolean);
      allSkills.forEach(skill => {
        // パッシブ・エンゲージの即時発動効果（0ターン目）
        if (['passive', 'engage'].includes(skill.trigger)) {
          this.executeEffects(unit, skill.effects, { triggerSkill: skill, isOpening: true });
        }
        
        // イベントフック（特定の行動を監視する効果）の登録
        if (skill.hooks) {
          skill.hooks.forEach(h => {
            this.hooks.push({
              event: h.event, chance: h.chance || 100, conditions: h.conditions || [],
              effects: h.effects, owner: unit, skillLabel: skill.name,
              isDeadHold: skill.trigger === 'engage' // エンゲージのフックは死亡後も持続
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
      if (this.phase === 'opening') {
        this.phaseOpening(); return;
      }
      if (this.phase === 'turnStart') {
        this.phaseTurnStart(); return;
      }
      if (this.phase === 'action') {
        this.phaseAction(); return;
      }
      if (this.phase === 'turnEnd') {
        this.phaseTurnEnd(); return;
      }
    } catch (err) {
      console.error(err); this.log(`【クラッシュ防止】${err.message}`); this.finish('error');
    }
  }

  phaseOpening() {
    this.log("=== 戦闘開始（0ターン目） ===");
    this.emit('onBattleStart'); // 0ターン目フック
    this.checkDeaths(); if (this.finished) return;
    this.turn = 1; this.viewTurn = 1; this.logsByTurn[1] = [];
    this.phase = 'turnStart';
  }

  phaseTurnStart() {
    this.viewTurn = this.turn;
    this.log(`--- Turn ${this.turn} 開始 ---`);
    this.units.filter(u => u.isAlive()).forEach(u => this.tickTurnStart(u));
    this.emit('onTurnStart', { turn: this.turn });
    this.checkDeaths(); if (this.finished) return;
    
    // 行動順ソート（AGI順）
    this.turnOrder = this.units.filter(u => u.isAlive()).sort((a,b) => b.getCurrentStat('agi') - a.getCurrentStat('agi'));
    this.turnIndex = 0;
    this.phase = 'action';
  }

  phaseAction() {
    if (this.turnIndex >= this.turnOrder.length) { this.phase = 'turnEnd'; return; }
    const actor = this.turnOrder[this.turnIndex++];
    if (actor.isAlive()) this.act(actor);
    this.checkDeaths(); if (this.finished) return;
    if (this.turnIndex >= this.turnOrder.length) this.phase = 'turnEnd';
  }

  phaseTurnEnd() {
    this.units.filter(u => u.isAlive()).forEach(u => this.tickTurnEnd(u));
    this.emit('onTurnEnd', { turn: this.turn });
    this.checkDeaths(); if (this.finished) return;
    
    if (this.turn >= 8) { this.finish('draw'); return; }
    this.turn++; this.logsByTurn[this.turn] = [];
    this.phase = 'turnStart';
  }

  act(actor) {
    this.log(`▼ [行動] ${actor.side==='left'?'自':'敵'} ${actor.posLabel} ${actor.name} (兵力:${Math.round(actor.hp)})`);
    
    if (this.hasStatus(actor, 'stun')) { this.log(`  -> 眩暈で行動不能`); return; }

    this.emit('onActionStart', { actor });
    this.checkDeaths(); if (this.finished) return;

    // 準備スキルの発動
    const preps = Object.keys(actor.preps);
    if (preps.length > 0) {
      preps.forEach(skId => {
        actor.preps[skId]--;
        if (actor.preps[skId] === 0) {
          const skill = getSkill(skId);
          this.log(`  ★ 準備完了！ ${skill.name} を発動！`);
          this.executeEffects(actor, skill.effects, { triggerSkill: skill });
          delete actor.preps[skId];
        } else {
          this.log(`  -> 力を蓄えている...`);
        }
      });
      // 準備スキル発動ターンは、通常行動不可（仕様に基づく）
      return; 
    }

    // アクティブスキル判定
    if (!this.hasStatus(actor, 'silence')) {
      const actives = [getSkill(actor.uniqueSkillId), ...actor.subSkillIds.map(getSkill)].filter(s => s && s.trigger === 'active');
      actives.forEach(skill => {
        // リンカーン用「発動しようとする度」フック。沈黙・眩暈時を除く。
        this.emit('onSkillAttempt', { actor, skill });
        
        // 最終決戦用重ねがけバフ
        if (skill.name === '最終決戦') { /* パッシブで処理 */ }

        if (rand() * 100 < skill.chance) {
          if (skill.prepTurns) {
            this.log(`  ★ ${skill.name} の準備に入った！`);
            actor.preps[skill.id] = skill.prepTurns;
          } else {
            this.log(`  ★ ${skill.name} 発動！`);
            this.executeEffects(actor, skill.effects, { triggerSkill: skill });
            this.emit('onSkillSuccess', { actor, skill });
          }
        } else {
          this.emit('onSkillFailed', { actor, skill });
        }
        this.checkDeaths(); if (this.finished) return;
      });
    }

    // 通常攻撃
    if (!this.hasStatus(actor, 'disarm')) {
      const hits = Math.max(1, actor.normalHits);
      for (let i = 0; i < hits; i++) {
        const target = this.chooseNormalTarget(actor);
        if (!target) { this.log(`  -> 攻撃対象がいない`); break; }
        
        const dmg = this.calcDamage(actor, target, 1.0, 'atk');
        this.applyDamage(actor, target, dmg, `通常攻撃 ${i+1}/${hits}`);
        
        // コンボスキル判定
        this.emit('onNormalAttack', { actor, target, damage: dmg });
        const combos = [getSkill(actor.uniqueSkillId), ...actor.subSkillIds.map(getSkill)].filter(s => s && s.trigger === 'combo');
        combos.forEach(skill => {
          if (rand() * 100 < skill.chance) {
            this.log(`  ★ コンボ ${skill.name} 発動！`);
            this.executeEffects(actor, skill.effects, { target, triggerSkill: skill });
          }
          this.checkDeaths(); if (this.finished) return;
        });
        if (!actor.isAlive()) break;
      }
    }
  }

  // ==========================================
  // UNIVERSAL EFFECT EXECUTOR (パイプライン処理)
  // ==========================================
  executeEffects(caster, effects, context = {}, skillLabel = '') {
    if (!effects) return;

    effects.forEach(eff => {
      // 確率判定
      if (eff.chance && rand() * 100 > eff.chance) return;
      
      // 条件判定
      if (!this.checkConditions(eff.conditions, context, caster)) return;

      // リピート処理（連撃や多段ヒット）
      const repeats = eff.repeat || 1;
      for (let i = 0; i < repeats; i++) {
        // ターゲット選択。射程（RNG）と陣形に基づく。
        const targets = this.selectTargets(caster, eff.target, eff.count || 1, context, eff.range);
        
        targets.forEach(target => {
          this.applySingleEffect(caster, target, eff, skillLabel, i + 1, repeats > 1);
        });
      }
    });
  }

  applySingleEffect(caster, target, eff, skillLabel, hitNum, isMulti) {
    const label = `${skillLabel}${isMulti ? `(${hitNum}撃目)` : ''}`;
    
    // ステータス依存の増幅度 (Rule 15)
    let powerScale = 1;
    if (eff.scalingStat) {
      powerScale = caster.getScaledStat(eff.scalingStat).scale;
    }

    switch (eff.type) {
      case 'damage': {
        const dmg = this.calcDamage(caster, target, eff.rate * powerScale, eff.basis || 'atk');
        this.applyDamage(caster, target, dmg, label, eff.isSplash);
        break;
      }
      case 'heal': {
        const heal = this.calcHeal(caster, target, eff.rate * powerScale, eff.basis || 'int');
        this.applyHeal(caster, target, heal, label);
        break;
      }
      case 'buff':
        this.addBuff(target, eff.stat, eff.value * powerScale, eff.duration, eff.statType || 'flat');
        break;
      case 'status':
        this.addStatus(target, eff.status, eff.duration, caster.uid, eff.value * powerScale);
        break;
      case 'cleanse':
        this.removeStatuses(target, eff.statusCategory, label);
        break;
      case 'absorb': {
        const val = eff.value * powerScale;
        this.addBuff(target, eff.stat, -val, eff.duration, 'flat');
        this.addBuff(caster, eff.stat, val, eff.duration, 'flat');
        this.log(`  -> ${caster.name} が ${target.name} の ${eff.stat} を ${val} 吸収 (${skillLabel})`);
        break;
      }
      case 'invincible':
        target.invincibleTurns = eff.duration;
        this.log(`  -> ${target.name} は無敵状態を獲得 (${skillLabel})`);
        break;
      case 'stackBuff':
        this.addStackBuff(target, eff.stat, eff.value, eff.stackLimit, skillLabel);
        break;
      case 'pounce_get':
        target.normalHits = 1 + (eff.value || 1);
        this.log(`  -> ${target.name} は連擊を獲得 (${skillLabel})`);
        break;
      case 'register_hook':
        this.log(`  -> ${skillLabel} 効果展開`);
        this.hooks.push({
          event: eff.hookEvent, chance: eff.hookChance || 100, conditions: eff.hookConditions || [],
          effects: eff.hookEffects, owner: caster, skillLabel: skillLabel, isDeadHold: eff.isDeadHold
        });
        break;
      case 'repro_act':
        this.log(`  -> 行動機会を再獲得！ (${skillLabel})`);
        this. Act Sequence logic, to be improved
        break;
    }
  }

  // --- 対象選択エンジン ---
  selectTargets(caster, type, count, context, range=null) {
    const enemies = this.units.filter(u => u.side !== caster.side && u.isAlive());
    const allies = this.units.filter(u => u.side === caster.side && u.isAlive());
    const rng = range || caster.getCurrentStat('rng');

    // RNGによる絞り込み（Rule 16）
    const inRangeEnemies = enemies.filter(t => this.rangeDistance(caster, t) <= rng);
    const inRangeAllies = allies.filter(t => this.rangeDistance(caster, t) <= rng);
    
    let pool = [];
    switch(type) {
      case 'self': return [caster];
      case 'contextTarget': return [context.target].filter(Boolean); // 直前の通常攻撃対象など
      case 'randomEnemy': pool = inRangeEnemies; break;
      case 'randomAlly': pool = inRangeAllies; break;
      case 'randomAllyExcludeSelf': pool = inRangeAllies.filter(a => a !== caster); break;
      case 'lowestHpAlly': pool = allies.sort((a,b) => a.hp - b.hp); break;
      case 'mostWoundedAlly': pool = allies.sort((a,b) => (b.maxHp - b.hp) - (a.maxHp - a.hp)); break;
      case 'highestAtkAlly': pool = allies.sort((a,b) => b.getCurrentStat('atk') - a.getCurrentStat('atk')); break;
      case 'enemyAll': return enemies;
      case 'allyAll': return allies;
      case 'nearbyEnemy': pool = enemies.filter(t => this.rangeDistance(context.target, t) === 1); break; // スプラッシュ用
    }
    
    // シャッフルして指定数取得
    return sample(pool, count);
  }

  rangeDistance(a, b) {
    // 陣形図: 指揮官A(0)-中軍A(1)-前衛A(2) VS 前衛B(2)-中軍B(1)-指揮官B(0)
    // 距離 = (2 - posIdxA) + 1 (間隔) + (2 - posIdxB)
    // ただし、死亡した英傑の位置は飛ばす (Rule 16.6)
    return (2 - a.posIdx) + 1 + (2 - b.posIdx);
  }

  // --- 条件判定エンジン ---
  checkConditions(conditions, context, owner) {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every(cond => {
      const target = context.target;
      switch (cond.type) {
        case 'hpBelowPct': return target && (target.hp / target.maxHp * 100) < cond.value;
        case 'isControlled': return target && target.statuses.some(s => CONTROL_SET.has(s.name));
        case 'notHasStatus': return target && !target.statuses.some(s => s.name === cond.value);
        case 'position': return owner.posIdx === cond.value;
        case 'turnEqual': return this.turn === cond.value;
        case 'isOpening': return context.isOpening;
      }
      return true;
    });
  }

  // --- 計算・適用ロジック ---
  calcDamage(attacker, target, rate, basis) {
    const atkStat = attacker.getScaledStat(basis);
    const defStat = target.getScaledStat(basis === 'int' ? 'int' : 'def');
    
    let atkVal = atkStat.value;
    let defVal = defStat.value;
    
    // 破陣効果
    if (this.hasStatus(attacker, 'pierce')) defVal = 0;

    const troops = attacker.hp;
    const base = ((atkVal - defVal) * 1.5) + ((-0.05/10000) * troops + 0.1) * troops;
    
    // クリティカル
    const isCrit = rand() * 100 < attacker.getCurrentStat('critRate');
    const critMul = isCrit ? 2 : 1;

    let dmg = Math.round(base * rate * critMul * (0.975 + rand() * 0.05));
    if (isCrit) this.log(`  -> 痛恨の一撃！`);
    return Math.max(1, dmg);
  }

  applyDamage(attacker, target, damage, label, isSplash=false) {
    if (target.hp <= 0) return;
    
    this.emit('beforeDamage', { target, attacker, damage, label });

    // 回避判定
    if (!this.hasStatus(attacker, '必中') && rand() * 100 < target.getCurrentStat('evadeRate')) {
      this.log(`  -> ${target.name} は攻撃を回避した！`);
      this.emit('afterDamage', { target, attacker, damage: 0, label });
      return;
    }

    // 無敵は制御効果を弾くがダメージは通る（Rule 5 無敵の定義）

    // 被ダメージ増減
    const dmgTakenMod = target.getScaledStat('dmgTakenPct').value;
    damage = Math.round(damage * (1 + dmgTakenMod / 100));

    // シールド
    if (target.shields > 0) {
      const absorb = Math.min(target.shields, damage);
      target.shields -= absorb;
      damage -= absorb;
      this.log(`  -> ${target.name} のシールドが ${absorb} 吸収 (${target.shields}残)`);
    }

    if (damage > 0) {
      target.hp -= damage;
      this.log(`  -> ${attacker.name} → ${target.name} に ${damage} ダメージ (${label})`);
      
      // 吸血
      const lifesteal = attacker.getCurrentStat('lifestealPct');
      if (lifesteal > 0 && !isSplash) {
        this.applyHeal(attacker, attacker, Math.round(damage * lifesteal / 100), '吸血');
      }
    }

    this.emit('afterDamage', { target, attacker, damage, label });
  }

  calcHeal(healer, target, rate, basis) {
    const stat = healer.getScaledStat(basis).value;
    const raw = (145 * Math.log(Math.max(1, healer.hp)) - 900) * rate;
    return Math.max(0, Math.round(raw));
  }

  applyHeal(healer, target, amount, label) {
    if (target.hp <= 0) return;
    if (this.hasStatus(target, 'noheal') || this.hasStatus(target, 'capture')) { this.log(`  -> ${target.name} は回復禁止`); return; }
    if (this.hasStatus(healer, 'unableHeal') || this.hasStatus(healer, 'capture')) { this.log(`  -> ${healer.name} は回復を与えられない`); return; }

    const actual = Math.min(target.maxHp - target.hp, amount);
    target.hp += actual;
    this.log(`  -> ${target.name} を ${actual} 回復 (${label})`);
  }

  addBuff(target, stat, value, duration, type) {
    target.buffs.push({ stat, value, duration, type });
  }

  addStatus(target, statusName, duration, casterUid, value) {
    // 無敵なら制御効果のみを弾く（ Rule 5 ）
    if (CONTROL_SET.has(statusName) && target.invincibleTurns > 0) {
      this.log(`  -> 〔無敵〕${target.name} は ${statusName} を弾いた！`);
      return;
    }
    target.statuses.push({ name: statusName, duration, casterUid, value });
    this.log(`  -> ${target.name} に【${statusName}】付与`);
  }

  removeStatuses(target, category, label) {
    if (category === 'debuff') {
      const before = target.statuses.length;
      target.statuses = target.statuses.filter(s => CATEGORIES.buff.has(s.name));
      if (before !== target.statuses.length) this.log(`  -> ${target.name} のデバフを解除 (${label})`);
    }
  }

  addStackBuff(target, stat, value, limit, label) {
    target.stackState[stat] = target.stackState[stat] || { value: 0, count: 0 };
    if (target.stackState[stat].count < limit) {
      target.stackState[stat].count++;
      target.stackState[stat].value += value;
      this.addBuff(target, stat, value, Infinity, 'flat'); // 戦闘終了まで
      this.log(`  -> ${target.name}：${label} スタック${target.stackState[stat].count} (+${target.stackState[stat].value}%)`);
    }
  }

  hasStatus(unit, statusName) { 
    if (statusName === '必中') return unit.buffs.some(b => b.stat === '必中');
    return unit.statuses.some(s => s.name === statusName); 
  }
  
  tickTurnStart(unit) {
    unit.countersThisTurn = 0;
    // 無敵タイマー
    if (unit.invincibleTurns > 0) { unit.invincibleTurns--; if (unit.invincibleTurns === 0) this.log(`  -> ${unit.name} の無敵が切れた`); }
  }

  tickTurnEnd(unit) {
    // バフ・状態異常の持続減少 (Rule 8)
    unit.buffs = unit.buffs.map(b => ({...b, duration: b.duration - 1})).filter(b => b.duration > 0 || b.duration < 0 /* Infinity */);
    unit.statuses = unit.statuses.map(s => ({...s, duration: s.duration - 1})).filter(s => s.duration > 0);
  }

  chooseNormalTarget(attacker) {
    // 混乱・狂乱等は selectTargets で処理
    return this.selectTargets(attacker, 'randomEnemy', 1)[0] || null;
  }

  checkDeaths() {
    this.units.forEach(u => {
      if (u.hp <= 0 && !u.isDead) {
        u.isDead = true;
        u.hp = 0;
        this.log(`✝ ${sideLabel(u.side)} ${u.posLabel} ${u.name} は撤退した`);
        this.emit('onDeath', { target: u });
      }
    });
    const leftCmd = this.sides.left[0];
    const rightCmd = this.sides.right[0];
    if (leftCmd.hp <= 0 && rightCmd.hp <= 0) this.finish('draw');
    else if (leftCmd.hp <= 0) this.finish('right_win');
    else if (rightCmd.hp <= 0) this.finish('left_win');
  }

  finish(reason) {
    this.finished = true; this.phase = 'finished';
    this.log("=== 戦闘終了 ===");
    if (reason === 'draw') this.log('引き分け！');
    if (reason === 'left_win') this.log('自軍（Left）の勝利！');
    if (reason === 'right_win') this.log('敵軍（Right）の勝利！');
  }
}

// ==========================================
// UI & VIEWER SYSTEM
// ==========================================
function renderTeams() {
  ['left', 'right'].forEach(side => {
    const el = document.getElementById(`${side}Slots`);
    el.innerHTML = app.teams[side].map((slot, i) => `
      <div class="slot">
        <label>${POSITIONS[i]}</label>
        <select onchange="updateSlot('${side}', ${i}, 'id', this.value)">
          <option value="">英傑選択</option>
          ${app.heroes.map(h => `<option value="${h.id}" ${slot.id===h.id?'selected':''}>${h.name}</option>`).join('')}
        </select>
        <input type="number" value="${slot.troops}" onchange="updateSlot('${side}', ${i}, 'troops', this.value)" placeholder="兵力">
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
  if (field === 'id') slot.id = value;
  if (field === 'troops') slot.troops = num(value, 10000);
  if (field === 'sub1') slot.subSkills[0] = value;
  if (field === 'sub2') slot.subSkills[1] = value;
  localStorage.setItem(STORE.teams, JSON.stringify(app.teams));
  renderAll();
}

// 【新設】ビューアの初期化と更新
function initViewers() {
  const hSelect = document.getElementById('heroViewerSelect');
  const sSelect = document.getElementById('skillViewerSelect');

  // プルダウンを満たす
  hSelect.innerHTML = '<option value="">英傑を選択</option>' + app.heroes.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
  sSelect.innerHTML = '<option value="">スキルを選択</option>' + app.skills.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  // 変更イベント
  hSelect.onchange = () => {
    const hero = getHero(hSelect.value);
    const detail = document.getElementById('heroViewerDetail');
    if (!hero) { detail.textContent = '英傑を選択してください。'; return; }
    
    const s = hero.stats;
    const unique = getSkill(hero.unique);
    detail.textContent = `Name: ${hero.name}\nType: ${hero.unitType || 'infantry'}\nATK: ${s.atk} DEF: ${s.def} INT: ${s.int} AGI: ${s.agi} RNG: ${s.rng}\n\nUnique Skill: ${unique ? unique.name : 'None'}\nDescription: ${unique ? unique.detail || '(No detail)' : ''}`;
  };

  sSelect.onchange = () => {
    const skill = getSkill(sSelect.value);
    const detail = document.getElementById('skillViewerDetail');
    if (!skill) { detail.textContent = 'スキルを選択してください。'; return; }
    
    detail.textContent = `Name: ${skill.name}\nType: ${skill.trigger}\nChance: ${skill.chance || 100}%\nRange: ${skill.range || 0}\n\nDescription: ${skill.detail || '(No detail)'}`;
  };
}

function renderLog() {
  const b = app.battle;
  if (!b) { setLog('準備完了。英傑を配置して「戦闘開始」を押してください。'); return; }
  const turn = b.viewTurn;
  document.getElementById('currentTurnLabel').textContent = `Turn ${turn}`;
  setLog((b.logsByTurn[turn] || []).join('\n'));
}

function renderAll() {
  renderTeams();
  const b = app.battle;
  document.getElementById('turnBadge').textContent = `Turn ${b ? b.turn : 0}`;
  document.getElementById('phaseBadge').textContent = `Phase: ${b ? b.phase : '-'}`;
  document.getElementById('stateBadge').textContent = b ? (b.finished ? '終了' : '進行中') : '待機中';
  renderLog();
}

function loadState() {
  try { app.heroes = JSON.parse(localStorage.getItem(STORE.heroes)) || DEFAULT_HEROES; } catch { app.heroes = DEFAULT_HEROES; }
  try { app.skills = JSON.parse(localStorage.getItem(STORE.skills)) || DEFAULT_SKILLS; } catch { app.skills = DEFAULT_SKILLS; }
  try { app.teams = JSON.parse(localStorage.getItem(STORE.teams)) || DEFAULT_TEAMS; } catch { app.teams = DEFAULT_TEAMS; }

  document.getElementById('heroesJson').value = JSON.stringify(app.heroes, null, 2);
  document.getElementById('skillsJson').value = JSON.stringify(app.skills, null, 2);
}

// --- 初期化 ---
window.onload = () => {
  loadState();
  renderAll();
  initViewers();

  // ボタンイベント
  document.getElementById('btnStart').onclick = () => {
    try {
      app.battle = new BattleEngine(clone(app.teams));
      app.battle.nextChunk();
      renderAll();
    } catch (err) { alert(`開始エラー: ${err.message}`); }
  };
  document.getElementById('btnNext').onclick = () => { if(app.battle) { app.battle.nextChunk(); renderAll(); } };
  document.getElementById('btnPrevTurn').onclick = () => { if(app.battle && app.battle.viewTurn > 0) { app.battle.viewTurn--; renderLog(); } };
  document.getElementById('btnNextTurn').onclick = () => { if(app.battle && app.battle.viewTurn < app.battle.turn) { app.battle.viewTurn++; renderLog(); } };
  document.getElementById('btnSaveHeroes').onclick = () => { app.heroes = JSON.parse(document.getElementById('heroesJson').value); localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes)); initViewers(); alert('英傑保存しました'); };
  document.getElementById('btnSaveSkills').onclick = () => { app.skills = JSON.parse(document.getElementById('skillsJson').value); localStorage.setItem(STORE.skills, JSON.stringify(app.skills)); initViewers(); alert('スキル保存しました'); };
};
