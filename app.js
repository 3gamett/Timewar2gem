const STORE = { 
    heroes: 'tw.uni.heroes.v16', 
    skills: 'tw.uni.skills.v16', 
    teams: 'tw.uni.teams.v16' 
};

let app = { heroes: [], skills: [], teams: null, battle: null, autoInterval: null, currentSelectingSlot: null };

// 【復旧】グローバルエラーキャッチ (プログラムが落ちた時にログに赤字で出す)
window.addEventListener('error', (e) => {
    console.error(e);
    const errHtml = `<div class="log-error">[システムエラー] ${e.message}</div>`;
    addHtmlLog(errHtml);
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
        this.uniqueSkillId = heroData.unique;
        this.subSkillIds = (teamData.subSkills || []).slice(0, 2);
        this.buffs = [];
        this.statuses = [];
        this.customState = { pounce: 1 }; 
    }
    isAlive() { return this.hp > 0; }
    getScaledStat(statName) {
        let base = Number(this.baseStats[statName]) || 0;
        let flatMod = this.buffs.filter(b => b.stat === statName).reduce((sum, b) => sum + b.value, 0);
        let val = base + flatMod;
        return { value: Math.round(val), multiplier: 1 + (val / 50) * 0.1 };
    }
    getCurrentStat(statName) { return this.getScaledStat(statName).value; }
}

