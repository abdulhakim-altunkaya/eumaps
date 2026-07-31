document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("dilationForm");
  const spaceshipTimeInput = document.getElementById("spaceshipTime");
  const spaceshipVelocityInput = document.getElementById("spaceshipVelocity");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");
  const resultSection = document.getElementById("resultSection");

  const spaceshipTimeResult = document.getElementById("spaceshipTimeResult");
  const earthTimeResult = document.getElementById("earthTimeResult");
  const timeDifferenceResult = document.getElementById("timeDifferenceResult");
  const lorentzFactorResult = document.getElementById("lorentzFactorResult");
  const velocityResult = document.getElementById("velocityResult");
  const velocityRatioResult = document.getElementById("velocityRatioResult");
  const velocityPercentageResult = document.getElementById("velocityPercentageResult");
  const calculationText = document.getElementById("calculationText");

  const speedOfLightKm = 299792.458;

  form.addEventListener("submit", calculateTimeDilation);
  clearBtn.addEventListener("click", clearCalculator);

  [spaceshipTimeInput, spaceshipVelocityInput].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("input-error");
      hideMessage();
    });
  });

  function calculateTimeDilation(event) {
    event.preventDefault();

    hideMessage();
    removeInputErrors();

    const spaceshipTime = Number(spaceshipTimeInput.value);
    const spaceshipVelocity = Number(spaceshipVelocityInput.value);

    if (
      spaceshipTimeInput.value.trim() === "" ||
      !Number.isFinite(spaceshipTime) ||
      spaceshipTime <= 0 ||
      spaceshipTime > 10000000000000
    ) {
      spaceshipTimeInput.classList.add("input-error");
      spaceshipTimeInput.focus();

      showMessage(
        "Araçta geçen süre sıfırdan büyük ve 10 trilyondan küçük olmalıdır."
      );

      return;
    }

    if (
      spaceshipVelocityInput.value.trim() === "" ||
      !Number.isFinite(spaceshipVelocity) ||
      spaceshipVelocity <= 0
    ) {
      spaceshipVelocityInput.classList.add("input-error");
      spaceshipVelocityInput.focus();
      showMessage("Geçerli bir araç hızı girin.");
      return;
    }

    if (spaceshipVelocity >= speedOfLightKm) {
      spaceshipVelocityInput.classList.add("input-error");
      spaceshipVelocityInput.focus();

      showMessage(
        "Araç hızı, 299.792,458 km/sn olan ışık hızından düşük olmalıdır."
      );

      return;
    }

    const velocityRatio = spaceshipVelocity / speedOfLightKm;
    const squareRootPart = Math.sqrt(
      1 - Math.pow(velocityRatio, 2)
    );

    if (
      !Number.isFinite(squareRootPart) ||
      squareRootPart <= 0
    ) {
      showMessage("Girilen hız için geçerli bir sonuç hesaplanamadı.");
      return;
    }

    const lorentzFactor = 1 / squareRootPart;
    const earthTime = spaceshipTime * lorentzFactor;
    const timeDifference = earthTime - spaceshipTime;
    const velocityPercentage = velocityRatio * 100;

    displayResults({
      spaceshipTime,
      spaceshipVelocity,
      velocityRatio,
      velocityPercentage,
      lorentzFactor,
      earthTime,
      timeDifference
    });
  }

  function displayResults(result) {
    spaceshipTimeResult.textContent =
      `${formatNumber(result.spaceshipTime, 10)} saniye`;

    earthTimeResult.textContent =
      `${formatNumber(result.earthTime, 10)} saniye`;

    timeDifferenceResult.textContent =
      `${formatNumber(result.timeDifference, 10)} saniye`;

    lorentzFactorResult.textContent =
      formatNumber(result.lorentzFactor, 12);

    velocityResult.textContent =
      `${formatNumber(result.spaceshipVelocity, 10)} km/sn`;

    velocityRatioResult.textContent =
      formatNumber(result.velocityRatio, 20);

    velocityPercentageResult.textContent =
      `%${formatNumber(result.velocityPercentage, 10)}`;

    calculationText.textContent =
      `${formatNumber(result.spaceshipTime, 10)} ÷ √(1 − ` +
      `${formatNumber(result.spaceshipVelocity, 10)}² / ` +
      `${formatNumber(speedOfLightKm, 3)}²) = ` +
      `${formatNumber(result.earthTime, 10)} saniye`;

    resultSection.hidden = false;

    resultSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function clearCalculator() {
    form.reset();
    resultSection.hidden = true;

    spaceshipTimeResult.textContent = "0 saniye";
    earthTimeResult.textContent = "0 saniye";
    timeDifferenceResult.textContent = "0 saniye";
    lorentzFactorResult.textContent = "1";
    velocityResult.textContent = "0 km/sn";
    velocityRatioResult.textContent = "0";
    velocityPercentageResult.textContent = "%0";
    calculationText.textContent = "";

    removeInputErrors();
    hideMessage();
    spaceshipTimeInput.focus();
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
    spaceshipTimeInput.classList.remove("input-error");
    spaceshipVelocityInput.classList.remove("input-error");
  }

  function formatNumber(value, maximumFractionDigits = 6) {
    if (!Number.isFinite(value)) {
      return "0";
    }

    if (value !== 0 && Math.abs(value) < 0.000001) {
      return value.toExponential(6).replace(".", ",");
    }

    if (Math.abs(value) >= 1000000000000000) {
      return value.toExponential(8).replace(".", ",");
    }

    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 0,
      maximumFractionDigits
    }).format(value);
  }
});