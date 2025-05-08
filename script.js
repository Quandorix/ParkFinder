const ORS_API_KEY = "5b3ce3597851110001cf6248f8334cd0ab614f0593147cf0b8a5e303";

const parkingForm = document.getElementById('parkingForm');
const addressInput = document.getElementById('address');
const onlyFreeParking = document.getElementById('onlyFreeParking');
const suggestionMode = document.getElementById('suggestionMode');
const searchBtn = document.getElementById('searchBtn');
const weatherDisplay = document.getElementById('weatherDisplay');
const weatherIcon = document.getElementById('weatherIcon');
const weatherWarning = document.getElementById('weatherWarning');
const displayLocation = document.getElementById('displayLocation');
const temperatureEl = document.getElementById('temperature');
const weatherDescriptionEl = document.getElementById('weatherDescription');
const humidityEl = document.getElementById('humidity');

const errorText = document.getElementById('errorText');
const parkingListCard = document.getElementById('parkingListCard');
const parkingList = document.getElementById('parkingList');
const loader = document.getElementById('loader');

let map = null;
let routeLayer = null;
let currentPosition = null;
let parkingSpots = [];
let filteredSpots = [];
let markers = [];
let selectedSpot = null;
let weatherData = null;
let currentWeatherCode = null;

const weatherCodeMap = {
  0: "Klar",
  1: "Teilweise bewölkt",
  2: "Bewölkt",
  3: "Bedeckt",
  45: "Nebel",
  51: "Leichter Regen",
  53: "Mäßiger Regen",
  55: "Starker Regen",
  61: "Leichter Regen",
  63: "Mäßiger Regen",
  65: "Starker Regen",
  71: "Leichter Schnee",
  73: "Mäßiger Schnee",
  75: "Starker Schnee",
  95: "Gewitter"
};

function initMap(lat = 48.2082, lon = 16.3738) {
  if (map) {
    map.remove();
  }
  
  map = L.map('map').setView([lat, lon], 13);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  
  parkingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const address = addressInput.value.trim();
    if (!address) {
      showError('Bitte gib eine Adresse oder Stadt ein.');
      return;
    }
    
    showLoader(true);
    try {
      await findParkingByAddress(address);
    } catch (error) {
      showError('Fehler beim Laden der Daten. Bitte versuche es später erneut.');
      console.error(error);
    } finally {
      showLoader(false);
    }
  });
  
  onlyFreeParking.addEventListener('change', () => {
    updateFilteredParkingSpots();
  });
  
  suggestionMode.addEventListener('change', () => {
    updateFilteredParkingSpots();
    
    if (suggestionMode.value === 'weather' && weatherData) {
      weatherDisplay.classList.remove('hidden');
    } else {
      weatherDisplay.classList.add('hidden');
    }
  });
});

async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { 
      ...options, 
      signal: controller.signal 
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    console.error(`Error with request ${url}:`, error);
    throw error;
  }
}

function isValidLatLng(lat, lon) {
  return !isNaN(lat) && !isNaN(lon) && 
         lat >= -90 && lat <= 90 && 
         lon >= -180 && lon <= 180;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c).toFixed(1);
}

