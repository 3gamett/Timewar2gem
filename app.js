const STORE = { 
    heroes: 'tw.uni.heroes.v9', 
    skills: 'tw.uni.skills.v9', 
    teams: 'tw.uni.teams.v9' 
};

let app = { 
    heroes: [], 
    skills: [], 
    teams: null, 
    battle: null, 
    autoInterval: null, 
    currentSelectingSlot: null 
};

// --- Unitクラス (メソッド不足によるエラーを修正) ---
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
        
        this.uniqueSkillId = heroData.unique;
        this.subSkillIds = (teamData.subSkills || []).slice(0, 2);
        
        this.buffs = [];
        this.statuses = [];
        this.customState = { pounce: 1 }; // 通常攻撃回数
    }

    isAlive() { return this.hp > 0; }

    // 属性値の増幅 (Rule 15)
    getScaledStat(statName) {
        let base = Number(this.baseStats[statName]) || 0;
        let flatMod = this.buffs.filter(b => b.stat === statName).reduce((sum, b) => sum + b.value, 0);
        let value = base + flatMod;
        let scale = 1 + (Math.floor(value / 50) * 0.1);
        return { value, scale };
    }

    getCurrentStat(statName) {
        return this.getScaledStat(statName).value;
    }
}

// --- 戦闘エンジンコア ---
class BattleEngine {
    constructor(teams) {
        this.turn = 0;
        this.viewTurn = 0;
        this.phase = 'opening';
        this.logsByTurn = { 0: [] };
        this.finished = false;
        this.hooks = [];

        this.units = [
            ...teams.left.map((t, i) => this.createUnit(t, 'left', i)),
            ...teams.right.map((t, i) => this.createUnit(t, 'right', i))
        ].filter(Boolean);

        this.registerSkills();
    }

    createUnit(slot, side, idx) {
        const h = app.heroes.find(h => h.id === slot.id);
        return h ? new Unit(h, slot, side, idx) : null;
    }

    log(msg) {
        if (!this.logsByTurn[this.viewTurn]) this.logsByTurn[this.viewTurn] = [];
        this.logsByTurn[this.viewTurn].push(msg);
        if (this.viewTurn === this.turn) addHtmlLog(msg);
    }

    // スキルとフックの登録
    registerSkills() {
        this.units.forEach(u => {
            const skillIds = [u.uniqueSkillId, ...u.subSkillIds].filter(Boolean);
            skillIds.forEach(id => {
                const s = app.skills.find(x => x.id === id);
                if (!s) return;
                
                // 開戦時スキル (Engage / Passive)
                if (s.trigger === 'engage' || s.trigger === 'passive') {
                    this.executeEffects(u, s.effects, { skillName: s.name });
                }
                
                // フックの登録 (リンカーン等の反応型スキル)
                if (s.effects) {
                    s.effects.forEach(eff => {
                        if (eff.type === 'register_hook') {
                            this.hooks.push({
                                event: eff.hookEvent,
                                chance: eff.hookChance || 100,
                                effects: eff.hookEffects,
                                owner: u,
                                skillName: s.name
                            });
                        }
                    });
                }
            });
        });
    }

    emit(eventName, context = {}) {
        this.hooks.filter(h => h.event === eventName).forEach(h => {
            if (!h.owner.isAlive()) return;
            if (Math.random() * 100 < h.chance) {
                this.executeEffects(h.owner, h.effects, { ...context, skillName: h.skillName });
            }
        });
    }

    nextChunk() {
        if (this.finished) return;

        if (this.phase === 'opening') {
            this.log(`<div class="log-turn-start">=== 戦闘開始 ===</div>`);
            this.emit('onBattleStart');
            this.checkDeaths();
            this.turn = 1; this.viewTurn = 1; this.phase = 'action_start';
        } else if (this.phase === 'action_start') {
            this.log(`<div class="log-turn-start">--- Turn ${this.turn} ---</div>`);
            this.turnOrder = this.units.filter(u => u.isAlive()).sort((a, b) => b.getCurrentStat('agi') - a.getCurrentStat('agi'));
            this.turnIdx = 0;
            this.phase = 'action';
            this.nextChunk(); // 即座に一人目の行動へ
        } else if (this.phase === 'action') {
            if (this.turnIdx < this.turnOrder.length) {
                const actor = this.turnOrder[this.turnIdx++];
                if (actor.isAlive()) this.unitAction(actor);
            } else {
                this.turn++; this.viewTurn = this.turn;
                if (this.turn > 8) {
                    this.finish("8ターン経過による引き分け");
                } else {
                    this.phase = 'action_start';
                }
            }
        }
        updateStatusDisplay();
    }

