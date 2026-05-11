const chicagoCenter = [41.8781, -87.6298];

const map = L.map("map").setView(chicagoCenter, 11);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);