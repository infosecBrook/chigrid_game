const chicagoCenter = [41.8781, -87.6298];

const map = L.map("map").setView(chicagoCenter, 11);
map.createPane("boundaryPane");
map.getPane("boundaryPane").style.zIndex = 450;
map.getPane("boundaryPane").style.pointerEvents = "none";

const guessingLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
}).addTo(map);

const revealLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
});

const elements = {
    lobbyScreen: document.getElementById("lobby-screen"),
    lobbyHome: document.getElementById("lobby-home"),
    createView: document.getElementById("create-view"),
    joinView: document.getElementById("join-view"),
    waitingView: document.getElementById("waiting-view"),
    matchFinishedView: document.getElementById("match-finished-view"),
    showCreate: document.getElementById("show-create"),
    showJoin: document.getElementById("show-join"),
    createPublic: document.getElementById("create-public"),
    createPrivate: document.getElementById("create-private"),
    publicLobbies: document.getElementById("public-lobbies"),
    privateCode: document.getElementById("private-code"),
    joinPrivate: document.getElementById("join-private"),
    lobbyTitle: document.getElementById("lobby-title"),
    lobbyCodeLine: document.getElementById("lobby-code-line"),
    lobbyPlayers: document.getElementById("lobby-players"),
    lobbyMessage: document.getElementById("lobby-message"),
    lobbyStatus: document.getElementById("lobby-status"),
    startGame: document.getElementById("start-game"),
    hostWaitingNote: document.getElementById("host-waiting-note"),
    matchFinishedTitle: document.getElementById("match-finished-title"),
    matchFinishedMessage: document.getElementById("match-finished-message"),
    matchResults: document.getElementById("match-results"),
    prompt: document.getElementById("prompt"),
    category: document.getElementById("category"),
    lineInfo: document.getElementById("line-info"),
    result: document.getElementById("result"),
    guessActions: document.getElementById("guess-actions"),
    confirmGuess: document.getElementById("confirm-guess"),
    cancelGuess: document.getElementById("cancel-guess"),
    nextButton: document.getElementById("next-location"),
    totalScore: document.getElementById("total-score"),
    roundsPlayed: document.getElementById("rounds-played"),
    averageDistance: document.getElementById("average-distance"),
    photoPanel: document.getElementById("photo-panel"),
    photoClue: document.getElementById("photo-clue"),
    photoMessage: document.getElementById("photo-message")
};

let currentLobby = null;
let lobbyPollTimer = null;
let matchRounds = [];
let currentLocation = null;
let currentRoundIndex = 0;
let roundStartedAt = 0;
let canGuess = false;
let pendingGuessLatLng = null;
let guessMarker = null;
let answerMarker = null;
let answerLine = null;
let totalScore = 0;
let totalDistance = 0;
let gameStarted = false;
let playerFinished = false;
let sessionToken = null;
let playerId = null;
let playerName = null;
let chicagoBoundaryLayer = null;

const guessIcon = L.divIcon({
    className: "guess-marker",
    html: "<span></span>",
    iconSize: [20, 20],
    iconAnchor: [10, 10]
});

const answerIcon = L.divIcon({
    className: "answer-marker",
    html: "<span></span>",
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

function getOrCreatePlayerName() {
    let name = localStorage.getItem("chigridPlayerName");

    if (!name) {
        name = `Player ${Math.floor(1000 + Math.random() * 9000)}`;
        localStorage.setItem("chigridPlayerName", name);
    }

    return name;
}

async function initializeSession() {
    const session = await postJson("/api/session", {
        sessionToken: localStorage.getItem("chigridSessionToken"),
        playerName: getOrCreatePlayerName()
    });

    sessionToken = session.sessionToken;
    playerId = session.player.id;
    playerName = session.player.name;
    localStorage.setItem("chigridSessionToken", sessionToken);
    localStorage.setItem("chigridPlayerName", playerName);
}

function showLobbyView(view) {
    [elements.lobbyHome, elements.createView, elements.joinView, elements.waitingView, elements.matchFinishedView].forEach((section) => {
        section.classList.add("hidden");
    });

    view.classList.remove("hidden");
    setLobbyMessage("");
}

async function createLobby(visibility) {
    const lobby = await postJson("/api/lobbies", {
        visibility,
        sessionToken
    });

    enterLobby(lobby);
}

async function loadPublicLobbies() {
    try {
        const response = await fetch("/api/lobbies/public");
        const lobbies = await response.json();

        elements.publicLobbies.innerHTML = "";

        if (lobbies.length === 0) {
            elements.publicLobbies.innerHTML = `<p class="empty-state">No public games yet.</p>`;
            return;
        }

        lobbies.forEach((lobby) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "lobby-row";
            button.textContent = `Public game ${lobby.code} (${lobby.playerCount}/${lobby.maxPlayers})`;
            button.addEventListener("click", () => joinLobby(lobby.code));
            elements.publicLobbies.appendChild(button);
        });
    } catch (error) {
        setLobbyMessage("Could not load public games.");
        console.error(error);
    }
}

async function joinLobby(code) {
    const cleanCode = String(code).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);

    if (cleanCode.length !== 7) {
        setLobbyMessage("Enter a 7 digit private code.");
        return;
    }

    const lobby = await postJson("/api/lobbies/join", {
        code: cleanCode,
        sessionToken
    });

    enterLobby(lobby);
}

