// Connect to Socket.IO
const socket = io();

// Generate a unique player ID
const playerId = 'player_' + Math.random().toString(36).substr(2, 9);

// Track game state
let gameState = null;

// Connect to server
socket.on('connect', () => {
    console.log('Connected to server');
    // Request initial game state
    socket.emit('request_game_state', { gameId: GAME_ID });
});

// Handle connection response
socket.on('connection_response', (data) => {
    console.log('Connection response:', data);
});

// Handle game state updates
socket.on('game_state', (data) => {
    console.log('Game state received:', data);
    gameState = data;
    renderGameBoard();
    updateGameInfo();
});

// Handle game state updates (after card reveal, etc.)
socket.on('game_state_update', (data) => {
    console.log('Game state update:', data);
    if (gameState && gameState.grid[data.cardIndex]) {
        gameState.grid[data.cardIndex].revealed = true;
        gameState.grid[data.cardIndex].team = data.team;
    }
    // Update game state
    gameState.current_turn = data.current_turn;
    gameState.current_clue = data.current_clue;
    gameState.clue_number = data.clue_number;
    gameState.guesses_made = data.guesses_made;
    gameState.guesses_allowed = data.guesses_allowed;
    gameState.red_remaining = data.red_remaining;
    gameState.blue_remaining = data.blue_remaining;
    gameState.game_over = data.game_over;
    gameState.winner = data.winner;

    renderGameBoard();
    updateGameInfo();

    // Check for game over
    if (data.game_over) {
        showGameOver();
    }
});

// Handle clue given
socket.on('clue_given', (data) => {
    console.log('Clue given:', data);
    if (gameState) {
        gameState.current_clue = data.clue;
        gameState.clue_number = data.number;
        gameState.guesses_allowed = data.guesses_allowed;
        gameState.guesses_made = 0;
        updateGameInfo();
    }
});

// Handle turn ended
socket.on('turn_ended', (data) => {
    console.log('Turn ended:', data);
    if (gameState) {
        gameState.current_turn = data.current_turn;
        gameState.current_clue = null;
        gameState.clue_number = 0;
        gameState.guesses_made = 0;
        gameState.guesses_allowed = 0;
        updateGameInfo();
    }
});

// Handle game reset
socket.on('game_reset', (data) => {
    console.log('Game reset:', data);
    if (data.gameId === GAME_ID) {
        // Redirect all clients to landing page
        window.location.href = '/';
    }
});

// Handle player cursor updates (for spymaster view)
socket.on('player_cursor', (data) => {
    if (IS_SPYMASTER && data.playerId !== playerId) {
        updatePlayerCursor(data);
    }
});

// Handle errors
socket.on('error', (data) => {
    console.error('Error:', data);
    alert('Error: ' + data.message);
});

// Render the game board
function renderGameBoard() {
    const gameBoard = document.getElementById('game-board');
    gameBoard.innerHTML = '';

    if (!gameState || !gameState.grid) {
        console.error('No game state available');
        return;
    }

    gameState.grid.forEach((card, index) => {
        const cardElement = document.createElement('div');
        cardElement.className = 'card';
        cardElement.dataset.index = index;

        // Add revealed state
        if (card.revealed) {
            cardElement.classList.add('revealed', card.team);
        }

        // For spymaster, show team colors on unrevealed cards
        if (IS_SPYMASTER && !card.revealed) {
            cardElement.dataset.team = card.team;
        }

        // Add word
        const wordSpan = document.createElement('span');
        wordSpan.textContent = card.word;
        cardElement.appendChild(wordSpan);

        // Add click handler for players (not spymaster)
        if (!IS_SPYMASTER && !card.revealed) {
            cardElement.addEventListener('click', () => {
                revealCard(index);
            });
        }

        // Add hover tracking for players
        if (!IS_SPYMASTER) {
            cardElement.addEventListener('mouseenter', () => {
                socket.emit('cursor_move', {
                    playerId: playerId,
                    cardIndex: index,
                    word: card.word
                });
            });
        }

        gameBoard.appendChild(cardElement);
    });
}

// Reveal a card
function revealCard(cardIndex) {
    if (!gameState || !gameState.grid[cardIndex]) return;

    const card = gameState.grid[cardIndex];
    if (card.revealed) return;

    console.log('Revealing card:', cardIndex);
    socket.emit('reveal_card', {
        cardIndex: cardIndex,
        gameId: GAME_ID
    });
}

// Track which card player is hovering over (only for players, not spymaster)
if (!IS_SPYMASTER) {
    let currentCardIndex = null;

    document.addEventListener('mouseover', (e) => {
        const card = e.target.closest('.card');
        if (card) {
            const cardIndex = parseInt(card.dataset.index);
            if (cardIndex !== currentCardIndex) {
                currentCardIndex = cardIndex;

                // Get card position
                const rect = card.getBoundingClientRect();

                socket.emit('cursor_position', {
                    playerId: playerId,
                    cardIndex: cardIndex,
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                });
            }
        } else if (currentCardIndex !== null) {
            currentCardIndex = null;
            socket.emit('cursor_position', {
                playerId: playerId,
                cardIndex: null,
                x: -1000,
                y: -1000
            });
        }
    });
}

