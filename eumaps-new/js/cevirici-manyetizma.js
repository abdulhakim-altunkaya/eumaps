document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  const REFERENCE_VALUES = {
    phoneMagnet: 0.0001,
    fridgeMagnet: 0.01,
    earthField: 0.00005,
    medicalScanner: 1.5,
    solarSunspot: 0.3,
    neutronStar: 100000000
  };

  inputs.forEach(input => {
    input.addEventListener("input", handleMagneticInput);
  });

  clearBtn.addEventListener("click", clearMagneticFields);

  function convertMagnetic(name, value) {
    let baseTesla = 0;

    switch (name) {
      case "tesla":
        baseTesla = value;
        break;

      case "millitesla":
        baseTesla = value / 1000;
        break;

      case "microtesla":
        baseTesla = value / 1000000;
        break;

      case "gauss":
        baseTesla = value / 10000;
        break;

      case "phoneMagnet":
        baseTesla = value * REFERENCE_VALUES.phoneMagnet;
        break;

      case "fridgeMagnet":
        baseTesla = value * REFERENCE_VALUES.fridgeMagnet;
        break;

      case "earthField":
        baseTesla = value * REFERENCE_VALUES.earthField;
        break;

      case "medicalScanner":
        baseTesla = value * REFERENCE_VALUES.medicalScanner;
        break;

      case "solarSunspot":
        baseTesla = value * REFERENCE_VALUES.solarSunspot;
        break;

      case "neutronStar":
        baseTesla = value * REFERENCE_VALUES.neutronStar;
        break;
    }

    return {
      tesla: baseTesla,
      millitesla: baseTesla * 1000,
      microtesla: baseTesla * 1000000,
      gauss: baseTesla * 10000,
      phoneMagnet: baseTesla / REFERENCE_VALUES.phoneMagnet,
      fridgeMagnet: baseTesla / REFERENCE_VALUES.fridgeMagnet,
      earthField: baseTesla / REFERENCE_VALUES.earthField,
      medicalScanner: baseTesla / REFERENCE_VALUES.medicalScanner,
      solarSunspot: baseTesla / REFERENCE_VALUES.solarSunspot,
      neutronStar: baseTesla / REFERENCE_VALUES.neutronStar
    };
  }

  function formatNumber(value) {
    if (value === 0) return "0";

    const absValue = Math.abs(value);

    if (absValue < 1e-6 || absValue > 1e6) {
      return value.toExponential(4);
    }

    if (absValue < 1) {
      return String(parseFloat(value.toFixed(6)));
    }

    return String(parseFloat(value.toFixed(2)));
  }

  function handleMagneticInput(event) {
    const currentInput = event.target;
    const value = currentInput.value;

    hideMessage();
    removeInputErrors();

    if (value === "") {
      inputs.forEach(input => {
        if (input !== currentInput) input.value = "";
      });
      return;
    }

    const numberValue = Number(value);

    if (!Number.isFinite(numberValue) || numberValue < 0) {
      currentInput.classList.add("input-error");
      showMessage("Geçerli ve pozitif bir değer giriniz.");
      return;
    }

    const maxValue = Number(currentInput.max);

    if (maxValue && numberValue > maxValue) {
      currentInput.classList.add("input-error");
      showMessage(`Bu alan için en yüksek değer ${maxValue} olabilir.`);
      return;
    }

    const results = convertMagnetic(currentInput.name, numberValue);

    inputs.forEach(input => {
      if (input !== currentInput) {
        const result = results[input.name];
        input.value = result !== undefined ? formatNumber(result) : "";
      }
    });
  }

  function clearMagneticFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("tesla").focus();
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
    inputs.forEach(input => {
      input.classList.remove("input-error");
    });
  }
});