// --- 戦闘エンジン ---
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
        if (!this.logsByTurn[this.turn]) this.logsByTurn[this.turn] = [];
        this.logsByTurn[this.turn].push(msg);
        addHtmlLog(msg);
    }

    registerAllSkills() {
        this.units.forEach(u => {
            const skillIds = [u.uniqueSkillId, ...u.subSkillIds].filter(Boolean);
            skillIds.forEach(id => {
                const s = app.skills.find(x => x.id === id);
                if (!s) return;
                if (s.trigger === 'passive' || s.trigger === 'engage') this.executeEffects(u, s.effects, { skillName: s.name });
                if (s.effects) {
                    s.effects.forEach(eff => {
                        if (eff.type === 'register_hook') {
                            this.hooks.push({ event: eff.hookEvent, chance: eff.hookChance || 100, effects: eff.hookEffects, owner: u, skillName: s.name });
                        }
                    });
                }
            });
        });
    }

    emit(eventName, context = {}) {
        this.hooks.filter(h => h.event === eventName).forEach(h => {
            if (!h.owner.isAlive()) return;
            if (Math.random() * 100 < h.chance) this.executeEffects(h.owner, h.effects, { ...context, skillName: h.skillName });
        });
    }

    nextChunk() {
        if (this.finished) return;
        if (this.phase === 'opening') {
            this.log(`<div class="log-turn-start" id="turn-mark-0">=== 戦闘開始 ===</div>`);
            this.emit('onBattleStart');
            this.phase = 'action_start'; this.turn = 1; this.viewTurn = 1;
        } else if (this.phase === 'action_start') {
            this.log(`<div class="log-turn-start" id="turn-mark-${this.turn}">--- Turn ${this.turn} 開始 ---</div>`);
            document.getElementById('currentTurnLabel').textContent = `Turn ${this.turn}`;
            this.viewTurn = this.turn;
            this.turnOrder = this.units.filter(u => u.isAlive()).sort((a,b) => b.getCurrentStat('agi') - a.getCurrentStat('agi'));
            this.turnIdx = 0; this.phase = 'action';
            this.nextChunk();
        } else if (this.phase === 'action') {
            if (this.turnIdx < this.turnOrder.length) {
                this.unitAction(this.turnOrder[this.turnIdx++]);
            } else {
                this.tickTurnEnd();
                this.log(`<div class="log-turn-end">--- Turn ${this.turn} 終了 ---</div>`);
                this.turn++; this.viewTurn = this.turn; this.phase = 'action_start';
                if (this.turn > 8) this.finish("8ターン経過による引き分け");
            }
        }
        updateStatusDisplay();
    }

    unitAction(u) {
        if (!u.isAlive()) return;
        const atk = u.getCurrentStat('atk'); const def = u.getCurrentStat('def');
        const int = u.getCurrentStat('int'); const agi = u.getCurrentStat('agi');
        const wounded = Math.max(0, u.maxHp - u.hp);
        this.log(`▼ [行動] ${u.side==='left'?'自':'敵'} <b>${u.name}</b> 兵力:${Math.round(u.hp)}(負傷:${Math.round(wounded)}) [A:${atk} D:${def} I:${int} S:${agi}]`);

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

    tickTurnEnd() {
        this.units.forEach(u => {
            // -1 は減らさず維持する (永続)
            u.buffs = u.buffs.map(b => (b.duration === -1 ? b : { ...b, duration: b.duration - 1 })).filter(b => b.duration === -1 || b.duration > 0);
            u.statuses = u.statuses.map(s => (s.duration === -1 ? s : { ...s, duration: s.duration - 1 })).filter(s => s.duration === -1 || s.duration > 0);
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
    finish(msg) { this.finished = true; this.log(`<div class="log-turn-start" id="turn-mark-end">=== ${msg} ===</div>`); }
}

// --- UI制御 ---

// 【復旧】常に描画される編成関数
function renderTeams() {
    ['left', 'right'].forEach(side => {
        const container = document.getElementById(`${side}Slots`);
        if(!container) return;
        container.innerHTML = app.teams[side].map((slot, i) => {
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

// 【復旧】エラーで止まらず、空データでも確実にUIを初期化する
async function loadData(force = false) {
    const localH = localStorage.getItem(STORE.heroes);
    const localS = localStorage.getItem(STORE.skills);
    
    if (force || !localH || !localS) {
        try {
            const [h, s] = await Promise.all([
                fetch('heroes_all.json').then(r => r.json()),
                fetch('skills_all.json').then(r => r.json())
            ]);
            app.heroes = h || []; app.skills = s || [];
            localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
            localStorage.setItem(STORE.skills, JSON.stringify(app.skills));
        } catch(e) { 
            console.warn("外部JSONの取得に失敗しました。空の状態で起動します。");
            app.heroes = []; app.skills = [];
        }
    } else {
        try { app.heroes = JSON.parse(localH); } catch(e){ app.heroes = []; }
        try { app.skills = JSON.parse(localS); } catch(e){ app.skills = []; }
    }

    const localT = localStorage.getItem(STORE.teams);
    if (localT) {
        try { app.teams = JSON.parse(localT); } catch(e){ app.teams = null; }
    }
    
    // データが存在しない（消去された）場合は、個別の空スロットを生成
    if (!app.teams) {
        app.teams = {
            left: [ {id:"", troops:10000, subSkills:["",""]}, {id:"", troops:10000, subSkills:["",""]}, {id:"", troops:10000, subSkills:["",""]} ],
            right: [ {id:"", troops:10000, subSkills:["",""]}, {id:"", troops:10000, subSkills:["",""]}, {id:"", troops:10000, subSkills:["",""]} ]
        };
    }
    
    // エディタへ強制反映
    const hJsonEl = document.getElementById('heroesJson');
    const sJsonEl = document.getElementById('skillsJson');
    if(hJsonEl) hJsonEl.value = JSON.stringify(app.heroes, null, 2);
    if(sJsonEl) sJsonEl.value = JSON.stringify(app.skills, null, 2);

    // 取得に失敗していても必ずUIを描画する
    renderTeams(); 
    initViewers();
}

// ターン切り替えスクロール
function scrollToTurn(turn) {
    document.getElementById('currentTurnLabel').textContent = `Turn ${turn}`;
    const mark = document.getElementById(`turn-mark-${turn}`);
    const area = document.getElementById('logArea');
    if (mark && area) {
        area.scrollTo({ top: mark.offsetTop - area.offsetTop, behavior: 'smooth' });
    }
}

function setupHandlers() {
    document.getElementById('btnStart').onclick = () => {
        try {
            document.getElementById('logContent').innerHTML = '';
            app.battle = new BattleEngine(JSON.parse(JSON.stringify(app.teams)));
            app.battle.nextChunk();
        } catch(e) { throw new Error("戦闘開始時にエラーが発生しました: " + e.message); }
    };
    document.getElementById('btnNext').onclick = () => { if(app.battle) app.battle.nextChunk(); };
    
    document.getElementById('btnPrevTurn').onclick = () => {
        if (app.battle && app.battle.viewTurn > 0) scrollToTurn(--app.battle.viewTurn);
    };
    document.getElementById('btnNextTurn').onclick = () => {
        if (app.battle && app.battle.viewTurn < app.battle.turn && app.battle.viewTurn < 8) scrollToTurn(++app.battle.viewTurn);
    };

    document.getElementById('btnClearLog').onclick = () => document.getElementById('logContent').innerHTML = '';
    document.getElementById('btnCopyLog').onclick = () => navigator.clipboard.writeText(document.getElementById('logContent').innerText).then(() => alert("ログをコピーしました"));
    document.getElementById('btnSyncFile').onclick = () => loadData(true);
    
    // 【復旧】詳細なJSONエラー通知
    document.getElementById('btnSaveHeroes').onclick = () => {
        try {
            app.heroes = JSON.parse(document.getElementById('heroesJson').value);
            localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
            renderTeams(); initViewers(); alert("英傑データを保存・反映しました");
        } catch (e) { alert("【エラー】英傑JSONの形式が間違っています。\n\n詳細: " + e.message); }
    };
    document.getElementById('btnSaveSkills').onclick = () => {
        try {
            app.skills = JSON.parse(document.getElementById('skillsJson').value);
            localStorage.setItem(STORE.skills, JSON.stringify(app.skills));
            renderTeams(); initViewers(); alert("スキルデータを保存・反映しました");
        } catch (e) { alert("【エラー】スキルJSONの形式が間違っています。\n\n詳細: " + e.message); }
    };
    
    document.getElementById('btnAuto').onclick = () => {
        if (app.autoInterval) return;
        app.autoInterval = setInterval(() => {
            if (!app.battle || app.battle.finished) { clearInterval(app.autoInterval); app.autoInterval = null; return; }
            app.battle.nextChunk();
        }, 500);
    };
    document.getElementById('btnStop').onclick = () => { clearInterval(app.autoInterval); app.autoInterval = null; };
}

function addHtmlLog(html) {
    const content = document.getElementById('logContent');
    const div = document.createElement('div');
    div.className = 'log-entry'; div.innerHTML = html;
    content.appendChild(div);
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
    if(!hSel || !sSel) return;
    hSel.innerHTML = '<option value="">英傑選択</option>' + app.heroes.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
    sSel.innerHTML = '<option value="">スキル選択</option>' + app.skills.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    hSel.onchange = () => {
        const h = app.heroes.find(x => x.id === hSel.value);
        document.getElementById('heroViewerDetail').textContent = h ? `${h.name}\nATK:${h.stats.atk} DEF:${h.stats.def} INT:${h.stats.int} AGI:${h.stats.agi}` : "";
    };
    sSel.onchange = () => {
        const s = app.skills.find(x => x.id === sSel.value);
        document.getElementById('skillViewerDetail').textContent = s ? `${s.name}\n${s.detail || ""}` : "";
    };
}