async function findParkingByAddress(addressQuery) {
  hideError();
  
  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addressQuery)}&format=json&limit=1`;
    const nominatimResponse = await fetchWithTimeout(nominatimUrl);
    const nominatimData = await nominatimResponse.json();

    if (!nominatimData || nominatimData.length === 0) {
      throw new Error("Adresse nicht gefunden");
    }

    const { lat, lon, display_name } = nominatimData[0];
    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);
    
    if (!isValidLatLng(parsedLat, parsedLon)) {
      throw new Error("Ungültige Koordinaten erhalten");
    }
    
    displayLocation.textContent = display_name;
    currentPosition = { lat: parsedLat, lon: parsedLon };
    
    await findParkingByCoordinates(parsedLat, parsedLon, display_name);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unbekannter Fehler";
    showError(`Fehler bei der Adresssuche: ${errorMsg}`);
  }
}

async function findParkingByCoordinates(lat, lon, displayName) {
  try {
    if (!isValidLatLng(lat, lon)) {
      throw new Error(`Ungültige Koordinaten: lat=${lat}, lon=${lon}`);
    }

    const [weatherData, parkingData] = await Promise.all([
      fetchWeatherData(lat, lon),
      fetchParkingData(lat, lon)
    ]);

    if (weatherData) {
      this.weatherData = weatherData;
      currentWeatherCode = weatherData.current.weather_code;
      displayWeatherData(weatherData, displayName);
    }

    parkingSpots = parkingData;
    updateFilteredParkingSpots();
    
    initMap(lat, lon);
    addCurrentPositionMarker(lat, lon);
    addParkingMarkers();
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unbekannter Fehler";
    showError(`Fehler beim Laden der Parkplätze: ${errorMsg}`);
  }
}

async function fetchWeatherData(lat, lon) {
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code`;
    const weatherResponse = await fetchWithTimeout(weatherUrl);
    
    if (!weatherResponse.ok) {
      throw new Error(`Weather API error: ${weatherResponse.status}`);
    }
    
    return await weatherResponse.json();
  } catch (error) {
    console.warn("Failed to fetch weather data:", error);
    return null;
  }
}

async function fetchParkingData(lat, lon) {
  try {
    const overpassQuery = `
      [out:json];
      (
        node["amenity"="parking"](around:3000,${lat},${lon});
        way["amenity"="parking"](around:3000,${lat},${lon});
        relation["amenity"="parking"](around:3000,${lat},${lon});
      );
      out center 50;
    `;
    
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
    const overpassResponse = await fetchWithTimeout(overpassUrl);
    
    if (!overpassResponse.ok) {
      throw new Error(`Overpass API error: ${overpassResponse.status}`);
    }
    
    const data = await overpassResponse.json();
    return processOverpassData(data, lat, lon);
  } catch (error) {
    console.warn("Failed to fetch parking data:", error);
    
    return createDemoData(lat, lon);
  }
}

function processOverpassData(data, centerLat, centerLon) {
  const spots = [];
  
  for (const element of data.elements) {
    const lat = element.lat || element.center?.lat;
    const lon = element.lon || element.center?.lon;
    const tags = element.tags || {};

    if (tags.amenity !== "parking" || !isValidLatLng(lat, lon)) {
      continue;
    }

    const name = tags.name || "Parkplatz";
    const covered = tags.shelter === "yes" || 
                   tags.roof === "yes" || 
                   tags.building === "garage" || 
                   tags.destination === "parking_garage";
    const isFree = tags.access === "customers" || 
                  tags.fee === "no" || 
                  !tags.fee;
    const distance = calculateDistance(centerLat, centerLon, lat, lon);

    let address = "";
    if (tags["addr:street"]) address += tags["addr:street"];
    if (tags["addr:housenumber"]) address += ` ${tags["addr:housenumber"]}`;
    if (tags["addr:postcode"] || tags["addr:city"]) address += ", ";
    if (tags["addr:postcode"]) address += ` ${tags["addr:postcode"]}`;
    if (tags["addr:city"]) address += ` ${tags["addr:city"]}`;
    address = address.trim() || "Adresse wird geladen...";

    spots.push({
      id: `${lat}-${lon}-${name}`.replace(/\s+/g, ''),
      name,
      covered,
      isFree,
      address,
      lat,
      lon,
      distance,
      needsReverseGeocoding: !tags["addr:street"]
    });
  }

  if (spots.length === 0) {
    return createDemoData(centerLat, centerLon);
  }

  return spots;
}