async function startLobbyGame() {
    if (!currentLobby) return;

    const lobby = await postJson(`/api/lobbies/${currentLobby.code}/start`, {
        sessionToken
    });

    renderLobby(lobby);
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Request failed.");
    }

    return data;
}

function enterLobby(lobby) {
    currentLobby = lobby;
    showLobbyView(elements.waitingView);
    renderLobby(lobby);
    startLobbyPolling();
}

function renderLobby(lobby) {
    currentLobby = lobby;

    if (lobby.status === "playing" && !gameStarted) {
        launchMatch(lobby);
    }

    if (playerFinished) {
        renderFinishedScreen(lobby);
    }

    elements.lobbyTitle.textContent = `${capitalize(lobby.visibility)} Game`;
    elements.lobbyCodeLine.textContent = lobby.visibility === "private"
        ? `Private code: ${lobby.code}`
        : `Public lobby code: ${lobby.code}`;

    renderPlayerList(lobby.progress.length ? lobby.progress : lobby.players);

    const isHost = lobby.hostId === playerId;
    elements.startGame.classList.toggle("hidden", !isHost || lobby.status !== "waiting");
    elements.hostWaitingNote.textContent = isHost
        ? "Wait for everyone to join, then start the match."
        : "Waiting for the host to click Let's Go.";

    elements.lobbyStatus.classList.remove("hidden");
    elements.lobbyStatus.textContent =
        `${capitalize(lobby.visibility)} lobby ${lobby.code} - ${lobby.playerCount}/${lobby.maxPlayers} players - ${capitalize(lobby.status)}`;
}

function renderPlayerList(players) {
    elements.lobbyPlayers.innerHTML = "";
    players.forEach((player) => {
        const item = document.createElement("div");
        const progress = player.roundsDone !== undefined ? ` - ${player.roundsDone}/20` : "";
        item.textContent = `${player.name}${progress}`;
        elements.lobbyPlayers.appendChild(item);
    });
}

function startLobbyPolling() {
    stopLobbyPolling();

    lobbyPollTimer = window.setInterval(async () => {
        if (!currentLobby) return;

        try {
            const response = await fetch(`/api/lobbies/${currentLobby.code}`);
            const lobby = await response.json();

            if (response.ok) {
                renderLobby(lobby);
            }
        } catch (error) {
            console.error(error);
        }
    }, 2000);
}

function stopLobbyPolling() {
    if (lobbyPollTimer) {
        window.clearInterval(lobbyPollTimer);
        lobbyPollTimer = null;
    }
}

function launchMatch(lobby) {
    gameStarted = true;
    matchRounds = lobby.rounds;
    elements.lobbyScreen.classList.add("hidden");
    map.invalidateSize();
    startRound(0);
}

function startRound(index) {
    clearRoundMarkers();
    setMapMode("guessing");

    currentRoundIndex = index;
    currentLocation = matchRounds[currentRoundIndex];
    canGuess = true;
    pendingGuessLatLng = null;
    roundStartedAt = performance.now();

    elements.prompt.textContent = `Find: ${currentLocation.name}`;
    elements.category.textContent = `Category: ${currentLocation.category || "Unknown"}`;
    renderLineInfo(currentLocation);
    elements.result.textContent = "Click the map where you think this is.";
    hideGuessActions();
    elements.nextButton.disabled = true;
    elements.nextButton.textContent = currentRoundIndex === matchRounds.length - 1 ? "Finish Match" : "Next Location";
    updateStats();
    updatePhotoClue(currentLocation);
}

function updatePhotoClue(location) {
    const imageUrl = location.image_url || location.imageUrl;

    elements.photoClue.removeAttribute("src");
    elements.photoClue.alt = `${location.name} photo clue`;

    if (!imageUrl) {
        elements.photoClue.classList.add("hidden");
        setPhotoMessage("No photo clue added for this location yet.");
        return;
    }

    elements.photoClue.classList.remove("hidden");
    elements.photoClue.src = imageUrl;
    setPhotoMessage("");
}

function setPhotoMessage(message) {
    elements.photoMessage.textContent = message;
    elements.photoMessage.classList.toggle("hidden", !message);
}

