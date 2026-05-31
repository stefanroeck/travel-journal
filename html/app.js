const DATA_URL = "../travels/travels.json";

const state = {
  travels: [],
  travel: null,
  selectedDate: null,
  map: null,
  gpxLayer: null,
};

const els = {
  title: document.querySelector("#travel-title"),
  travelSelect: document.querySelector("#travel-select"),
  dayNav: document.querySelector("#day-nav"),
  trackName: document.querySelector("#track-name"),
  trackStats: document.querySelector("#track-stats"),
  photos: document.querySelector("#photos"),
  photoCount: document.querySelector("#photo-count"),
  notes: document.querySelector("#notes"),
  noteDate: document.querySelector("#note-date"),
};

function repoPath(path) {
  return `../${path.replace(/^\/+/, "")}`;
}

function formatDate(dateString, options = {}) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: options.weekday ?? "short",
    month: "short",
    day: "numeric",
    year: options.year ?? undefined,
  }).format(new Date(`${dateString}T12:00:00`));
}

function dateRange(start, end) {
  const dates = [];
  const current = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);

  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function photoDate(photo) {
  return photo.timestamp?.slice(0, 10);
}

function dayHasContent(travel, date) {
  return Boolean(
    travel.tracks?.some((track) => track.date === date) ||
      travel.notes?.some((note) => note.date === date) ||
      travel.photos?.some((photo) => photoDate(photo) === date)
  );
}

function getTravelDays(travel) {
  const range = dateRange(travel.start_date, travel.end_date);
  return range.filter((date) => dayHasContent(travel, date));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function markdownToHtml(markdown) {
  return markdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function getTrack() {
  return state.travel.tracks?.find((item) => item.date === state.selectedDate);
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMeters(value) {
  return Number.isFinite(value) ? `${Math.round(value)} m` : "n/a";
}

function renderTrackStats(gpxLayer) {
  const cards = [
    ["Start", gpxLayer.get_start_time() ? formatTime(gpxLayer.get_start_time()) : "n/a"],
    ["End", gpxLayer.get_end_time() ? formatTime(gpxLayer.get_end_time()) : "n/a"],
    ["Distance", Number.isFinite(gpxLayer.get_distance()) ? `${(gpxLayer.get_distance() / 1000).toFixed(1)} km` : "n/a"],
    ["Elevation", `+${formatMeters(gpxLayer.get_elevation_gain())} / -${formatMeters(gpxLayer.get_elevation_loss())}`],
  ];

  els.trackName.textContent = gpxLayer.get_name() || "";

  els.trackStats.innerHTML = cards
    .map(([label, value]) => `<div class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function initMap() {
  state.map = L.map("map", {
    scrollWheelZoom: true,
  }).setView([39.9, 4.25], 11);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);
}

function renderTravelOptions() {
  els.travelSelect.innerHTML = state.travels
    .map((travel) => `<option value="${escapeHtml(travel.slug)}">${escapeHtml(travel.title)}</option>`)
    .join("");
}

function renderDayNav() {
  const days = getTravelDays(state.travel);
  els.dayNav.innerHTML = days
    .map((date, index) => {
      const label = `Day ${index + 1}`;
      const active = date === state.selectedDate ? " active" : "";
      return `<button class="day-button${active}" type="button" data-date="${date}">
        ${label}<span>${formatDate(date)}</span>
      </button>`;
    })
    .join("");
}

function renderTrack() {
  const track = getTrack();
  document.querySelector(".map-error")?.remove();
  els.trackName.textContent = "";

  if (state.gpxLayer) {
    state.map.removeLayer(state.gpxLayer);
    state.gpxLayer = null;
  }

  if (!track) {
    state.map.setView([39.9, 4.25], 11);
    els.trackStats.innerHTML = '<div class="empty-state">No track for this day.</div>';
    return;
  }

  els.trackStats.innerHTML = '<div class="empty-state">Loading track statistics...</div>';

  state.gpxLayer = new L.GPX(repoPath(track.path), {
    async: true,
    marker_options: {
      startIconUrl: "https://unpkg.com/leaflet-gpx@1.7.0/pin-icon-start.png",
      endIconUrl: "https://unpkg.com/leaflet-gpx@1.7.0/pin-icon-end.png",
      shadowUrl: "https://unpkg.com/leaflet-gpx@1.7.0/pin-shadow.png",
    },
    polyline_options: {
      color: "#167a72",
      opacity: 0.95,
      weight: 5,
      lineCap: "round",
    },
  })
    .on("loaded", (event) => {
      state.map.fitBounds(event.target.getBounds(), { padding: [52, 52] });
      renderTrackStats(event.target);
    })
    .on("error", () => {
      els.trackStats.innerHTML = '<div class="error-state">Could not load track statistics.</div>';
      document.querySelector(".map-panel").insertAdjacentHTML(
        "beforeend",
        '<div class="error-state map-error">Could not load the GPX track for this day.</div>'
      );
    })
    .addTo(state.map);
}

function renderPhotos() {
  const photos = (state.travel.photos || []).filter((photo) => photoDate(photo) === state.selectedDate);
  els.photoCount.textContent = `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`;

  if (!photos.length) {
    els.photos.innerHTML = '<div class="empty-state">No photos for this day.</div>';
    return;
  }

  els.photos.innerHTML = photos
    .map((photo) => {
      const time = photo.timestamp
        ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(photo.timestamp))
        : "No time";
      const caption = photo.caption?.trim() || "Untitled";
      return `<figure class="photo-card">
        <img src="${repoPath(photo.path)}" alt="${escapeHtml(caption)}" loading="lazy">
        <figcaption class="photo-meta">
          <strong>${escapeHtml(caption)}</strong>
          <span>${escapeHtml(time)}</span>
        </figcaption>
      </figure>`;
    })
    .join("");
}

async function renderNotes() {
  const note = state.travel.notes?.find((item) => item.date === state.selectedDate);
  els.noteDate.textContent = formatDate(state.selectedDate, { year: "numeric" });

  if (!note) {
    els.notes.innerHTML = '<div class="empty-state">No notes for this day.</div>';
    return;
  }

  try {
    const response = await fetch(repoPath(note.path));
    if (!response.ok) throw new Error(`Failed with ${response.status}`);
    const markdown = await response.text();
    els.notes.innerHTML = markdownToHtml(markdown);
  } catch (error) {
    els.notes.innerHTML = '<div class="error-state">Could not load notes for this day.</div>';
  }
}

async function selectDay(date) {
  state.selectedDate = date;
  renderDayNav();
  renderTrack();
  renderPhotos();
  await renderNotes();
}

async function selectTravel(slug) {
  state.travel = state.travels.find((travel) => travel.slug === slug) || state.travels[0];
  els.title.textContent = state.travel.title;
  els.travelSelect.value = state.travel.slug;

  const days = getTravelDays(state.travel);
  await selectDay(days[0] || state.travel.start_date);
}

function bindEvents() {
  els.travelSelect.addEventListener("change", (event) => {
    selectTravel(event.target.value);
  });

  els.dayNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (button) selectDay(button.dataset.date);
  });
}

async function load() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Failed with ${response.status}`);
    const data = await response.json();
    state.travels = data.travels || [];

    if (!state.travels.length) {
      throw new Error("No travels found");
    }

    initMap();
    renderTravelOptions();
    bindEvents();
    await selectTravel(state.travels[0].slug);
  } catch (error) {
    document.body.innerHTML = `<main class="load-failure">
      <h1>Could not load itinerary</h1>
      <p>${escapeHtml(error.message)}</p>
    </main>`;
  }
}

load();
