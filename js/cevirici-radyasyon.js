document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  inputs.forEach(input => {
    if (!input.name.includes("cancerRisk")) {
      input.addEventListener("input", handleRadiationInput);
    }
  });

  clearBtn.addEventListener("click", clearRadiationFields);

  function convertGamma(name, value) {
    const conversions = {
      grayGamma: {
        grayGamma: value,
        milligrayGamma: value * 1000,
        sievertGamma: value,
        millisievertGamma: value * 1000,
        radGamma: value * 100,
        remGamma: value * 100,
        cancerRiskGamma: value * 5,
        flightDurationGamma: value / 0.000004,
        chestXraysGamma: value / 0.0001
      },
      milligrayGamma: {
        grayGamma: value / 1000,
        milligrayGamma: value,
        sievertGamma: value / 1000,
        millisievertGamma: value,
        radGamma: value / 10,
        remGamma: value / 10,
        cancerRiskGamma: value / 1000 * 5,
        flightDurationGamma: value / 1000 / 0.000004,
        chestXraysGamma: value / 1000 / 0.0001
      },
      sievertGamma: {
        grayGamma: value,
        milligrayGamma: value * 1000,
        sievertGamma: value,
        millisievertGamma: value * 1000,
        radGamma: value * 100,
        remGamma: value * 100,
        cancerRiskGamma: value * 5,
        flightDurationGamma: value / 0.000004,
        chestXraysGamma: value / 0.0001
      },
      millisievertGamma: {
        grayGamma: value / 1000,
        milligrayGamma: value,
        sievertGamma: value / 1000,
        millisievertGamma: value,
        radGamma: value / 10,
        remGamma: value / 10,
        cancerRiskGamma: value / 1000 * 5,
        flightDurationGamma: value / 1000 / 0.000004,
        chestXraysGamma: value / 1000 / 0.0001
      },
      radGamma: {
        grayGamma: value / 100,
        milligrayGamma: value * 10,
        sievertGamma: value / 100,
        millisievertGamma: value * 10,
        radGamma: value,
        remGamma: value,
        cancerRiskGamma: value / 100 * 5,
        flightDurationGamma: value / 100 / 0.000004,
        chestXraysGamma: value / 100 / 0.0001
      },
      remGamma: {
        grayGamma: value / 100,
        milligrayGamma: value * 10,
        sievertGamma: value / 100,
        millisievertGamma: value * 10,
        radGamma: value,
        remGamma: value,
        cancerRiskGamma: value / 100 * 5,
        flightDurationGamma: value / 100 / 0.000004,
        chestXraysGamma: value / 100 / 0.0001
      },
      flightDurationGamma: {
        grayGamma: value * 0.000004,
        milligrayGamma: value * 0.004,
        sievertGamma: value * 0.000004,
        millisievertGamma: value * 0.004,
        radGamma: value * 0.0004,
        remGamma: value * 0.0004,
        cancerRiskGamma: value * 0.000004 * 5,
        flightDurationGamma: value,
        chestXraysGamma: value * 0.04
      },
      chestXraysGamma: {
        grayGamma: value * 0.0001,
        milligrayGamma: value * 0.1,
        sievertGamma: value * 0.0001,
        millisievertGamma: value * 0.1,
        radGamma: value * 0.01,
        remGamma: value * 0.01,
        cancerRiskGamma: value * 0.0001 * 5,
        flightDurationGamma: value * 25,
        chestXraysGamma: value
      }
    };

    return conversions[name];
  }

  function convertAlpha(name, value) {
    const conversions = {
      grayAlpha: {
        grayAlpha: value,
        milligrayAlpha: value * 1000,
        sievertAlpha: value * 20,
        millisievertAlpha: value * 20000,
        radAlpha: value * 100,
        remAlpha: value * 2000,
        cancerRiskAlpha: value * 100,
        issDurationAlpha: value / 0.0000015,
        moonDurationAlpha: value / 0.000003125,
        marsDurationAlpha: value / 0.000001875
      },
      milligrayAlpha: {
        grayAlpha: value / 1000,
        milligrayAlpha: value,
        sievertAlpha: value / 50,
        millisievertAlpha: value * 20,
        radAlpha: value / 10,
        remAlpha: value * 2,
        cancerRiskAlpha: value / 10,
        issDurationAlpha: value / 1000 / 0.0000015,
        moonDurationAlpha: value / 1000 / 0.000003125,
        marsDurationAlpha: value / 1000 / 0.000001875
      },
      sievertAlpha: {
        grayAlpha: value / 20,
        milligrayAlpha: value * 50,
        sievertAlpha: value,
        millisievertAlpha: value * 1000,
        radAlpha: value * 5,
        remAlpha: value * 100,
        cancerRiskAlpha: value * 5,
        issDurationAlpha: value / 0.00003,
        moonDurationAlpha: value / 0.0000625,
        marsDurationAlpha: value / 0.0000375
      },
      millisievertAlpha: {
        grayAlpha: value / 20000,
        milligrayAlpha: value / 20,
        sievertAlpha: value / 1000,
        millisievertAlpha: value,
        radAlpha: value / 200,
        remAlpha: value / 10,
        cancerRiskAlpha: value / 1000 * 5,
        issDurationAlpha: value / 1000 / 0.00003,
        moonDurationAlpha: value / 1000 / 0.0000625,
        marsDurationAlpha: value / 1000 / 0.0000375
      },
      radAlpha: {
        grayAlpha: value / 100,
        milligrayAlpha: value * 10,
        sievertAlpha: value / 5,
        millisievertAlpha: value * 200,
        radAlpha: value,
        remAlpha: value * 20,
        cancerRiskAlpha: value,
        issDurationAlpha: value / 100 / 0.0000015,
        moonDurationAlpha: value / 100 / 0.000003125,
        marsDurationAlpha: value / 100 / 0.000001875
      },
      remAlpha: {
        grayAlpha: value / 2000,
        milligrayAlpha: value / 2,
        sievertAlpha: value / 100,
        millisievertAlpha: value * 10,
        radAlpha: value / 20,
        remAlpha: value,
        cancerRiskAlpha: value / 100 * 5,
        issDurationAlpha: value / 100 / 0.00003,
        moonDurationAlpha: value / 100 / 0.0000625,
        marsDurationAlpha: value / 100 / 0.0000375
      },
      issDurationAlpha: {
        grayAlpha: value * 0.0000015,
        milligrayAlpha: value * 0.0015,
        sievertAlpha: value * 0.00003,
        millisievertAlpha: value * 0.03,
        radAlpha: value * 0.00015,
        remAlpha: value * 0.003,
        cancerRiskAlpha: value * 0.00015,
        issDurationAlpha: value,
        moonDurationAlpha: value * 0.48,
        marsDurationAlpha: value * 0.8
      },
      moonDurationAlpha: {
        grayAlpha: value * 0.000003125,
        milligrayAlpha: value * 0.003125,
        sievertAlpha: value * 0.0000625,
        millisievertAlpha: value * 0.0625,
        radAlpha: value * 0.0003125,
        remAlpha: value * 0.00625,
        cancerRiskAlpha: value * 0.0003125,
        issDurationAlpha: value * 2.0833333333,
        moonDurationAlpha: value,
        marsDurationAlpha: value * 1.6666666667
      },
      marsDurationAlpha: {
        grayAlpha: value * 0.000001875,
        milligrayAlpha: value * 0.001875,
        sievertAlpha: value * 0.0000375,
        millisievertAlpha: value * 0.0375,
        radAlpha: value * 0.0001875,
        remAlpha: value * 0.00375,
        cancerRiskAlpha: value * 0.0001875,
        issDurationAlpha: value * 1.25,
        moonDurationAlpha: value * 0.6,
        marsDurationAlpha: value
      }
    };

    return conversions[name];
  }

  function formatNumber(value) {
    if (value === 0) return "0";

    const absValue = Math.abs(value);

    if (absValue < 1e-6 || absValue > 1e6) {
      return value.toExponential(5);
    }

    if (absValue < 1) {
      return String(parseFloat(value.toFixed(10)));
    }

    return String(parseFloat(value.toFixed(8)));
  }

  function handleRadiationInput(event) {
    const currentInput = event.target;
    const name = currentInput.name;
    const value = currentInput.value;

    hideMessage();
    removeErrors();

    if (value === "") {
      clearGroup(name);
      return;
    }

    const numberValue = Number(value);

    if (!Number.isFinite(numberValue) || numberValue < 0) {
      currentInput.classList.add("input-error");
      showMessage("Geçerli ve pozitif bir değer giriniz.");
      return;
    }

    let results;
    let groupInputs;

    if (name.includes("Gamma")) {
      results = convertGamma(name, numberValue);
      groupInputs = document.querySelectorAll(".inputFields[name*='Gamma']");
    } else if (name.includes("Alpha")) {
      results = convertAlpha(name, numberValue);
      groupInputs = document.querySelectorAll(".inputFields[name*='Alpha']");
    } else {
      return;
    }

    if (!results) return;

    groupInputs.forEach(input => {
      if (input !== currentInput) {
        const result = results[input.name];
        input.value = result !== undefined ? formatNumber(result) : "";
      }
    });
  }

  function clearGroup(name) {
    const selector = name.includes("Gamma")
      ? ".inputFields[name*='Gamma']"
      : ".inputFields[name*='Alpha']";

    document.querySelectorAll(selector).forEach(input => {
      input.value = "";
    });
  }

  function clearRadiationFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("grayGamma").focus();
  }

  function showMessage(message) {
    formMessage.textContent = message;
    formMessage.classList.add("visible");
  }

  function hideMessage() {
    formMessage.textContent = "";
    formMessage.classList.remove("visible");
  }

  function removeErrors() {
    inputs.forEach(input => input.classList.remove("input-error"));
  }
});