const STORE = { heroes: 'tw.uni.heroes.v6', skills: 'tw.uni.skills.v6', teams: 'tw.uni.teams.v6' };

// 初期データは空（fetchで取得）
let app = { heroes: [], skills: [], teams: null, battle: null, currentSelectingSlot: null };

// --- データ同期 ---
async function loadData(force = false) {
    const localH = localStorage.getItem(STORE.heroes);
    const localS = localStorage.getItem(STORE.skills);

    if (force || !localH || !localS) {
        try {
            const [hRes, sRes] = await Promise.all([
                fetch('heroes_all.json').then(r => r.json()),
                fetch('skills_all.json').then(r => r.json())
            ]);
            app.heroes = hRes;
            app.skills = sRes;
            localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
            localStorage.setItem(STORE.skills, JSON.stringify(app.skills));
            console.log("GitHubから最新データを同期しました");
        } catch (e) {
            console.error("Fetchエラー: ファイルが見つかりません。");
            app.heroes = []; app.skills = [];
        }
    } else {
        app.heroes = JSON.parse(localH);
        app.skills = JSON.parse(localS);
    }

    const localT = localStorage.getItem(STORE.teams);
    app.teams = localT ? JSON.parse(localT) : {
        left: Array(3).fill({ id: "", troops: 10000, subSkills: ["", ""] }),
        right: Array(3).fill({ id: "", troops: 10000, subSkills: ["", ""] })
    };

    renderAll();
    initViewers();
}

// --- UIレンダリング ---
function renderAll() {
    renderTeams();
    document.getElementById('heroesJson').value = JSON.stringify(app.heroes, null, 2);
    document.getElementById('skillsJson').value = JSON.stringify(app.skills, null, 2);
}

function renderTeams() {
    ['left', 'right'].forEach(side => {
        const container = document.getElementById(`${side}Slots`);
        container.innerHTML = app.teams[side].map((slot, i) => {
            const hero = app.heroes.find(h => h.id === slot.id);
            return `
            <div class="slot">
                <div class="label">${['指揮官','中軍','前衛'][i]}</div>
                <div class="select-trigger ${hero?'has-hero':''}" onclick="openHeroModal('${side}', ${i})">
                    ${hero ? `<b>${hero.name}</b>` : '＋ 英傑を選択'}
                </div>
                <div style="display:flex; gap:5px; margin-top:8px;">
                  <select onchange="updateSlot('${side}',${i},'sub1',this.value)">
                    <option value="">スキル1</option>
                    ${app.skills.map(s => `<option value="${s.id}" ${slot.subSkills[0]===s.id?'selected':''}>${s.name}</option>`).join('')}
                  </select>
                  <select onchange="updateSlot('${side}',${i},'sub2',this.value)">
                    <option value="">スキル2</option>
                    ${app.skills.map(s => `<option value="${s.id}" ${slot.subSkills[1]===s.id?'selected':''}>${s.name}</option>`).join('')}
                  </select>
                </div>
            </div>`;
        }).join('');
    });
}

// --- モーダル制御 ---
function openHeroModal(side, idx) {
    app.currentSelectingSlot = { side, idx };
    const grid = document.getElementById('heroGrid');
    grid.innerHTML = app.heroes.map(h => `
        <div class="hero-card" onclick="selectHero('${h.id}')">
            <h4>${h.name}</h4>
            <p>${h.unitType || '歩兵'}</p>
            <p style="font-size:10px; opacity:0.6;">ATK:${h.stats.atk} INT:${h.stats.int}</p>
        </div>
    `).join('');
    document.getElementById('heroModal').style.display = 'block';
}

function selectHero(id) {
    const { side, idx } = app.currentSelectingSlot;
    app.teams[side][idx].id = id;
    localStorage.setItem(STORE.teams, JSON.stringify(app.teams));
    closeHeroModal();
    renderTeams();
}

function closeHeroModal() {
    document.getElementById('heroModal').style.display = 'none';
}

function updateSlot(side, idx, field, val) {
    if(field === 'sub1') app.teams[side][idx].subSkills[0] = val;
    if(field === 'sub2') app.teams[side][idx].subSkills[1] = val;
    localStorage.setItem(STORE.teams, JSON.stringify(app.teams));
}

// ビューア初期化（プルダウン）
function initViewers() {
    const hSel = document.getElementById('heroViewerSelect');
    const sSel = document.getElementById('skillViewerSelect');
    hSel.innerHTML = '<option value="">選択</option>' + app.heroes.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
    sSel.innerHTML = '<option value="">選択</option>' + app.skills.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

window.onload = () => {
    loadData();
    document.getElementById('btnSyncFile').onclick = () => loadData(true);
    document.getElementById('btnSaveHeroes').onclick = () => {
        app.heroes = JSON.parse(document.getElementById('heroesJson').value);
        localStorage.setItem(STORE.heroes, JSON.stringify(app.heroes));
        renderAll(); initViewers(); alert("保存しました");
    };
    // 戦闘開始等のロジックは以前のものを継承
};
