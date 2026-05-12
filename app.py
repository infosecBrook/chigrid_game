import json
import math
import os
import random
import secrets
import string
from pathlib import Path

from flask import Flask, jsonify, render_template, request

try:
    import redis
except ImportError:
    redis = None

app = Flask(__name__)
DATA_FILE = Path(__file__).parent / "data" / "locations.json"
BOUNDARY_FILE = Path(__file__).parent / "data" / "chicago_boundary.geojson"
MAX_LOBBY_PLAYERS = 6
MATCH_ROUNDS = 20
LOBBY_CODE_LENGTH = 7
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
LOBBY_TTL_SECONDS = 60 * 60 * 12
lobbies = {}
sessions = {}
redis_client = None

if os.environ.get("REDIS_URL"):
    if redis is None:
        raise RuntimeError("REDIS_URL is set, but the redis package is not installed.")

    redis_client = redis.from_url(os.environ["REDIS_URL"], decode_responses=True)

@app.route("/")
def home():
    return render_template("index.html")

@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})

@app.route("/api/locations")
def locations():
    return jsonify(load_locations())

@app.get("/api/chicago-boundary")
def chicago_boundary():
    with BOUNDARY_FILE.open() as file:
        return jsonify(json.load(file))

@app.post("/api/session")
def create_session():
    data = request.get_json(silent=True) or {}
    token = str(data.get("sessionToken", "")).strip()
    player = load_session(token)

    if not player:
        token = secrets.token_urlsafe(32)
        player = {
            "id": secrets.token_urlsafe(16),
            "name": clean_player_name(data.get("playerName")),
        }
        save_session(token, player)
    elif data.get("playerName"):
        player["name"] = clean_player_name(data.get("playerName"))
        save_session(token, player)

    return jsonify({
        "sessionToken": token,
        "player": player,
    })

@app.get("/api/lobbies/public")
def public_lobbies():
    return jsonify([
        lobby_summary(lobby)
        for lobby in load_lobbies()
        if (
            lobby["visibility"] == "public"
            and lobby["status"] == "waiting"
            and len(lobby["players"]) < MAX_LOBBY_PLAYERS
        )
    ])

@app.post("/api/lobbies")
def create_lobby():
    data = request.get_json(silent=True) or {}
    visibility = data.get("visibility")
    player = player_from_request(data)

    if visibility not in {"public", "private"}:
        return jsonify({"error": "Choose public or private."}), 400

    if not player:
        return jsonify({"error": "Invalid session."}), 401

    code = make_lobby_code()
    lobby = {
        "code": code,
        "visibility": visibility,
        "hostId": player["id"],
        "status": "waiting",
        "players": [player],
        "rounds": [],
        "submissions": {},
    }
    save_lobby(lobby)

    return jsonify(lobby_summary(lobby))

@app.post("/api/lobbies/join")
def join_lobby():
    data = request.get_json(silent=True) or {}
    code = clean_lobby_code(data.get("code"))
    player = player_from_request(data)
    lobby = load_lobby(code)

    if not lobby:
        return jsonify({"error": "Lobby not found."}), 404

    if not player:
        return jsonify({"error": "Invalid session."}), 401

    if player["id"] not in [existing["id"] for existing in lobby["players"]]:
        if lobby["status"] != "waiting":
            return jsonify({"error": "That game already started."}), 400

        if len(lobby["players"]) >= MAX_LOBBY_PLAYERS:
            return jsonify({"error": "That lobby is full."}), 400

        lobby["players"].append(player)

    save_lobby(lobby)

    return jsonify(lobby_summary(lobby))

@app.get("/api/lobbies/<code>")
def get_lobby(code):
    lobby = load_lobby(code)

    if not lobby:
        return jsonify({"error": "Lobby not found."}), 404

    return jsonify(lobby_summary(lobby))

@app.post("/api/lobbies/<code>/start")
def start_lobby(code):
    data = request.get_json(silent=True) or {}
    lobby = load_lobby(code)
    player = player_from_request(data)

    if not lobby:
        return jsonify({"error": "Lobby not found."}), 404

    if not player:
        return jsonify({"error": "Invalid session."}), 401

    if player["id"] != lobby["hostId"]:
        return jsonify({"error": "Only the host can start the game."}), 403

    if lobby["status"] != "waiting":
        return jsonify(lobby_summary(lobby))

    all_playable_locations = [
        location for location in load_locations()
        if location.get("name") and location.get("lat") is not None and location.get("lng") is not None
    ]
    photo_locations = [
        location for location in all_playable_locations
        if location.get("image_url") or location.get("imageUrl")
    ]
    playable_locations = photo_locations if len(photo_locations) >= MATCH_ROUNDS else all_playable_locations

    if len(playable_locations) < MATCH_ROUNDS:
        return jsonify({"error": "Not enough locations to start a match."}), 400

    lobby["rounds"] = random.sample(playable_locations, MATCH_ROUNDS)
    lobby["status"] = "playing"
    lobby["submissions"] = {player["id"]: [] for player in lobby["players"]}
    save_lobby(lobby)

    return jsonify(lobby_summary(lobby))