async function handleMapClick(event) {
    if (!canGuess || !currentLocation) {
        return;
    }

    pendingGuessLatLng = event.latlng;

    if (guessMarker) {
        guessMarker.setLatLng(pendingGuessLatLng);
    } else {
        guessMarker = L.marker(pendingGuessLatLng, { icon: guessIcon })
            .addTo(map)
            .bindPopup("Your guess");
    }

    elements.result.textContent = "Confirm this spot, or cancel and choose again.";
    showGuessActions();
}

async function confirmGuess() {
    if (!canGuess || !currentLocation || !pendingGuessLatLng) {
        return;
    }

    const seconds = (performance.now() - roundStartedAt) / 1000;
    const guessLatLng = pendingGuessLatLng;
    const answerLatLng = L.latLng(Number(currentLocation.lat), Number(currentLocation.lng));

    canGuess = false;
    hideGuessActions();
    elements.result.textContent = "Submitting guess...";

    try {
        const lobby = await postJson(`/api/lobbies/${currentLobby.code}/submit`, {
            sessionToken,
            roundIndex: currentRoundIndex,
            guessLat: guessLatLng.lat,
            guessLng: guessLatLng.lng,
            seconds
        });
        const myProgress = lobby.progress.find((player) => player.id === playerId);
        const submittedRound = myProgress.submissions[myProgress.submissions.length - 1];

        totalScore = myProgress.totalScore;
        totalDistance += submittedRound.distance;

        answerMarker = L.marker(answerLatLng, { icon: answerIcon })
            .addTo(map)
            .bindPopup(currentLocation.name);

        answerLine = L.polyline([guessLatLng, answerLatLng], {
            color: "#00a1de",
            weight: 4,
            opacity: 0.85,
            dashArray: "8 8"
        }).addTo(map);

        map.fitBounds(answerLine.getBounds(), {
            padding: [80, 80],
            maxZoom: 14
        });

        showRoundResult(submittedRound.distance, submittedRound.seconds, submittedRound.score);
        setMapMode("reveal");
        updateStats();
        renderLobby(lobby);
        elements.nextButton.disabled = false;
    } catch (error) {
        elements.result.textContent = error.message;
        canGuess = true;
        showGuessActions();
        console.error(error);
    }
}

function cancelGuess() {
    if (!canGuess) {
        return;
    }

    pendingGuessLatLng = null;

    if (guessMarker) {
        map.removeLayer(guessMarker);
        guessMarker = null;
    }

    elements.result.textContent = "Click the map where you think this is.";
    hideGuessActions();
}

function goToNextRound() {
    if (canGuess || !gameStarted) return;

    if (currentRoundIndex < matchRounds.length - 1) {
        startRound(currentRoundIndex + 1);
        return;
    }

    playerFinished = true;
    canGuess = false;
    elements.lobbyScreen.classList.remove("hidden");
    renderFinishedScreen(currentLobby);
}

function renderFinishedScreen(lobby) {
    showLobbyView(elements.matchFinishedView);

    if (lobby.status === "finished") {
        elements.matchFinishedTitle.textContent = "Final Results";
        elements.matchFinishedMessage.textContent = "Everyone finished the 20-location match.";
    } else if (lobby.playerCount <= 1) {
        elements.matchFinishedTitle.textContent = "Match Complete";
        elements.matchFinishedMessage.textContent = "You finished all 20 locations.";
    } else {
        elements.matchFinishedTitle.textContent = "Waiting for everyone";
        elements.matchFinishedMessage.textContent = "You finished all 20 locations. Results unlock when the whole lobby is done.";
    }

    elements.matchResults.innerHTML = "";
    [...lobby.progress]
        .sort((a, b) => b.totalScore - a.totalScore)
        .forEach((player, index) => {
            const item = document.createElement("div");
            const distance = player.averageDistance === null ? "--" : `${player.averageDistance} mi avg`;
            item.textContent = `${index + 1}. ${player.name} - ${player.totalScore} pts - ${player.roundsDone}/20 - ${distance}`;
            elements.matchResults.appendChild(item);
        });
}

function getDistanceInMiles(lat1, lng1, lat2, lng2) {
    const earthRadiusMiles = 3958.8;
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);

    // Haversine measures distance over the earth's surface from two lat/lng points.
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
            Math.cos(toRadians(lat2)) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMiles * c;
}

function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

function updateStats() {
    const roundsDone = canGuess ? currentRoundIndex : currentRoundIndex + 1;
    const average = roundsDone > 0 ? `${(totalDistance / roundsDone).toFixed(2)} mi` : "--";

    elements.totalScore.textContent = totalScore;
    elements.roundsPlayed.textContent = gameStarted ? `${roundsDone}/20` : "0/20";
    elements.averageDistance.textContent = average;
}

