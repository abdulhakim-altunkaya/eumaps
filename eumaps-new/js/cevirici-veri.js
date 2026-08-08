document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  inputs.forEach(input => input.addEventListener("input", handleDataStorageInput));
  clearBtn.addEventListener("click", clearDataStorageFields);

  function convertDataStorage(name, value) {
    const conversions = {
      bit: {
        bit: value,
        byte: value / 8,
        kilobyte: value / 8000,
        megabyte: value / 8e6,
        gigabyte: value / 8e9,
        terabyte: value / 8e12,
        petabyte: value / 8e15,
        exabyte: value / 8e18,
        zettabyte: value / 8e21,
        yottabyte: value / 8e24
      },
      byte: {
        bit: value * 8,
        byte: value,
        kilobyte: value / 1e3,
        megabyte: value / 1e6,
        gigabyte: value / 1e9,
        terabyte: value / 1e12,
        petabyte: value / 1e15,
        exabyte: value / 1e18,
        zettabyte: value / 1e21,
        yottabyte: value / 1e24
      },
      kilobyte: {
        bit: value * 8000,
        byte: value * 1e3,
        kilobyte: value,
        megabyte: value / 1e3,
        gigabyte: value / 1e6,
        terabyte: value / 1e9,
        petabyte: value / 1e12,
        exabyte: value / 1e15,
        zettabyte: value / 1e18,
        yottabyte: value / 1e21
      },
      megabyte: {
        bit: value * 8e6,
        byte: value * 1e6,
        kilobyte: value * 1e3,
        megabyte: value,
        gigabyte: value / 1e3,
        terabyte: value / 1e6,
        petabyte: value / 1e9,
        exabyte: value / 1e12,
        zettabyte: value / 1e15,
        yottabyte: value / 1e18
      },
      gigabyte: {
        bit: value * 8e9,
        byte: value * 1e9,
        kilobyte: value * 1e6,
        megabyte: value * 1e3,
        gigabyte: value,
        terabyte: value / 1e3,
        petabyte: value / 1e6,
        exabyte: value / 1e9,
        zettabyte: value / 1e12,
        yottabyte: value / 1e15
      },
      terabyte: {
        bit: value * 8e12,
        byte: value * 1e12,
        kilobyte: value * 1e9,
        megabyte: value * 1e6,
        gigabyte: value * 1e3,
        terabyte: value,
        petabyte: value / 1e3,
        exabyte: value / 1e6,
        zettabyte: value / 1e9,
        yottabyte: value / 1e12
      },
      petabyte: {
        bit: value * 8e15,
        byte: value * 1e15,
        kilobyte: value * 1e12,
        megabyte: value * 1e9,
        gigabyte: value * 1e6,
        terabyte: value * 1e3,
        petabyte: value,
        exabyte: value / 1e3,
        zettabyte: value / 1e6,
        yottabyte: value / 1e9
      },
      exabyte: {
        bit: value * 8e18,
        byte: value * 1e18,
        kilobyte: value * 1e15,
        megabyte: value * 1e12,
        gigabyte: value * 1e9,
        terabyte: value * 1e6,
        petabyte: value * 1e3,
        exabyte: value,
        zettabyte: value / 1e3,
        yottabyte: value / 1e6
      },
      zettabyte: {
        bit: value * 8e21,
        byte: value * 1e21,
        kilobyte: value * 1e18,
        megabyte: value * 1e15,
        gigabyte: value * 1e12,
        terabyte: value * 1e9,
        petabyte: value * 1e6,
        exabyte: value * 1e3,
        zettabyte: value,
        yottabyte: value / 1e3
      },
      yottabyte: {
        bit: value * 8e24,
        byte: value * 1e24,
        kilobyte: value * 1e21,
        megabyte: value * 1e18,
        gigabyte: value * 1e15,
        terabyte: value * 1e12,
        petabyte: value * 1e9,
        exabyte: value * 1e6,
        zettabyte: value * 1e3,
        yottabyte: value
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

  function handleDataStorageInput(event) {
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

    const results = convertDataStorage(currentInput.name, numberValue);

    inputs.forEach(input => {
      if (input !== currentInput) {
        input.value = formatNumber(results[input.name]);
      }
    });
  }

  function clearDataStorageFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("gigabyte").focus();
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