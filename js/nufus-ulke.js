// ./assets/js/country.js

document.addEventListener('DOMContentLoaded', async () => {
  // Set initial loading placeholders
  const popTbody = document.getElementById('country-population-table-body');
  const intTbody = document.getElementById('country-international-table-body');
  const civilTbody = document.getElementById('country-civil-status-table-body');

  if (!popTbody || !intTbody || !civilTbody) {
    console.error('Table bodies not found');
    return;
  }

  popTbody.innerHTML = '<tr><td colspan="3">Loading population data...</td></tr>';
  intTbody.innerHTML = '<tr><td colspan="7">Loading international data...</td></tr>';
  civilTbody.innerHTML = '<tr><td colspan="3">Loading civil status data...</td></tr>';

  try {
    await Promise.all([
      loadCountryPopulation(),
      loadCountryInternational(),
      loadCountryCivilStatus()
    ]);
  } catch (err) {
    console.error('Error loading country data:', err);
    // Fallback error UI
    popTbody.innerHTML = '<tr><td colspan="3">Error loading population data</td></tr>';
    intTbody.innerHTML = '<tr><td colspan="7">Error loading international data</td></tr>';
    civilTbody.innerHTML = '<tr><td colspan="3">Error loading civil status data</td></tr>';
  }
});

async function loadCountryPopulation() {
  try {
    const res = await axios.get('https://www.eumaps.org/api/kac-milyon/get-country-population');
    if (!res.data.resStatus) throw new Error(res.data.resMessage);

    let data = res.data.resData;
    if (!Array.isArray(data)) {
      data = [data];  // Wrap single row as array if needed
    }

    // Sort by year descending (newest first)
    data.sort((a, b) => parseInt(b.year) - parseInt(a.year));

    const tbody = document.getElementById('country-population-table-body');
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3">No population data available</td></tr>';
      return;
    }

    data.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.year}</td>
        <td>${parseInt(row.total || 0).toLocaleString('tr-TR')}</td>
        <td>${row.percentage || ''}</td>  <!-- Use as-is text, no extra % -->
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Population fetch failed:', err.message);
    const tbody = document.getElementById('country-population-table-body');
    tbody.innerHTML = `<tr><td colspan="3">Error: ${err.message}</td></tr>`;
  }
}

async function loadCountryInternational() {
  try {
    const res = await axios.get('https://www.eumaps.org/api/kac-milyon/get-country-international');
    if (!res.data.resStatus) throw new Error(res.data.resMessage);

    let data = res.data.resData;
    if (!Array.isArray(data)) {
      data = [data];  // Wrap single row as array if needed
    }

    // Sort by year descending (newest first)
    data.sort((a, b) => parseInt(b.year) - parseInt(a.year));

    const tbody = document.getElementById('country-international-table-body');
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">No international data available</td></tr>';
      return;
    }

    data.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.year}</td>
        <td>${parseInt(row.inturkish || 0).toLocaleString('tr-TR')}</td>
        <td>${parseInt(row.outturkish || 0).toLocaleString('tr-TR')}</td>
        <td>${parseInt(row.inforeign || 0).toLocaleString('tr-TR')}</td>
        <td>${parseInt(row.outforeign || 0).toLocaleString('tr-TR')}</td>
        <td>${parseInt(row.intotal || 0).toLocaleString('tr-TR')}</td>
        <td>${parseInt(row.outtotal || 0).toLocaleString('tr-TR')}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('International fetch failed:', err.message);
    const tbody = document.getElementById('country-international-table-body');
    tbody.innerHTML = `<tr><td colspan="7">Error: ${err.message}</td></tr>`;
  }
}

async function loadCountryCivilStatus() {
  try {
    const res = await axios.get('https://www.eumaps.org/api/kac-milyon/get-country-civil-status');
    if (!res.data.resStatus) throw new Error(res.data.resMessage);

    let data = res.data.resData;
    if (!Array.isArray(data)) {
      data = [data];  // Wrap single row as array if needed
    }

    // Sort by sene descending (newest first)
    data.sort((a, b) => parseInt(b.sene) - parseInt(a.sene));

    const tbody = document.getElementById('country-civil-status-table-body');
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3">No civil status data available</td></tr>';
      return;
    }

    data.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.sene}</td>
        <td>${parseInt(row.evlenme || 0).toLocaleString('tr-TR')}</td>
        <td>${parseInt(row.bosanma || 0).toLocaleString('tr-TR')}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Civil status fetch failed:', err.message);
    const tbody = document.getElementById('country-civil-status-table-body');
    tbody.innerHTML = `<tr><td colspan="3">Error: ${err.message}</td></tr>`;
  }
}