function showRoundResult(distance, seconds, roundScore) {
    const lines = getLineText(currentLocation);
    elements.result.innerHTML = `
        <strong>${distance.toFixed(2)} miles away</strong>
        <span>${roundScore} points in ${seconds.toFixed(1)} seconds</span>
        <dl>
            <dt>Answer</dt>
            <dd>${escapeHtml(currentLocation.name)}</dd>
            ${lines ? `<dt>Lines</dt><dd>${escapeHtml(lines)}</dd>` : ""}
            <dt>Neighborhood</dt>
            <dd>${escapeHtml(currentLocation.neighborhood || "Unknown")}</dd>
            <dt>Streets</dt>
            <dd>${escapeHtml(currentLocation.streets || "Unknown")}</dd>
            <dt>Category</dt>
            <dd>${escapeHtml(currentLocation.category || "Unknown")}</dd>
        </dl>
    `;
}

function renderLineInfo(location) {
    const lines = Array.isArray(location.lines) ? location.lines : [];
    const colors = Array.isArray(location.line_colors) ? location.line_colors : [];

    elements.lineInfo.innerHTML = "";

    if (lines.length === 0) {
        elements.lineInfo.classList.add("hidden");
        return;
    }

    lines.forEach((line, index) => {
        const badge = document.createElement("span");
        badge.className = "line-badge";
        badge.textContent = line;
        badge.style.setProperty("--line-color", colors[index] || "#00a1de");
        elements.lineInfo.appendChild(badge);
    });

    elements.lineInfo.classList.remove("hidden");
}

function getLineText(location) {
    return Array.isArray(location.lines) ? location.lines.join(", ") : "";
}

function clearRoundMarkers() {
    [guessMarker, answerMarker, answerLine].forEach((layer) => {
        if (layer) {
            map.removeLayer(layer);
        }
    });

    pendingGuessLatLng = null;
    guessMarker = null;
    answerMarker = null;
    answerLine = null;
}

function showGuessActions() {
    elements.guessActions.classList.remove("hidden");
}

function hideGuessActions() {
    elements.guessActions.classList.add("hidden");
}

function setMapMode(mode) {
    if (mode === "reveal") {
        if (map.hasLayer(guessingLayer)) {
            map.removeLayer(guessingLayer);
        }
        if (!map.hasLayer(revealLayer)) {
            revealLayer.addTo(map);
        }
        bringBoundaryToFront();
        return;
    }

    if (map.hasLayer(revealLayer)) {
        map.removeLayer(revealLayer);
    }
    if (!map.hasLayer(guessingLayer)) {
        guessingLayer.addTo(map);
    }
    bringBoundaryToFront();
}

async function loadChicagoBoundary() {
    const response = await fetch("/api/chicago-boundary");

    if (!response.ok) {
        throw new Error("Could not load Chicago city boundary.");
    }

    const boundary = await response.json();

    chicagoBoundaryLayer = L.geoJSON(boundary, {
        pane: "boundaryPane",
        interactive: false,
        style: {
            color: "#c60c30",
            weight: 4,
            opacity: 0.95,
            fill: false,
            dashArray: "8 6"
        }
    }).addTo(map);

    bringBoundaryToFront();
}

function bringBoundaryToFront() {
    if (chicagoBoundaryLayer) {
        chicagoBoundaryLayer.bringToFront();
    }
}

function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function setLobbyMessage(message) {
    elements.lobbyMessage.textContent = message;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

map.on("click", handleMapClick);
loadChicagoBoundary().catch((error) => console.error(error));
elements.confirmGuess.addEventListener("click", () => confirmGuess().catch((error) => console.error(error)));
elements.cancelGuess.addEventListener("click", cancelGuess);
elements.nextButton.addEventListener("click", goToNextRound);
elements.showCreate.addEventListener("click", () => showLobbyView(elements.createView));
elements.showJoin.addEventListener("click", () => {
    showLobbyView(elements.joinView);
    loadPublicLobbies();
});
elements.createPublic.addEventListener("click", () => createLobby("public").catch((error) => setLobbyMessage(error.message)));
elements.createPrivate.addEventListener("click", () => createLobby("private").catch((error) => setLobbyMessage(error.message)));
elements.joinPrivate.addEventListener("click", () => joinLobby(elements.privateCode.value).catch((error) => setLobbyMessage(error.message)));
elements.startGame.addEventListener("click", () => startLobbyGame().catch((error) => setLobbyMessage(error.message)));
elements.photoClue.addEventListener("error", () => {
    elements.photoClue.classList.add("hidden");
    setPhotoMessage("Photo clue could not load for this location.");
});
elements.photoClue.addEventListener("load", () => {
    setPhotoMessage("");
});
document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => showLobbyView(document.getElementById(button.dataset.back)));
});

initializeSession().catch((error) => {
    setLobbyMessage("Could not create a player session. Refresh the page.");
    console.error(error);
});
