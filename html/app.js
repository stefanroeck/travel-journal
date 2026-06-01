const DATA_URL = "../travels/travels.json";

const state = {
  travels: [],
  travel: null,
  selectedDate: null,
  map: null,
  gpxLayer: null,
  photoLayer: null,
  currentPhotos: [],
  currentPhotoIndex: -1,
  selectedPhotoIndex: -1,
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
  photoViewer: document.querySelector("#photo-viewer"),
  photoViewerImage: document.querySelector("#photo-viewer-image"),
  photoViewerCaption: document.querySelector("#photo-viewer-caption"),
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

function getDayPhotos() {
  return (state.travel.photos || [])
    .filter((photo) => photoDate(photo) === state.selectedDate)
    .slice()
    .sort((a, b) => {
      const aTimestamp = a.timestamp || "";
      const bTimestamp = b.timestamp || "";
      if (aTimestamp && bTimestamp && aTimestamp !== bTimestamp) {
        return aTimestamp.localeCompare(bTimestamp);
      }
      if (aTimestamp && !bTimestamp) return -1;
      if (!aTimestamp && bTimestamp) return 1;
      return (a.path || "").localeCompare(b.path || "");
    });
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

  state.photoLayer = L.layerGroup().addTo(state.map);
}

function photoCaption(photo) {
  return photo.caption?.trim() || photo.location_name?.trim() || "";
}

function photoTime(photo) {
  return photo.timestamp
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(photo.timestamp))
    : "No time";
}

function renderPhotoViewer() {
  const photo = state.currentPhotos[state.currentPhotoIndex];
  if (!photo) return;

  const label = photoCaption(photo);
  els.photoViewerImage.src = repoPath(photo.path);
  els.photoViewerImage.alt = label;
  els.photoViewerCaption.textContent = label ? `${label} · ${photoTime(photo)}` : photoTime(photo);
  els.photoViewer.hidden = false;
  document.body.classList.add("viewer-open");
}

function openPhotoViewer(index) {
  if (!state.currentPhotos[index]) return;
  state.currentPhotoIndex = index;
  state.selectedPhotoIndex = index;
  renderPhotos();
  renderPhotoViewer();
}

function selectPhotoInPanel(index) {
  if (!state.currentPhotos[index]) return;

  if (!els.photoViewer.hidden) closePhotoViewer();
  state.selectedPhotoIndex = index;

  const card = els.photos.querySelector(`[data-photo-index="${index}"]`);
  if (card) {
    const container = els.photos;
    const targetLeft =
      card.offsetLeft - container.clientWidth / 2 + card.clientWidth / 2;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    container.scrollTo({
      left: Math.max(0, Math.min(targetLeft, maxScrollLeft)),
      behavior: "smooth",
    });
  }
}

function navigatePhoto(direction) {
  if (els.photoViewer.hidden || !state.currentPhotos.length) return;
  state.currentPhotoIndex =
    (state.currentPhotoIndex + direction + state.currentPhotos.length) % state.currentPhotos.length;
  renderPhotoViewer();
}

function closePhotoViewer() {
  els.photoViewer.hidden = true;
  els.photoViewerImage.src = "";
  els.photoViewerImage.alt = "";
  els.photoViewerCaption.textContent = "";
  state.currentPhotoIndex = -1;
  document.body.classList.remove("viewer-open");
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

function renderPhotoMarkers() {
  state.photoLayer.clearLayers();

  state.currentPhotos.forEach((photo, index) => {
    if (!Number.isFinite(photo.latitude) || !Number.isFinite(photo.longitude)) return;

    const marker = L.marker([photo.latitude, photo.longitude], {
      icon: L.divIcon({
        className: "photo-marker",
        html: '<span></span>',
        iconSize: [30, 38],
        iconAnchor: [15, 37],
      }),
      title: photoCaption(photo),
    });

    marker.on("click", () => selectPhotoInPanel(index));
    marker.addTo(state.photoLayer);
  });
}

function renderPhotos() {
  const photos = getDayPhotos();
  state.currentPhotos = photos;
  if (state.selectedPhotoIndex >= photos.length) {
    state.selectedPhotoIndex = -1;
  }
  els.photoCount.textContent = `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`;
  renderPhotoMarkers();

  if (!photos.length) {
    els.photos.innerHTML = '<div class="empty-state">No photos for this day.</div>';
    return;
  }

  els.photos.innerHTML = photos
    .map((photo, index) => {
      const caption = photoCaption(photo);
      const captionMarkup = caption ? `<strong>${escapeHtml(caption)}</strong>` : "";
      const selected = index === state.selectedPhotoIndex ? " selected" : "";
      return `<figure class="photo-card${selected}" data-photo-index="${index}" tabindex="0">
        <img src="${repoPath(photo.path)}" alt="${escapeHtml(caption)}" loading="lazy">
        <figcaption class="photo-meta">
          ${captionMarkup}
          <span>${escapeHtml(photoTime(photo))}</span>
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
  state.selectedPhotoIndex = -1;
  closePhotoViewer();
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

  els.photos.addEventListener("click", (event) => {
    const card = event.target.closest("[data-photo-index]");
    if (card) openPhotoViewer(Number(card.dataset.photoIndex));
  });

  els.photos.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-photo-index]");
    if (!card) return;
    event.preventDefault();
    openPhotoViewer(Number(card.dataset.photoIndex));
  });

  els.photoViewer.addEventListener("click", (event) => {
    const navButton = event.target.closest("[data-photo-nav]");
    if (navButton) {
      event.stopPropagation();
      navigatePhoto(Number(navButton.dataset.photoNav));
      return;
    }

    closePhotoViewer();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.photoViewer.hidden) closePhotoViewer();
    if (event.key === "ArrowLeft") navigatePhoto(-1);
    if (event.key === "ArrowRight") navigatePhoto(1);
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
