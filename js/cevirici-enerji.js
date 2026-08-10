document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  inputs.forEach(input => input.addEventListener("input", handleEnergyInput));
  clearBtn.addEventListener("click", clearEnergyFields);

  function convertEnergy(name, value) {
    const conversions = {
      joule: {
        joule: value,
        kilojoule: value / 1000,
        calorie: value * 0.2388459,
        kilocalorie: value * 0.0002388459,
        wattHour: value / 3600,
        kilowattHour: value / 3.6e6,
        electronvolt: value * 6.242e18
      },
      kilojoule: {
        joule: value * 1000,
        kilojoule: value,
        calorie: value * 238.8459,
        kilocalorie: value * 0.2388459,
        wattHour: value / 3.6,
        kilowattHour: value / 3600,
        electronvolt: value * 6.242e21
      },
      calorie: {
        joule: value * 4.184,
        kilojoule: value * 0.004184,
        calorie: value,
        kilocalorie: value / 1000,
        wattHour: value * 0.0011622222,
        kilowattHour: value * 1.1622222e-6,
        electronvolt: value * 2.611e19
      },
      kilocalorie: {
        joule: value * 4184,
        kilojoule: value * 4.184,
        calorie: value * 1000,
        kilocalorie: value,
        wattHour: value * 1.1622222,
        kilowattHour: value * 0.0011622222,
        electronvolt: value * 2.611e22
      },
      wattHour: {
        joule: value * 3600,
        kilojoule: value * 3.6,
        calorie: value * 860.42065,
        kilocalorie: value * 0.86042065,
        wattHour: value,
        kilowattHour: value / 1000,
        electronvolt: value * 2.247e22
      },
      kilowattHour: {
        joule: value * 3.6e6,
        kilojoule: value * 3600,
        calorie: value * 860420.65,
        kilocalorie: value * 860.42065,
        wattHour: value * 1000,
        kilowattHour: value,
        electronvolt: value * 2.247e25
      },
      electronvolt: {
        joule: value * 1.60217662e-19,
        kilojoule: value * 1.60217662e-22,
        calorie: value * 3.82929389e-20,
        kilocalorie: value * 3.82929389e-23,
        wattHour: value * 4.45049258e-23,
        kilowattHour: value * 4.45049258e-26,
        electronvolt: value
      }
    };

    return conversions[name];
  }

  function formatNumber(value) {
    if (value === 0) return "0";

    const absValue = Math.abs(value);

    if (absValue < 1e-6 || absValue > 1e6) return value.toExponential(5);
    if (absValue < 1) return String(parseFloat(value.toFixed(10)));

    return String(parseFloat(value.toFixed(8)));
  }

  function handleEnergyInput(event) {
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

    const results = convertEnergy(currentInput.name, numberValue);

    inputs.forEach(input => {
      if (input !== currentInput) {
        input.value = formatNumber(results[input.name]);
      }
    });
  }

  function clearEnergyFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("joule").focus();
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
    inputs.forEach(input => input.classList.remove("input-error"));
  }
});