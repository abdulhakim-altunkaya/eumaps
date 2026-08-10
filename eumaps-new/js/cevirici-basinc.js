document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  inputs.forEach(input => input.addEventListener("input", handlePressureInput));
  clearBtn.addEventListener("click", clearPressureFields);

  function convertPressure(name, value) {
    const conversions = {
      pascal: {
        pascal: value,
        kilopascal: value / 1000,
        bar: value / 100000,
        atmosphere: value / 101325,
        millibar: value / 100,
        psi: value / 6894.75729,
        torr: value / 133.322368,
        inchMercury: value / 3386.38864
      },

      kilopascal: {
        pascal: value * 1000,
        kilopascal: value,
        bar: value / 100,
        atmosphere: value / 101.325,
        millibar: value * 10,
        psi: value / 6.89475729,
        torr: value * 7.50061683,
        inchMercury: value / 3.38638864
      },

      bar: {
        pascal: value * 100000,
        kilopascal: value * 100,
        bar: value,
        atmosphere: value / 1.01325,
        millibar: value * 1000,
        psi: value * 14.5037738,
        torr: value * 750.061683,
        inchMercury: value * 29.5299831
      },

      atmosphere: {
        pascal: value * 101325,
        kilopascal: value * 101.325,
        bar: value * 1.01325,
        atmosphere: value,
        millibar: value * 1013.25,
        psi: value * 14.6959488,
        torr: value * 760,
        inchMercury: value * 29.9212598
      },

      millibar: {
        pascal: value * 100,
        kilopascal: value / 10,
        bar: value / 1000,
        atmosphere: value / 1013.25,
        millibar: value,
        psi: value / 68.9475729,
        torr: value * 0.750061683,
        inchMercury: value / 33.8638864
      },

      psi: {
        pascal: value * 6894.75729,
        kilopascal: value * 6.89475729,
        bar: value / 14.5037738,
        atmosphere: value / 14.6959488,
        millibar: value * 68.9475729,
        psi: value,
        torr: value * 51.7149326,
        inchMercury: value * 2.03602102
      },

      torr: {
        pascal: value * 133.322368,
        kilopascal: value * 0.133322368,
        bar: value / 750.061683,
        atmosphere: value / 760,
        millibar: value * 1.33322368,
        psi: value / 51.7149326,
        torr: value,
        inchMercury: value / 25.4000665
      },

      inchMercury: {
        pascal: value * 3386.38864,
        kilopascal: value * 3.38638864,
        bar: value / 29.5299831,
        atmosphere: value / 29.9212598,
        millibar: value * 33.8638864,
        psi: value / 2.03602102,
        torr: value * 25.4000665,
        inchMercury: value
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

  function handlePressureInput(event) {
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

    const results = convertPressure(currentInput.name, numberValue);

    inputs.forEach(input => {
      if (input !== currentInput) {
        const result = results[input.name];
        input.value = result !== undefined ? formatNumber(result) : "";
      }
    });
  }

  function clearPressureFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("pascal").focus();
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