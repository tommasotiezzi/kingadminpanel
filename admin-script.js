// ============================================
// SUPABASE CONFIGURATION
// ============================================
const SUPABASE_URL = 'https://ctikdctvbjsdbtfyzxgj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0aWtkY3R2YmpzZGJ0Znl6eGdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNDYxNTcsImV4cCI6MjA3NjcyMjE1N30.hlGGeCGsuAxnuimvFoKC0Qj3YirmPmiF3DASxrF1lu0';

// ⚠️ SERVICE ROLE KEY - NEVER COMMIT TO PUBLIC REPO
// For production: Use environment variable or Vercel env
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Client for authentication (uses anon key)
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Admin client for CRUD operations (bypasses RLS)
const adminClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================
// STATE
// ============================================
let currentUser = null;
let isAdmin = false;
let scoringConfig = {};
let currentMatchday = null;
let teamA = null;
let teamB = null;

// ============================================
// AUTH
// ============================================
async function checkAuth() {
    const { data: { session } } = await sb.auth.getSession();
    
    if (session) {
        currentUser = session.user;
        await verifyAdmin();
        
        if (isAdmin) {
            document.getElementById('adminEmailDisplay').textContent = `👤 ${currentUser.email}`;
            showScreen('mainPanel');
            requestAnimationFrame(() => {
                requestAnimationFrame(async () => {
                    await initializeApp();
                });
            });
        } else {
            alert('❌ Access Denied: Your email is not authorized as admin');
            await sb.auth.signOut();
            showScreen('loginScreen');
        }
    } else {
        showScreen('loginScreen');
    }
}

async function verifyAdmin() {
    try {
        // Use anon key client to check admin_users table
        const { data, error } = await sb
            .from('admin_users')
            .select('email')
            .eq('email', currentUser.email)
            .maybeSingle();
        
        if (error) {
            console.error('Error verifying admin:', error);
            isAdmin = false;
            return;
        }
        
        // If email found in admin_users → authorized
        isAdmin = data !== null;
        
        console.log('Admin verification:', isAdmin ? '✅ Authorized' : '❌ Not authorized');
    } catch (error) {
        console.error('Error in verifyAdmin:', error);
        isAdmin = false;
    }
}

async function login(email, password) {
    const { data, error} = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    currentUser = data.user;
    await verifyAdmin();
    
    if (!isAdmin) {
        await sb.auth.signOut();
        throw new Error('Not authorized as admin');
    }
    
    return data;
}

async function logout() {
    await sb.auth.signOut();
    currentUser = null;
    isAdmin = false;
    document.getElementById('adminEmailDisplay').textContent = '';
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
    
    document.getElementById('calculateResultsBtn').addEventListener('click', calculateAllResults);
    document.getElementById('loadMatchBtn').addEventListener('click', loadMatch);
    document.getElementById('saveAllBtn').addEventListener('click', saveAllVotes);
    document.getElementById('configBtn').addEventListener('click', openConfigModal);
    document.getElementById('addPlayerBtn').addEventListener('click', openAddPlayerModal);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    const closeBtn = document.querySelector('.close');
    if (closeBtn) closeBtn.addEventListener('click', closeConfigModal);
    
    const closePlayerBtn = document.querySelector('.close-player');
    if (closePlayerBtn) closePlayerBtn.addEventListener('click', closeAddPlayerModal);
    
    document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
    document.getElementById('addPlayerForm').addEventListener('submit', addPlayer);
    document.getElementById('cancelAddPlayer').addEventListener('click', closeAddPlayerModal);
}

async function loadScoringConfig() {
    // Use adminClient to bypass RLS
    const { data } = await adminClient.from('scoring_config').select('*');
    if (data) {
        scoringConfig = {};
        data.forEach(item => {
            scoringConfig[item.key] = item.value;
        });
    }
}

async function loadMatchdays() {
    // Use adminClient to bypass RLS
    const { data } = await adminClient.from('kl_matchdays').select('*').order('matchday_number');
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
    // Use adminClient to bypass RLS
    const { data } = await adminClient.from('kings_league_teams').select('*').order('name');
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
    
    document.getElementById('matchInfoText').textContent = `Matchday ${matchdayNumber}: ${teamA.name} vs ${teamB.name}`;
    document.getElementById('matchInfo').classList.remove('hidden');
    
    // Render forms first, then try to load existing votes
    renderVoteForms();
    await loadExistingVotes();
    
    document.getElementById('voteSection').classList.remove('hidden');
}

