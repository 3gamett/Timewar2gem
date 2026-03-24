const STORE = { 
    heroes: 'tw.uni.heroes.v18', 
    skills: 'tw.uni.skills.v18', 
    teams: 'tw.uni.teams.v18' 
};

let app = { heroes: [], skills: [], teams: null, battle: null, autoInterval: null, currentSelectingSlot: null };

window.addEventListener('error', (e) => {
    console.error(e);
    addHtmlLog(`<div class="log-error">[システムエラー] ${e.message}</div>`);
});

// --- Unitクラス ---
class Unit {
    constructor(heroData, teamData, side, posIdx) {
        this.uid = `${side}_${posIdx}`;
        this.id = heroData.id;
        this.name = heroData.name;
        this.side = side;
        this.posIdx = posIdx; 
        this.posLabel = ['指揮官', '中軍', '前衛'][posIdx];
        this.maxHp = Number(teamData.troops) || 10000;
        this.hp = this.maxHp;
        this.baseStats = heroData.stats || { atk: 100, def: 100, int: 100, agi: 100, rng: 3 };
        this.troopType = heroData.troopType || 'infantry'; 
        this.uniqueSkillId = heroData.unique;
        this.subSkillIds = (teamData.subSkills || []).slice(0, 2);
        
        this.buffs = [];
        
        // --- 追加: デバフ解除や特殊状態の管理 ---
        this.states = {
            isDead: false,
            disoriented: false, 
            silenced: false,    
            exhausted: false,   
            healBlocked: false, 
            firstStrike: false, 
            doubleAttack: false,
            ignoreEvasion: false,
            invincible: false,  // 無敵（制御効果・ダメージ無効化など）
        };

        // --- 追加: スキルごとの発動回数や蓄積のカウンター ---
        this.customCounters = {}; 
        
        // --- 追加: HP閾値イベントの発生済みフラグ管理 ---
        this.hpThresholdsTriggered = new Set();
    }

    get isAlive() {
        return this.hp > 0 && !this.states.isDead;
    }

    get wounded() {
        return this.maxHp - this.hp;
    }

    getStat(statName) {
        let val = this.baseStats[statName] || 0;
        // バフからのステータス増減を反映する処理（簡易版）
        const statBuffs = this._getBuffSum(`${statName}_bonus`);
        const statMultipliers = this._getBuffSum(`${statName}_multiplier`);
        return (val + statBuffs) * (1 + statMultipliers);
    }

    _getBuffSum(key) {
        return this.buffs.filter(b => b[key]).reduce((sum, b) => sum + b[key], 0);
    }

    // --- 追加: バフ付与メソッド（スタック上限の管理） ---
    addBuff(buff) {
        const existingBuffs = this.buffs.filter(b => b.id === buff.id);
        const maxStacks = buff.maxStacks || 1; // デフォルトは重複不可(1)

        if (existingBuffs.length >= maxStacks) {
            // スタック上限に達している場合は、最も古いものを削除して新しいものを入れる
            const oldestIndex = this.buffs.findIndex(b => b.id === buff.id);
            if(oldestIndex !== -1) {
                this.buffs.splice(oldestIndex, 1);
            }
        }
        this.buffs.push(buff);
    }

    // --- 追加: イベントフックの発火 ---
    triggerHook(eventName, context) {
        if (!app.battle) return;
        app.battle.handleEventHook(this, eventName, context);
    }