// Update player cursor display (for spymaster)
const playerCursors = {};

function updatePlayerCursor(data) {
    const cursorContainer = document.getElementById('cursor-container');
    if (!cursorContainer) return;

    let cursor = playerCursors[data.playerId];

    if (!cursor) {
        cursor = document.createElement('div');
        cursor.className = 'player-cursor';
        cursorContainer.appendChild(cursor);
        playerCursors[data.playerId] = cursor;
    }

    // Hide cursor if not on a card
    if (data.cardIndex === null || data.x < 0) {
        cursor.style.display = 'none';
        return;
    }

    // Show and position cursor on the card
    cursor.style.display = 'block';
    cursor.style.left = data.x + 'px';
    cursor.style.top = data.y + 'px';
}

// Update game info display
function updateGameInfo() {
    if (!gameState) return;

    const gameInfoDiv = document.getElementById('game-controls');
    if (!gameInfoDiv) return;

    let html = '';

    // Team scores
    html += `<div class="score-board">
        <div class="team-score red-team ${gameState.current_turn === 'red' ? 'active-team' : ''}">
            <span class="team-icon">🔴</span>
            <span class="team-name">RED TEAM</span>
            <span class="team-remaining">${gameState.red_remaining} left</span>
        </div>
        <div class="team-score blue-team ${gameState.current_turn === 'blue' ? 'active-team' : ''}">
            <span class="team-icon">🔵</span>
            <span class="team-name">BLUE TEAM</span>
            <span class="team-remaining">${gameState.blue_remaining} left</span>
        </div>
    </div>`;

    // Current turn and clue info
    if (!gameState.game_over) {
        const turnColor = gameState.current_turn === 'red' ? '#D97D7D' : '#7D9FC4';
        html += `<div class="turn-indicator" style="border-color: ${turnColor};">
            <strong style="color: ${turnColor};">${gameState.current_turn.toUpperCase()}'S TURN</strong>
        </div>`;

        // Show current clue if exists
        if (gameState.current_clue) {
            const guessesRemaining = gameState.guesses_allowed - gameState.guesses_made;
            html += `<div class="clue-display">
                <div class="clue-text">Clue: <strong>${gameState.current_clue.toUpperCase()}</strong> for <strong>${gameState.clue_number}</strong></div>
                <div class="guesses-info">Guesses: ${gameState.guesses_made} / ${gameState.guesses_allowed} (${guessesRemaining} remaining)</div>
            </div>`;
        }

        // End turn button (for operatives after clue is given)
        if (!IS_SPYMASTER && gameState.current_clue && gameState.guesses_made > 0) {
            html += `<button onclick="endTurn()" class="end-turn-btn">End Turn</button>`;
        }
    }

    gameInfoDiv.innerHTML = html;

    // Handle spymaster sidebar separately
    updateSpymasterSidebar();
}

// Update spymaster sidebar (clue form)
function updateSpymasterSidebar() {
    // Removed - no clue form needed
}

// Give a clue (spymaster only)
function giveClue() {
    const clueInput = document.getElementById('clueInput');
    const numberInput = document.getElementById('clueNumber');

    if (!clueInput || !numberInput) return;

    const clue = clueInput.value.trim();
    const number = parseInt(numberInput.value);

    if (!clue) {
        alert('Please enter a clue word');
        return;
    }

    if (isNaN(number) || number < 0 || number > 9) {
        alert('Please enter a number between 0 and 9');
        return;
    }

    // Check if it's a single word
    if (clue.includes(' ')) {
        alert('Clue must be a single word!');
        return;
    }

    socket.emit('give_clue', {
        gameId: GAME_ID,
        clue: clue,
        number: number
    });

    clueInput.value = '';
    numberInput.value = '1';
}

// End turn manually
function endTurn() {
    if (confirm('Are you sure you want to end your turn?')) {
        socket.emit('end_turn', {
            gameId: GAME_ID
        });
    }
}

// Show game over screen
function showGameOver() {
    if (!gameState || !gameState.game_over) return;

    const winnerColor = gameState.winner === 'red' ? '#D97D7D' : '#7D9FC4';
    const winnerEmoji = gameState.winner === 'red' ? '🔴' : '🔵';

    const overlay = document.createElement('div');
    overlay.className = 'game-over-overlay';
    overlay.innerHTML = `
        <div class="game-over-modal">
            <h1 style="color: ${winnerColor};">${winnerEmoji} ${gameState.winner.toUpperCase()} TEAM WINS! ${winnerEmoji}</h1>
            <p>Congratulations!</p>
            <button onclick="playAgain()" class="play-again-btn">Play Again</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

// Play again - reset game and go back to landing
async function playAgain() {
    try {
        // Reset the game with new words
        const response = await fetch(`/reset/${GAME_ID}`, {
            method: 'POST'
        });

        if (response.ok) {
            // Redirect to landing page
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Error resetting game:', error);
        // Fallback: just redirect to landing
        window.location.href = '/';
    }
}

// Initial game state request
console.log('Requesting game state for:', GAME_ID);