function createDemoData(centerLat, centerLon) {
  return [
    { 
      id: "demo-1", 
      name: "Parkhaus Zentrum", 
      covered: true, 
      isFree: false, 
      lat: centerLat + 0.005, 
      lon: centerLon + 0.005, 
      distance: calculateDistance(centerLat, centerLon, centerLat + 0.005, centerLon + 0.005),
      address: "Adresse wird geladen...",
      needsReverseGeocoding: true 
    },
    { 
      id: "demo-2", 
      name: "Tiefgarage Mitte", 
      covered: true, 
      isFree: true, 
      lat: centerLat - 0.003, 
      lon: centerLon + 0.002, 
      distance: calculateDistance(centerLat, centerLon, centerLat - 0.003, centerLon + 0.002),
      address: "Adresse wird geladen...",
      needsReverseGeocoding: true 
    },
    { 
      id: "demo-3", 
      name: "Parkplatz Park", 
      covered: false, 
      isFree: true, 
      lat: centerLat + 0.002, 
      lon: centerLon - 0.004, 
      distance: calculateDistance(centerLat, centerLon, centerLat + 0.002, centerLon - 0.004),
      address: "Adresse wird geladen...",
      needsReverseGeocoding: true 
    },
    { 
      id: "demo-4", 
      name: "Freifläche Nord", 
      covered: false, 
      isFree: false, 
      lat: centerLat - 0.004, 
      lon: centerLon - 0.003, 
      distance: calculateDistance(centerLat, centerLon, centerLat - 0.004, centerLon - 0.003),
      address: "Adresse wird geladen...",
      needsReverseGeocoding: true 
    }
  ];
}

async function loadAddresses(spots) {
  const maxRequests = 12;
  let requestCount = 0;
  
  for (const spot of spots) {
    if (spot.needsReverseGeocoding && requestCount < maxRequests) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const reverseUrl = `https://nominatim.openstreetmap.org/reverse?lat=${spot.lat}&lon=${spot.lon}&format=json`;
        const reverseResponse = await fetchWithTimeout(reverseUrl);
        const reverseData = await reverseResponse.json();
        
        spot.address = reverseData.display_name || "Unbekannte Adresse";
        spot.needsReverseGeocoding = false;
        requestCount++;
        
        updateParkingList();
        updateMapPopups();
      } catch (error) {
        console.warn(`Reverse geocoding failed for ${spot.name}:`, error);
        spot.address = "Unbekannte Adresse";
        spot.needsReverseGeocoding = false;
      }
    } else if (requestCount >= maxRequests && spot.needsReverseGeocoding) {
      spot.address = "Unbekannte Adresse";
      spot.needsReverseGeocoding = false;
    }
  }
}

function displayWeatherData(data, locationName) {
  const temp = Math.round(data.current.temperature_2m);
  const weatherCode = data.current.weather_code;
  const humidity = data.current.relative_humidity_2m;
  
  weatherIcon.textContent = getWeatherIcon(weatherCode);
  
  temperatureEl.textContent = `${temp}°C`;
  weatherDescriptionEl.textContent = weatherCodeMap[weatherCode] || "Unbekannt";
  humidityEl.textContent = `${humidity}%`;
  
  if (isBadWeather(weatherCode)) {
    weatherWarning.classList.remove('hidden');
  } else {
    weatherWarning.classList.add('hidden');
  }
  
  if (suggestionMode.value === 'weather') {
    weatherDisplay.classList.remove('hidden');
  }
}

function getWeatherIcon(code) {
  if (code === 0) return '☀️';
  if (code === 1) return '🌤️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45) return '🌫️';
  if ([51, 53, 55, 61, 63, 65].includes(code)) return '🌧️';
  if ([71, 73, 75].includes(code)) return '❄️';
  if (code === 95) return '⛈️';
  return '🌡️';
}

function isBadWeather(code) {
  return [51, 53, 55, 61, 63, 65, 71, 73, 75, 95].includes(code);
}

