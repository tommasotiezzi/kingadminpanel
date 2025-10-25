// ============================================
// SUPABASE CONFIGURATION
// ============================================
const SUPABASE_URL = 'https://ctikdctvbjsdbtfyzxgj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0aWtkY3R2YmpzZGJ0Znl6eGdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNDYxNTcsImV4cCI6MjA3NjcyMjE1N30.hlGGeCGsuAxnuimvFoKC0Qj3YirmPmiF3DASxrF1lu0';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// STATE
// ============================================
let currentUser = null;
let isAdmin = false;
let scoringConfig = {};
let currentMatchday = null;
let teamA = null;
let teamB = null;
let gameStarted = false;

// ============================================
// AUTH
// ============================================
async function checkAuth() {
    const { data: { session } } = await sb.auth.getSession();
    
    if (session) {
        currentUser = session.user;
        await verifyAdmin();
        
        if (isAdmin) {
            showScreen('mainPanel');
            // Wait for next frame after DOM renders
            requestAnimationFrame(() => {
                requestAnimationFrame(async () => {
                    await initializeApp();
                });
            });
        } else {
            alert('Not authorized');
            await sb.auth.signOut();
            showScreen('loginScreen');
        }
    } else {
        showScreen('loginScreen');
    }
}

async function verifyAdmin() {
    const { data, error } = await sb
        .from('admin_users')
        .select('email')
        .eq('email', currentUser.email)
        .single();
    
    isAdmin = data !== null && !error;
}

async function login(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    currentUser = data.user;
    await verifyAdmin();
    
    if (!isAdmin) {
        await sb.auth.signOut();
        throw new Error('Not authorized');
    }
    
    return data;
}