    // --- 改修: 被ダメージ処理の拡張（クリティカル、回避、スプラッシュ、HP閾値、反撃フック） ---
    takeDamage(amount, sourceUnit, dmgType, context = {}) {
        if (this.states.isDead) return 0;
        if (sourceUnit && sourceUnit.states.exhausted) return 0;
        
        // 無敵状態の判定
        if (this.states.invincible && context.isControlEffect) return 0;

        let finalDamage = amount;

        // 回避の判定 (sourceUnitが回避無視を持っていなければ)
        const evasionRate = this._getBuffSum('evasion_rate'); 
        if (evasionRate > 0 && !(sourceUnit && sourceUnit.states.ignoreEvasion)) {
            if (Math.random() < evasionRate) {
                app.battle.log(`${this.name} は攻撃を回避した！`);
                return 0;
            }
        }

        // クリティカルの判定
        if (sourceUnit) {
            const critRate = sourceUnit._getBuffSum(`${dmgType}_crit_rate`);
            if (Math.random() < critRate) {
                finalDamage *= 1.5; // クリティカルダメージ倍率（1.5倍）
                app.battle.log(`【クリティカル】${sourceUnit.name} の攻撃が急所に命中！`);
            }
        }

        const actualDamage = Math.min(this.hp, Math.floor(finalDamage));
        this.hp -= actualDamage;

        if (this.hp <= 0) {
            this.hp = 0;
            this.states.isDead = true;
            app.battle.log(`💀 ${this.name} は撤退した。`);
        }

        // HP閾値のチェック（例: 70%）
        const hpRatio = this.hp / this.maxHp;
        if (hpRatio <= 0.70 && !this.hpThresholdsTriggered.has('70_percent')) {
            this.hpThresholdsTriggered.add('70_percent');
            this.triggerHook('on_hp_threshold_crossed', { threshold: 70 });
        }

        // 被ダメージ時フック（ゼノビア「パルメラの抵抗」などの発動トリガー）
        this.triggerHook('on_damage_taken', { sourceUnit, amount: actualDamage, dmgType });

        // スプラッシュダメージの処理（波及効果）
        if (sourceUnit && !context.isSplash) {
            const splashRate = sourceUnit._getBuffSum('splash_rate');
            if (splashRate > 0) {
                app.battle.applySplashDamage(this, actualDamage * splashRate, sourceUnit, dmgType);
            }
        }

        return actualDamage;
    }

    heal(amount) {
        if (this.states.isDead || this.states.healBlocked) return 0;
        const actualHeal = Math.min(this.maxHp - this.hp, Math.floor(amount));
        this.hp += actualHeal;
        return actualHeal;
    }
}

// --- Battleクラス ---
class Battle {
    constructor(teams) {
        this.turn = 0;
        this.maxTurn = 8;
        this.logs = [];
        this.units = [];
        this.isFinished = false;

        ['left', 'right'].forEach(side => {
            teams[side].forEach((t, i) => {
                const heroData = app.heroes.find(h => h.id === t.id);
                if (heroData) {
                    this.units.push(new Unit(heroData, t, side, i));
                }
            });
        });
    }

    log(msg) {
        this.logs.push(`[Turn ${this.turn}] ${msg}`);
        addHtmlLog(`<div>[Turn ${this.turn}] ${msg}</div>`);
    }

    handleEventHook(unit, eventName, context) {
        // パッシブスキルなどで特定のトリガーに反応するロジックをここに集約
        // 例: unitが持っているスキル群の中に、eventNameに反応するものがあれば実行
        unit.buffs.forEach(buff => {
            if (buff.trigger === eventName) {
                this.executeEffect(unit, buff.effect, [context.sourceUnit], {}); 
            }
        });
    }

    applySplashDamage(targetUnit, splashAmount, sourceUnit, dmgType) {
        // 同じ陣営の隣接ユニットを検索してスプラッシュダメージを与える
        const allies = this.units.filter(u => u.side === targetUnit.side && u.isAlive && u.uid !== targetUnit.uid);
        if(allies.length > 0) {
            this.log(`${sourceUnit.name} の攻撃が波及（スプラッシュ）！`);
            allies.forEach(ally => {
                ally.takeDamage(splashAmount, sourceUnit, dmgType, { isSplash: true });
            });
        }
    }

