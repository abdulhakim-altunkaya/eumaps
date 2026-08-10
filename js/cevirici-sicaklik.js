document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  inputs.forEach(input => input.addEventListener("input", handleTemperatureInput));
  clearBtn.addEventListener("click", clearTemperatureFields);

  function convertTemperature(name, value) {
    const conversions = {
      celsius: {
        celsius: value,
        fahrenheit: value * 9 / 5 + 32,
        kelvin: value + 273.15,
        rankine: (value + 273.15) * 9 / 5,
        reaumur: value * 4 / 5
      },

      fahrenheit: {
        celsius: (value - 32) * 5 / 9,
        fahrenheit: value,
        kelvin: (value - 32) * 5 / 9 + 273.15,
        rankine: value + 459.67,
        reaumur: (value - 32) * 4 / 9
      },

      kelvin: {
        celsius: value - 273.15,
        fahrenheit: (value - 273.15) * 9 / 5 + 32,
        kelvin: value,
        rankine: value * 9 / 5,
        reaumur: (value - 273.15) * 4 / 5
      },

      rankine: {
        celsius: (value - 491.67) * 5 / 9,
        fahrenheit: value - 459.67,
        kelvin: value * 5 / 9,
        rankine: value,
        reaumur: (value - 491.67) * 4 / 9
      },

      reaumur: {
        celsius: value * 5 / 4,
        fahrenheit: value * 9 / 4 + 32,
        kelvin: value * 5 / 4 + 273.15,
        rankine: value * 9 / 4 + 491.67,
        reaumur: value
      }
    };

    return conversions[name];
  }

  function formatNumber(value) {
    if (value === 0) return "0";

    const absValue = Math.abs(value);

    if (absValue > 1000000 || (absValue > 0 && absValue < 0.000001)) {
      return value.toExponential(5);
    }

    return String(parseFloat(value.toFixed(5)));
  }

  function handleTemperatureInput(event) {
    const currentInput = event.target;
    const value = currentInput.value;

    hideMessage();
    removeInputErrors();

    if (value === "" || value === "-" || value === "-.") {
      return;
    }

    const numberValue = Number(value);

    if (!Number.isFinite(numberValue) || numberValue < -1000000 || numberValue > 1000000) {
      currentInput.classList.add("input-error");
      showMessage("-1.000.000 ile 1.000.000 arasında geçerli bir değer giriniz.");
      return;
    }

    if (currentInput.name === "kelvin" && numberValue < 0) {
      currentInput.classList.add("input-error");
      showMessage("Kelvin değeri 0'dan küçük olamaz.");
      return;
    }

    if (currentInput.name === "rankine" && numberValue < 0) {
      currentInput.classList.add("input-error");
      showMessage("Rankine değeri 0'dan küçük olamaz.");
      return;
    }

    const results = convertTemperature(currentInput.name, numberValue);

    if (results.kelvin < 0 || results.rankine < 0) {
      currentInput.classList.add("input-error");
      showMessage("Bu sıcaklık mutlak sıfırın altında olamaz.");
      return;
    }

    inputs.forEach(input => {
      if (input !== currentInput) {
        input.value = formatNumber(results[input.name]);
      }
    });
  }

  function clearTemperatureFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("celsius").focus();
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