async function logout() {
    await sb.auth.signOut();
    currentUser = null;
    isAdmin = false;
    showScreen('loginScreen');
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// ============================================
// INIT
// ============================================
async function initializeApp() {
    await loadScoringConfig();
    await loadMatchdays();
    await loadTeams();
    
    // Add event listeners that are in mainPanel
    document.getElementById('calculateResultsBtn').addEventListener('click', calculateAllResults);
    document.getElementById('loadMatchBtn').addEventListener('click', loadMatch);
    document.getElementById('startGameBtn').addEventListener('click', startGame);
    document.getElementById('saveAllBtn').addEventListener('click', saveAllVotes);
    document.getElementById('configBtn').addEventListener('click', openConfigModal);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    const closeBtn = document.querySelector('.close');
    if (closeBtn) closeBtn.addEventListener('click', closeConfigModal);
    
    document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
}

async function loadScoringConfig() {
    const { data } = await sb.from('scoring_config').select('*');
    if (data) {
        scoringConfig = {};
        data.forEach(item => {
            scoringConfig[item.key] = item.value;
        });
    }
}

async function loadMatchdays() {
    const { data } = await sb.from('kl_matchdays').select('*').order('matchday_number');
    if (data) {
        const select = document.getElementById('matchdaySelect');
        select.innerHTML = '<option value="">Select Matchday...</option>';
        data.forEach(md => {
            const opt = document.createElement('option');
            opt.value = md.id;
            opt.textContent = `Matchday ${md.matchday_number} - ${md.date}${md.is_playoff ? ' (Playoff)' : ''}`;
            opt.dataset.number = md.matchday_number;
            select.appendChild(opt);
        });
    }
}

async function loadTeams() {
    const { data } = await sb.from('kings_league_teams').select('*').order('name');
    if (data) {
        const selectA = document.getElementById('teamASelect');
        const selectB = document.getElementById('teamBSelect');
        selectA.innerHTML = '<option value="">Select Team A...</option>';
        selectB.innerHTML = '<option value="">Select Team B...</option>';
        
        data.forEach(team => {
            const optA = document.createElement('option');
            optA.value = team.id;
            optA.textContent = team.name;
            optA.dataset.eliminated = team.is_eliminated;
            selectA.appendChild(optA);
            
            const optB = document.createElement('option');
            optB.value = team.id;
            optB.textContent = team.name;
            optB.dataset.eliminated = team.is_eliminated;
            selectB.appendChild(optB);
        });
    }
}

// ============================================
// LOAD MATCH
// ============================================
async function loadMatch() {
    const matchdayId = document.getElementById('matchdaySelect').value;
    const teamAId = document.getElementById('teamASelect').value;
    const teamBId = document.getElementById('teamBSelect').value;
    
    if (!matchdayId || !teamAId || !teamBId) {
        alert('Please select matchday and both teams');
        return;
    }
    
    if (teamAId === teamBId) {
        alert('Please select different teams');
        return;
    }
    
    currentMatchday = matchdayId;
    const matchdayNumber = document.querySelector('#matchdaySelect option:checked').dataset.number;
    
    teamA = await loadTeamData(teamAId);
    teamB = await loadTeamData(teamBId);
    
    const votesExist = await checkExistingVotes(matchdayId);
    gameStarted = votesExist;
    
    document.getElementById('matchInfoText').textContent = `Matchday ${matchdayNumber}: ${teamA.name} vs ${teamB.name}`;
    document.getElementById('matchInfo').classList.remove('hidden');
    document.getElementById('startGameBtn').style.display = votesExist ? 'none' : 'block';
    
    if (votesExist) {
        await loadExistingVotes();
    } else {
        renderVoteForms();
    }
    
    document.getElementById('voteSection').classList.remove('hidden');
}

async function loadTeamData(teamId) {
    const { data: team } = await sb.from('kings_league_teams').select('*').eq('id', teamId).single();
    const { data: players } = await sb.from('players').select('*').eq('team_id', teamId).order('role').order('name');
    const { data: president } = await sb.from('presidents').select('*').eq('team_id', teamId).single();
    return { ...team, players, president };
}

async function checkExistingVotes(matchdayId) {
    const { data } = await sb.from('player_votes').select('id').eq('kl_matchday_id', matchdayId).limit(1);
    return data && data.length > 0;
}

// ============================================
// RENDER FORMS
// ============================================
function renderVoteForms() {
    document.getElementById('teamAName').textContent = teamA.name;
    renderPresidentForm('teamAPresidentVote', teamA.president, 'A');
    renderPlayersForm('teamAPlayersList', teamA.players, 'A', teamA.is_eliminated);
    
    document.getElementById('teamBName').textContent = teamB.name;
    renderPresidentForm('teamBPresidentVote', teamB.president, 'B');
    renderPlayersForm('teamBPlayersList', teamB.players, 'B', teamB.is_eliminated);
}

function renderPresidentForm(containerId, president, team) {
    if (!president) return;
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div class="vote-card president-card" data-president-id="${president.id}" data-team="${team}">
            <div class="player-info">
                <span class="player-name">👑 ${president.name}</span>
            </div>
            <div class="president-vote-form">
                <div class="president-penalty">
                    <div class="checkbox-field">
                        <input type="radio" id="pres_${team}_scored" name="pres_${team}" value="scored">
                        <label for="pres_${team}_scored">✅ Scored (+${scoringConfig.president_penalty_scored})</label>
                    </div>
                    <div class="checkbox-field">
                        <input type="radio" id="pres_${team}_missed" name="pres_${team}" value="missed">
                        <label for="pres_${team}_missed">❌ Missed (${scoringConfig.president_penalty_missed})</label>
                    </div>
                    <div class="checkbox-field">
                        <input type="radio" id="pres_${team}_none" name="pres_${team}" value="none" checked>
                        <label for="pres_${team}_none">⚪ None (0)</label>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderPlayersForm(containerId, players, team, isEliminated) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const roleLabels = { 'P': 'Portiere', 'D': 'Difensore', 'C': 'Centrocampista', 'A': 'Attaccante' };
    
    players.forEach(player => {
        const card = document.createElement('div');
        card.className = 'vote-card';
        card.dataset.playerId = player.id;
        card.dataset.team = team;
        
        const defaultVote = (isEliminated && !gameStarted) ? '5.0' : '6.0';
        
        card.innerHTML = `
            <div class="player-info">
                <span class="player-name">${player.name}</span>
                <span class="player-role">${roleLabels[player.role]}</span>
            </div>
            <div class="vote-form">
                <div class="form-field base-vote">
                    <label>Base Vote</label>
                    <input type="number" class="base-vote-input" min="1" max="10" step="0.5" value="${defaultVote}" ${isEliminated ? 'readonly' : ''}>
                </div>
                <div class="form-field">
                    <label>Goals</label>
                    <input type="number" class="goals" min="0" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
                <div class="form-field">
                    <label>Goals Double</label>
                    <input type="number" class="goals-double" min="0" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
                <div class="form-field">
                    <label>Penalties ✅</label>
                    <input type="number" class="penalties-scored" min="0" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
                <div class="form-field">
                    <label>Penalties ❌</label>
                    <input type="number" class="penalties-missed" min="0" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
                <div class="form-field">
                    <label>Assists</label>
                    <input type="number" class="assists" min="0" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
                <div class="form-field">
                    <label>Yellow Cards</label>
                    <input type="number" class="yellow-cards" min="0" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
                <div class="form-field">
                    <label>Red Cards</label>
                    <input type="number" class="red-cards" min="0" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
                ${player.role === 'P' ? `
                <div class="form-field">
                    <label>Clean Sheet</label>
                    <input type="checkbox" class="clean-sheet" ${isEliminated ? 'disabled' : ''}>
                </div>
                ` : ''}
                <div class="form-field">
                    <label>Shootout ✅</label>
                    <input type="number" class="shootout-scored" min="0" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
                <div class="form-field">
                    <label>Shootout ❌</label>
                    <input type="number" class="shootout-missed" min="0" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
                <div class="form-field">
                    <label>Own Goals</label>
                    <input type="number" class="own-goals" min="0" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
                <div class="form-field">
                    <label>Minutes</label>
                    <input type="number" class="minutes" min="0" max="90" value="0" ${isEliminated ? 'disabled' : ''}>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

async function loadExistingVotes() {
    const { data: playerVotes } = await sb.from('player_votes').select('*').eq('kl_matchday_id', currentMatchday);
    const { data: presidentVotes } = await sb.from('president_votes').select('*').eq('kl_matchday_id', currentMatchday);
    
    renderVoteForms();
    
    if (playerVotes) {
        playerVotes.forEach(vote => {
            const card = document.querySelector(`[data-player-id="${vote.player_id}"]`);
            if (card) {
                card.querySelector('.base-vote-input').value = vote.base_vote;
                card.querySelector('.goals').value = vote.goals;
                card.querySelector('.goals-double').value = vote.goals_double;
                card.querySelector('.penalties-scored').value = vote.penalties_scored;
                card.querySelector('.penalties-missed').value = vote.penalties_missed;
                card.querySelector('.assists').value = vote.assists;
                card.querySelector('.yellow-cards').value = vote.yellow_cards;
                card.querySelector('.red-cards').value = vote.red_cards;
                if (card.querySelector('.clean-sheet')) card.querySelector('.clean-sheet').checked = vote.clean_sheet;
                card.querySelector('.shootout-scored').value = vote.shootout_scored;
                card.querySelector('.shootout-missed').value = vote.shootout_missed;
                card.querySelector('.own-goals').value = vote.own_goals;
                card.querySelector('.minutes').value = vote.minutes_played;
            }
        });
    }
    
    if (presidentVotes) {
        presidentVotes.forEach(vote => {
            const card = document.querySelector(`[data-president-id="${vote.president_id}"]`);
            if (card) {
                const team = card.dataset.team;
                if (vote.penalty_scored) document.getElementById(`pres_${team}_scored`).checked = true;
                else if (vote.penalty_missed) document.getElementById(`pres_${team}_missed`).checked = true;
                else document.getElementById(`pres_${team}_none`).checked = true;
            }
        });
    }
}

// ============================================
// START GAME
// ============================================
async function startGame() {
    if (!confirm('Initialize all votes with base values?')) return;
    
    try {
        const allPlayers = [...teamA.players, ...teamB.players];
        const allPresidents = [teamA.president, teamB.president].filter(p => p);
        
        const playerVotesData = allPlayers.map(player => {
            const isEliminated = (player.team_id === teamA.id && teamA.is_eliminated) || (player.team_id === teamB.id && teamB.is_eliminated);
            return {
                kl_matchday_id: currentMatchday,
                player_id: player.id,
                base_vote: isEliminated ? 5.0 : 6.0,
                goals: 0,
                goals_double: 0,
                penalties_scored: 0,
                penalties_missed: 0,
                assists: 0,
                yellow_cards: 0,
                red_cards: 0,
                clean_sheet: false,
                shootout_scored: 0,
                shootout_missed: 0,
                own_goals: 0,
                minutes_played: 0,
                final_score: isEliminated ? 5.0 : 6.0
            };
        });
        
        const { error: playerError } = await sb.from('player_votes').insert(playerVotesData);
        if (playerError) throw playerError;
        
        const presidentVotesData = allPresidents.map(p => ({
            kl_matchday_id: currentMatchday,
            president_id: p.id,
            penalty_scored: false,
            penalty_missed: false,
            final_score: 0
        }));
        
        const { error: presidentError } = await sb.from('president_votes').insert(presidentVotesData);
        if (presidentError) throw presidentError;
        
        gameStarted = true;
        document.getElementById('startGameBtn').style.display = 'none';
        showStatus('Game started!', 'success');
    } catch (error) {
        console.error(error);
        showStatus('Error: ' + error.message, 'error');
    }
}

// ============================================
// SAVE VOTES
// ============================================
async function saveAllVotes() {
    if (!gameStarted) {
        alert('Click "Start Game" first');
        return;
    }
    
    if (!confirm('Save all votes?')) return;
    
    try {
        const playerCards = document.querySelectorAll('[data-player-id]');
        
        for (const card of playerCards) {
            const playerId = card.dataset.playerId;
            const baseVote = parseFloat(card.querySelector('.base-vote-input').value);
            const goals = parseInt(card.querySelector('.goals').value) || 0;
            const goalsDouble = parseInt(card.querySelector('.goals-double').value) || 0;
            const penaltiesScored = parseInt(card.querySelector('.penalties-scored').value) || 0;
            const penaltiesMissed = parseInt(card.querySelector('.penalties-missed').value) || 0;
            const assists = parseInt(card.querySelector('.assists').value) || 0;
            const yellowCards = parseInt(card.querySelector('.yellow-cards').value) || 0;
            const redCards = parseInt(card.querySelector('.red-cards').value) || 0;
            const cleanSheet = card.querySelector('.clean-sheet')?.checked || false;
            const shootoutScored = parseInt(card.querySelector('.shootout-scored').value) || 0;
            const shootoutMissed = parseInt(card.querySelector('.shootout-missed').value) || 0;
            const ownGoals = parseInt(card.querySelector('.own-goals').value) || 0;
            const minutesPlayed = parseInt(card.querySelector('.minutes').value) || 0;
            
            const finalScore = calculatePlayerScore(baseVote, goals, goalsDouble, penaltiesScored, penaltiesMissed, assists, yellowCards, redCards, cleanSheet, shootoutScored, shootoutMissed, ownGoals);
            
            const { error } = await sb.from('player_votes').update({
                base_vote: baseVote,
                goals,
                goals_double: goalsDouble,
                penalties_scored: penaltiesScored,
                penalties_missed: penaltiesMissed,
                assists,
                yellow_cards: yellowCards,
                red_cards: redCards,
                clean_sheet: cleanSheet,
                shootout_scored: shootoutScored,
                shootout_missed: shootoutMissed,
                own_goals: ownGoals,
                minutes_played: minutesPlayed,
                final_score: finalScore,
                updated_at: new Date().toISOString()
            }).eq('kl_matchday_id', currentMatchday).eq('player_id', playerId);
            
            if (error) throw error;
        }
        
        const presidentCards = document.querySelectorAll('[data-president-id]');
        for (const card of presidentCards) {
            const presidentId = card.dataset.presidentId;
            const team = card.dataset.team;
            const scored = document.getElementById(`pres_${team}_scored`).checked;
            const missed = document.getElementById(`pres_${team}_missed`).checked;
            
            let finalScore = 0;
            if (scored) finalScore = scoringConfig.president_penalty_scored;
            if (missed) finalScore = scoringConfig.president_penalty_missed;
            
            const { error } = await sb.from('president_votes').update({
                penalty_scored: scored,
                penalty_missed: missed,
                final_score: finalScore,
                updated_at: new Date().toISOString()
            }).eq('kl_matchday_id', currentMatchday).eq('president_id', presidentId);
            
            if (error) throw error;
        }
        
        showStatus('✅ Saved!', 'success');
    } catch (error) {
        console.error(error);
        showStatus('❌ Error: ' + error.message, 'error');
    }
}

function calculatePlayerScore(baseVote, goals, goalsDouble, penaltiesScored, penaltiesMissed, assists, yellowCards, redCards, cleanSheet, shootoutScored, shootoutMissed, ownGoals) {
    let score = baseVote;
    score += goals * scoringConfig.goal_normal;
    score += goalsDouble * scoringConfig.goal_double;
    score += penaltiesScored * scoringConfig.penalty_scored;
    score += penaltiesMissed * scoringConfig.penalty_missed;
    score += assists * scoringConfig.assist;
    score += yellowCards * scoringConfig.yellow_card;
    score += redCards * scoringConfig.red_card;
    score += cleanSheet ? scoringConfig.clean_sheet : 0;
    score += shootoutScored * scoringConfig.shootout_scored;
    score += shootoutMissed * scoringConfig.shootout_missed;
    score += ownGoals * scoringConfig.own_goal;
    return Math.round(score * 10) / 10;
}

// ============================================
// CALCULATE RESULTS (RPC)
// ============================================
async function calculateAllResults() {
    const matchdayId = document.getElementById('matchdaySelect').value;
    
    if (!matchdayId) {
        alert('Please select a matchday first!');
        return;
    }
    
    const matchdayNumber = document.querySelector('#matchdaySelect option:checked').dataset.number;
    
    if (!confirm(`Calculate results for Matchday ${matchdayNumber}?\n\nThis will:\n- Process all fantasy matches\n- Handle substitutions\n- Calculate virtual goals\n- Update standings\n\nContinue?`)) return;
    
    try {
        showStatus(`⏳ Calculating Matchday ${matchdayNumber}...`, 'success');
        
        const { data, error } = await sb.rpc('calculate_matchday_results', {
            p_kl_matchday_id: matchdayId
        });
        
        if (error) throw error;
        
        if (data.success) {
            showStatus(
                `✅ Success! Processed ${data.processed} matches, ${data.competitions_updated} competitions updated. ${data.errors > 0 ? `(${data.errors} errors)` : ''}`,
                'success'
            );
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error(error);
        showStatus('❌ Error: ' + error.message, 'error');
    }
}

// ============================================
// CONFIG MODAL
// ============================================
function openConfigModal() {
    const modal = document.getElementById('configModal');
    const form = document.getElementById('configForm');
    form.innerHTML = '';
    
    Object.entries(scoringConfig).forEach(([key, value]) => {
        const item = document.createElement('div');
        item.className = 'config-item';
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        item.innerHTML = `
            <label>${label}</label>
            <input type="number" step="0.5" value="${value}" data-config-key="${key}">
            <small>Current: ${value}</small>
        `;
        form.appendChild(item);
    });
    
    modal.classList.add('active');
}

function closeConfigModal() {
    document.getElementById('configModal').classList.remove('active');
}

async function saveConfig() {
    try {
        const inputs = document.querySelectorAll('#configForm input');
        for (const input of inputs) {
            const key = input.dataset.configKey;
            const value = parseFloat(input.value);
            const { error } = await sb.from('scoring_config').update({ value }).eq('key', key);
            if (error) throw error;
        }
        await loadScoringConfig();
        closeConfigModal();
        alert('Config saved!');
    } catch (error) {
        console.error(error);
        alert('Error: ' + error.message);
    }
}

function showStatus(message, type) {
    const status = document.getElementById('saveStatus');
    status.textContent = message;
    status.className = `save-status ${type}`;
    setTimeout(() => {
        status.textContent = '';
        status.className = 'save-status';
    }, 5000);
}

// ============================================
// EVENT LISTENERS
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');
        
        try {
            await login(email, password);
            showScreen('mainPanel');
            // Wait for next frame after DOM renders
            requestAnimationFrame(() => {
                requestAnimationFrame(async () => {
                    await initializeApp();
                });
            });
        } catch (error) {
            errorEl.textContent = error.message;
        }
    });
    
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('configModal');
        if (e.target === modal) closeConfigModal();
    });
});
