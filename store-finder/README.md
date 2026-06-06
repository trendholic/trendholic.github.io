# USA Store Finder — Live Dashboard

A standalone, self-contained dashboard to find **restaurants, fast food, cafés,
supermarkets, grocery & convenience stores across the whole USA**.

> This is a **separate project**. It lives entirely inside the `store-finder/`
> folder and does **not** touch or depend on any other files in the repo.

## Live URL
Once GitHub Pages is enabled: `https://trendholic.github.io/store-finder/`

## Features
- 🔍 Search by city, ZIP, or address (e.g. `Chicago`, `10001`, `Dallas TX`)
- 📍 "Use my location" geolocation
- 🍽️ Category filters: restaurants, fast food, cafés, supermarkets, grocery, convenience
- 🗺️ Interactive map (Leaflet) synced to the results list
- 📏 Distance from your center point (km + miles)
- 🔗 One-tap "open in Google Maps / Apple Maps" per store
- 📞 Address, phone, hours, website
- ⬇️ One-click CSV export → opens in Google Sheets / Excel
- 🎛️ Adjustable radius (1–25 km) and sort (nearest / name / type)

## Data sources (no API keys, no backend, no cost)
- **Stores:** OpenStreetMap Overpass API
- **Geocoding:** Nominatim
- **Map tiles:** OpenStreetMap

## How to run
Just open `index.html` in a browser, or visit the Pages URL. Pure static
HTML/CSS/JS — nothing to build or install.

## Notes & limits
- OSM coverage is excellent in cities, thinner in rural areas. It is real data,
  but not literally every store on the internet.
- Per-store photos and star ratings require a paid Places API (e.g. Google
  Places) and are intentionally not included to keep this free and key-less.