    unitAction(u) {
        this.log(`▼ [行動] ${u.side==='left'?'自':'敵'} <b>${u.name}</b>`);
        
        // 1. アクティブスキルの抽選
        const actives = [u.uniqueSkillId, ...u.subSkillIds]
            .map(id => app.skills.find(s => s.id === id))
            .filter(s => s && (s.trigger === 'active' || s.trigger === 'action'));

        actives.forEach(s => {
            this.emit('onSkillAttempt', { actor: u, skill: s });
            if (Math.random() * 100 < (s.chance || 0)) {
                this.log(` ★ <span class="log-skill">[${s.name}]</span> 発動！`);
                this.executeEffects(u, s.effects, { skillName: s.name });
            }
        });

        // 2. 通常攻撃 (確実に実行)
        const target = this.selectTargets(u, 'randomEnemy', 1)[0];
        if (target) {
            for (let i = 0; i < (u.customState.pounce || 1); i++) {
                const dmg = this.calcDamage(u, target, 1.0, 'atk');
                this.applyDamage(u, target, dmg, '通常攻撃');
                this.emit('onNormalAttack', { actor: u, target: target });
            }
        }
        this.checkDeaths();
    }

    executeEffects(caster, effects, context) {
        if (!effects) return;
        effects.forEach(eff => {
            const targets = this.selectTargets(caster, eff.target, eff.count || 1);
            targets.forEach(t => {
                if (eff.type === 'damage') {
                    const dmg = this.calcDamage(caster, t, eff.rate || 1.0, eff.basis || 'atk');
                    this.applyDamage(caster, t, dmg, context.skillName);
                } else if (eff.type === 'heal') {
                    const heal = Math.round(caster.getCurrentStat('int') * (eff.rate || 1.0));
                    t.hp = Math.min(t.maxHp, t.hp + heal);
                    this.log(`  + ${t.name} が <span class="log-heal">${heal} 回復</span> (${context.skillName})`);
                } else if (eff.type === 'buff' || eff.type === 'debuff') {
                    t.buffs.push({ stat: eff.stat, value: eff.value, duration: eff.duration });
                    this.log(`  * ${t.name} の ${eff.stat} が ${eff.value} 変化`);
                } else if (eff.type === 'pounce_get') {
                    caster.customState.pounce = (caster.customState.pounce || 1) + eff.value;
                }
            });
        });
    }

    selectTargets(caster, type, count) {
        const enemies = this.units.filter(u => u.side !== caster.side && u.isAlive());
        const allies = this.units.filter(u => u.side === caster.side && u.isAlive());
        // JSONの enemyRandom 等を吸収
        if (type === 'enemyRandom' || type === 'randomEnemy') return enemies.sort(() => 0.5 - Math.random()).slice(0, count);
        if (type === 'self') return [caster];
        if (type === 'allies') return allies.slice(0, count);
        return enemies.slice(0, count);
    }

    calcDamage(attacker, target, rate, basis) {
        const atkVal = attacker.getCurrentStat(basis);
        const defVal = target.getCurrentStat('def');
        const base = (atkVal - defVal) * 1.5 + (attacker.hp / 100);
        return Math.max(1, Math.round(base * rate * (0.9 + Math.random() * 0.2)));
    }

    applyDamage(attacker, target, dmg, label) {
        target.hp -= dmg;
        this.log(`  -> ${target.name} に <span class="log-damage">${dmg} ダメージ</span> (${label})`);
    }

    checkDeaths() {
        if (this.units.find(u => u.posIdx === 0 && u.side === 'left' && u.hp <= 0)) this.finish("敵軍の勝利！");
        if (this.units.find(u => u.posIdx === 0 && u.side === 'right' && u.hp <= 0)) this.finish("自軍の勝利！");
    }

    finish(msg) {
        this.finished = true;
        this.log(`<div class="log-turn-start">=== ${msg} ===</div>`);
    }
}

// --- UI / イベント ---
function addHtmlLog(html) {
    const content = document.getElementById('logContent');
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = html;
    content.appendChild(div);
    document.getElementById('logArea').scrollTop = 99999;
}

function updateStatusDisplay() {
    if (!app.battle) return;
    document.getElementById('turnBadge').textContent = `Turn ${app.battle.turn}`;
    document.getElementById('stateBadge').textContent = app.battle.finished ? '終了' : '進行中';
}

// 【修正】コピー・消去ボタンの動作
function setupLogButtons() {
    document.getElementById('btnClearLog').onclick = () => {
        document.getElementById('logContent').innerHTML = '';
        if(app.battle) app.battle.logsByTurn = {};
    };
    document.getElementById('btnCopyLog').onclick = () => {
        const text = document.getElementById('logContent').innerText;
        navigator.clipboard.writeText(text).then(() => alert("ログをコピーしました"));
    };
}

