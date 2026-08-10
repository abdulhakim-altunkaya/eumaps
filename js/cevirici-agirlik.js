document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  // Her değerin kilogram karşılığı
  const units = {
    milligram: 1e-6,
    gram: 1e-3,
    kilogram: 1,
    ton: 1000,
    megaton: 1e9,
    gigaton: 1e12,
    uston: 907.18474,
    pound: 0.45359237,
    ounce: 0.028349523125,
    carat: 0.0002
  };

  inputs.forEach(input => {
    input.addEventListener("input", handleInput);
  });

  clearBtn.addEventListener("click", clearFields);

  function handleInput(event) {
    const currentInput = event.target;
    const value = currentInput.value;

    hideMessage();
    removeErrors();

    if (value === "") {
      inputs.forEach(input => {
        if (input !== currentInput) input.value = "";
      });
      return;
    }

    const numberValue = Number(value);

    if (
      !Number.isFinite(numberValue) ||
      numberValue < 0 ||
      numberValue > 1000000000
    ) {
      currentInput.classList.add("input-error");
      showMessage("0 ile 1.000.000.000 arasında geçerli bir değer giriniz.");
      return;
    }

    const kilograms = numberValue * units[currentInput.name];

    inputs.forEach(input => {
      if (input !== currentInput) {
        const result = kilograms / units[input.name];
        input.value = formatNumber(result);
      }
    });
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

  function clearFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("kilogram").focus();
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
    inputs.forEach(input => {
      input.classList.remove("input-error");
    });
  }
});