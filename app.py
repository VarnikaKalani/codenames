from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import random
import secrets

# Import wonderwords for word generation
from wonderwords import RandomWord

# Create Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(16)
socketio = SocketIO(app, cors_allowed_origins="*")

# Generate word bank
r = RandomWord()
WORD_BANK = [r.word(include_parts_of_speech=["nouns"]) for _ in range(200)]
print(f"Loaded {len(WORD_BANK)} words")

# Game state storage
games = {}

def create_game():
    """Create a new game with 25 random words and team assignments"""
    # Pick 25 random words
    words = random.sample(WORD_BANK, 25)

    # Assign teams: 9 red, 8 blue, 7 neutral, 1 assassin
    # Red team always goes first, so they get 9 cards
    assignments = ['red'] * 9 + ['blue'] * 8 + ['neutral'] * 7 + ['assassin'] * 1
    random.shuffle(assignments)

    # Create grid of 25 cards
    grid = []
    for i in range(25):
        grid.append({
            'word': words[i],
            'team': assignments[i],
            'revealed': False
        })

    return {
        'grid': grid,
        'current_turn': 'red',
        'current_clue': None,
        'clue_number': 0,
        'guesses_made': 0,
        'guesses_allowed': 0,
        'red_remaining': 9,
        'blue_remaining': 8,
        'game_over': False,
        'winner': None,
        'cursors': {}
    }

# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/player/<game_id>')
def player(game_id):
    # Create game if it doesn't exist
    if game_id not in games:
        games[game_id] = create_game()
        print(f"Created new game: {game_id}")
    return render_template('player.html', game_id=game_id)

@app.route('/spymaster/<game_id>')
def spymaster(game_id):
    # Create game if it doesn't exist
    if game_id not in games:
        games[game_id] = create_game()
        print(f"Created new game: {game_id}")
    return render_template('spymaster.html', game_id=game_id)

@app.route('/reset/<game_id>', methods=['POST'])
def reset_game(game_id):
    """Reset a game with new words"""
    games[game_id] = create_game()
    print(f"Reset game: {game_id}")

    # Broadcast to all clients that game was reset
    socketio.emit('game_reset', {'gameId': game_id}, room=None)

    return {'status': 'success', 'message': 'Game reset'}

@app.route('/test')
def test():
    return "TEST ROUTE WORKS!"

