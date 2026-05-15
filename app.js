const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const searchBtn = document.getElementById("search-btn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

const map = L.map("map").setView([20, 0], 2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

let markers = [];

function clearMarkers() {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function dedupeKey(name, lat, lon) {
  return `${name.toLowerCase()}|${lat.toFixed(2)},${lon.toFixed(2)}`;
}

const SETTLEMENT_VALUES = new Set([
  "country",
  "state",
  "region",
  "province",
  "district",
  "county",
  "municipality",
  "city",
  "town",
  "village",
  "borough",
]);

function isSettlement(osmKey, osmValue) {
  if (osmKey === "place" && SETTLEMENT_VALUES.has(osmValue)) return true;
  if (osmKey === "boundary" && osmValue === "administrative") return true;
  return false;
}

function normalizePhoton(feature) {
  const props = feature.properties || {};
  const [lon, lat] = feature.geometry?.coordinates || [];
  const name = props.name || "";
  const contextParts = [props.city, props.county, props.state, props.country]
    .filter((p) => p && p !== name);
  return {
    name,
    secondary: contextParts.join(", "),
    country: props.country || "Unknown",
    countryCode: (props.countrycode || "").toUpperCase(),
    osmKey: props.osm_key || "",
    osmValue: props.osm_value || "",
    type: props.osm_value || props.type || "",
    lat,
    lon,
    source: "photon",
    key: dedupeKey(name, lat, lon),
  };
}

function normalizeNominatim(place) {
  const lat = parseFloat(place.lat);
  const lon = parseFloat(place.lon);
  const addr = place.address || {};
  const name = (place.display_name || "").split(",")[0].trim();
  const contextParts = [addr.city, addr.town, addr.village, addr.county, addr.state, addr.country]
    .filter((p, i, arr) => p && p !== name && arr.indexOf(p) === i);
  return {
    name,
    secondary: contextParts.join(", "),
    country: addr.country || "Unknown",
    countryCode: (addr.country_code || "").toUpperCase(),
    osmKey: place.class || "",
    osmValue: place.type || "",
    type: place.type || place.class || "",
    lat,
    lon,
    source: "nominatim",
    key: dedupeKey(name, lat, lon),
  };
}

function filterByQuery(places, query) {
  const term = query.split(",")[0].trim().toLowerCase();
  if (!term) return places;
  return places.filter((p) => p.name.trim().toLowerCase() === term);
}

function dedupe(places) {
  const seen = new Map();
  for (const p of places) {
    if (!seen.has(p.key)) seen.set(p.key, p);
  }
  return [...seen.values()];
}

function groupByCountry(places) {
  const groups = new Map();
  for (const place of places) {
    const country = place.country;
    if (!groups.has(country)) {
      groups.set(country, { code: place.countryCode, places: [] });
    }
    groups.get(country).places.push(place);
  }
  return [...groups.entries()].sort((a, b) => {
    if (b[1].places.length !== a[1].places.length) {
      return b[1].places.length - a[1].places.length;
    }
    return a[0].localeCompare(b[0]);
  });
}

function countryFlag(code) {
  if (!code || code.length !== 2) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(...[...code].map((c) => A + c.charCodeAt(0) - 65));
}

function renderResults(places) {
  resultsEl.innerHTML = "";
  clearMarkers();

  if (places.length === 0) {
    setStatus("No matching places found. Try a different spelling.");
    return;
  }

  const grouped = groupByCountry(places);
  setStatus(
    `Found ${places.length} place${places.length === 1 ? "" : "s"} across ${grouped.length} ${
      grouped.length === 1 ? "country" : "countries"
    }.`
  );

  const bounds = L.latLngBounds([]);

  grouped.forEach(([country, { code, places: countryPlaces }]) => {
    const details = document.createElement("details");
    details.className = "country-group";
    details.open = grouped.length <= 3;

    const summary = document.createElement("summary");
    summary.className = "country-summary";
    summary.innerHTML = `
      <span class="country-flag">${countryFlag(code)}</span>
      <span class="country-name">${country}</span>
      <span class="country-count">${countryPlaces.length}</span>
    `;
    details.appendChild(summary);

    const list = document.createElement("div");
    list.className = "country-places";

    countryPlaces.forEach((place) => {
      const item = document.createElement("div");
      item.className = "result-item";
      item.innerHTML = `
        <div class="result-name">${place.name}</div>
        <div class="result-detail">
          <span>${place.secondary || "—"}</span>
          ${place.type ? `<span class="badge">${place.type.replace(/_/g, " ")}</span>` : ""}
        </div>
      `;

      const marker = L.marker([place.lat, place.lon]).addTo(map);
      marker.bindPopup(`<strong>${place.name}</strong><br>${place.secondary}`);
      markers.push(marker);
      bounds.extend([place.lat, place.lon]);

      item.addEventListener("click", () => {
        document.querySelectorAll(".result-item").forEach((el) => el.classList.remove("active"));
        item.classList.add("active");
        map.setView([place.lat, place.lon], 10);
        marker.openPopup();
      });

      list.appendChild(item);
    });

    details.appendChild(list);
    resultsEl.appendChild(details);
  });

  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
  }
}

async function searchPhoton(query) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "50");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const data = await res.json();
  return (data.features || []).map(normalizePhoton);
}

async function searchNominatim(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "50");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("dedupe", "0");
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  return data.map(normalizeNominatim);
}

async function searchLocation(query) {
  const results = await Promise.allSettled([searchPhoton(query), searchNominatim(query)]);
  const merged = [];
  for (const r of results) {
    if (r.status === "fulfilled") merged.push(...r.value);
  }
  if (merged.length === 0 && results.every((r) => r.status === "rejected")) {
    throw new Error(results[0].reason?.message || "Search failed");
  }
  return merged;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;

  searchBtn.disabled = true;
  setStatus("Searching...");
  resultsEl.innerHTML = "";

  try {
    const raw = await searchLocation(query);
    const settlements = raw.filter((p) => isSettlement(p.osmKey, p.osmValue));
    const filtered = dedupe(filterByQuery(settlements, query));
    renderResults(filtered);
  } catch (err) {
    setStatus(err.message || "Something went wrong. Please try again.", true);
  } finally {
    searchBtn.disabled = false;
  }
});
