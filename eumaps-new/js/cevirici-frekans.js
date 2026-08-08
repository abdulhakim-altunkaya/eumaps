document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  inputs.forEach(input => input.addEventListener("input", handleFrequencyInput));
  clearBtn.addEventListener("click", clearFrequencyFields);

  function convertFrequency(name, value) {
    const conversions = {
      hertz: {
        hertz: value,
        kilohertz: value / 1e3,
        megahertz: value / 1e6,
        gigahertz: value / 1e9,
        rpm: value * 60,
        cyclesPerSecond: value
      },
      kilohertz: {
        hertz: value * 1e3,
        kilohertz: value,
        megahertz: value / 1e3,
        gigahertz: value / 1e6,
        rpm: value * 60000,
        cyclesPerSecond: value * 1e3
      },
      megahertz: {
        hertz: value * 1e6,
        kilohertz: value * 1e3,
        megahertz: value,
        gigahertz: value / 1e3,
        rpm: value * 6e7,
        cyclesPerSecond: value * 1e6
      },
      gigahertz: {
        hertz: value * 1e9,
        kilohertz: value * 1e6,
        megahertz: value * 1e3,
        gigahertz: value,
        rpm: value * 6e10,
        cyclesPerSecond: value * 1e9
      },
      rpm: {
        hertz: value / 60,
        kilohertz: value / 60000,
        megahertz: value / 6e7,
        gigahertz: value / 6e10,
        rpm: value,
        cyclesPerSecond: value / 60
      },
      cyclesPerSecond: {
        hertz: value,
        kilohertz: value / 1e3,
        megahertz: value / 1e6,
        gigahertz: value / 1e9,
        rpm: value * 60,
        cyclesPerSecond: value
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

  function handleFrequencyInput(event) {
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

    const results = convertFrequency(currentInput.name, numberValue);

    inputs.forEach(input => {
      if (input !== currentInput) {
        input.value = formatNumber(results[input.name]);
      }
    });
  }

  function clearFrequencyFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("hertz").focus();
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