# ChiGrid

ChiGrid is an interactive city-learning game designed to help users become mentally fluent in cities before living in or visiting them.

Starting with Chicago, the project combines interactive maps, CTA transit systems, neighborhoods, landmarks, and navigation-based challenges to teach real-world city orientation and transit knowledge.

## Goals

* Learn Chicago’s grid system
* Memorize neighborhoods and landmarks
* Understand CTA train and bus routes
* Improve real-world navigation skills
* Build mental maps of major cities

## Planned Features

* Interactive Chicago map
* Landmark guessing game
* CTA train overlays and station quizzes
* Neighborhood recognition
* Route-planning challenges
* Transit-based navigation scenarios
* Timed memory and orientation modes
* Expansion to cities like New York City and Los Angeles

## Current Stack

* Python
* Flask
* Leaflet.js
* OpenStreetMap

## Current Progress

* Flask backend initialized
* Interactive Chicago map working with Leaflet
* Project structure created
* Landmark dataset preparation started

## Setup

Clone the repository:

```bash
git clone git@github.com:infosecBrook/chigrid_game.git
cd chigrid_game
```

Create virtual environment:

```bash
python -m venv venv
source venv/bin/activate
```

Install dependencies:

```bash
pip install flask
```

Run the app:

```bash
python app.py
```

Open in browser:

```text
http://127.0.0.1:5000
```

## Vision

The long-term goal is to create a game-like system that teaches users how cities “work” through landmarks, transit systems, neighborhoods, and real-world navigation scenarios rather than traditional memorization.
