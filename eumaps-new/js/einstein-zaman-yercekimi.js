document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("timeDilationForm");
  const observerTimeInput = document.getElementById("observerTimeInput");
  const massOfObjectInput = document.getElementById("massOfObjectInput");
  const radiusInput = document.getElementById("radiusInput");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");
  const resultSection = document.getElementById("resultSection");

  const massSolarResult = document.getElementById("massSolarResult");
  const massKgResult = document.getElementById("massKgResult");
  const radiusResult = document.getElementById("radiusResult");
  const schwarzschildRadiusResult = document.getElementById(
    "schwarzschildRadiusResult"
  );
  const radiusRatioResult = document.getElementById("radiusRatioResult");
  const timeFactorResult = document.getElementById("timeFactorResult");
  const observerTimeResult = document.getElementById("observerTimeResult");
  const nearObjectTimeResult = document.getElementById(
    "nearObjectTimeResult"
  );
  const timeDifferenceResult = document.getElementById(
    "timeDifferenceResult"
  );
  const slowdownPercentageResult = document.getElementById(
    "slowdownPercentageResult"
  );
  const calculationText = document.getElementById("calculationText");

  const gravitationalConstant = 6.67430e-11;
  const speedOfLight = 299792458;
  const solarMassKg = 1.98847e30;

  form.addEventListener("submit", calculateGravitationalTimeDilation);
  clearBtn.addEventListener("click", clearCalculator);

  [observerTimeInput, massOfObjectInput, radiusInput].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("input-error");
      hideMessage();
    });
  });

  function calculateGravitationalTimeDilation(event) {
    event.preventDefault();

    hideMessage();
    removeInputErrors();

    const observerTime = Number(observerTimeInput.value);
    const massSolar = Number(massOfObjectInput.value);
    const radiusKm = Number(radiusInput.value);

    if (
      observerTimeInput.value.trim() === "" ||
      !Number.isFinite(observerTime) ||
      observerTime <= 0
    ) {
      observerTimeInput.classList.add("input-error");
      observerTimeInput.focus();

      showMessage(
        "Uzak gözlemci için sıfırdan büyük geçerli bir süre girin."
      );

      return;
    }

    if (
      massOfObjectInput.value.trim() === "" ||
      !Number.isFinite(massSolar) ||
      massSolar <= 0
    ) {
      massOfObjectInput.classList.add("input-error");
      massOfObjectInput.focus();

      showMessage(
        "Cismin kütlesi için sıfırdan büyük geçerli bir değer girin."
      );

      return;
    }

    if (
      radiusInput.value.trim() === "" ||
      !Number.isFinite(radiusKm) ||
      radiusKm <= 0
    ) {
      radiusInput.classList.add("input-error");
      radiusInput.focus();

      showMessage(
        "Cismin merkezinden uzaklık için sıfırdan büyük geçerli bir değer girin."
      );

      return;
    }

    const massKg = massSolar * solarMassKg;
    const radiusMetres = radiusKm * 1000;

    const schwarzschildRadiusMetres =
      (2 * gravitationalConstant * massKg) /
      Math.pow(speedOfLight, 2);

    const schwarzschildRadiusKm =
      schwarzschildRadiusMetres / 1000;

    if (radiusMetres <= schwarzschildRadiusMetres) {
      radiusInput.classList.add("input-error");
      radiusInput.focus();

      showMessage(
        `Merkezden uzaklık, Schwarzschild yarıçapından büyük olmalıdır. ` +
        `Bu kütle için minimum değer ${formatNumber(
          schwarzschildRadiusKm,
          12
        )} km'den büyüktür.`
      );

      return;
    }

    const gravitationalFactor =
      1 -
      (2 * gravitationalConstant * massKg) /
        (radiusMetres * Math.pow(speedOfLight, 2));

    if (
      !Number.isFinite(gravitationalFactor) ||
      gravitationalFactor <= 0
    ) {
      showMessage("Girilen değerler için geçerli bir sonuç hesaplanamadı.");
      return;
    }

    const timeFlowFactor = Math.sqrt(gravitationalFactor);
    const nearObjectTime = observerTime * timeFlowFactor;
    const timeDifference = observerTime - nearObjectTime;

    const slowdownPercentage =
      (1 - timeFlowFactor) * 100;

    const radiusRatio =
      radiusKm / schwarzschildRadiusKm;

    displayResults({
      observerTime,
      massSolar,
      massKg,
      radiusKm,
      schwarzschildRadiusKm,
      radiusRatio,
      timeFlowFactor,
      nearObjectTime,
      timeDifference,
      slowdownPercentage
    });
  }

  function displayResults(result) {
    massSolarResult.textContent =
      `${formatNumber(result.massSolar, 12)} Güneş kütlesi`;

    massKgResult.textContent =
      `${formatLargeNumber(result.massKg)} kg`;

    radiusResult.textContent =
      `${formatNumber(result.radiusKm, 12)} km`;

    schwarzschildRadiusResult.textContent =
      `${formatNumber(result.schwarzschildRadiusKm, 12)} km`;

    radiusRatioResult.textContent =
      formatNumber(result.radiusRatio, 12);

    timeFactorResult.textContent =
      formatNumber(result.timeFlowFactor, 16);

    observerTimeResult.textContent =
      `${formatNumber(result.observerTime, 12)} saniye`;

    nearObjectTimeResult.textContent =
      `${formatNumber(result.nearObjectTime, 12)} saniye`;

    timeDifferenceResult.textContent =
      `${formatNumber(result.timeDifference, 12)} saniye`;

    slowdownPercentageResult.textContent =
      `%${formatNumber(result.slowdownPercentage, 12)}`;

    calculationText.textContent =
      `${formatNumber(result.observerTime, 12)} × √(1 − ` +
      `${formatNumber(result.schwarzschildRadiusKm, 12)} / ` +
      `${formatNumber(result.radiusKm, 12)}) = ` +
      `${formatNumber(result.nearObjectTime, 12)} saniye`;

    resultSection.hidden = false;

    resultSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function clearCalculator() {
    form.reset();
    resultSection.hidden = true;

    massSolarResult.textContent = "0 Güneş kütlesi";
    massKgResult.textContent = "0 kg";
    radiusResult.textContent = "0 km";
    schwarzschildRadiusResult.textContent = "0 km";
    radiusRatioResult.textContent = "0";
    timeFactorResult.textContent = "1";
    observerTimeResult.textContent = "0 saniye";
    nearObjectTimeResult.textContent = "0 saniye";
    timeDifferenceResult.textContent = "0 saniye";
    slowdownPercentageResult.textContent = "%0";
    calculationText.textContent = "";

    removeInputErrors();
    hideMessage();
    observerTimeInput.focus();
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
    observerTimeInput.classList.remove("input-error");
    massOfObjectInput.classList.remove("input-error");
    radiusInput.classList.remove("input-error");
  }

  function formatNumber(value, maximumFractionDigits = 6) {
    if (!Number.isFinite(value)) {
      return "0";
    }

    if (
      value !== 0 &&
      Math.abs(value) < 0.000001
    ) {
      return formatScientific(value);
    }

    if (Math.abs(value) >= 1e15) {
      return formatScientific(value);
    }

    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 0,
      maximumFractionDigits
    }).format(value);
  }

  function formatLargeNumber(value) {
    if (!Number.isFinite(value)) {
      return "0";
    }

    if (
      Math.abs(value) >= 1e15 ||
      (value !== 0 && Math.abs(value) < 0.000001)
    ) {
      return formatScientific(value);
    }

    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 8
    }).format(value);
  }

  function formatScientific(value) {
    if (!Number.isFinite(value)) {
      return "0";
    }

    return value
      .toExponential(6)
      .replace(".", ",")
      .replace("e+", " × 10^")
      .replace("e-", " × 10^-");
  }
});