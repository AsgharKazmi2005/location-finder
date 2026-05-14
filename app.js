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

function formatDisplayName(place) {
  const parts = place.display_name.split(",").map((p) => p.trim());
  return {
    primary: parts[0],
    secondary: parts.slice(1).join(", "),
  };
}

function renderResults(places) {
  resultsEl.innerHTML = "";
  clearMarkers();

  if (places.length === 0) {
    setStatus("No matching places found. Try a different spelling.");
    return;
  }

  setStatus(`Found ${places.length} place${places.length === 1 ? "" : "s"} matching your search.`);

  const bounds = L.latLngBounds([]);

  places.forEach((place, idx) => {
    const { primary, secondary } = formatDisplayName(place);
    const lat = parseFloat(place.lat);
    const lon = parseFloat(place.lon);

    const item = document.createElement("div");
    item.className = "result-item";
    item.dataset.index = idx;
    item.innerHTML = `
      <div class="result-name">${primary}</div>
      <div class="result-detail">
        <span>${secondary || "—"}</span>
        ${place.type ? `<span class="badge">${place.type.replace(/_/g, " ")}</span>` : ""}
      </div>
    `;

    const marker = L.marker([lat, lon]).addTo(map);
    marker.bindPopup(`<strong>${primary}</strong><br>${secondary}`);
    markers.push(marker);
    bounds.extend([lat, lon]);

    item.addEventListener("click", () => {
      document.querySelectorAll(".result-item").forEach((el) => el.classList.remove("active"));
      item.classList.add("active");
      map.setView([lat, lon], 10);
      marker.openPopup();
    });

    resultsEl.appendChild(item);
  });

  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
  }
}

async function searchLocation(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "50");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, {
    headers: { "Accept-Language": "en" },
  });

  if (!response.ok) {
    throw new Error(`Search failed (HTTP ${response.status})`);
  }

  return response.json();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;

  searchBtn.disabled = true;
  setStatus("Searching...");
  resultsEl.innerHTML = "";

  try {
    const places = await searchLocation(query);
    renderResults(places);
  } catch (err) {
    setStatus(err.message || "Something went wrong. Please try again.", true);
  } finally {
    searchBtn.disabled = false;
  }
});