    nextTurn() {
        if (this.isFinished) return;
        this.turn++;
        if (this.turn > this.maxTurn) {
            this.finishBattle('引き分け（時間切れ）');
            return;
        }
        
        this.log(`=== ターン ${this.turn} 開始 ===`);
        
        // ターン開始処理、バフの持続ターン消費など
        this.units.forEach(u => {
            if(!u.isAlive) return;
            // 状態異常の解除などの前処理
            u.buffs = u.buffs.filter(b => {
                if (b.duration !== undefined) {
                    b.duration--;
                    return b.duration > 0;
                }
                return true;
            });
        });

        // 行動順（AGI順）
        const actionQueue = [...this.units].filter(u => u.isAlive).sort((a, b) => b.getStat('agi') - a.getStat('agi'));

        actionQueue.forEach(actor => {
            if (!actor.isAlive) return;
            this.processUnitAction(actor);
        });

        this.checkWinCondition();
    }

    processUnitAction(actor) {
        if (actor.states.disoriented) {
            this.log(`${actor.name} は混乱しており行動できない！`);
            return;
        }

        // 通常攻撃とスキルの実行ロジック
        // メインスキル
        if (actor.uniqueSkillId) {
            const skillData = app.skills.find(s => s.id === actor.uniqueSkillId);
            if (skillData) this.tryExecuteSkill(actor, skillData);
        }

        // サブスキル
        actor.subSkillIds.forEach(skillId => {
            const skillData = app.skills.find(s => s.id === skillId);
            if (skillData) this.tryExecuteSkill(actor, skillData);
        });

        // 通常攻撃
        this.executeBasicAttack(actor);
    }

    // --- 改修: スキル発動のフックと、パイプラインコンテキスト ---
    tryExecuteSkill(caster, skill) {
        // 1. スキル発動「試み」のフック（リンカーン「自由の宣言」など）
        caster.triggerHook('on_skill_try', { skill });

        if (caster.states.silenced && skill.type === 'active') {
            this.log(`${caster.name} は沈黙しておりアクティブスキルを発動できない！`);
            return false;
        }

        const procRate = skill.procRate || 100;
        const isSuccess = (Math.random() * 100) <= procRate;

        if (isSuccess) {
            this.log(`【スキル発動】${caster.name} が [${skill.name}] を発動！`);
            
            // 2. スキル発動「成功」のフック（ダーウィン「進化論」など）
            caster.triggerHook('on_skill_success', { skill });
            
            // パイプライン用コンテキスト（与えた合計ダメージ量を記憶し、吸収回復などに使う）
            let effectContext = {
                totalDamageDealt: 0
            };

            const targets = this.getTargets(caster, skill, this.units);

            if (skill.effects) {
                skill.effects.forEach(effect => {
                    this.executeEffect(caster, effect, targets, effectContext);
                });
            }

            // 攻撃ごとのカスタムカウンター（風魔小太郎など）
            if (skill.type === 'damage') { // 暫定
                caster.customCounters['damage_times'] = (caster.customCounters['damage_times'] || 0) + 1;
                if (caster.customCounters['damage_times'] >= 4) {
                    caster.triggerHook('on_counter_reach_4', { type: 'damage_times' });
                    caster.customCounters['damage_times'] = 0; // リセット
                }
            }
            return true;
        }
        return false;
    }

    executeBasicAttack(actor) {
        if (actor.states.exhausted) {
            this.log(`${actor.name} は疲弊しており通常攻撃できない！`);
            return;
        }
        
        const targets = this.getTargets(actor, { targetSide: 'enemy', targetCount: 1, targetLogic: 'frontline' }, this.units);
        if (targets.length > 0) {
            const target = targets[0];
            const dmg = actor.getStat('atk') * 1.5; // 基本攻撃計算式（仮）
            const dealt = target.takeDamage(dmg, actor, 'atk');
            this.log(`${actor.name} の通常攻撃 -> ${target.name} に ${dealt} のダメージ`);
            
            actor.triggerHook('on_basic_attack_success', { target });
            
            // 連撃（Double Attack）の処理
            if (actor.states.doubleAttack && !actor.customCounters['has_double_attacked']) {
                actor.customCounters['has_double_attacked'] = true;
                this.log(`${actor.name} の連撃が発生！`);
                this.executeBasicAttack(actor);
            } else {
                actor.customCounters['has_double_attacked'] = false;
            }
        }
    }

