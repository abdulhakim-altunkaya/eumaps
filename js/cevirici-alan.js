document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  inputs.forEach((input) => {
    input.addEventListener("input", handleChangeAreaUnits);
  });

  clearBtn.addEventListener("click", clearFields);

  function convertValues(name, value) {
    const conversions = {

      sqMillimeter: {
        sqMillimeter: value,
        sqCentimeter: value / 100,
        sqMeter: value / 1e6,
        donum: value / 1e9,
        sqKilometer: value / 1e12,
        sqFeet: value / 92903.04,
        sqInch: value / 645.16,
        sqYard: value / 836127.36,
        acre: value / 4.046856422e9,
        hectare: value / 1e10,
        sqMile: value / 2.58998811e12,
        are: value / 1e8,
        sqMicrometer: value * 1e6,
        barn: value * 1e22
      },

      sqCentimeter: {
        sqMillimeter: value * 100,
        sqCentimeter: value,
        sqMeter: value / 10000,
        donum: value / 1e7,
        sqKilometer: value / 1e10,
        sqFeet: value / 929.0304,
        sqInch: value / 6.4516,
        sqYard: value / 8361.2736,
        acre: value / 40468564.22,
        hectare: value / 1e8,
        sqMile: value / 2.58998811e10,
        are: value / 1e6,
        sqMicrometer: value * 1e8,
        barn: value * 1e24
      },

      sqMeter: {
        sqMillimeter: value * 1e6,
        sqCentimeter: value * 10000,
        sqMeter: value,
        donum: value / 1000,
        sqKilometer: value / 1e6,
        sqFeet: value * 10.7639104167,
        sqInch: value * 1550.0031,
        sqYard: value * 1.195990046,
        acre: value / 4046.856422,
        hectare: value / 10000,
        sqMile: value / 2589988.11,
        are: value / 100,
        sqMicrometer: value * 1e12,
        barn: value * 1e28
      },

      donum: {
        sqMillimeter: value * 1e9,
        sqCentimeter: value * 1e7,
        sqMeter: value * 1000,
        donum: value,
        sqKilometer: value / 1000,
        sqFeet: value * 10763.9104167,
        sqInch: value * 1550003.1,
        sqYard: value * 1195.990046,
        acre: value / 4.046856422,
        hectare: value / 10,
        sqMile: value / 2589.98811,
        are: value * 10,
        sqMicrometer: value * 1e15,
        barn: value * 1e31
      },

      sqKilometer: {
        sqMillimeter: value * 1e12,
        sqCentimeter: value * 1e10,
        sqMeter: value * 1e6,
        donum: value * 1000,
        sqKilometer: value,
        sqFeet: value * 10763910.4167,
        sqInch: value * 1550003100,
        sqYard: value * 1195990.046,
        acre: value * 247.105381467,
        hectare: value * 100,
        sqMile: value / 2.58998811,
        are: value * 10000,
        sqMicrometer: value * 1e18,
        barn: value * 1e34
      },

      sqFeet: {
        sqMillimeter: value * 92903.04,
        sqCentimeter: value * 929.0304,
        sqMeter: value * 0.09290304,
        donum: value / 10763.9104167,
        sqKilometer: value / 10763910.4167,
        sqFeet: value,
        sqInch: value * 144,
        sqYard: value / 9,
        acre: value / 43560,
        hectare: value / 107639.104167,
        sqMile: value / 27878400,
        are: value / 1076.39104167,
        sqMicrometer: value * 9.290304e10,
        barn: value * 9.290304e26
      },

      sqInch: {
        sqMillimeter: value * 645.16,
        sqCentimeter: value * 6.4516,
        sqMeter: value * 0.00064516,
        donum: value / 1550003.1,
        sqKilometer: value / 1550003100,
        sqFeet: value / 144,
        sqInch: value,
        sqYard: value / 1296,
        acre: value / 6272640,
        hectare: value / 15500031,
        sqMile: value / 4014489600,
        are: value / 155000.31,
        sqMicrometer: value * 645160000,
        barn: value * 6.4516e24
      },

      sqYard: {
        sqMillimeter: value * 836127.36,
        sqCentimeter: value * 8361.2736,
        sqMeter: value * 0.83612736,
        donum: value / 1195.990046,
        sqKilometer: value / 1195990.046,
        sqFeet: value * 9,
        sqInch: value * 1296,
        sqYard: value,
        acre: value / 4840,
        hectare: value / 11959.900463,
        sqMile: value / 3097600,
        are: value / 119.59900463,
        sqMicrometer: value * 8.3612736e11,
        barn: value * 8.3612736e27
      },

      acre: {
        sqMillimeter: value * 4.046856422e9,
        sqCentimeter: value * 40468564.22,
        sqMeter: value * 4046.856422,
        donum: value * 4.046856422,
        sqKilometer: value / 247.105381467,
        sqFeet: value * 43560,
        sqInch: value * 6272640,
        sqYard: value * 4840,
        acre: value,
        hectare: value * 0.4046856422,
        sqMile: value / 640,
        are: value * 40.46856422,
        sqMicrometer: value * 4.046856422e15,
        barn: value * 4.046856422e31
      },

      hectare: {
        sqMillimeter: value * 1e10,
        sqCentimeter: value * 1e8,
        sqMeter: value * 10000,
        donum: value * 10,
        sqKilometer: value / 100,
        sqFeet: value * 107639.104167,
        sqInch: value * 15500031,
        sqYard: value * 11959.900463,
        acre: value * 2.47105381467,
        hectare: value,
        sqMile: value / 258.998811,
        are: value * 100,
        sqMicrometer: value * 1e16,
        barn: value * 1e32
      },

      sqMile: {
        sqMillimeter: value * 2.58998811e12,
        sqCentimeter: value * 2.58998811e10,
        sqMeter: value * 2589988.11,
        donum: value * 2589.98811,
        sqKilometer: value * 2.58998811,
        sqFeet: value * 27878400,
        sqInch: value * 4014489600,
        sqYard: value * 3097600,
        acre: value * 640,
        hectare: value * 258.998811,
        sqMile: value,
        are: value * 25899.8811,
        sqMicrometer: value * 2.58998811e18,
        barn: value * 2.58998811e34
      },

      are: {
        sqMillimeter: value * 1e8,
        sqCentimeter: value * 1e6,
        sqMeter: value * 100,
        donum: value / 10,
        sqKilometer: value / 10000,
        sqFeet: value * 1076.39104167,
        sqInch: value * 155000.31,
        sqYard: value * 119.59900463,
        acre: value / 40.46856422,
        hectare: value / 100,
        sqMile: value / 25899.8811,
        are: value,
        sqMicrometer: value * 1e14,
        barn: value * 1e30
      },

      sqMicrometer: {
        sqMillimeter: value / 1e6,
        sqCentimeter: value / 1e8,
        sqMeter: value / 1e12,
        donum: value / 1e15,
        sqKilometer: value / 1e18,
        sqFeet: value / 9.290304e10,
        sqInch: value / 645160000,
        sqYard: value / 8.3612736e11,
        acre: value / 4.046856422e15,
        hectare: value / 1e16,
        sqMile: value / 2.58998811e18,
        are: value / 1e14,
        sqMicrometer: value,
        barn: value * 1e8
      },

      barn: {
        sqMillimeter: value / 1e22,
        sqCentimeter: value / 1e24,
        sqMeter: value / 1e28,
        donum: value / 1e31,
        sqKilometer: value / 1e34,
        sqFeet: value / 9.290304e26,
        sqInch: value / 6.4516e24,
        sqYard: value / 8.3612736e27,
        acre: value / 4.046856422e31,
        hectare: value / 1e32,
        sqMile: value / 2.58998811e34,
        are: value / 1e30,
        sqMicrometer: value / 1e8,
        barn: value
      }
    };

    return conversions[name];
  }

  function formatNumber(value) {
    if (value === 0) {
      return "0";
    }

    const absValue = Math.abs(value);

    if (absValue < 1e-6 || absValue > 1e6) {
      return value.toExponential(5);
    }

    if (absValue < 1) {
      return String(parseFloat(value.toFixed(10)));
    }

    return String(parseFloat(value.toFixed(8)));
  }

  function handleChangeAreaUnits(event) {
    const currentInput = event.target;
    const name = currentInput.name;
    const value = currentInput.value;

    hideMessage();
    removeInputErrors();

    if (value === "") {
      clearOtherFields(currentInput);
      return;
    }

    const numberValue = Number(value);

    if (
      !Number.isFinite(numberValue) ||
      numberValue < 0 ||
      numberValue > 1000000000
    ) {
      currentInput.classList.add("input-error");

      showMessage(
        "0 ile 1.000.000.000 arasında geçerli bir değer girin."
      );

      return;
    }

    const newValues = convertValues(name, numberValue);

    if (!newValues) {
      return;
    }

    inputs.forEach((input) => {
      if (input === currentInput) {
        return;
      }

      const convertedValue = newValues[input.name];

      input.value =
        convertedValue !== undefined
          ? formatNumber(convertedValue)
          : "";
    });
  }

  function clearOtherFields(currentInput) {
    inputs.forEach((input) => {
      if (input !== currentInput) {
        input.value = "";
      }
    });
  }

  function clearFields() {
    inputs.forEach((input) => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();

    document.getElementById("sqMeter").focus();
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
    inputs.forEach((input) => {
      input.classList.remove("input-error");
    });
  }
});