document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("massEnergyForm");
  const massInput = document.getElementById("massInput");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");
  const resultSection = document.getElementById("resultSection");

  const massGramResult = document.getElementById("massGramResult");
  const massKgResult = document.getElementById("massKgResult");
  const energyJouleResult = document.getElementById("energyJouleResult");
  const energyKwhResult = document.getElementById("energyKwhResult");
  const energyEvResult = document.getElementById("energyEvResult");
  const energyCalorieResult = document.getElementById("energyCalorieResult");
  const tntKgResult = document.getElementById("tntKgResult");
  const tntMegatonResult = document.getElementById("tntMegatonResult");
  const hiroshimaResult = document.getElementById("hiroshimaResult");
  const tsarResult = document.getElementById("tsarResult");
  const calculationText = document.getElementById("calculationText");

  const speedOfLight = 299792458;
  const joulesPerKwh = 3600000;
  const joulesPerElectronvolt = 1.602176634e-19;
  const joulesPerCalorie = 4.184;
  const joulesPerKgTnt = 4.184e6;
  const joulesPerMegatonTnt = 4.184e15;
  const joulesPerHiroshimaBomb = 6.276e13;
  const joulesPerTsarBomb = 2.092e17;

  form.addEventListener("submit", calculateMassEnergy);
  clearBtn.addEventListener("click", clearCalculator);

  massInput.addEventListener("input", () => {
    massInput.classList.remove("input-error");
    hideMessage();
  });

  function calculateMassEnergy(event) {
    event.preventDefault();

    hideMessage();
    massInput.classList.remove("input-error");

    const grams = Number(massInput.value);

    if (
      massInput.value.trim() === "" ||
      !Number.isFinite(grams) ||
      grams <= 0
    ) {
      massInput.classList.add("input-error");
      massInput.focus();
      showMessage("Sıfırdan büyük geçerli bir kütle değeri girin.");
      return;
    }

    const massKg = grams / 1000;
    const energyJoules = massKg * Math.pow(speedOfLight, 2);
    const energyKwh = energyJoules / joulesPerKwh;
    const energyEv = energyJoules / joulesPerElectronvolt;
    const energyCalories = energyJoules / joulesPerCalorie;
    const kgTnt = energyJoules / joulesPerKgTnt;
    const megatonsTnt = energyJoules / joulesPerMegatonTnt;
    const hiroshimaBombs = energyJoules / joulesPerHiroshimaBomb;
    const tsarBombs = energyJoules / joulesPerTsarBomb;

    massGramResult.textContent =
      `${formatNumber(grams, 10)} gram`;

    massKgResult.textContent =
      `${formatNumber(massKg, 12)} kilogram`;

    energyJouleResult.textContent =
      `${formatLargeNumber(energyJoules)} joule`;

    energyKwhResult.textContent =
      `${formatLargeNumber(energyKwh)} kWh`;

    energyEvResult.textContent =
      `${formatScientific(energyEv)} eV`;

    energyCalorieResult.textContent =
      `${formatLargeNumber(energyCalories)} cal`;

    tntKgResult.textContent =
      `${formatLargeNumber(kgTnt)} kg TNT`;

    tntMegatonResult.textContent =
      `${formatNumber(megatonsTnt, 10)} megaton TNT`;

    hiroshimaResult.textContent =
      formatNumber(hiroshimaBombs, 10);

    tsarResult.textContent =
      formatNumber(tsarBombs, 10);

    calculationText.textContent =
      `${formatNumber(massKg, 12)} kg × ` +
      `(299.792.458 m/sn)² = ` +
      `${formatLargeNumber(energyJoules)} joule`;

    resultSection.hidden = false;

    resultSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function clearCalculator() {
    form.reset();
    resultSection.hidden = true;

    massGramResult.textContent = "0 gram";
    massKgResult.textContent = "0 kilogram";
    energyJouleResult.textContent = "0 joule";
    energyKwhResult.textContent = "0 kWh";
    energyEvResult.textContent = "0 eV";
    energyCalorieResult.textContent = "0 cal";
    tntKgResult.textContent = "0 kg TNT";
    tntMegatonResult.textContent = "0 megaton TNT";
    hiroshimaResult.textContent = "0";
    tsarResult.textContent = "0";
    calculationText.textContent = "";

    massInput.classList.remove("input-error");
    hideMessage();
    massInput.focus();
  }

  function showMessage(message) {
    formMessage.textContent = message;
    formMessage.classList.add("visible");
  }

  function hideMessage() {
    formMessage.textContent = "";
    formMessage.classList.remove("visible");
  }

  function formatNumber(value, maximumFractionDigits = 6) {
    if (!Number.isFinite(value)) {
      return "0";
    }

    if (value !== 0 && Math.abs(value) < 0.000001) {
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

    if (Math.abs(value) >= 1e15 || Math.abs(value) < 0.000001) {
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