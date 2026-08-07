document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  inputs.forEach((input) => {
    input.addEventListener("input", handleAngleInput);
  });

  clearBtn.addEventListener("click", clearAngleFields);

  function convertAngle(name, value) {
    const conversions = {
      degree: {
        degree: value,
        radian: value * (Math.PI / 180),
        gradian: value * (10 / 9),
        arcminute: value * 60,
        arcsecond: value * 3600,
        turn: value / 360
      },

      radian: {
        degree: value * (180 / Math.PI),
        radian: value,
        gradian: value * (200 / Math.PI),
        arcminute: value * (180 / Math.PI) * 60,
        arcsecond: value * (180 / Math.PI) * 3600,
        turn: value / (2 * Math.PI)
      },

      gradian: {
        degree: value * (9 / 10),
        radian: value * (Math.PI / 200),
        gradian: value,
        arcminute: value * (9 / 10) * 60,
        arcsecond: value * (9 / 10) * 3600,
        turn: value / 400
      },

      arcminute: {
        degree: value / 60,
        radian: value * (Math.PI / 10800),
        gradian: value * (3 / 200),
        arcminute: value,
        arcsecond: value * 60,
        turn: value / (60 * 360)
      },

      arcsecond: {
        degree: value / 3600,
        radian: value * (Math.PI / 648000),
        gradian: value * (1 / 2400),
        arcminute: value / 60,
        arcsecond: value,
        turn: value / (3600 * 360)
      },

      turn: {
        degree: value * 360,
        radian: value * (2 * Math.PI),
        gradian: value * 400,
        arcminute: value * 360 * 60,
        arcsecond: value * 360 * 3600,
        turn: value
      }
    };

    return conversions[name];
  }

  function formatNumber(value) {
    if (value === 0) {
      return "0";
    }

    const absoluteValue = Math.abs(value);

    if (absoluteValue < 1e-6 || absoluteValue > 1e6) {
      return value.toExponential(5);
    }

    if (absoluteValue < 1) {
      return String(parseFloat(value.toFixed(10)));
    }

    return String(parseFloat(value.toFixed(8)));
  }

  function handleAngleInput(event) {
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
      numberValue < -1000000000 ||
      numberValue > 1000000000
    ) {
      currentInput.classList.add("input-error");

      showMessage(
        "-1.000.000.000 ile 1.000.000.000 arasında geçerli bir değer girin."
      );

      return;
    }

    const results = convertAngle(name, numberValue);

    inputs.forEach((input) => {
      if (input === currentInput) {
        return;
      }

      input.value = formatNumber(results[input.name]);
    });
  }

  function clearOtherFields(currentInput) {
    inputs.forEach((input) => {
      if (input !== currentInput) {
        input.value = "";
      }
    });
  }

  function clearAngleFields() {
    inputs.forEach((input) => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("degree").focus();
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