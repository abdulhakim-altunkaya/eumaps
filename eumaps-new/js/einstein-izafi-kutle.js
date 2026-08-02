document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("relMassForm");
  const restMassInput = document.getElementById("restMassInput");
  const velocityInput = document.getElementById("velocityInput");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");
  const resultSection = document.getElementById("resultSection");

  const restMassResult = document.getElementById("restMassResult");
  const velocityResult = document.getElementById("velocityResult");
  const velocityRatioResult = document.getElementById("velocityRatioResult");
  const velocityPercentageResult = document.getElementById(
    "velocityPercentageResult"
  );
  const lorentzFactorResult = document.getElementById("lorentzFactorResult");
  const relativisticMassGramResult = document.getElementById(
    "relativisticMassGramResult"
  );
  const massDifferenceResult = document.getElementById(
    "massDifferenceResult"
  );
  const massIncreasePercentageResult = document.getElementById(
    "massIncreasePercentageResult"
  );
  const relativisticMassKgResult = document.getElementById(
    "relativisticMassKgResult"
  );
  const relativisticMassTonResult = document.getElementById(
    "relativisticMassTonResult"
  );
  const relativisticMassMegatonResult = document.getElementById(
    "relativisticMassMegatonResult"
  );
  const relativisticMassGigatonResult = document.getElementById(
    "relativisticMassGigatonResult"
  );
  const calculationText = document.getElementById("calculationText");

  const speedOfLight = 299792458;
  const speedOfLightKm = 299792.458;

  const gramsToKg = 1e-3;
  const gramsToTon = 1e-6;
  const gramsToMegaton = 1e-12;
  const gramsToGigaton = 1e-15;

  form.addEventListener("submit", calculateRelativisticMass);
  clearBtn.addEventListener("click", clearCalculator);

  [restMassInput, velocityInput].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("input-error");
      hideMessage();
    });
  });

  function calculateRelativisticMass(event) {
    event.preventDefault();

    hideMessage();
    removeInputErrors();

    const restMass = Number(restMassInput.value);
    const velocityKm = Number(velocityInput.value);

    if (
      restMassInput.value.trim() === "" ||
      !Number.isFinite(restMass) ||
      restMass <= 0
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

    const velocity = velocityKm * 1000;
    const velocityRatio = velocity / speedOfLight;
    const velocityPercentage = velocityRatio * 100;

    const lorentzFactor =
      1 / Math.sqrt(1 - Math.pow(velocityRatio, 2));

    const relativisticMass = lorentzFactor * restMass;
    const massDifference = relativisticMass - restMass;

    const massIncreasePercentage =
      (massDifference / restMass) * 100;

    const relativisticMassKg =
      relativisticMass * gramsToKg;

    const relativisticMassTon =
      relativisticMass * gramsToTon;

    const relativisticMassMegaton =
      relativisticMass * gramsToMegaton;

    const relativisticMassGigaton =
      relativisticMass * gramsToGigaton;

    displayResults({
      restMass,
      velocityKm,
      velocityRatio,
      velocityPercentage,
      lorentzFactor,
      relativisticMass,
      massDifference,
      massIncreasePercentage,
      relativisticMassKg,
      relativisticMassTon,
      relativisticMassMegaton,
      relativisticMassGigaton
    });
  }

  function displayResults(result) {
    restMassResult.textContent =
      `${formatNumber(result.restMass, 10)} gram`;

    velocityResult.textContent =
      `${formatNumber(result.velocityKm, 10)} km/sn`;

    velocityRatioResult.textContent =
      formatNumber(result.velocityRatio, 20);

    velocityPercentageResult.textContent =
      `%${formatNumber(result.velocityPercentage, 12)}`;

    lorentzFactorResult.textContent =
      formatNumber(result.lorentzFactor, 14);

    relativisticMassGramResult.textContent =
      `${formatLargeNumber(result.relativisticMass)} gram`;

    massDifferenceResult.textContent =
      `${formatLargeNumber(result.massDifference)} gram`;

    massIncreasePercentageResult.textContent =
      `%${formatNumber(result.massIncreasePercentage, 12)}`;

    relativisticMassKgResult.textContent =
      `${formatLargeNumber(result.relativisticMassKg)} kilogram`;

    relativisticMassTonResult.textContent =
      `${formatLargeNumber(result.relativisticMassTon)} ton`;

    relativisticMassMegatonResult.textContent =
      `${formatLargeNumber(result.relativisticMassMegaton)} megaton`;

    relativisticMassGigatonResult.textContent =
      `${formatLargeNumber(result.relativisticMassGigaton)} gigaton`;

    calculationText.textContent =
      `${formatNumber(result.restMass, 10)} ÷ √(1 − ` +
      `${formatNumber(result.velocityKm, 10)}² / ` +
      `${formatNumber(speedOfLightKm, 3)}²) = ` +
      `${formatLargeNumber(result.relativisticMass)} gram`;

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
    relativisticMassGramResult.textContent = "0 gram";
    massDifferenceResult.textContent = "0 gram";
    massIncreasePercentageResult.textContent = "%0";
    relativisticMassKgResult.textContent = "0 kilogram";
    relativisticMassTonResult.textContent = "0 ton";
    relativisticMassMegatonResult.textContent = "0 megaton";
    relativisticMassGigatonResult.textContent = "0 gigaton";
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