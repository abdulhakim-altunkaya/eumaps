  const latitude = 40.7128;  // Example: New York
  const longitude = -74.0060;

  const map = L.map('map').setView([latitude, longitude], 9);

  // Add tile layer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  // Create custom FontAwesome marker
  const customIcon = L.divIcon({
    className: 'custom-div-icon',
    html: '<i class="fas fa-map-marker-alt" style="color: red; font-size: 32px;"></i>',
    iconSize: [30, 42],
    iconAnchor: [15, 42],
  });

  // Add marker
  const marker = L.marker([latitude, longitude], { icon: customIcon }).addTo(map);

function displayError(message) {
    document.getElementById('errorArea').textContent = message;
}

function clearError() {
    document.getElementById('errorArea').textContent = '';
}

function isValidIP(ip) {
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Pattern = /^([a-fA-F0-9:]+)$/;
    return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
}

async function handleGeolocation() {
    const ipInputValue = document.getElementById('ipInput').value.trim();

    if (!ipInputValue) {
        displayError("Please enter an IP address. ❌");
        return;
    }

    if (ipInputValue.length > 45 || !isValidIP(ipInputValue)) {
        displayError("Invalid IP format. Please check your input. ❌");
        return;
    }

    clearError();  // Clear error if valid input

    try {
      const response = await axios.post("https://www.eumaps.org/api/get-coordinates-and-log-visitor",
        { ipInput: ipInputValue });

      const geoData = response.data.resData;

      document.getElementById('continentSpan').textContent = geoData.continent_name;
      document.getElementById('countrySpan').textContent = geoData.country_name;
      document.getElementById('citySpan').textContent = geoData.city;
      document.getElementById('latitudeSpan').textContent = geoData.latitude;
      document.getElementById('longitudeSpan').textContent = geoData.longitude;
      document.getElementById('connectionTypeSpan').textContent =  geoData.connection_type;
      document.getElementById('ipTypeSpan').textContent = geoData.type;

      const newLat = parseFloat(geoData.latitude);
      const newLng = parseFloat(geoData.longitude);

      map.setView([newLat, newLng], 9);            // move map
      marker.setLatLng([newLat, newLng]);          // move marker

    } catch (error) {
      let message = "Error fetching geolocation data. Please try again. ❌";

      if (error.response) {
          // Error response from backend
          const backendMessage = error.response.data?.resMessage;
          if (backendMessage) {
              message = `${backendMessage} ❌`;
          } else if (error.response.status === 403) {
              message = "Access denied. This IP may be ignored. ❌ ";
          } else if (error.response.status === 429) {
              message = "Too many requests. Please slow down. ❌ ";
          } else if (error.response.status === 500) {
              message = "Server error. Please try again later. ❌ ";
          }
      } else if (error.request) {
          // No response from backend
          message = "No response from server. Please check your connection. ❌ ";
      }
      displayError(message);
      console.error("Detailed error:", error);
    }
}
document.getElementById('logVisitorBtn').addEventListener('click', handleGeolocation);

document.getElementById('ipInput').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
        handleGeolocation();
    }
});