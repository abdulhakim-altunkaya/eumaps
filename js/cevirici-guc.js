document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  inputs.forEach(input => input.addEventListener("input", handlePowerInput));
  clearBtn.addEventListener("click", clearPowerFields);

  function convertPower(name, value) {
    const conversions = {
      watt: {
        watt: value,
        kilowatt: value / 1000,
        megawatt: value / 1e6,
        horsepowerImperial: value / 745.7,
        horsepowerMetric: value / 735.49875,
        footPoundPerSecond: value / 1.355818,
        caloriePerSecond: value / 4.184,
        kilocaloriePerSecond: value / 4184,
        ergPerSecond: value * 1e7,
        pferdestarke: value / 735.49875,
        milliwatt: value * 1000
      },

      kilowatt: {
        watt: value * 1000,
        kilowatt: value,
        megawatt: value / 1000,
        horsepowerImperial: value * 1.34102209,
        horsepowerMetric: value * 1.35962162,
        footPoundPerSecond: value * 737.562149,
        caloriePerSecond: value * 238.8459,
        kilocaloriePerSecond: value * 0.2388459,
        ergPerSecond: value * 1e10,
        pferdestarke: value * 1.35962162,
        milliwatt: value * 1e6
      },

      megawatt: {
        watt: value * 1e6,
        kilowatt: value * 1000,
        megawatt: value,
        horsepowerImperial: value * 1341.02209,
        horsepowerMetric: value * 1359.62162,
        footPoundPerSecond: value * 737562.149,
        caloriePerSecond: value * 238845.9,
        kilocaloriePerSecond: value * 238.8459,
        ergPerSecond: value * 1e13,
        pferdestarke: value * 1359.62162,
        milliwatt: value * 1e9
      },

      horsepowerImperial: {
        watt: value * 745.7,
        kilowatt: value * 0.7457,
        megawatt: value * 0.0007457,
        horsepowerImperial: value,
        horsepowerMetric: value * 1.01386766,
        footPoundPerSecond: value * 550,
        caloriePerSecond: value * 178.107354,
        kilocaloriePerSecond: value * 0.178107354,
        ergPerSecond: value * 7.457e9,
        pferdestarke: value * 1.01386766,
        milliwatt: value * 745700
      },

      horsepowerMetric: {
        watt: value * 735.49875,
        kilowatt: value * 0.73549875,
        megawatt: value * 0.00073549875,
        horsepowerImperial: value * 0.98632007,
        horsepowerMetric: value,
        footPoundPerSecond: value * 542.476038,
        caloriePerSecond: value * 175.670858,
        kilocaloriePerSecond: value * 0.175670858,
        ergPerSecond: value * 7.3549875e9,
        pferdestarke: value,
        milliwatt: value * 735498.75
      },

      footPoundPerSecond: {
        watt: value * 1.355818,
        kilowatt: value * 0.001355818,
        megawatt: value * 1.355818e-6,
        horsepowerImperial: value * 0.00181818182,
        horsepowerMetric: value * 0.00184339836,
        footPoundPerSecond: value,
        caloriePerSecond: value * 0.323831554,
        kilocaloriePerSecond: value * 0.000323831554,
        ergPerSecond: value * 1.355818e7,
        pferdestarke: value * 0.00184339836,
        milliwatt: value * 1355.818
      },

      caloriePerSecond: {
        watt: value * 4.184,
        kilowatt: value * 0.004184,
        megawatt: value * 4.184e-6,
        horsepowerImperial: value * 0.00561459124,
        horsepowerMetric: value * 0.00568865545,
        footPoundPerSecond: value * 3.08802521,
        caloriePerSecond: value,
        kilocaloriePerSecond: value / 1000,
        ergPerSecond: value * 4.184e7,
        pferdestarke: value * 0.00568865545,
        milliwatt: value * 4184
      },

      kilocaloriePerSecond: {
        watt: value * 4184,
        kilowatt: value * 4.184,
        megawatt: value * 0.004184,
        horsepowerImperial: value * 5.61459124,
        horsepowerMetric: value * 5.68865545,
        footPoundPerSecond: value * 3088.02521,
        caloriePerSecond: value * 1000,
        kilocaloriePerSecond: value,
        ergPerSecond: value * 4.184e10,
        pferdestarke: value * 5.68865545,
        milliwatt: value * 4.184e6
      },

      ergPerSecond: {
        watt: value * 1e-7,
        kilowatt: value * 1e-10,
        megawatt: value * 1e-13,
        horsepowerImperial: value * 1.34102209e-10,
        horsepowerMetric: value * 1.35962162e-10,
        footPoundPerSecond: value * 7.37562149e-8,
        caloriePerSecond: value * 2.388459e-8,
        kilocaloriePerSecond: value * 2.388459e-11,
        ergPerSecond: value,
        pferdestarke: value * 1.35962162e-10,
        milliwatt: value * 1e-4
      },

      pferdestarke: {
        watt: value * 735.49875,
        kilowatt: value * 0.73549875,
        megawatt: value * 0.00073549875,
        horsepowerImperial: value * 0.98632007,
        horsepowerMetric: value,
        footPoundPerSecond: value * 542.476038,
        caloriePerSecond: value * 175.670858,
        kilocaloriePerSecond: value * 0.175670858,
        ergPerSecond: value * 7.3549875e9,
        pferdestarke: value,
        milliwatt: value * 735498.75
      },

      milliwatt: {
        watt: value * 0.001,
        kilowatt: value * 1e-6,
        megawatt: value * 1e-9,
        horsepowerImperial: value * 1.34102209e-6,
        horsepowerMetric: value * 1.35962162e-6,
        footPoundPerSecond: value * 0.000737562149,
        caloriePerSecond: value * 0.0002388459,
        kilocaloriePerSecond: value * 2.388459e-7,
        ergPerSecond: value * 10000,
        pferdestarke: value * 1.35962162e-6,
        milliwatt: value
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

  function handlePowerInput(event) {
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

    if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 1000000000) {
      currentInput.classList.add("input-error");
      showMessage("0 ile 1.000.000.000 arasında geçerli bir değer girin.");
      return;
    }

    const results = convertPower(currentInput.name, numberValue);

    inputs.forEach(input => {
      if (input !== currentInput) {
        const result = results[input.name];
        input.value = result !== undefined ? formatNumber(result) : "";
      }
    });
  }

  function clearPowerFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("watt").focus();
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