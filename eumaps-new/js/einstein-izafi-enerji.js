document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("kineticEnergyForm");
  const restMassInput = document.getElementById("restMassInput");
  const velocityInput = document.getElementById("velocityInput");
  const clearButton = document.getElementById("clearButton");
  const formMessage = document.getElementById("formMessage");
  const resultSection = document.getElementById("resultSection");

  const restMassResult = document.getElementById("restMassResult");
  const velocityResult = document.getElementById("velocityResult");
  const velocityRatioResult = document.getElementById("velocityRatioResult");
  const velocityPercentageResult = document.getElementById(
    "velocityPercentageResult"
  );
  const lorentzFactorResult = document.getElementById("lorentzFactorResult");
  const energyJouleResult = document.getElementById("energyJouleResult");
  const totalEnergyResult = document.getElementById("totalEnergyResult");
  const energyKwhResult = document.getElementById("energyKwhResult");
  const energyEvResult = document.getElementById("energyEvResult");
  const energyCalorieResult = document.getElementById("energyCalorieResult");
  const tntKgResult = document.getElementById("tntKgResult");
  const tntMegatonResult = document.getElementById("tntMegatonResult");
  const hiroshimaResult = document.getElementById("hiroshimaResult");
  const tsarResult = document.getElementById("tsarResult");
  const calculationText = document.getElementById("calculationText");

  const speedOfLight = 299792458;
  const speedOfLightKm = 299792.458;

  const joulesPerKwh = 3.6e6;
  const joulesPerElectronvolt = 1.602176634e-19;
  const joulesPerCalorie = 4.184;
  const joulesPerKgTnt = 4.184e6;
  const joulesPerMegatonTnt = 4.184e15;
  const joulesPerHiroshimaBomb = 6.276e13;
  const joulesPerTsarBomb = 2.092e17;

  form.addEventListener("submit", calculateKineticEnergy);
  clearButton.addEventListener("click", clearCalculator);

  [restMassInput, velocityInput].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("input-error");
      hideMessage();
    });
  });

  function calculateKineticEnergy(event) {
    event.preventDefault();

    hideMessage();
    removeInputErrors();

    const restMassGrams = Number(restMassInput.value);
    const velocityKm = Number(velocityInput.value);

    if (
      restMassInput.value.trim() === "" ||
      !Number.isFinite(restMassGrams) ||
      restMassGrams <= 0
    ) {
      restMassInput.classList.add("input-error");
      restMassInput.focus();
      showMessage("Sıfırdan büyük geçerli bir durgun kütle girin.");
      return;
    }

    if (
      velocityInput.value.trim() === "" ||
      !Number.isFinite(velocityKm) ||
      velocityKm <= 0
    ) {
      velocityInput.classList.add("input-error");
      velocityInput.focus();
      showMessage("Sıfırdan büyük geçerli bir hız girin.");
      return;
    }

    if (velocityKm >= speedOfLightKm) {
      velocityInput.classList.add("input-error");
      velocityInput.focus();

      showMessage(
        "Cismin hızı, 299.792,458 km/sn olan ışık hızından düşük olmalıdır."
      );

      return;
    }

    const restMassKg = restMassGrams / 1000;
    const velocity = velocityKm * 1000;
    const velocityRatio = velocity / speedOfLight;
    const velocityPercentage = velocityRatio * 100;

    const lorentzFactor =
      1 / Math.sqrt(1 - Math.pow(velocityRatio, 2));

    const restEnergy =
      restMassKg * Math.pow(speedOfLight, 2);

    const totalEnergy =
      lorentzFactor * restEnergy;

    const kineticEnergy =
      (lorentzFactor - 1) * restEnergy;

    const energyKwh =
      kineticEnergy / joulesPerKwh;

    const energyEv =
      kineticEnergy / joulesPerElectronvolt;

    const energyCalories =
      kineticEnergy / joulesPerCalorie;

    const kgTnt =
      kineticEnergy / joulesPerKgTnt;

    const megatonsTnt =
      kineticEnergy / joulesPerMegatonTnt;

    const hiroshimaBombs =
      kineticEnergy / joulesPerHiroshimaBomb;

    const tsarBombs =
      kineticEnergy / joulesPerTsarBomb;

    displayResults({
      restMassGrams,
      restMassKg,
      velocityKm,
      velocityRatio,
      velocityPercentage,
      lorentzFactor,
      totalEnergy,
      kineticEnergy,
      energyKwh,
      energyEv,
      energyCalories,
      kgTnt,
      megatonsTnt,
      hiroshimaBombs,
      tsarBombs
    });
  }

  function displayResults(result) {
    restMassResult.textContent =
      `${formatNumber(result.restMassGrams, 10)} gram`;

    velocityResult.textContent =
      `${formatNumber(result.velocityKm, 10)} km/sn`;

    velocityRatioResult.textContent =
      formatNumber(result.velocityRatio, 20);

    velocityPercentageResult.textContent =
      `%${formatNumber(result.velocityPercentage, 12)}`;

    lorentzFactorResult.textContent =
      formatNumber(result.lorentzFactor, 14);

    energyJouleResult.textContent =
      `${formatLargeNumber(result.kineticEnergy)} joule`;

    totalEnergyResult.textContent =
      `${formatLargeNumber(result.totalEnergy)} joule`;

    energyKwhResult.textContent =
      `${formatLargeNumber(result.energyKwh)} kWh`;

    energyEvResult.textContent =
      `${formatScientific(result.energyEv)} eV`;

    energyCalorieResult.textContent =
      `${formatLargeNumber(result.energyCalories)} cal`;

    tntKgResult.textContent =
      `${formatLargeNumber(result.kgTnt)} kg TNT`;

    tntMegatonResult.textContent =
      `${formatNumber(result.megatonsTnt, 12)} megaton TNT`;

    hiroshimaResult.textContent =
      formatNumber(result.hiroshimaBombs, 12);

    tsarResult.textContent =
      formatNumber(result.tsarBombs, 12);

    calculationText.textContent =
      `(${formatNumber(result.lorentzFactor, 14)} − 1) × ` +
      `${formatNumber(result.restMassKg, 12)} kg × ` +
      `(299.792.458 m/sn)² = ` +
      `${formatLargeNumber(result.kineticEnergy)} joule`;

    resultSection.hidden = false;

    resultSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function clearCalculator() {
    form.reset();
    resultSection.hidden = true;

    restMassResult.textContent = "0 gram";
    velocityResult.textContent = "0 km/sn";
    velocityRatioResult.textContent = "0";
    velocityPercentageResult.textContent = "%0";
    lorentzFactorResult.textContent = "1";
    energyJouleResult.textContent = "0 joule";
    totalEnergyResult.textContent = "0 joule";
    energyKwhResult.textContent = "0 kWh";
    energyEvResult.textContent = "0 eV";
    energyCalorieResult.textContent = "0 cal";
    tntKgResult.textContent = "0 kg TNT";
    tntMegatonResult.textContent = "0 megaton TNT";
    hiroshimaResult.textContent = "0";
    tsarResult.textContent = "0";
    calculationText.textContent = "";

    removeInputErrors();
    hideMessage();
    restMassInput.focus();
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
    restMassInput.classList.remove("input-error");
    velocityInput.classList.remove("input-error");
  }

  function formatNumber(value, maximumFractionDigits = 6) {
    if (!Number.isFinite(value)) {
      return "0";
    }

    if (value !== 0 && Math.abs(value) < 0.000001) {
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
      maximumFractionDigits: 6
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