async function loadTeamData(teamId) {
    // Use adminClient to bypass RLS
    const { data: team } = await adminClient.from('kings_league_teams').select('*').eq('id', teamId).single();
    const { data: players } = await adminClient.from('players').select('*').eq('team_id', teamId).order('role').order('name');
    const { data: president } = await adminClient.from('presidents').select('*').eq('team_id', teamId).single();
    return { ...team, players, president };
}

// ============================================
// RENDER FORMS
// ============================================
function renderVoteForms() {
    document.getElementById('teamAName').textContent = teamA.name.toUpperCase();
    document.getElementById('teamBName').textContent = teamB.name.toUpperCase();
    
    renderPresidentTable('teamAPresident', teamA.president, 'A');
    renderPresidentTable('teamBPresident', teamB.president, 'B');
    
    renderPlayersTable('teamAPlayers', teamA.players);
    renderPlayersTable('teamBPlayers', teamB.players);
}

function renderPresidentTable(containerId, president, team) {
    const container = document.getElementById(containerId);
    if (!president) {
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No president assigned</p>';
        return;
    }
    
    container.innerHTML = `
        <div class="president-row" data-president-id="${president.id}" data-team="${team}">
            <div class="president-name">⭐ ${president.name}</div>
            <div class="penalty-options">
                <label class="radio-option scored">
                    <input type="radio" id="pres_${team}_scored" name="pres_${team}" value="scored">
                    <label for="pres_${team}_scored">✅ Segnato</label>
                </label>
                <label class="radio-option missed">
                    <input type="radio" id="pres_${team}_missed" name="pres_${team}" value="missed">
                    <label for="pres_${team}_missed">❌ Sbagliato</label>
                </label>
                <label class="radio-option">
                    <input type="radio" id="pres_${team}_none" name="pres_${team}" value="none" checked>
                    <label for="pres_${team}_none">⚪ None</label>
                </label>
            </div>
        </div>
    `;
}

