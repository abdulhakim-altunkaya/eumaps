document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("lengthContractionForm");
  const restLengthInput = document.getElementById("restLengthInput");
  const velocityInput = document.getElementById("velocityInput");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");
  const resultSection = document.getElementById("resultSection");

  const restLengthResult = document.getElementById("restLengthResult");
  const velocityResult = document.getElementById("velocityResult");
  const velocityRatioResult = document.getElementById("velocityRatioResult");
  const contractedLengthResult = document.getElementById("contractedLengthResult");
  const lengthDifferenceResult = document.getElementById("lengthDifferenceResult");
  const contractionPercentageResult = document.getElementById("contractionPercentageResult");
  const lorentzFactorResult = document.getElementById("lorentzFactorResult");
  const calculationText = document.getElementById("calculationText");

  const speedOfLightKm = 299792.458;

  form.addEventListener("submit", calculateLengthContraction);
  clearBtn.addEventListener("click", clearCalculator);

  [restLengthInput, velocityInput].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("input-error");
      hideMessage();
    });
  });

  function calculateLengthContraction(event) {
    event.preventDefault();

    hideMessage();
    removeInputErrors();

    const restLength = Number(restLengthInput.value);
    const velocityKm = Number(velocityInput.value);

    if (
      restLengthInput.value.trim() === "" ||
      !Number.isFinite(restLength) ||
      restLength <= 0
    ) {
      restLengthInput.classList.add("input-error");
      restLengthInput.focus();
      showMessage("Geçerli bir durgun uzunluk girin.");
      return;
    }

    if (
      velocityInput.value.trim() === "" ||
      !Number.isFinite(velocityKm) ||
      velocityKm <= 0
    ) {
      velocityInput.classList.add("input-error");
      velocityInput.focus();
      showMessage("Geçerli bir hız değeri girin.");
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

    const velocityRatio = velocityKm / speedOfLightKm;
    const contractionFactor = Math.sqrt(1 - Math.pow(velocityRatio, 2));

    if (
      !Number.isFinite(contractionFactor) ||
      contractionFactor <= 0
    ) {
      showMessage("Girilen hız için geçerli bir sonuç hesaplanamadı.");
      return;
    }

    const contractedLength = restLength * contractionFactor;
    const lengthDifference = restLength - contractedLength;
    const contractionPercentage = (lengthDifference / restLength) * 100;
    const lorentzFactor = 1 / contractionFactor;

    displayResults({
      restLength,
      velocityKm,
      velocityRatio,
      contractedLength,
      lengthDifference,
      contractionPercentage,
      lorentzFactor,
      contractionFactor
    });
  }

  function displayResults(result) {
    restLengthResult.textContent =
      `${formatNumber(result.restLength, 10)} metre`;

    velocityResult.textContent =
      `${formatNumber(result.velocityKm, 10)} km/sn`;

    velocityRatioResult.textContent =
      formatNumber(result.velocityRatio, 12);

    contractedLengthResult.textContent =
      `${formatNumber(result.contractedLength, 10)} metre`;

    lengthDifferenceResult.textContent =
      `${formatNumber(result.lengthDifference, 10)} metre`;

    contractionPercentageResult.textContent =
      `%${formatNumber(result.contractionPercentage, 10)}`;

    lorentzFactorResult.textContent =
      formatNumber(result.lorentzFactor, 12);

    calculationText.textContent =
      `${formatNumber(result.restLength, 10)} × √(1 − ` +
      `${formatNumber(result.velocityKm, 10)}² / ` +
      `${formatNumber(speedOfLightKm, 3)}²) = ` +
      `${formatNumber(result.contractedLength, 10)} metre`;

    resultSection.hidden = false;

    resultSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function clearCalculator() {
    form.reset();
    resultSection.hidden = true;

    restLengthResult.textContent = "0 metre";
    velocityResult.textContent = "0 km/sn";
    velocityRatioResult.textContent = "0";
    contractedLengthResult.textContent = "0 metre";
    lengthDifferenceResult.textContent = "0 metre";
    contractionPercentageResult.textContent = "%0";
    lorentzFactorResult.textContent = "1";
    calculationText.textContent = "";

    removeInputErrors();
    hideMessage();
    restLengthInput.focus();
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
    restLengthInput.classList.remove("input-error");
    velocityInput.classList.remove("input-error");
  }

  function formatNumber(value, maximumFractionDigits = 6) {
    if (!Number.isFinite(value)) {
      return "0";
    }

    if (value !== 0 && Math.abs(value) < 0.000001) {
      return value.toExponential(6).replace(".", ",");
    }

    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 0,
      maximumFractionDigits
    }).format(value);
  }
});