    // --- 改修: ターゲティングロジックの拡張（最低INTなどを狙う） ---
    getTargets(caster, logicDef, allUnits) {
        let validTargets = allUnits.filter(u => u.isAlive);
        
        if (logicDef.targetSide === 'enemy') validTargets = validTargets.filter(u => u.side !== caster.side);
        if (logicDef.targetSide === 'ally') validTargets = validTargets.filter(u => u.side === caster.side);

        // ソート・抽出ロジック
        if (logicDef.targetLogic === 'lowest_int') {
            validTargets.sort((a, b) => a.getStat('int') - b.getStat('int'));
        } else if (logicDef.targetLogic === 'highest_atk') {
            validTargets.sort((a, b) => b.getStat('atk') - a.getStat('atk'));
        } else if (logicDef.targetLogic === 'most_wounded') {
            validTargets.sort((a, b) => b.wounded - a.wounded);
        } else if (logicDef.targetLogic === 'frontline') {
            // 前衛から順に狙うロジック
            validTargets.sort((a, b) => b.posIdx - a.posIdx);
        } else {
            // デフォルトはランダム
            validTargets = validTargets.sort(() => Math.random() - 0.5);
        }

        return validTargets.slice(0, logicDef.targetCount || 1);
    }

    // --- 改修: エフェクト処理（差分ダメージ、動的割合回復、クレンズ、ランダム抽選） ---
    executeEffect(caster, effect, targets, context) {
        // 1. 配列からのランダム抽選（ダーウィン「進化論」対応）
        if (effect.type === 'random_selection') {
            const numToSelect = effect.selectCount || 1; 
            const shuffledOptions = [...effect.options].sort(() => Math.random() - 0.5);
            const selectedEffects = shuffledOptions.slice(0, numToSelect);
            selectedEffects.forEach(subEffect => this.executeEffect(caster, subEffect, targets, context));
            return;
        }

        targets.forEach(target => {
            // 2. デバフ解除（クレンズ）
            if (effect.type === 'remove_debuff') {
                const initialCount = target.buffs.length;
                target.buffs = target.buffs.filter(b => b.isGood); // isGoodフラグがない悪性バフを削除
                const removed = initialCount - target.buffs.length;
                if(removed > 0) this.log(`${target.name} のデバフが ${removed} つ解除された！`);
                return;
            }

            // 3. ダメージ処理（ステータス差分ボーナス）
            if (effect.type === 'damage') {
                let baseDamage = (caster.getStat(effect.dmgType) * (effect.rate / 100)) - (target.getStat('def') * 0.5);
                if (baseDamage < 1) baseDamage = 1;
                
                // ステータス差分によるボーナス（明智光秀など）
                if (effect.diffStatBonus) {
                    const statDiff = Math.max(0, caster.getStat(effect.diffStatBonus) - target.getStat(effect.diffStatBonus));
                    const bonusMultiplier = 1.0 + (statDiff * 0.01); // 差分1につき1%アップなどのルール
                    baseDamage *= bonusMultiplier;
                }

                const dealt = target.takeDamage(baseDamage, caster, effect.dmgType, effect);
                context.totalDamageDealt += dealt; // コンテキストに記録
                this.log(`${target.name} に ${dealt} のダメージ！`);
            }

            // 4. 回復処理（与えたダメージ量に基づく動的数値の参照、捕虜・離間など）
            if (effect.type === 'heal') {
                let healAmount = 0;
                if (effect.basedOnDamage) {
                    healAmount = context.totalDamageDealt * (effect.rate / 100);
                } else {
                    healAmount = (caster.getStat('int') * (effect.rate / 100)); // 基本回復式（仮）
                }
                const actualHeal = target.heal(healAmount);
                this.log(`${target.name} が ${actualHeal} 回復した。`);
            }
            
            // 通常のバフ・デバフ付与
            if (effect.type === 'add_buff') {
                target.addBuff({ ...effect.buffData, duration: effect.duration });
                this.log(`${target.name} に [${effect.buffData.name}] が付与された。`);
            }
            
            // 状態異常の直接付与
            if (effect.type === 'apply_state') {
                target.states[effect.stateName] = true;
                this.log(`${target.name} は [${effect.stateName}] 状態になった！`);
            }
        });
    }