function renderPlayersTable(containerId, players) {
    const container = document.getElementById(containerId);
    if (!players || players.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No players</p>';
        return;
    }
    
    const labelId = containerId === 'teamAPlayers' ? 'teamAPlayersLabel' : 'teamBPlayersLabel';
    const sectionLabel = document.getElementById(labelId);
    if (sectionLabel) {
        sectionLabel.textContent = `Giocatori (${players.length})`;
    }
    
    const roleOrder = { 'P': 1, 'D': 2, 'C': 3, 'A': 4 };
    const sortedPlayers = [...players].sort((a, b) => {
        const orderA = roleOrder[a.role] || 99;
        const orderB = roleOrder[b.role] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
    });
    
    let html = `
        <div class="table-header">
            <div class="table-header-cell" title="Gioca">✓</div>
            <div class="table-header-cell">R</div>
            <div class="table-header-cell">NOME</div>
            <div class="table-header-cell" title="Voto Base">⚡</div>
            <div class="table-header-cell" title="Gol Normali">⚽</div>
            <div class="table-header-cell" title="Gol Doppio">💥</div>
            <div class="table-header-cell" title="Assist">🎯</div>
            <div class="table-header-cell" title="Rigori Segnati">🥅</div>
            <div class="table-header-cell" title="Rigori Sbagliati">❌</div>
            <div class="table-header-cell" title="Cartellini Gialli">🟨</div>
            <div class="table-header-cell" title="Cartellini Rossi">🟥</div>
            <div class="table-header-cell" title="Shootout Segnati">🎪</div>
            <div class="table-header-cell" title="Shootout Sbagliati">⛔</div>
            <div class="table-header-cell" title="Autogol">🔄</div>
            <div class="table-header-cell" title="Clean Sheet (solo P)">🧤</div>
            <div class="table-header-cell" title="Gol Subiti (solo P)">🥅❌</div>
            <div class="table-header-cell" title="Shootout Subiti (solo P)">🎪❌</div>
        </div>
    `;
    
    sortedPlayers.forEach(player => {
        const nameParts = player.name.trim().split(' ');
        let formattedName = player.name;
        if (nameParts.length >= 2) {
            const firstName = nameParts[0];
            const surname = nameParts.slice(1).join(' ');
            formattedName = `${firstName.charAt(0)}. ${surname}`;
        }
        
        const roleColors = {
            'P': 'background: #f39c12; color: white;',
            'D': 'background: #3498db; color: white;',
            'C': 'background: #27ae60; color: white;',
            'A': 'background: #e74c3c; color: white;'
        };
        const roleStyle = roleColors[player.role] || 'background: #95a5a6; color: white;';
        const isGoalkeeper = player.role === 'P';
        
        html += `
            <div class="player-row" data-player-id="${player.id}">
                <div class="checkbox-cell">
                    <input type="checkbox" class="gioca-checkbox" data-player-id="${player.id}">
                </div>
                <div class="role-badge" style="${roleStyle}">${player.role}</div>
                <div class="player-name-cell" title="${player.name}">${formattedName}</div>
                <div>
                    <input type="number" class="player-input base-vote-input" step="0.1" min="0" max="10" value="0" placeholder="0">
                </div>
                <div>
                    <input type="number" class="player-input goals" min="0" value="0">
                </div>
                <div>
                    <input type="number" class="player-input goals-double" min="0" value="0">
                </div>
                <div>
                    <input type="number" class="player-input assists" min="0" value="0">
                </div>
                <div>
                    <input type="number" class="player-input penalties-scored" min="0" value="0">
                </div>
                <div>
                    <input type="number" class="player-input penalties-missed" min="0" value="0">
                </div>
                <div>
                    <input type="number" class="player-input yellow-cards" min="0" value="0">
                </div>
                <div>
                    <input type="number" class="player-input red-cards" min="0" value="0">
                </div>
                <div>
                    <input type="number" class="player-input shootout-scored" min="0" value="0">
                </div>
                <div>
                    <input type="number" class="player-input shootout-missed" min="0" value="0">
                </div>
                <div>
                    <input type="number" class="player-input own-goals" min="0" value="0">
                </div>
                <div class="checkbox-cell">
                    ${isGoalkeeper ? '<input type="checkbox" class="clean-sheet-checkbox">' : ''}
                </div>
                <div>
                    ${isGoalkeeper ? '<input type="number" class="player-input goals-conceded" min="0" value="0">' : ''}
                </div>
                <div>
                    ${isGoalkeeper ? '<input type="number" class="player-input shootout-conceded" min="0" value="0">' : ''}
                </div>
                <input type="hidden" class="minutes" value="0">
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners to "Gioca" checkboxes
    container.querySelectorAll('.gioca-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const row = this.closest('.player-row');
            const voteInput = row.querySelector('.base-vote-input');
            
            if (this.checked) {
                voteInput.value = '6.0';
            } else {
                voteInput.value = '0';
            }
        });
    });
}

// ============================================
// LOAD EXISTING VOTES
// ============================================
async function loadExistingVotes() {
    const allPlayers = [...teamA.players, ...teamB.players];
    
    // Use adminClient to bypass RLS
    for (const player of allPlayers) {
        const { data } = await adminClient
            .from('player_votes')
            .select('*')
            .eq('kl_matchday_id', currentMatchday)
            .eq('player_id', player.id)
            .maybeSingle();
        
        if (data) {
            const card = document.querySelector(`[data-player-id="${player.id}"]`);
            if (card) {
                const baseVote = data.base_vote || 0;
                card.querySelector('.base-vote-input').value = baseVote;
                
                const checkbox = card.querySelector('.gioca-checkbox');
                if (checkbox) {
                    checkbox.checked = baseVote > 0;
                }
                
                card.querySelector('.goals').value = data.goals || 0;
                card.querySelector('.goals-double').value = data.goals_double || 0;
                card.querySelector('.penalties-scored').value = data.penalties_scored || 0;
                card.querySelector('.penalties-missed').value = data.penalties_missed || 0;
                card.querySelector('.assists').value = data.assists || 0;
                card.querySelector('.yellow-cards').value = data.yellow_cards || 0;
                card.querySelector('.red-cards').value = data.red_cards || 0;
                const cleanSheetCheckbox = card.querySelector('.clean-sheet-checkbox');
                if (cleanSheetCheckbox) {
                    cleanSheetCheckbox.checked = data.clean_sheet || false;
                }
                card.querySelector('.shootout-scored').value = data.shootout_scored || 0;
                card.querySelector('.shootout-missed').value = data.shootout_missed || 0;
                card.querySelector('.own-goals').value = data.own_goals || 0;
                
                const goalsConcededInput = card.querySelector('.goals-conceded');
                if (goalsConcededInput) {
                    goalsConcededInput.value = data.goals_conceded || 0;
                }
                const shootoutConcededInput = card.querySelector('.shootout-conceded');
                if (shootoutConcededInput) {
                    shootoutConcededInput.value = data.shootout_conceded || 0;
                }
                
                card.querySelector('.minutes').value = data.minutes_played || 0;
            }
        }
    }
    
    if (teamA.president) {
        const { data } = await adminClient
            .from('president_votes')
            .select('*')
            .eq('kl_matchday_id', currentMatchday)
            .eq('president_id', teamA.president.id)
            .maybeSingle();
        
        if (data) {
            if (data.penalty_scored) {
                document.getElementById('pres_A_scored').checked = true;
            } else if (data.penalty_missed) {
                document.getElementById('pres_A_missed').checked = true;
            } else {
                document.getElementById('pres_A_none').checked = true;
            }
        }
    }
    
    if (teamB.president) {
        const { data } = await adminClient
            .from('president_votes')
            .select('*')
            .eq('kl_matchday_id', currentMatchday)
            .eq('president_id', teamB.president.id)
            .maybeSingle();
        
        if (data) {
            if (data.penalty_scored) {
                document.getElementById('pres_B_scored').checked = true;
            } else if (data.penalty_missed) {
                document.getElementById('pres_B_missed').checked = true;
            } else {
                document.getElementById('pres_B_none').checked = true;
            }
        }
    }
}

// ============================================
// SAVE VOTES (WITH UPSERT) - Uses adminClient
// ============================================
async function saveAllVotes() {
    if (!confirm('Save all votes?')) return;
    
    try {
        showStatus('⏳ Saving...', 'success');
        
        const playerCards = document.querySelectorAll('[data-player-id]');
        
        // Use adminClient to bypass RLS
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
            const cleanSheetCheckbox = card.querySelector('.clean-sheet-checkbox');
            const cleanSheet = cleanSheetCheckbox ? cleanSheetCheckbox.checked : false;
            const shootoutScored = parseInt(card.querySelector('.shootout-scored').value) || 0;
            const shootoutMissed = parseInt(card.querySelector('.shootout-missed').value) || 0;
            const ownGoals = parseInt(card.querySelector('.own-goals').value) || 0;
            
            const goalsConcededInput = card.querySelector('.goals-conceded');
            const goalsConceded = goalsConcededInput ? parseInt(goalsConcededInput.value) || 0 : 0;
            
            const shootoutConcededInput = card.querySelector('.shootout-conceded');
            const shootoutConceded = shootoutConcededInput ? parseInt(shootoutConcededInput.value) || 0 : 0;
            
            const minutesPlayed = parseInt(card.querySelector('.minutes').value) || 0;
            
            const finalScore = calculatePlayerScore(
                baseVote, goals, goalsDouble, penaltiesScored, penaltiesMissed, 
                assists, yellowCards, redCards, cleanSheet, shootoutScored, 
                shootoutMissed, ownGoals, goalsConceded, shootoutConceded
            );
            
            const { error } = await adminClient.from('player_votes').upsert({
                kl_matchday_id: currentMatchday,
                player_id: playerId,
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
                goals_conceded: goalsConceded,
                shootout_conceded: shootoutConceded,
                minutes_played: minutesPlayed,
                final_score: finalScore,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'kl_matchday_id,player_id'
            });
            
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
            
            const { error } = await adminClient.from('president_votes').upsert({
                kl_matchday_id: currentMatchday,
                president_id: presidentId,
                penalty_scored: scored,
                penalty_missed: missed,
                final_score: finalScore,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'kl_matchday_id,president_id'
            });
            
            if (error) throw error;
        }
        
        showStatus('✅ Saved!', 'success');
    } catch (error) {
        console.error(error);
        showStatus('❌ Error: ' + error.message, 'error');
    }
}

function calculatePlayerScore(
    baseVote, goals, goalsDouble, penaltiesScored, penaltiesMissed, 
    assists, yellowCards, redCards, cleanSheet, shootoutScored, 
    shootoutMissed, ownGoals, goalsConceded, shootoutConceded
) {
    let score = baseVote;
    score += goals * (scoringConfig.goal_normal || 0);
    score += goalsDouble * (scoringConfig.goal_double || 0);
    score += penaltiesScored * (scoringConfig.penalty_scored || 0);
    score += penaltiesMissed * (scoringConfig.penalty_missed || 0);
    score += assists * (scoringConfig.assist || 0);
    score += yellowCards * (scoringConfig.yellow_card || 0);
    score += redCards * (scoringConfig.red_card || 0);
    score += cleanSheet ? (scoringConfig.clean_sheet || 0) : 0;
    score += shootoutScored * (scoringConfig.shootout_scored || 0);
    score += shootoutMissed * (scoringConfig.shootout_missed || 0);
    score += ownGoals * (scoringConfig.own_goal || 0);
    score += goalsConceded * (scoringConfig.goal_conceded || 0);
    score += shootoutConceded * (scoringConfig.shootout_conceded || 0);
    return Math.round(score * 10) / 10;
}

// ============================================
// CALCULATE RESULTS (RPC) - Uses adminClient
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
        
        // Use adminClient to bypass RLS
        const { data, error } = await adminClient.rpc('process_matchday_results', {
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
// CONFIG MODAL - Uses adminClient
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
        
        // Use adminClient to bypass RLS
        for (const input of inputs) {
            const key = input.dataset.configKey;
            const value = parseFloat(input.value);
            const { error } = await adminClient.from('scoring_config').update({ value }).eq('key', key);
            if (error) throw error;
        }
        await loadScoringConfig();
        closeConfigModal();
        alert('✅ Config saved!');
    } catch (error) {
        console.error(error);
        alert('❌ Error: ' + error.message);
    }
}

// ============================================
// ADD PLAYER MODAL - Uses adminClient
// ============================================
async function openAddPlayerModal() {
    const modal = document.getElementById('addPlayerModal');
    
    // Use adminClient to bypass RLS
    const { data: teams } = await adminClient.from('kings_league_teams').select('*').order('name');
    const teamSelect = document.getElementById('playerTeam');
    teamSelect.innerHTML = '<option value="">Select Team...</option>';
    if (teams) {
        teams.forEach(team => {
            const opt = document.createElement('option');
            opt.value = team.id;
            opt.textContent = team.name;
            teamSelect.appendChild(opt);
        });
    }
    
    document.getElementById('addPlayerForm').reset();
    modal.classList.add('active');
}

function closeAddPlayerModal() {
    document.getElementById('addPlayerModal').classList.remove('active');
}

async function addPlayer(e) {
    e.preventDefault();
    
    const name = document.getElementById('playerName').value.trim();
    const teamId = document.getElementById('playerTeam').value;
    const role = document.getElementById('playerRole').value;
    const rating = document.getElementById('playerRating').value;
    const avatar = document.getElementById('playerAvatar').value.trim();
    const isWildcard = document.getElementById('playerWildcard').checked;
    
    if (!name || !teamId || !role) {
        alert('Please fill all required fields!');
        return;
    }
    
    try {
        const playerData = {
            name,
            team_id: teamId,
            role,
            is_wildcard: isWildcard,
            overall_rating: rating ? parseInt(rating) : null,
            avatar_url: avatar || null
        };
        
        // Use adminClient to bypass RLS
        const { data, error } = await adminClient.from('players').insert(playerData).select();
        
        if (error) throw error;
        
        alert(`✅ Player "${name}" added successfully!`);
        closeAddPlayerModal();
        
        // Reload match if currently viewing one
        if (teamA || teamB) {
            const matchdayId = document.getElementById('matchdaySelect').value;
            const teamAId = document.getElementById('teamASelect').value;
            const teamBId = document.getElementById('teamBSelect').value;
            
            if (matchdayId && teamAId && teamBId) {
                await loadMatch();
            }
        }
    } catch (error) {
        console.error(error);
        alert('❌ Error: ' + error.message);
    }
}

function showStatus(message, type) {
    const status = document.getElementById('saveStatus');
    if (status) {
        status.textContent = message;
        status.className = `save-status ${type}`;
        setTimeout(() => {
            status.textContent = '';
            status.className = 'save-status';
        }, 5000);
    }
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
            document.getElementById('adminEmailDisplay').textContent = `👤 ${email}`;
            showScreen('mainPanel');
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
        const configModal = document.getElementById('configModal');
        const playerModal = document.getElementById('addPlayerModal');
        
        if (e.target === configModal) closeConfigModal();
        if (e.target === playerModal) closeAddPlayerModal();
    });
});
