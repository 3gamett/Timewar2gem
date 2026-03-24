const STORE = { heroes: 'tw.uni.heroes.v8', skills: 'tw.uni.skills.v8', teams: 'tw.uni.teams.v8' };

let app = { 
    heroes: [], 
    skills: [], 
    teams: null, 
    battle: null, 
    autoInterval: null, 
    currentSelectingSlot: null 
};

// --- Unitクラス定義 (エラー修正) ---
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
        this.baseStats = heroData.stats || { atk:100, def:100, int:100, agi:100, rng:3 };
        this.buffs = [];
        this.statuses = [];
        this.customState = {};
    }

    isAlive() { return this.hp > 0; }

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

// --- 戦闘エンジン ---
class BattleEngine {
    constructor(teams) {
        this.turn = 0; this.viewTurn = 0; this.phase = 'opening';
        this.logsByTurn = { 0: [] }; this.finished = false;
        this.units = [
            ...teams.left.map((t, i) => this.createUnit(t, 'left', i)),
            ...teams.right.map((t, i) => this.createUnit(t, 'right', i))
        ].filter(Boolean);
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

    nextChunk() {
        if (this.finished) return;
        if (this.phase === 'opening') {
            this.turn = 1; this.viewTurn = 1; this.phase = 'action';
            this.log(`<div class="log-turn-start">--- Turn 1 ---</div>`);
            this.turnOrder = this.units.filter(u => u.isAlive()).sort((a, b) => b.getCurrentStat('agi') - a.getCurrentStat('agi'));
            this.turnIdx = 0;
        } else {
            if (this.turnIdx < this.turnOrder.length) {
                const actor = this.turnOrder[this.turnIdx++];
                if (actor.isAlive()) this.log(`[行動] <b>${actor.name}</b> (兵力:${Math.round(actor.hp)})`);
            } else {
                this.turn++; this.viewTurn = this.turn; this.turnIdx = 0;
                if (this.turn > 8) { this.finished = true; this.log("=== 戦闘終了 ==="); }
                else { this.log(`<div class="log-turn-start">--- Turn ${this.turn} ---</div>`); }
            }
        }
        updateStatusDisplay();
    }
}

// --- UI制御 ---
function addHtmlLog(html) {
    const content = document.getElementById('logContent');
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = html;
    content.appendChild(div);
    const area = document.getElementById('logArea');
    area.scrollTop = area.scrollHeight;
}

function updateStatusDisplay() {
    if (!app.battle) return;
    document.getElementById('turnBadge').textContent = `Turn ${app.battle.turn}`;
    document.getElementById('stateBadge').textContent = app.battle.finished ? '終了' : '進行中';
}

async function loadData(force = false) {
    const localH = localStorage.getItem(STORE.heroes);
    const localS = localStorage.getItem(STORE.skills);

    if (force || !localH || !localS) {
        try {
            const [hRes, sRes] = await Promise.all([
                fetch('heroes_all.json').then(r => r.json()),
                fetch('skills_all.json').then(r => r.json())
            ]);
            app.heroes = hRes; app.skills = sRes;
            localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
            localStorage.setItem(STORE.skills, JSON.stringify(app.skills));
        } catch (e) { console.error("Load Error"); }
    } else {
        app.heroes = JSON.parse(localH); app.skills = JSON.parse(localS);
    }
    app.teams = JSON.parse(localStorage.getItem(STORE.teams)) || {
        left: Array(3).fill({ id: "", troops: 10000, subSkills: ["", ""] }),
        right: Array(3).fill({ id: "", troops: 10000, subSkills: ["", ""] })
    };
    renderTeams(); initViewers();
}

// 入力欄をすべて表示する描画処理
function renderTeams() {
    ['left', 'right'].forEach(side => {
        document.getElementById(`${side}Slots`).innerHTML = app.teams[side].map((slot, i) => {
            const hero = app.heroes.find(h => h.id === slot.id);
            return `<div class="slot">
                <label>${['指揮官', '中軍', '前衛'][i]}</label>
                <div class="select-trigger ${hero?'has-hero':''}" onclick="openHeroModal('${side}', ${i})">
                    ${hero ? hero.name : '英傑を選択'}
                </div>
                <div class="input-group">
                    <input type="number" value="${slot.troops}" onchange="updateSlot('${side}',${i},'troops',this.value)" placeholder="兵力">
                    <div class="input-row">
                        <select onchange="updateSlot('${side}',${i},'sub1',this.value)">
                            <option value="">スキル1</option>
                            ${app.skills.map(s => `<option value="${s.id}" ${slot.subSkills[0]===s.id?'selected':''}>${s.name}</option>`).join('')}
                        </select>
                        <select onchange="updateSlot('${side}',${i},'sub2',this.value)">
                            <option value="">スキル2</option>
                            ${app.skills.map(s => `<option value="${s.id}" ${slot.subSkills[1]===s.id?'selected':''}>${s.name}</option>`).join('')}
                        </select>
                    </div>
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

// --- モーダル ---
window.openHeroModal = (side, idx) => {
    app.currentSelectingSlot = { side, idx };
    document.getElementById('heroGrid').innerHTML = app.heroes.map(h => `
        <div class="hero-item" onclick="selectHero('${h.id}')">${h.name}</div>
    `).join('');
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

// --- 初期化 ---
window.onload = async () => {
    await loadData();
    
    document.getElementById('btnStart').onclick = () => {
        document.getElementById('logContent').innerHTML = '';
        app.battle = new BattleEngine(JSON.parse(JSON.stringify(app.teams)));
        app.battle.nextChunk();
    };

    document.getElementById('btnNext').onclick = () => { if(app.battle) app.battle.nextChunk(); };

    document.getElementById('btnAuto').onclick = () => {
        if (app.autoInterval) return;
        app.autoInterval = setInterval(() => {
            if (!app.battle || app.battle.finished) {
                clearInterval(app.autoInterval); app.autoInterval = null; return;
            }
            app.battle.nextChunk();
        }, 500);
    };

    document.getElementById('btnStop').onclick = () => { clearInterval(app.autoInterval); app.autoInterval = null; };
    document.getElementById('btnSyncFile').onclick = () => loadData(true);
    document.getElementById('btnSaveHeroes').onclick = () => {
        app.heroes = JSON.parse(document.getElementById('heroesJson').value);
        localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
        renderTeams(); initViewers(); alert("英傑データを保存しました");
    };
    document.getElementById('btnSaveSkills').onclick = () => {
        app.skills = JSON.parse(document.getElementById('skillsJson').value);
        localStorage.setItem(STORE.skills, JSON.stringify(app.skills));
        renderTeams(); initViewers(); alert("スキルデータを保存しました");
    };
};

function initViewers() {
    const hSel = document.getElementById('heroViewerSelect');
    const sSel = document.getElementById('skillViewerSelect');
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