    checkWinCondition() {
        const leftAlive = this.units.filter(u => u.side === 'left' && u.isAlive);
        const rightAlive = this.units.filter(u => u.side === 'right' && u.isAlive);

        const leftCommanderDead = !this.units.find(u => u.side === 'left' && u.posIdx === 0).isAlive;
        const rightCommanderDead = !this.units.find(u => u.side === 'right' && u.posIdx === 0).isAlive;

        if (leftCommanderDead && rightCommanderDead) {
            this.finishBattle('引き分け（両軍指揮官撤退）');
        } else if (leftCommanderDead || leftAlive.length === 0) {
            this.finishBattle('右軍（敵軍）の勝利！');
        } else if (rightCommanderDead || rightAlive.length === 0) {
            this.finishBattle('左軍（自軍）の勝利！');
        }
    }

    finishBattle(resultStr) {
        this.isFinished = true;
        this.log(`【戦闘終了】 ${resultStr}`);
        
        // 残存兵力のレポート表示
        this.log(`--- 最終兵力レポート ---`);
        ['left', 'right'].forEach(side => {
            const sideName = side === 'left' ? '自軍' : '敵軍';
            this.units.filter(u => u.side === side).forEach(u => {
                this.log(`[${sideName}] ${u.name} (${u.posLabel}): 残存 ${u.hp} / 負傷 ${u.wounded}`);
            });
        });

        if (app.autoInterval) clearInterval(app.autoInterval);
    }
}

// --- 初期化・UIイベントバインディング ---

function loadData() {
    try {
        app.heroes = JSON.parse(localStorage.getItem(STORE.heroes)) || [];
        app.skills = JSON.parse(localStorage.getItem(STORE.skills)) || [];
        app.teams = JSON.parse(localStorage.getItem(STORE.teams)) || {
            left: [{}, {}, {}],
            right: [{}, {}, {}]
        };
        renderTeams();
        renderJSONEditors();
        renderViewers();
    } catch (e) {
        console.error("データの読み込みに失敗しました:", e);
    }
}

function saveData() {
    localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
    localStorage.setItem(STORE.skills, JSON.stringify(app.skills));
    localStorage.setItem(STORE.teams, JSON.stringify(app.teams));
}

function renderTeams() {
    ['left', 'right'].forEach(side => {
        const container = document.getElementById(`${side}Slots`);
        if(!container) return;
        container.innerHTML = app.teams[side].map((t, i) => {
            const h = app.heroes.find(x => x.id === t.id);
            const name = h ? h.name : '未配置';
            return `<div class="unit-slot" onclick="openHeroModal('${side}', ${i})"><div class="unit-name">${['指揮官','中軍','前衛'][i]}: ${name}</div></div>`;
        }).join('');
    });
}

function renderJSONEditors() {
    const hJson = document.getElementById('heroesJson');
    const sJson = document.getElementById('skillsJson');
    if (hJson) hJson.value = JSON.stringify(app.heroes, null, 2);
    if (sJson) sJson.value = JSON.stringify(app.skills, null, 2);
}

function renderViewers() {
    // データ確認用のプルダウンを生成
    const hSelect = document.getElementById('heroViewerSelect');
    if (hSelect) {
        hSelect.innerHTML = '<option value="">-- 英傑を選択 --</option>' + app.heroes.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
    }
    const sSelect = document.getElementById('skillViewerSelect');
    if (sSelect) {
        sSelect.innerHTML = '<option value="">-- スキルを選択 --</option>' + app.skills.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }
}