@app.post("/api/lobbies/<code>/submit")
def submit_guess(code):
    data = request.get_json(silent=True) or {}
    lobby = load_lobby(code)
    player = player_from_request(data)

    if not lobby:
        return jsonify({"error": "Lobby not found."}), 404

    if lobby["status"] not in {"playing", "finished"}:
        return jsonify({"error": "This game has not started."}), 400

    if not player:
        return jsonify({"error": "Invalid session."}), 401

    player_id = player["id"]

    if player_id not in [existing["id"] for existing in lobby["players"]]:
        return jsonify({"error": "Player is not in this lobby."}), 403

    submissions = lobby["submissions"].setdefault(player_id, [])

    try:
        round_index = int(data.get("roundIndex", -1))
        guess_lat = float(data.get("guessLat"))
        guess_lng = float(data.get("guessLng"))
        seconds = max(float(data.get("seconds", 0)), 0)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid guess submission."}), 400

    if round_index != len(submissions) or round_index >= MATCH_ROUNDS:
        return jsonify({"error": "Round submission is out of order."}), 400

    answer = lobby["rounds"][round_index]
    distance = get_distance_in_miles(
        guess_lat,
        guess_lng,
        float(answer["lat"]),
        float(answer["lng"]),
    )
    score = get_score(distance, seconds)

    submissions.append({
        "roundIndex": round_index,
        "guessLat": guess_lat,
        "guessLng": guess_lng,
        "distance": distance,
        "seconds": seconds,
        "score": score,
    })

    if all(len(lobby["submissions"].get(player["id"], [])) >= MATCH_ROUNDS for player in lobby["players"]):
        lobby["status"] = "finished"

    save_lobby(lobby)

    return jsonify(lobby_summary(lobby))

def load_locations():
    with DATA_FILE.open() as file:
        return json.load(file)

def session_key(token):
    return f"session:{token}"

def lobby_key(code):
    return f"lobby:{code}"

def load_session(token):
    if not token:
        return None

    if redis_client:
        raw_session = redis_client.get(session_key(token))
        if not raw_session:
            return None

        redis_client.expire(session_key(token), SESSION_TTL_SECONDS)
        return json.loads(raw_session)

    return sessions.get(token)

def save_session(token, player):
    if redis_client:
        redis_client.setex(session_key(token), SESSION_TTL_SECONDS, json.dumps(player))
        return

    sessions[token] = player

def load_lobby(code):
    clean_code = clean_lobby_code(code)

    if redis_client:
        raw_lobby = redis_client.get(lobby_key(clean_code))
        if not raw_lobby:
            return None

        redis_client.expire(lobby_key(clean_code), LOBBY_TTL_SECONDS)
        return json.loads(raw_lobby)

    return lobbies.get(clean_code)

def save_lobby(lobby):
    if redis_client:
        redis_client.setex(lobby_key(lobby["code"]), LOBBY_TTL_SECONDS, json.dumps(lobby))
        return

    lobbies[lobby["code"]] = lobby

def load_lobbies():
    if redis_client:
        loaded_lobbies = []
        for key in redis_client.scan_iter("lobby:*"):
            raw_lobby = redis_client.get(key)
            if raw_lobby:
                loaded_lobbies.append(json.loads(raw_lobby))
        return loaded_lobbies

    return list(lobbies.values())

def make_lobby_code():
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(LOBBY_CODE_LENGTH))
        if not load_lobby(code):
            return code

def clean_lobby_code(code):
    allowed = string.ascii_uppercase + string.digits
    normalized = str(code or "").strip().upper().replace("-", "")

    return "".join(character for character in normalized if character in allowed)[:LOBBY_CODE_LENGTH]

def clean_player_name(name):
    return str(name or "Player").strip()[:30] or "Player"

def player_from_request(data):
    token = str(data.get("sessionToken", "")).strip()
    return load_session(token)

def get_distance_in_miles(lat1, lng1, lat2, lng2):
    earth_radius_miles = 3958.8
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return earth_radius_miles * c

def get_score(distance, seconds):
    speed_bonus = max(0, round(80 * (1 - min(seconds, 60) / 60)))

    return get_distance_points(distance) + speed_bonus

def get_distance_points(distance):
    if distance < 0.25:
        return 100
    if distance < 0.5:
        return 80
    if distance < 1:
        return 60
    if distance < 2:
        return 40
    if distance < 5:
        return 20
    return 5

def lobby_summary(lobby):
    progress = []
    for player in lobby["players"]:
        submissions = lobby["submissions"].get(player["id"], [])
        total_score = sum(submission["score"] for submission in submissions)
        total_seconds = sum(submission["seconds"] for submission in submissions)
        total_distance = sum(submission["distance"] for submission in submissions)
        progress.append({
            "id": player["id"],
            "name": player["name"],
            "roundsDone": min(len(submissions), MATCH_ROUNDS),
            "totalScore": total_score,
            "totalSeconds": round(total_seconds, 1),
            "averageDistance": round(total_distance / len(submissions), 2) if submissions else None,
            "finished": len(submissions) >= MATCH_ROUNDS,
            "submissions": submissions,
        })

    return {
        "code": lobby["code"],
        "visibility": lobby["visibility"],
        "hostId": lobby["hostId"],
        "status": lobby["status"],
        "maxPlayers": MAX_LOBBY_PLAYERS,
        "matchRounds": MATCH_ROUNDS,
        "playerCount": len(lobby["players"]),
        "players": lobby["players"],
        "progress": progress,
        "rounds": lobby["rounds"] if lobby["status"] in {"playing", "finished"} else [],
    }

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"

    app.run(host=host, port=port, debug=debug)