function updateFilteredParkingSpots() {
  const mode = suggestionMode.value;
  const onlyFree = onlyFreeParking.checked;
  const isBadWeather = currentWeatherCode !== null && 
    [51, 53, 55, 61, 63, 65, 71, 73, 75, 95].includes(currentWeatherCode);
  
  let filtered = [...parkingSpots];
  
  if (mode === "weather" && isBadWeather) {
    filtered = filtered.filter(spot => spot.covered);
  } else if (mode === "open") {
    filtered = filtered.filter(spot => !spot.covered);
  } else if (mode === "covered") {
    filtered = filtered.filter(spot => spot.covered);
  }
  
  if (onlyFree) {
    filtered = filtered.filter(spot => spot.isFree);
  }
  
  filtered = filtered
    .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance))
    .slice(0, 6);
  
  filteredSpots = filtered;
  
  updateParkingList();
  updateMapMarkers();
  
  if (filtered.some(s => s.needsReverseGeocoding)) {
    loadAddresses(filtered);
  }
}

function addCurrentPositionMarker(lat, lon) {
  const blueIcon = L.divIcon({
    className: 'marker-icon marker-blue',
    html: '<div class="marker-icon-inner"></div>',
    iconSize: [24, 24]
  });
  
  L.marker([lat, lon], { icon: blueIcon })
    .addTo(map)
    .bindPopup("<strong>Ihr Standort</strong><br>" + displayLocation.textContent);
}

function addParkingMarkers() {
  markers.forEach(marker => {
    if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });
  markers = [];
  
  const amberIcon = L.divIcon({
    className: 'marker-icon marker-amber',
    html: '<div class="marker-icon-inner"></div>',
    iconSize: [24, 24]
  });
  
  filteredSpots.forEach(spot => {
    if (isValidLatLng(spot.lat, spot.lon)) {
      const marker = L.marker([spot.lat, spot.lon], { icon: amberIcon })
        .addTo(map)
        .bindPopup(createPopupContent(spot));
      
      marker.on('click', () => {
        selectSpot(spot);
      });
      
      markers.push(marker);
    }
  });
}

function updateMapMarkers() {
  markers.forEach(marker => {
    if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });
  
  addParkingMarkers();
  
  if (selectedSpot) {
    const marker = markers.find(m => {
      const spotLat = m.getLatLng().lat;
      const spotLng = m.getLatLng().lng;
      return Math.abs(spotLat - selectedSpot.lat) < 0.0001 && 
             Math.abs(spotLng - selectedSpot.lon) < 0.0001;
    });
    
    if (marker) {
      marker.setIcon(L.divIcon({
        className: 'marker-icon marker-red',
        html: '<div class="marker-icon-inner"></div>',
        iconSize: [24, 24]
      }));
    }
  }
}

function updateMapPopups() {
  markers.forEach(marker => {
    const lat = marker.getLatLng().lat;
    const lng = marker.getLatLng().lng;
    
    const spot = filteredSpots.find(s => 
      Math.abs(s.lat - lat) < 0.0001 && 
      Math.abs(s.lon - lng) < 0.0001
    );
    
    if (spot) {
      marker.bindPopup(createPopupContent(spot));
    }
  });
}

function createPopupContent(spot) {
  let html = `
    <div class="popup-content">
      <h3>${spot.name}</h3>
      <p>${spot.covered ? 'Überdacht' : 'Freifläche'} | ${spot.isFree ? 'Kostenlos' : 'Kostenpflichtig'}</p>
      <p>${spot.address}</p>
      <p>${spot.distance} km entfernt</p>
      <button class="route-button" onclick="selectSpotById('${spot.id}')">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="3 11 22 2 13 21 11 13 3 11"/>
        </svg>
        Route anzeigen
      </button>
    </div>
  `;
  
  return html;
}