async function loadData(force = false) {
    const localH = localStorage.getItem(STORE.heroes);
    const localS = localStorage.getItem(STORE.skills);
    if (force || !localH || !localS) {
        const [h, s] = await Promise.all([
            fetch('heroes_all.json').then(r => r.json()),
            fetch('skills_all.json').then(r => r.json())
        ]);
        app.heroes = h; app.skills = s;
        localStorage.setItem(STORE.heroes, JSON.stringify(h));
        localStorage.setItem(STORE.skills, JSON.stringify(s));
    } else {
        app.heroes = JSON.parse(localH);
        app.skills = JSON.parse(localS);
    }
    app.teams = JSON.parse(localStorage.getItem(STORE.teams)) || {
        left: Array(3).fill({id:"", troops:10000, subSkills:["",""]}),
        right: Array(3).fill({id:"", troops:10000, subSkills:["",""]})
    };
    renderTeams(); initViewers();
}

function renderTeams() {
    ['left', 'right'].forEach(side => {
        document.getElementById(`${side}Slots`).innerHTML = app.teams[side].map((slot, i) => {
            const h = app.heroes.find(x => x.id === slot.id);
            return `<div class="slot">
                <label>${['指揮官','中軍','前衛'][i]}</label>
                <div class="select-trigger ${h?'has-hero':''}" onclick="openHeroModal('${side}',${i})">${h?h.name:'英傑を選択'}</div>
                <input type="number" value="${slot.troops}" onchange="updateSlot('${side}',${i},'troops',this.value)">
                <div class="input-row">
                    <select onchange="updateSlot('${side}',${i},'sub1',this.value)">
                        <option value="">スキル1</option>
                        ${app.skills.map(s=>`<option value="${s.id}" ${slot.subSkills[0]===s.id?'selected':''}>${s.name}</option>`).join('')}
                    </select>
                    <select onchange="updateSlot('${side}',${i},'sub2',this.value)">
                        <option value="">スキル2</option>
                        ${app.skills.map(s=>`<option value="${s.id}" ${slot.subSkills[1]===s.id?'selected':''}>${s.name}</option>`).join('')}
                    </select>
                </div>
            </div>`;
        }).join('');
    });
}

function updateSlot(side, idx, field, val) {
    if(field==='troops') app.teams[side][idx].troops = Number(val);
    if(field==='sub1') app.teams[side][idx].subSkills[0] = val;
    if(field==='sub2') app.teams[side][idx].subSkills[1] = val;
    localStorage.setItem(STORE.teams, JSON.stringify(app.teams));
}

window.onload = async () => {
    await loadData();
    setupLogButtons();

    document.getElementById('btnStart').onclick = () => {
        document.getElementById('logContent').innerHTML = '';
        app.battle = new BattleEngine(clone(app.teams));
        app.battle.nextChunk();
    };

    document.getElementById('btnNext').onclick = () => { if(app.battle) app.battle.nextChunk(); };

    document.getElementById('btnAuto').onclick = () => {
        if(app.autoInterval) return;
        app.autoInterval = setInterval(() => {
            if(!app.battle || app.battle.finished) {
                clearInterval(app.autoInterval); app.autoInterval = null; return;
            }
            app.battle.nextChunk();
        }, 400);
    };

    document.getElementById('btnStop').onclick = () => { clearInterval(app.autoInterval); app.autoInterval = null; };
    document.getElementById('btnSyncFile').onclick = () => loadData(true);
};

// モーダル・ビューア等は以前のロジックを継承
window.openHeroModal = (side, idx) => {
    app.currentSelectingSlot = { side, idx };
    document.getElementById('heroGrid').innerHTML = app.heroes.map(h => `<div class="hero-item" onclick="selectHero('${h.id}')">${h.name}</div>`).join('');
    document.getElementById('heroModal').style.display = 'block';
};
window.selectHero = id => {
    app.teams[app.currentSelectingSlot.side][app.currentSelectingSlot.idx].id = id;
    localStorage.setItem(STORE.teams, JSON.stringify(app.teams));
    document.getElementById('heroModal').style.display = 'none';
    renderTeams();
};
window.closeHeroModal = () => document.getElementById('heroModal').style.display = 'none';
function initViewers() {
    const hSel = document.getElementById('heroViewerSelect');
    const sSel = document.getElementById('skillViewerSelect');
    hSel.innerHTML = '<option value="">英傑選択</option>' + app.heroes.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
    sSel.innerHTML = '<option value="">スキル選択</option>' + app.skills.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    hSel.onchange = () => {
        const h = app.heroes.find(x => x.id === hSel.value);
        document.getElementById('heroViewerDetail').textContent = h ? `${h.name}\nATK:${h.stats.atk} DEF:${h.stats.def} INT:${h.stats.int} AGI:${h.stats.agi}` : "英傑詳細";
    };
}