function addHtmlLog(html) {
    const log = document.getElementById('logContent');
    if(!log) {
        // UIが存在しない場合のフォールバック（ログコンテナ自動生成など）
        const panel = document.querySelector('.log-panel');
        if(panel) {
            const logDiv = document.createElement('div');
            logDiv.id = 'logContent';
            logDiv.style.flex = '1';
            logDiv.style.overflowY = 'auto';
            panel.appendChild(logDiv);
            logDiv.innerHTML += html;
        }
        return;
    }
    const div = document.createElement('div');
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

function updateStatusView() {
    if(!app.battle) return;
    const badge = document.getElementById('turnBadge');
    if(badge) badge.textContent = `Turn ${app.battle.turn}`;
}

// UIグローバル関数
window.openHeroModal = (side, idx) => {
    app.currentSelectingSlot = { side, idx };
    const grid = document.getElementById('heroGrid');
    if(grid) grid.innerHTML = app.heroes.map(h => `<div class="hero-item" onclick="selectHero('${h.id}')">${h.name}</div>`).join('');
    const modal = document.getElementById('heroModal');
    if(modal) modal.style.display = 'block';
};

window.selectHero = id => {
    const { side, idx } = app.currentSelectingSlot;
    app.teams[side][idx] = { id: id, troops: 10000, subSkills: [] };
    saveData();
    renderTeams();
    document.getElementById('heroModal').style.display = 'none';
};

window.closeHeroModal = () => {
    document.getElementById('heroModal').style.display = 'none';
};

// イベントリスナーの登録
document.addEventListener('DOMContentLoaded', () => {
    loadData();

    document.getElementById('btnStart')?.addEventListener('click', () => {
        document.getElementById('logContent')?.replaceChildren();
        app.battle = new Battle(app.teams);
        updateStatusView();
        app.battle.log('戦闘が初期化されました。');
    });

    document.getElementById('btnNext')?.addEventListener('click', () => {
        if(app.battle && !app.battle.isFinished) {
            app.battle.nextTurn();
            updateStatusView();
        }
    });

    document.getElementById('btnAuto')?.addEventListener('click', () => {
        if(!app.battle || app.battle.isFinished) return;
        if(app.autoInterval) clearInterval(app.autoInterval);
        app.autoInterval = setInterval(() => {
            if (app.battle.isFinished) {
                clearInterval(app.autoInterval);
            } else {
                app.battle.nextTurn();
                updateStatusView();
            }
        }, 1000);
    });

    document.getElementById('btnStop')?.addEventListener('click', () => {
        if(app.autoInterval) {
            clearInterval(app.autoInterval);
            app.autoInterval = null;
        }
    });

    document.getElementById('btnSaveHeroes')?.addEventListener('click', () => {
        try {
            app.heroes = JSON.parse(document.getElementById('heroesJson').value);
            saveData();
            renderTeams();
            renderViewers();
            alert('英傑データを保存しました。');
        } catch(e) { alert('JSONフォーマットエラー'); }
    });

    document.getElementById('btnSaveSkills')?.addEventListener('click', () => {
        try {
            app.skills = JSON.parse(document.getElementById('skillsJson').value);
            saveData();
            renderViewers();
            alert('スキルデータを保存しました。');
        } catch(e) { alert('JSONフォーマットエラー'); }
    });

    document.getElementById('heroViewerSelect')?.addEventListener('change', (e) => {
        const h = app.heroes.find(x => x.id === e.target.value);
        document.getElementById('heroViewerDetail').innerHTML = h ? `<pre>${JSON.stringify(h, null, 2)}</pre>` : '';
    });

    document.getElementById('skillViewerSelect')?.addEventListener('change', (e) => {
        const s = app.skills.find(x => x.id === e.target.value);
        document.getElementById('skillViewerDetail').innerHTML = s ? `<pre>${JSON.stringify(s, null, 2)}</pre>` : '';
    });
});
