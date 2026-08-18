document.addEventListener("DOMContentLoaded", () => {
  const trips = [];

  const form = document.getElementById("visaForm");
  const regionSelect = document.getElementById("regionSelect");
  const entryInput = document.getElementById("entryDate");
  const exitInput = document.getElementById("exitDate");
  const clearAllBtn = document.getElementById("clearAllBtn");
  const formMessage = document.getElementById("formMessage");

  const tripsSection = document.getElementById("tripsSection");
  const tripList = document.getElementById("tripList");
  const tripCount = document.getElementById("tripCount");
  const resultArea = document.getElementById("resultArea");

  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  form.addEventListener("submit", addTrip);
  clearAllBtn.addEventListener("click", clearAllTrips);
  regionSelect.addEventListener("change", updateResult);

  [entryInput, exitInput].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("input-error");
      hideMessage();
    });
  });

  function addTrip(event) {
    event.preventDefault();

    hideMessage();
    removeInputErrors();

    const entryDateValue = entryInput.value;
    const exitDateValue = exitInput.value;

    if (!entryDateValue) {
      entryInput.classList.add("input-error");
      entryInput.focus();
      showMessage("Giriş tarihini seçin.");
      return;
    }

    if (!exitDateValue) {
      exitInput.classList.add("input-error");
      exitInput.focus();
      showMessage("Çıkış tarihini seçin.");
      return;
    }

    const entryDate = parseDate(entryDateValue);
    const exitDate = parseDate(exitDateValue);

    if (exitDate < entryDate) {
      entryInput.classList.add("input-error");
      exitInput.classList.add("input-error");
      showMessage("Çıkış tarihi giriş tarihinden önce olamaz.");
      return;
    }

    const overlaps = trips.some((trip) =>
      dateRangesOverlap(
        entryDate,
        exitDate,
        trip.entryDate,
        trip.exitDate
      )
    );

    if (overlaps) {
      entryInput.classList.add("input-error");
      exitInput.classList.add("input-error");

      showMessage(
        "Bu tarihler daha önce eklenen bir seyahatle çakışıyor."
      );

      return;
    }

    trips.push({
      entryDate,
      exitDate,
      duration: calculateInclusiveDays(entryDate, exitDate)
    });

    trips.sort((firstTrip, secondTrip) =>
      firstTrip.entryDate - secondTrip.entryDate
    );

    entryInput.value = "";
    exitInput.value = "";

    renderTrips();
    updateResult();
    entryInput.focus();
  }

  function renderTrips() {
    tripList.innerHTML = "";

    tripsSection.hidden = trips.length === 0;
    tripCount.textContent = `${trips.length} seyahat`;

    trips.forEach((trip, index) => {
      const listItem = document.createElement("li");
      listItem.className = "trip-item";

      const information = document.createElement("div");
      information.className = "trip-information";

      const dates = document.createElement("span");
      dates.className = "trip-dates";
      dates.textContent =
        `${formatDate(trip.entryDate)} → ${formatDate(trip.exitDate)}`;

      const duration = document.createElement("span");
      duration.className = "trip-duration";
      duration.textContent = `${trip.duration} gün`;

      information.append(dates, duration);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-trip";
      deleteButton.textContent = "Sil";
      deleteButton.setAttribute(
        "aria-label",
        `${formatDate(trip.entryDate)} tarihli seyahati sil`
      );

      deleteButton.addEventListener("click", () => {
        trips.splice(index, 1);
        renderTrips();
        updateResult();
      });

      listItem.append(information, deleteButton);
      tripList.appendChild(listItem);
    });
  }

  function updateResult() {
    if (trips.length === 0) {
      resultArea.innerHTML = `
        <p>Hesaplama yapmak için ilk giriş ve çıkış tarihinizi ekleyin.</p>
      `;
      return;
    }

    const windowDays = getWindowDays();
    const ruleLabel = `90/${windowDays}`;

    const occupiedDays = getOccupiedDays();
    const violation = findFirstViolation(occupiedDays, windowDays);

    const latestTrip = trips[trips.length - 1];
    const referenceDate = latestTrip.exitDate;

    const usedDays = countDaysInWindow(
      occupiedDays,
      referenceDate,
      windowDays
    );

    const remainingDays = Math.max(0, 90 - usedDays);

    const possibleNextEntry = addDays(referenceDate, 1);

    const selectedRegion =
      regionSelect.value === "schengen"
        ? "Schengen"
        : "Türkiye";

    let statusHtml;
    let nextEntry;

    if (violation) {
      statusHtml = `
        <div class="result-status warning">
          ${ruleLabel} gün sınırı aşıldı. İlk aşım tarihi:
          ${formatDate(violation.date)}.
        </div>
      `;

      nextEntry = "Süre aşımı";
    } else {
      statusHtml = `
        <div class="result-status">
          ${ruleLabel} gün sınırı aşılmadı.
        </div>
      `;

      nextEntry = formatDate(possibleNextEntry);
    }

    resultArea.innerHTML = `
      <h2>${selectedRegion} Kalış Sonucu</h2>

      ${statusHtml}

      <ul class="result-list">
        <li>
          <span>Son ${windowDays} günlük dönemde kullanılan süre</span>
          <strong>${usedDays} gün</strong>
        </li>

        <li>
          <span>Bu dönem için kalan süre</span>
          <strong>${remainingDays} gün</strong>
        </li>

        <li>
          <span>Bir sonraki serbest giriş tarihi</span>
          <strong>${nextEntry}</strong>
        </li>
      </ul>
    `;
  }

  function getWindowDays() {
    if (regionSelect.value === "turkiye365") {
      return 365;
    }

    return 180;
  }

  function getOccupiedDays() {
    const occupiedDays = new Set();

    trips.forEach((trip) => {
      let currentDate = new Date(trip.entryDate);

      while (currentDate <= trip.exitDate) {
        occupiedDays.add(toDateKey(currentDate));
        currentDate = addDays(currentDate, 1);
      }
    });

    return occupiedDays;
  }

  function findFirstViolation(occupiedDays, windowDays) {
    const sortedDays = [...occupiedDays]
      .map(parseDate)
      .sort((firstDate, secondDate) => firstDate - secondDate);

    for (const currentDate of sortedDays) {
      const usedDays = countDaysInWindow(
        occupiedDays,
        currentDate,
        windowDays
      );

      if (usedDays > 90) {
        return {
          date: currentDate,
          usedDays
        };
      }
    }

    return null;
  }

  function countDaysInWindow(
    occupiedDays,
    referenceDate,
    windowDays
  ) {
    const windowStart = addDays(
      referenceDate,
      -(windowDays - 1)
    );

    let count = 0;

    occupiedDays.forEach((dateKey) => {
      const occupiedDate = parseDate(dateKey);

      if (
        occupiedDate >= windowStart &&
        occupiedDate <= referenceDate
      ) {
        count += 1;
      }
    });

    return count;
  }

  function calculateContinuousAllowance(
    startDate,
    occupiedDays
  ) {
    const simulatedDays = new Set(occupiedDays);
    const windowDays = getWindowDays();

    let allowedDays = 0;

    for (let dayOffset = 0; dayOffset < 90; dayOffset += 1) {
      const proposedDate = addDays(startDate, dayOffset);
      const proposedDateKey = toDateKey(proposedDate);

      simulatedDays.add(proposedDateKey);

      const usedDays = countDaysInWindow(
        simulatedDays,
        proposedDate,
        windowDays
      );

      if (usedDays > 90) {
        simulatedDays.delete(proposedDateKey);
        break;
      }

      allowedDays += 1;
    }

    return allowedDays;
  }

  function dateRangesOverlap(
    firstStart,
    firstEnd,
    secondStart,
    secondEnd
  ) {
    return firstStart <= secondEnd && firstEnd >= secondStart;
  }

  function calculateInclusiveDays(startDate, endDate) {
    return (
      Math.floor((endDate - startDate) / millisecondsPerDay) + 1
    );
  }

  function parseDate(dateValue) {
    const [year, month, day] = dateValue.split("-").map(Number);

    return new Date(Date.UTC(year, month - 1, day));
  }

  function addDays(date, amount) {
    const newDate = new Date(date);
    newDate.setUTCDate(newDate.getUTCDate() + amount);
    return newDate;
  }

  function toDateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat("tr-TR", {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function clearAllTrips() {
    trips.length = 0;

    form.reset();
    regionSelect.value = "schengen";
    tripsSection.hidden = true;
    tripList.innerHTML = "";

    removeInputErrors();
    hideMessage();
    updateResult();

    entryInput.focus();
  }

  function showMessage(message) {
    formMessage.textContent = message;
    formMessage.classList.add("visible");
  }

  function hideMessage() {
    formMessage.textContent = "";
    formMessage.classList.remove("visible");
  }

  function removeInputErrors() {
    entryInput.classList.remove("input-error");
    exitInput.classList.remove("input-error");
  }
});