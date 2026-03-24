const STORE = { 
    heroes: 'tw.uni.heroes.v12', 
    skills: 'tw.uni.skills.v12', 
    teams: 'tw.uni.teams.v12' 
};

let app = { 
    heroes: [], 
    skills: [], 
    teams: null, 
    battle: null, 
    autoInterval: null, 
    currentSelectingSlot: null 
};

// --- Unitクラス (属性増幅と詳細ステータス取得) ---
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
        this.baseStats = { ...heroData.stats };
        this.uniqueSkillId = heroData.unique;
        this.subSkillIds = (teamData.subSkills || []).slice(0, 2);
        this.buffs = [];
        this.statuses = [];
        this.customState = { pounce: 1 }; 
    }

    isAlive() { return this.hp > 0; }

    // 属性値の増幅計算 (Rule 15)
    getScaledStat(statName) {
        let base = Number(this.baseStats[statName]) || 0;
        let flatMod = this.buffs.filter(b => b.stat === statName).reduce((sum, b) => sum + b.value, 0);
        let val = base + flatMod;
        // ステータス50ごとに10%増加
        let multiplier = 1 + (val / 50) * 0.1;
        return { value: Math.round(val), multiplier: multiplier };
    }

    getCurrentStat(statName) { return this.getScaledStat(statName).value; }
}