function updateParkingList() {
  parkingList.innerHTML = '';
  
  if (filteredSpots.length === 0) {
    parkingList.innerHTML = '<div class="no-spots">Keine Parkplätze gefunden</div>';
    parkingListCard.classList.add('hidden');
    return;
  }
  
  parkingListCard.classList.remove('hidden');
  
  filteredSpots.forEach(spot => {
    const spotElement = document.createElement('div');
    spotElement.className = `parking-spot ${selectedSpot && selectedSpot.id === spot.id ? 'selected' : ''}`;
    spotElement.dataset.id = spot.id;
    
    spotElement.innerHTML = `
      <div class="parking-spot-header">
        <h3 class="spot-name">${spot.name}</h3>
        <span class="spot-tag ${spot.covered ? 'tag-covered' : 'tag-open'}">
          ${spot.covered ? 
            `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 10h4"/><path d="M7 14h4"/><path d="M13 10h4"/><path d="M13 14h4"/></svg>Überdacht` : 
            `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.6-1.5-.9-2.3-.7-1.8.2-3 .9-3.9 1.8-1.3 1.2-1.5 2.3-1.5 3.2 0 1.7.9 2.9 1.5 3.8.5.7 1.1 1.2 1.4 1.2"/><path d="M9.5 14.5 9.1 16"/><path d="M14.9 16 16 7"/><path d="M9 18h12"/><path d="M8 22 16 2"/></svg>Freifläche`
          }
        </span>
      </div>
      
      <div class="spot-details">
        <p>
          ${spot.isFree ? 
            '<span class="spot-free">Kostenlos</span>' : 
            '<span class="spot-paid">Kostenpflichtig</span>'
          }
        </p>
        <p class="spot-address">${spot.address}</p>
        <p class="spot-distance">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          ${spot.distance} km entfernt
        </p>
      </div>
      
      <button class="route-button ${selectedSpot && selectedSpot.id === spot.id ? 'selected' : ''}">
        ${selectedSpot && selectedSpot.id === spot.id ? 
          `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Ausgewählt` : 
          `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> Route anzeigen`
        }
      </button>
    `;
    
    const button = spotElement.querySelector('.route-button');
    button.addEventListener('click', () => {
      selectSpot(spot);
    });
    
    parkingList.appendChild(spotElement);
  });
}

async function findRoute(spot) {
  if (!currentPosition) {
    showError("Kein Ausgangspunkt verfügbar.");
    return;
  }
  
  showLoader(true);
  
  try {
    const routeUrl = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${ORS_API_KEY}&start=${currentPosition.lon},${currentPosition.lat}&end=${spot.lon},${spot.lat}`;
    const routeResponse = await fetchWithTimeout(routeUrl);
    
    if (!routeResponse.ok) {
      throw new Error(`Routing API error: ${routeResponse.status}`);
    }
    
    const routeData = await routeResponse.json();
    
    if (routeData.features && routeData.features.length > 0) {
      const coords = routeData.features[0].geometry.coordinates.map(
        (coord) => [coord[1], coord[0]]
      );
      
      if (routeLayer && map.hasLayer(routeLayer)) {
        map.removeLayer(routeLayer);
      }
      
      routeLayer = L.polyline(coords, { color: '#1d4ed8', weight: 4, opacity: 0.7 }).addTo(map);
      
      const bounds = L.latLngBounds([
        [currentPosition.lat, currentPosition.lon],
        [spot.lat, spot.lon]
      ]);
      map.fitBounds(bounds.pad(0.2));
    } else {
      throw new Error("Keine Route gefunden");
    }
  } catch (error) {
    showError(`Fehler bei der Routenberechnung: ${error.message}`);
  } finally {
    showLoader(false);
  }
}

async function selectSpot(spot) {
  selectedSpot = spot;
  
  updateParkingList();
  updateMapMarkers();
  
  await findRoute(spot);
}

window.selectSpotById = async function(id) {
  const spot = filteredSpots.find(s => s.id === id);
  if (spot) {
    await selectSpot(spot);
  }
};

function showError(message) {
    
}

function hideError() {
  
}

function showLoader(show) {
  if (show) {
    loader.classList.remove('hidden');
  } else {
    loader.classList.add('hidden');
  }
}