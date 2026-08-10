document.addEventListener('DOMContentLoaded', () => {
  // Only run on index page (check for unique element)
  const isIndexPage = !!document.getElementById('provinces-table-body');
  
  if (!isIndexPage) {
    return; // Skip entirely
  }

  const getProvincesData = async () => {
    try {
      const response = await axios.get("https://www.eumaps.org/api/kac-milyon/get-provinces");
      const { resStatus, resData, resMessage } = response.data;

      if (resStatus && Array.isArray(resData)) {
        renderProvinces(resData);
      } else {
        console.warn("⚠️ API returned error:", resMessage);
      }
    } catch (error) {
      console.error("❌ Request failed:", error.message);
    }
  };

  const renderProvinces = (provinces) => {
    const tableBody = document.getElementById("provinces-table-body");
    if (!tableBody) {
      console.error("❌ No element with id 'provinces-table-body' found!");
      return;
    }

    tableBody.innerHTML = "";

    provinces.forEach((province, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${index + 1}</td>
        <td><a href="https://kacmilyon.com/il-nufus.html?provinceId=${province.provinceid}">
          ${province.provincename}
        </a>
        </td>
        <td>${formatNumber(province["2025"])}</td>
        <td>${formatNumber(province["2024"])}</td>
        <td>${formatNumber(province["2023"])}</td>
        <td>${formatNumber(province["2015"])}</td>
        <td>${formatNumber(province["2011"])}</td>
        <td>${formatNumber(province["2007"])}</td>
      `;
      tableBody.appendChild(row);
    });
  };
  
  const formatNumber = (value) => {
    if (value === null || value === undefined) return "-";
    return Number(value).toLocaleString("tr-TR");
  };

  // Run only on index
  getProvincesData();
});