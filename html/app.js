const DATA_URL = "../travels/travels.json";
const URL_PARAMS = {
  travel: "travel",
  day: "day",
};

const state = {
  travels: [],
  travel: null,
  selectedDate: null,
  map: null,
  gpxLayers: [],
  trackRenderId: null,
  photoLayer: null,
  photoMarkers: [],
  currentPhotos: [],
  currentPhotoIndex: -1,
  selectedPhotoIndex: -1,
  hoveredPhotoIndex: -1,
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

function getUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    travelSlug: params.get(URL_PARAMS.travel),
    date: params.get(URL_PARAMS.day),
  };
}

function setUrlState({ travelSlug, date }, { replace = false } = {}) {
  const url = new URL(window.location.href);
  if (travelSlug) {
    url.searchParams.set(URL_PARAMS.travel, travelSlug);
  } else {
    url.searchParams.delete(URL_PARAMS.travel);
  }

  if (date) {
    url.searchParams.set(URL_PARAMS.day, date);
  } else {
    url.searchParams.delete(URL_PARAMS.day);
  }

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ travelSlug, date }, "", url);
}

function isValidDay(travel, date) {
  return getTravelDays(travel).includes(date);
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

function getTracks() {
  return (state.travel.tracks || []).filter((item) => item.date === state.selectedDate);
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

  if (state.gpxLayers.length <= 1) {
    els.trackName.textContent = gpxLayer.get_name() || "";
  }

  els.trackStats.innerHTML = cards
    .map(([label, value]) => `<div class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function renderCombinedTrackStats(layers) {
  if (!layers.length) return;

  if (layers.length === 1) {
    renderTrackStats(layers[0]);
    return;
  }

  const startTimes = layers
    .map((layer) => layer.get_start_time())
    .filter(Boolean)
    .sort((a, b) => a - b);
  const endTimes = layers
    .map((layer) => layer.get_end_time())
    .filter(Boolean)
    .sort((a, b) => a - b);
  const totalDistance = layers.reduce(
    (sum, layer) => sum + (Number.isFinite(layer.get_distance()) ? layer.get_distance() : 0),
    0
  );
  const totalGain = layers.reduce(
    (sum, layer) => sum + (Number.isFinite(layer.get_elevation_gain()) ? layer.get_elevation_gain() : 0),
    0
  );
  const totalLoss = layers.reduce(
    (sum, layer) => sum + (Number.isFinite(layer.get_elevation_loss()) ? layer.get_elevation_loss() : 0),
    0
  );

  els.trackName.textContent = `${layers.length} tracks`;

  const cards = [
    ["Start", startTimes[0] ? formatTime(startTimes[0]) : "n/a"],
    ["End", endTimes[endTimes.length - 1] ? formatTime(endTimes[endTimes.length - 1]) : "n/a"],
    ["Distance", totalDistance ? `${(totalDistance / 1000).toFixed(1)} km` : "n/a"],
    ["Elevation", `+${formatMeters(totalGain)} / -${formatMeters(totalLoss)}`],
  ];

  els.trackStats.innerHTML = cards
    .map(([label, value]) => `<div class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function initMap() {
  state.map = L.map("map", {
    // Let the page handle wheel/trackpad scrolling instead of zooming the map.
    scrollWheelZoom: false,
  }).setView([39.9, 4.25], 11);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  state.photoLayer = L.layerGroup().addTo(state.map);
}

function updatePhotoMarkerHighlights() {
  state.photoMarkers.forEach((marker, index) => {
    const icon = marker._icon;
    if (!icon) return;
    icon.classList.toggle("photo-marker--hovered", index === state.hoveredPhotoIndex);
    icon.classList.toggle("photo-marker--selected", index === state.selectedPhotoIndex);
  });
}

function photoCaption(photo) {
  return photo.caption?.trim() || photo.location_name?.trim() || "";
}

function photoTime(photo) {
  return photo.timestamp
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(photo.timestamp))
    : "No time";
}

function photoDateTime(photo) {
  if (!photo.timestamp) return "No time";

  const date = new Date(photo.timestamp);
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);

  return `${dateLabel} · ${photoTime(photo)}`;
}

function renderPhotoViewer() {
  const photo = state.currentPhotos[state.currentPhotoIndex];
  if (!photo) return;

  const label = photoCaption(photo);
  els.photoViewerImage.src = repoPath(photo.path);
  els.photoViewerImage.alt = label;
  els.photoViewerCaption.textContent = label ? `${label} · ${photoDateTime(photo)}` : photoDateTime(photo);
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

function scrollPhotoIntoView(index) {
  const card = els.photos.querySelector(`[data-photo-index="${index}"]`);
  if (!card) return;

  const container = els.photos;
  const targetLeft = card.offsetLeft - container.clientWidth / 2 + card.clientWidth / 2;
  const maxScrollLeft = container.scrollWidth - container.clientWidth;
  container.scrollTo({
    left: Math.max(0, Math.min(targetLeft, maxScrollLeft)),
    behavior: "smooth",
  });
}

function selectPhotoInPanel(index) {
  if (!state.currentPhotos[index]) return;

  if (!els.photoViewer.hidden) closePhotoViewer();
  state.selectedPhotoIndex = index;
  renderPhotos();
  scrollPhotoIntoView(index);
}

function navigatePhoto(direction) {
  if (els.photoViewer.hidden || !state.currentPhotos.length) return;
  state.currentPhotoIndex =
    (state.currentPhotoIndex + direction + state.currentPhotos.length) % state.currentPhotos.length;
  state.selectedPhotoIndex = state.currentPhotoIndex;
  renderPhotos();
  renderPhotoViewer();
  scrollPhotoIntoView(state.selectedPhotoIndex);
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

function getDayLabel(travel, date, index) {
  return `Day ${index + 1}`;
}

function renderDayNav() {
  const days = getTravelDays(state.travel);
  els.dayNav.innerHTML = days
    .map((date, index) => {
      const label = getDayLabel(state.travel, date, index);
      const active = date === state.selectedDate ? " active" : "";
      return `<button class="day-button${active}" type="button" data-date="${date}">
        ${escapeHtml(label)}<span>${formatDate(date)}</span>
      </button>`;
    })
    .join("");
}

function renderTrack() {
  const tracks = getTracks();
  document.querySelector(".map-error")?.remove();

  state.gpxLayers.forEach((layer) => state.map.removeLayer(layer));
  state.gpxLayers = [];

  if (!tracks.length) {
    state.map.setView([39.9, 4.25], 11);
    els.trackName.textContent = "";
    els.trackStats.innerHTML = '<div class="empty-state">No track for this day.</div>';
    return;
  }

  els.trackStats.innerHTML = '<div class="empty-state">Loading track statistics...</div>';

  const renderId = Symbol("track-render");
  state.trackRenderId = renderId;
  let bounds = null;
  const loadedLayers = [];
  let hasError = false;

  tracks.forEach((track) => {
    const gpxLayer = new L.GPX(repoPath(track.path), {
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
        if (hasError || state.trackRenderId !== renderId) return;

        loadedLayers.push(event.target);
        const trackBounds = event.target.getBounds();
        bounds = bounds ? bounds.extend(trackBounds) : trackBounds;

        if (loadedLayers.length === tracks.length) {
          state.map.fitBounds(bounds, { padding: [52, 52] });
          renderCombinedTrackStats(loadedLayers);
        }
      })
      .on("error", () => {
        hasError = true;
        els.trackName.textContent = "";
        els.trackStats.innerHTML = '<div class="error-state">Could not load track statistics.</div>';
        document.querySelector(".map-panel").insertAdjacentHTML(
          "beforeend",
          '<div class="error-state map-error">Could not load the GPX track for this day.</div>'
        );
      })
      .addTo(state.map);

    state.gpxLayers.push(gpxLayer);
  });
}

function renderPhotoMarkers() {
  state.photoLayer.clearLayers();
  state.photoMarkers = [];

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
    marker.on("add", updatePhotoMarkerHighlights);
    marker.addTo(state.photoLayer);
    state.photoMarkers[index] = marker;
  });

  updatePhotoMarkerHighlights();
}

function setHoveredPhotoIndex(index) {
  if (state.hoveredPhotoIndex === index) return;
  state.hoveredPhotoIndex = index;
  updatePhotoMarkerHighlights();
}

function renderPhotos() {
  const photos = getDayPhotos();
  state.currentPhotos = photos;
  if (state.selectedPhotoIndex >= photos.length) {
    state.selectedPhotoIndex = -1;
  }
  if (state.hoveredPhotoIndex >= photos.length) {
    state.hoveredPhotoIndex = -1;
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

async function selectDay(date, { updateUrl = true } = {}) {
  state.selectedDate = date;
  state.selectedPhotoIndex = -1;
  closePhotoViewer();
  renderDayNav();
  renderTrack();
  renderPhotos();
  await renderNotes();
  if (updateUrl) {
    setUrlState({ travelSlug: state.travel.slug, date }, { replace: false });
  }
}

async function selectTravel(slug, { replaceUrl = false } = {}) {
  state.travel = state.travels.find((travel) => travel.slug === slug) || state.travels[0];
  els.title.textContent = state.travel.title;
  els.travelSelect.value = state.travel.slug;

  const days = getTravelDays(state.travel);
  const urlState = getUrlState();
  const requestedDay = urlState.travelSlug === state.travel.slug ? urlState.date : null;
  const selectedDay = requestedDay && isValidDay(state.travel, requestedDay) ? requestedDay : days[0] || state.travel.start_date;

  if (replaceUrl) {
    setUrlState({ travelSlug: state.travel.slug, date: selectedDay }, { replace: true });
  }

  await selectDay(selectedDay, { updateUrl: !replaceUrl });
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

  els.photos.addEventListener("mouseover", (event) => {
    const card = event.target.closest("[data-photo-index]");
    if (!card) return;
    setHoveredPhotoIndex(Number(card.dataset.photoIndex));
  });

  els.photos.addEventListener("mouseout", (event) => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
    setHoveredPhotoIndex(-1);
  });

  els.photos.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-photo-index]");
    if (!card) return;
    event.preventDefault();
    openPhotoViewer(Number(card.dataset.photoIndex));
  });

  els.photos.addEventListener("focusin", (event) => {
    const card = event.target.closest("[data-photo-index]");
    if (card) setHoveredPhotoIndex(Number(card.dataset.photoIndex));
  });

  els.photos.addEventListener("focusout", (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setHoveredPhotoIndex(-1);
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

    const urlState = getUrlState();
    const initialTravel = state.travels.find((travel) => travel.slug === urlState.travelSlug) || state.travels[0];
    await selectTravel(initialTravel.slug, { replaceUrl: true });
  } catch (error) {
    document.body.innerHTML = `<main class="load-failure">
      <h1>Could not load itinerary</h1>
      <p>${escapeHtml(error.message)}</p>
    </main>`;
  }
}

window.addEventListener("popstate", () => {
  const urlState = getUrlState();
  const travel = state.travels.find((item) => item.slug === urlState.travelSlug) || state.travels[0];
  if (!travel) return;

  state.travel = travel;
  els.title.textContent = travel.title;
  els.travelSelect.value = travel.slug;

  const days = getTravelDays(travel);
  const date = urlState.date && isValidDay(travel, urlState.date) ? urlState.date : days[0] || travel.start_date;
  selectDay(date, { updateUrl: false });
});

load();
