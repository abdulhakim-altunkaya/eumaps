document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.getElementById("district-annual-table-body");
  const tableHeader = document.querySelector(".districtAnnualTableArea h3");
  const urlParams = new URLSearchParams(window.location.search);
  const districtId = urlParams.get("districtId");

  if (!districtId) {
    if (tableBody)
      tableBody.innerHTML = `<tr><td colspan="2">❌ İlçe ID bulunamadı.</td></tr>`;
    return;
  }

  fetchDistrictData(districtId, tableBody, tableHeader);
});

async function fetchDistrictData(districtId, tableBody, tableHeader) {
  try {
    const response = await axios.get(`https://www.eumaps.org/api/kac-milyon/get-district/${districtId}`, {
      validateStatus: (status) => true,
    });

    if (response.status !== 200) {
      if (tableBody)
        tableBody.innerHTML = `<tr><td colspan="2">⚠️ Sunucu durumu: ${response.status} ${response.statusText}</td></tr>`;
      return;
    }

    const data = response.data;
    if (!data) {
      if (tableBody)
        tableBody.innerHTML = `<tr><td colspan="2">❌ Backend yanıtı boş.</td></tr>`;
      return;
    }

    const district = data.resData || data;

    // ✅ Update header with district name if available
    if (district.districtname && tableHeader) {
      tableHeader.textContent = `Yıllara göre ${district.districtname} / ${district.provincename} nüfusu`;
    }

    const yearEntries =
      district && typeof district === "object"
        ? Object.entries(district).filter(
            ([k, v]) => /\b\d{4}\b/.test(k) && !isNaN(Number(v))
          )
        : [];

    if (yearEntries.length === 0) {
      if (tableBody)
        tableBody.innerHTML = `<tr><td colspan="2">📭 Nüfus verisi mevcut değil.</td></tr>`;
      return;
    }

    const sorted = yearEntries.sort((a, b) => b[0].localeCompare(a[0]));
    if (tableBody) {
      tableBody.innerHTML = sorted
        .map(([yearKey, val]) => {
          const year = yearKey.replace(/\D/g, "");
          const population = Number(val).toLocaleString("tr-TR");
          return `<tr><td>${year}</td><td>${population}</td></tr>`;
        })
        .join("");
    }
  } catch (error) {
    if (tableBody)
      tableBody.innerHTML = `<tr><td colspan="2">⚠️ İstek yapılamadı: ${error.message}</td></tr>`;
  }
}
