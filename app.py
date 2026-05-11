import json
import os
import random
import string
from pathlib import Path

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
DATA_FILE = Path(__file__).parent / "data" / "locations.json"
MAX_LOBBY_PLAYERS = 6
MATCH_ROUNDS = 20
lobbies = {}

@app.route("/")
def home():
    return render_template("index.html")

@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})

@app.route("/api/locations")
def locations():
    return jsonify(load_locations())

@app.get("/api/lobbies/public")
def public_lobbies():
    return jsonify([
        lobby_summary(lobby)
        for lobby in lobbies.values()
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
    player = clean_player(data)

    if visibility not in {"public", "private"}:
        return jsonify({"error": "Choose public or private."}), 400

    if not player["id"]:
        return jsonify({"error": "Missing player id."}), 400

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
    lobbies[code] = lobby

    return jsonify(lobby_summary(lobby))

@app.post("/api/lobbies/join")
def join_lobby():
    data = request.get_json(silent=True) or {}
    code = str(data.get("code", "")).strip()
    player = clean_player(data)
    lobby = lobbies.get(code)

    if not lobby:
        return jsonify({"error": "Lobby not found."}), 404

    if not player["id"]:
        return jsonify({"error": "Missing player id."}), 400

    if player["id"] not in [existing["id"] for existing in lobby["players"]]:
        if lobby["status"] != "waiting":
            return jsonify({"error": "That game already started."}), 400

        if len(lobby["players"]) >= MAX_LOBBY_PLAYERS:
            return jsonify({"error": "That lobby is full."}), 400

        lobby["players"].append(player)

    return jsonify(lobby_summary(lobby))

@app.get("/api/lobbies/<code>")
def get_lobby(code):
    lobby = lobbies.get(code)

    if not lobby:
        return jsonify({"error": "Lobby not found."}), 404

    return jsonify(lobby_summary(lobby))

@app.post("/api/lobbies/<code>/start")
def start_lobby(code):
    data = request.get_json(silent=True) or {}
    lobby = lobbies.get(code)

    if not lobby:
        return jsonify({"error": "Lobby not found."}), 404

    if str(data.get("playerId", "")).strip() != lobby["hostId"]:
        return jsonify({"error": "Only the host can start the game."}), 403

    if lobby["status"] != "waiting":
        return jsonify(lobby_summary(lobby))

    playable_locations = [
        location for location in load_locations()
        if location.get("name") and location.get("lat") is not None and location.get("lng") is not None
    ]

    if len(playable_locations) < MATCH_ROUNDS:
        return jsonify({"error": "Not enough locations to start a match."}), 400

    lobby["rounds"] = random.sample(playable_locations, MATCH_ROUNDS)
    lobby["status"] = "playing"
    lobby["submissions"] = {player["id"]: [] for player in lobby["players"]}

    return jsonify(lobby_summary(lobby))

@app.post("/api/lobbies/<code>/submit")
def submit_guess(code):
    data = request.get_json(silent=True) or {}
    lobby = lobbies.get(code)
    player_id = str(data.get("playerId", "")).strip()

    if not lobby:
        return jsonify({"error": "Lobby not found."}), 404

    if lobby["status"] not in {"playing", "finished"}:
        return jsonify({"error": "This game has not started."}), 400

    if player_id not in [player["id"] for player in lobby["players"]]:
        return jsonify({"error": "Player is not in this lobby."}), 403

    submissions = lobby["submissions"].setdefault(player_id, [])

    try:
        round_index = int(data.get("roundIndex", -1))
        distance = max(float(data.get("distance", 0)), 0)
        seconds = max(float(data.get("seconds", 0)), 0)
        score = max(int(data.get("score", 0)), 0)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid guess submission."}), 400

    if round_index != len(submissions) or round_index >= MATCH_ROUNDS:
        return jsonify({"error": "Round submission is out of order."}), 400

    submissions.append({
        "roundIndex": round_index,
        "distance": distance,
        "seconds": seconds,
        "score": score,
    })

    if all(len(lobby["submissions"].get(player["id"], [])) >= MATCH_ROUNDS for player in lobby["players"]):
        lobby["status"] = "finished"

    return jsonify(lobby_summary(lobby))

def load_locations():
    with DATA_FILE.open() as file:
        return json.load(file)

def make_lobby_code():
    while True:
        code = "".join(random.choices(string.digits, k=7))
        if code not in lobbies:
            return code

def clean_player(data):
    player_id = str(data.get("playerId", "")).strip()[:80]
    player_name = str(data.get("playerName", "Player")).strip()[:30] or "Player"

    return {
        "id": player_id,
        "name": player_name,
    }

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
