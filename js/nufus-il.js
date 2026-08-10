// ./assets/js/provinceSingle.js

document.addEventListener('DOMContentLoaded', async () => {
  const tbody = document.getElementById('province-districts-table-body');
  const annualTbody = document.getElementById('province-annual-table-body');
  const originsTbody = document.getElementById('province-origins-table-body');
  const provinceLabel = document.getElementById('province-label');
  const originsTitle = document.querySelector('.provinceOriginsTableArea h3');

  if (!tbody || !annualTbody || !originsTbody) {
    console.error('Table bodies not found');
    return;
  }

  // Loading placeholders
  tbody.innerHTML = '<tr><td colspan="9">Loading district data...</td></tr>';
  annualTbody.innerHTML = '<tr><td colspan="3">Loading annual population data...</td></tr>';
  originsTbody.innerHTML = '<tr><td colspan="3">Loading origins data...</td></tr>';

  const formatNumber = (val) =>
    !val || isNaN(parseInt(val)) ? '' : parseInt(val).toLocaleString('tr-TR');

  // --- Fetch helpers ---
  async function loadDistricts(provinceId) {
    try {
      const [districtsRes, provinceRes] = await Promise.all([
        axios.get(`https://www.eumaps.org/api/kac-milyon/get-districts/${provinceId}`),
        axios.get(`https://www.eumaps.org/api/kac-milyon/get-province/${provinceId}`)
      ]);

      if (!districtsRes.data.resStatus) throw new Error(districtsRes.data.resMessage);
      const districts = districtsRes.data.resData;
      const provinceData = provinceRes?.data?.resData;
      const name =
        districts?.[0]?.provincename || provinceData?.provincename || 'Unknown Province';
      provinceLabel.textContent = name;

      tbody.innerHTML = '';
      if (provinceData) {
        const totalTr = document.createElement('tr');
        totalTr.classList.add('province-total-row');
        totalTr.innerHTML = `
          <td></td>
          <td class="provinceNameCell">${provinceData.provincename}</td>
          <td></td>
          <td>${formatNumber(provinceData['2025'])}</td>
          <td>${formatNumber(provinceData['2024'])}</td>
          <td>${formatNumber(provinceData['2023'])}</td>
          <td>${formatNumber(provinceData['2015'])}</td>
          <td>${formatNumber(provinceData['2011'])}</td>
          <td>${formatNumber(provinceData['2007'])}</td>
        `;
        tbody.appendChild(totalTr);
      }

      if (districts?.length) {
        districts.forEach((d, i) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${i + 1}</td>
            <td>${d.provincename}</td>
            <td>${d.districtname}</td>
            <td>${formatNumber(d['2025'])}</td>
            <td>${formatNumber(d['2024'])}</td>
            <td>${formatNumber(d['2023'])}</td>
            <td>${formatNumber(d['2015'])}</td>
            <td>${formatNumber(d['2011'])}</td>
            <td>${formatNumber(d['2007'])}</td>
          `;
          tr.addEventListener('click', () => {
            window.location.href = `https://kacmilyon.com/ilce-nufus.html?districtId=${d.id}`;
          });
          tbody.appendChild(tr);
        });
      } else {
        tbody.innerHTML = '<tr><td colspan="9">No district data available</td></tr>';
      }
    } catch (err) {
      console.error('Districts fetch failed:', err.message);
      tbody.innerHTML = `<tr><td colspan="9">Error: ${err.message}</td></tr>`;
    }
  }

  async function loadAnnual(provinceId) {
    try {
      const [provinceRes, foreignersRes] = await Promise.all([
        axios.get(`https://www.eumaps.org/api/kac-milyon/get-province/${provinceId}`),
        axios.get(`https://www.eumaps.org/api/kac-milyon/get-province-foreigners/${provinceId}`)
      ]);
      if (!provinceRes.data.resStatus || !foreignersRes.data.resStatus)
        throw new Error('Missing annual data');

      const provinceData = provinceRes.data.resData;
      const foreignersData = foreignersRes.data.resData;

      const years = [];
      for (let y = 2025; y >= 2007; y--) years.push(String(y));

      annualTbody.innerHTML = '';
      years.forEach((year) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${year}</td>
          <td>${formatNumber(provinceData[year])}</td>
          <td>${formatNumber(foreignersData[year])}</td>
        `;
        annualTbody.appendChild(tr);
      });
    } catch (err) {
      console.error('Annual fetch failed:', err.message);
      annualTbody.innerHTML = `<tr><td colspan="3">Error: ${err.message}</td></tr>`;
    }
  }

  async function loadOrigins(provinceId) {
    try {
      const res = await axios.get(
        `https://www.eumaps.org/api/kac-milyon/get-province-origins/${provinceId}`
      );
      if (!res.data.resStatus || !res.data.resData?.length)
        throw new Error(res.data.resMessage || 'No origins data');

      const data = res.data.resData[0];
      const originName = data.provincename || 'Unknown Province';
      const header = document.querySelector('.province-origins-table thead tr th:nth-child(3)');
      if (header) {
        const lastTwoChars = originName.slice(-2).toLowerCase();
        let suffix = 'liler';
        if (lastTwoChars.includes('a') || lastTwoChars.includes('ı')) suffix = 'lılar';
        else if (lastTwoChars.includes('e') || lastTwoChars.includes('i')) suffix = 'liler';
        else if (lastTwoChars.includes('ö') || lastTwoChars.includes('ü')) suffix = 'lüler';
        else if (lastTwoChars.includes('o') || lastTwoChars.includes('u')) suffix = 'lular';
        header.textContent = `${originName}${suffix}`;
        originsTitle.textContent = `${originName}${suffix} en çok hangi ilde yaşıyor?`;
      }

      const entries = Object.entries(data).filter(
        ([key]) => !['provinceid', 'provincename', 'originPopulation'].includes(key)
      );
      originsTbody.innerHTML = '';
      if (!entries.length) {
        originsTbody.innerHTML =
          '<tr><td colspan="3">No origins distribution data</td></tr>';
        return;
      }

      entries.forEach(([resName, count], idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>${resName}</td>
          <td>${formatNumber(count)}</td>
        `;
        originsTbody.appendChild(tr);
      });
    } catch (err) {
      console.error('Origins fetch failed:', err.message);
      originsTbody.innerHTML = `<tr><td colspan="3">Error: ${err.message}</td></tr>`;
    }
  }

  // --- Combined load ---
  async function loadProvinceAll(provinceId) {
    await Promise.all([
      loadDistricts(provinceId),
      loadAnnual(provinceId),
      loadOrigins(provinceId)
    ]);
  }

  // Auto-load via URL param
  const urlParams = new URLSearchParams(window.location.search);
  const urlProvinceId = urlParams.get('provinceId');
  if (urlProvinceId) {
    console.log('Auto-loading province:', urlProvinceId);
    await loadProvinceAll(urlProvinceId);
  } else {
    tbody.innerHTML =
      '<tr><td colspan="9">Select a province on the map or add ?provinceId=34 to URL</td></tr>';
    annualTbody.innerHTML =
      '<tr><td colspan="3">Select a province to view annual population data</td></tr>';
    originsTbody.innerHTML =
      '<tr><td colspan="3">Select a province to view origins distribution</td></tr>';
  }

  // Debounced reload when selecting on map
  let provinceFetchTimeout;
  document.addEventListener('provinceSelected', (event) => {
    const { provinceId } = event.detail;
    clearTimeout(provinceFetchTimeout);
    provinceFetchTimeout = setTimeout(() => {
      loadProvinceAll(provinceId);
    }, 500);
  });
});