// --- 戦闘エンジン (詳細ログとスキル.txt対応) ---
class BattleEngine {
    constructor(teams) {
        this.turn = 0; this.viewTurn = 0; this.phase = 'opening';
        this.logsByTurn = { 0: [] }; this.finished = false;
        this.hooks = [];
        this.units = [
            ...teams.left.map((t, i) => this.createUnit(t, 'left', i)),
            ...teams.right.map((t, i) => this.createUnit(t, 'right', i))
        ].filter(Boolean);
        this.registerAllSkills();
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

    registerAllSkills() {
        this.units.forEach(u => {
            const skillIds = [u.uniqueSkillId, ...u.subSkillIds].filter(Boolean);
            skillIds.forEach(id => {
                const s = app.skills.find(x => x.id === id);
                if (!s) return;
                if (s.trigger === 'passive' || s.trigger === 'engage') {
                    this.executeEffects(u, s.effects, { skillName: s.name });
                }
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
            this.phase = 'action_start'; this.turn = 1; this.viewTurn = 1;
        } else if (this.phase === 'action_start') {
            this.log(`<div class="log-turn-start">--- Turn ${this.turn} ---</div>`);
            this.turnOrder = this.units.filter(u => u.isAlive()).sort((a,b) => b.getCurrentStat('agi') - a.getCurrentStat('agi'));
            this.turnIdx = 0; this.phase = 'action';
            this.nextChunk();
        } else if (this.phase === 'action') {
            if (this.turnIdx < this.turnOrder.length) {
                this.unitAction(this.turnOrder[this.turnIdx++]);
            } else {
                this.turn++; this.viewTurn = this.turn; this.phase = 'action_start';
                if (this.turn > 8) this.finish("8ターン経過による引き分け");
            }
        }
        updateStatusDisplay();
    }

    unitAction(u) {
        if (!u.isAlive()) return;
        const s = { atk: u.getCurrentStat('atk'), def: u.getCurrentStat('def'), int: u.getCurrentStat('int'), agi: u.getCurrentStat('agi') };
        // 詳細な兵力とステータスの表示
        this.log(`▼ [行動] ${u.side==='left'?'自':'敵'}<b>${u.name}</b> 兵力:${Math.round(u.hp)}(負傷:${Math.round(u.maxHp-u.hp)}) [A:${s.atk} D:${s.def} I:${s.int} S:${s.agi}]`);

        const actives = [u.uniqueSkillId, ...u.subSkillIds].map(id => app.skills.find(x => x.id === id)).filter(x => x && (x.trigger === 'active' || x.trigger === 'action'));
        actives.forEach(skill => {
            this.emit('onSkillAttempt', { actor: u, skill: skill });
            if (Math.random() * 100 < (skill.chance || 0)) {
                this.log(` ★ <span class="log-skill">[${skill.name}]</span> 発動！`);
                this.executeEffects(u, skill.effects, { skillName: skill.name });
            }
        });

        const target = this.selectTargets(u, 'randomEnemy', 1)[0];
        if (target) {
            const dmg = this.calcDamage(u, target, 1.0, 'atk');
            this.applyDamage(u, target, dmg, '通常攻撃');
            this.emit('onNormalAttack', { actor: u, target: target });
        }
        this.checkDeaths();
    }

    executeEffects(caster, effects, context) {
        if (!effects) return;
        effects.forEach(eff => {
            const targets = this.selectTargets(caster, eff.target || 'randomEnemy', eff.count || 1);
            targets.forEach(t => {
                const scaling = caster.getScaledStat(eff.scalingStat || 'atk').multiplier;
                if (eff.type === 'damage') {
                    const dmg = this.calcDamage(caster, t, (eff.rate || 1) * scaling, eff.basis || 'atk');
                    this.applyDamage(caster, t, dmg, context.skillName);
                } else if (eff.type === 'heal') {
                    const healBase = (145 * Math.log(Math.max(1, caster.hp)) - 900);
                    const heal = Math.max(0, Math.round(healBase * (eff.rate || 1) * scaling));
                    const actual = Math.min(t.maxHp - t.hp, heal);
                    t.hp += actual;
                    this.log(`  + ${t.name} が <span class="log-heal">${actual} 回復</span> (${context.skillName}) 残:${Math.round(t.hp)}`);
                } else if (eff.type === 'buff' || eff.type === 'debuff') {
                    t.buffs.push({ stat: eff.stat, value: eff.value, duration: eff.duration });
                }
            });
        });
    }

    selectTargets(caster, type, count) {
        const enemies = this.units.filter(u => u.side !== caster.side && u.isAlive());
        const allies = this.units.filter(u => u.side === caster.side && u.isAlive());
        if (type === 'randomEnemy' || type === 'enemyRandom') return enemies.sort(() => 0.5 - Math.random()).slice(0, count);
        if (type === 'self') return [caster];
        if (type === 'lowestHpAlly') return allies.sort((a,b) => a.hp - b.hp).slice(0, count);
        return enemies.slice(0, count);
    }

    calcDamage(attacker, target, rate, basis) {
        const atkVal = attacker.getCurrentStat(basis);
        const defVal = target.getCurrentStat('def');
        let dmg = (atkVal - defVal) * 1.5 + (attacker.hp / 100);
        return Math.max(1, Math.round(dmg * rate * (0.95 + Math.random() * 0.1)));
    }

    applyDamage(attacker, target, dmg, label) {
        target.hp = Math.max(0, target.hp - dmg);
        this.log(`  -> ${target.name} に <span class="log-damage">${dmg} ダメージ</span> (${label}) 残:${Math.round(target.hp)}`);
    }

    checkDeaths() {
        const leftCap = this.units.find(u => u.side === 'left' && u.posIdx === 0);
        const rightCap = this.units.find(u => u.side === 'right' && u.posIdx === 0);
        if (leftCap && leftCap.hp <= 0) this.finish("敵軍の勝利！");
        else if (rightCap && rightCap.hp <= 0) this.finish("自軍の勝利！");
    }

    finish(msg) { this.finished = true; this.log(`<div class="log-turn-start">=== ${msg} ===</div>`); }
}

// --- UI制御 (入力欄の完全復旧) ---
function renderTeams() {
    ['left', 'right'].forEach(side => {
        document.getElementById(`${side}Slots`).innerHTML = app.teams[side].map((slot, i) => {
            const h = app.heroes.find(x => x.id === slot.id);
            return `
            <div class="slot">
                <label>${['指揮官','中軍','前衛'][i]}</label>
                <div class="select-trigger ${h?'has-hero':''}" onclick="openHeroModal('${side}',${i})">
                    ${h ? h.name : '英傑を選択'}
                </div>
                <input type="number" value="${slot.troops}" onchange="updateSlot('${side}',${i},'troops',this.value)" placeholder="兵力">
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
    if(field === 'troops') app.teams[side][idx].troops = Number(val);
    if(field === 'sub1') app.teams[side][idx].subSkills[0] = val;
    if(field === 'sub2') app.teams[side][idx].subSkills[1] = val;
    localStorage.setItem(STORE.teams, JSON.stringify(app.teams));
}

// チームデータの初期化 (スロット連動を修正)
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

    const localT = localStorage.getItem(STORE.teams);
    if (localT) {
        app.teams = JSON.parse(localT);
    } else {
        // 個別のオブジェクトを生成するように修正
        app.teams = {
            left: [ {id:"", troops:10000, subSkills:["",""]}, {id:"", troops:10000, subSkills:["",""]}, {id:"", troops:10000, subSkills:["",""]} ],
            right: [ {id:"", troops:10000, subSkills:["",""]}, {id:"", troops:10000, subSkills:["",""]}, {id:"", troops:10000, subSkills:["",""]} ]
        };
    }
    renderTeams(); initViewers();
}

// --- 他のイベントハンドラ (コピー、開始、モーダル等) ---
function setupHandlers() {
    document.getElementById('btnStart').onclick = () => {
        document.getElementById('logContent').innerHTML = '';
        app.battle = new BattleEngine(JSON.parse(JSON.stringify(app.teams)));
        app.battle.nextChunk();
    };
    document.getElementById('btnNext').onclick = () => { if(app.battle) app.battle.nextChunk(); };
    document.getElementById('btnClearLog').onclick = () => document.getElementById('logContent').innerHTML = '';
    document.getElementById('btnCopyLog').onclick = () => {
        navigator.clipboard.writeText(document.getElementById('logContent').innerText).then(() => alert("ログをコピーしました"));
    };
    document.getElementById('btnSyncFile').onclick = () => loadData(true);
}

function addHtmlLog(html) {
    const content = document.getElementById('logContent');
    const div = document.createElement('div');
    div.className = 'log-entry'; div.innerHTML = html;
    content.appendChild(div);
    const area = document.getElementById('logArea');
    area.scrollTop = area.scrollHeight;
}

function updateStatusDisplay() {
    if (!app.battle) return;
    document.getElementById('turnBadge').textContent = `Turn ${app.battle.turn}`;
    document.getElementById('stateBadge').textContent = app.battle.finished ? '終了' : '進行中';
}

window.onload = async () => {
    await loadData();
    setupHandlers();
};

// モーダル制御
window.openHeroModal = (side, idx) => {
    app.currentSelectingSlot = { side, idx };
    document.getElementById('heroGrid').innerHTML = app.heroes.map(h => `<div class="hero-item" onclick="selectHero('${h.id}')">${h.name}</div>`).join('');
    document.getElementById('heroModal').style.display = 'block';
};
window.selectHero = id => {
    const { side, idx } = app.currentSelectingSlot;
    app.teams[side][idx].id = id;
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
}