# Socket.IO event handlers
@socketio.on('connect')
def handle_connect():
    """When a client connects"""
    print('Client connected')
    emit('connection_response', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    """When a client disconnects"""
    print('Client disconnected')

@socketio.on('request_game_state')
def handle_game_state_request(data):
    """Send current game state to client"""
    game_id = data.get('gameId', 'main')
    game = games.get(game_id)
    if game:
        # Send full game state
        client_game_state = {
            'grid': [
                {
                    'word': card['word'],
                    'team': card['team'],
                    'revealed': card['revealed']
                }
                for card in game['grid']
            ],
            'current_turn': game['current_turn'],
            'current_clue': game['current_clue'],
            'clue_number': game['clue_number'],
            'guesses_made': game['guesses_made'],
            'guesses_allowed': game['guesses_allowed'],
            'red_remaining': game['red_remaining'],
            'blue_remaining': game['blue_remaining'],
            'game_over': game['game_over'],
            'winner': game['winner']
        }
        emit('game_state', client_game_state)
    else:
        emit('error', {'message': f'No game found with ID: {game_id}'})

@socketio.on('reveal_card')
def handle_reveal_card(data):
    """Handle card reveal from player"""
    card_index = data.get('cardIndex')
    game_id = data.get('gameId', 'main')
    game = games.get(game_id)

    if not game or game['game_over']:
        return

    if not (0 <= card_index < 25):
        return

    card = game['grid'][card_index]

    if card['revealed']:
        return

    # Mark card as revealed
    card['revealed'] = True
    game['guesses_made'] += 1

    print(f"[{game_id}] Card {card_index} ({card['word']}) revealed: {card['team']}")

    # Check what was revealed
    end_turn = False
    card_team = card['team']

    if card_team == 'assassin':
        # Assassin revealed - instant loss for current team
        game['game_over'] = True
        game['winner'] = 'blue' if game['current_turn'] == 'red' else 'red'
        end_turn = True
        print(f"[{game_id}] ASSASSIN revealed! {game['winner'].upper()} team wins!")

    elif card_team == 'red':
        # Red card revealed
        game['red_remaining'] -= 1
        if game['red_remaining'] == 0:
            # Red team wins
            game['game_over'] = True
            game['winner'] = 'red'
            print(f"[{game_id}] RED team found all their agents and wins!")
        elif game['current_turn'] != 'red':
            # Opponent's card - end turn
            end_turn = True
        elif game['guesses_made'] > game['guesses_allowed']:
            # Used all guesses - end turn
            end_turn = True

    elif card_team == 'blue':
        # Blue card revealed
        game['blue_remaining'] -= 1
        if game['blue_remaining'] == 0:
            # Blue team wins
            game['game_over'] = True
            game['winner'] = 'blue'
            print(f"[{game_id}] BLUE team found all their agents and wins!")
        elif game['current_turn'] != 'blue':
            # Opponent's card - end turn
            end_turn = True
        elif game['guesses_made'] > game['guesses_allowed']:
            # Used all guesses - end turn
            end_turn = True

    elif card_team == 'neutral':
        # Neutral card - always ends turn
        end_turn = True

    # End turn if needed
    if end_turn and not game['game_over']:
        game['current_turn'] = 'blue' if game['current_turn'] == 'red' else 'red'
        game['current_clue'] = None
        game['clue_number'] = 0
        game['guesses_made'] = 0
        game['guesses_allowed'] = 0
        print(f"[{game_id}] Turn ended. Now {game['current_turn'].upper()} team's turn")

    # Broadcast updated game state to all clients
    socketio.emit('game_state_update', {
        'cardIndex': card_index,
        'team': card_team,
        'current_turn': game['current_turn'],
        'current_clue': game['current_clue'],
        'clue_number': game['clue_number'],
        'guesses_made': game['guesses_made'],
        'guesses_allowed': game['guesses_allowed'],
        'red_remaining': game['red_remaining'],
        'blue_remaining': game['blue_remaining'],
        'game_over': game['game_over'],
        'winner': game['winner']
    }, room=None)

@socketio.on('cursor_position')
def handle_cursor_position(data):
    """Receive cursor position and broadcast to spymaster"""
    player_id = data.get('playerId')
    x = data.get('x')
    y = data.get('y')
    
    # Broadcast to all clients (spymaster will filter)
    socketio.emit('player_cursor', {
        'playerId': player_id,
        'x': x,
        'y': y
    })

@socketio.on('cursor_move')
def handle_cursor_move(data):
    """Handle when cursor enters a card"""
    player_id = data.get('playerId')
    card_index = data.get('cardIndex')
    word = data.get('word')

    # You could broadcast this to show which card players are hovering
    # For now, we'll just log it
    print(f"Player {player_id} hovering over card {card_index}: {word}")

@socketio.on('give_clue')
def handle_give_clue(data):
    """Handle spymaster giving a clue"""
    game_id = data.get('gameId', 'main')
    clue = data.get('clue', '').strip()
    number = data.get('number', 0)

    game = games.get(game_id)

    if not game or game['game_over']:
        return

    # Validate clue
    if not clue or number < 0 or number > 9:
        emit('error', {'message': 'Invalid clue or number'})
        return

    # Set the clue
    game['current_clue'] = clue
    game['clue_number'] = number
    game['guesses_allowed'] = number + 1  # Can guess number + 1
    game['guesses_made'] = 0

    print(f"[{game_id}] {game['current_turn'].upper()} Spymaster gave clue: '{clue}' for {number}")

    # Broadcast clue to all clients
    socketio.emit('clue_given', {
        'clue': clue,
        'number': number,
        'team': game['current_turn'],
        'guesses_allowed': game['guesses_allowed']
    }, room=None)

@socketio.on('end_turn')
def handle_end_turn(data):
    """Handle operative ending their turn"""
    game_id = data.get('gameId', 'main')
    game = games.get(game_id)

    if not game or game['game_over']:
        return

    # Switch turns
    game['current_turn'] = 'blue' if game['current_turn'] == 'red' else 'red'
    game['current_clue'] = None
    game['clue_number'] = 0
    game['guesses_made'] = 0
    game['guesses_allowed'] = 0

    print(f"[{game_id}] Turn manually ended. Now {game['current_turn'].upper()} team's turn")

    # Broadcast turn change
    socketio.emit('turn_ended', {
        'current_turn': game['current_turn']
    }, room=None)

# Start the server
if __name__ == '__main__':
    print("Codenames Server starting...")
    print("Open http://localhost:5001 to start playing!")
    print("Games will be created automatically when you enter a game ID")
    socketio.run(app, debug=True, port=5001, allow_unsafe_werkzeug=True)