document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  inputs.forEach(input => {
    input.addEventListener("input", handleChangeTimeUnits);
  });

  clearBtn.addEventListener("click", clearFields);

  function convertValues(name, value) {
    const conversions = {
      nanosecond: {
        nanosecond: value,
        microsecond: value / 1e3,
        millisecond: value / 1e6,
        second: value / 1e9,
        minute: value / 6e10,
        hour: value / 3.6e12,
        day: value / 8.64e13,
        week: value / 6.048e14,
        month: value / 2.628e15,
        year: value / 3.154e16,
        decade: value / 3.154e17,
        century: value / 3.154e18,
        julianYear: value / 3.15576e16,
        siderealYear: value / 3.15581498e16,
        planckTime: value / 5.391e-44,
        fortnight: value / 1.2096e15
      },

      microsecond: {
        nanosecond: value * 1e3,
        microsecond: value,
        millisecond: value / 1e3,
        second: value / 1e6,
        minute: value / 6e7,
        hour: value / 3.6e9,
        day: value / 8.64e10,
        week: value / 6.048e11,
        month: value / 2.628e12,
        year: value / 3.154e13,
        decade: value / 3.154e14,
        century: value / 3.154e15,
        julianYear: value / 3.15576e13,
        siderealYear: value / 3.15581498e13,
        planckTime: value / 5.391e-41,
        fortnight: value / 1.2096e12
      },

      millisecond: {
        nanosecond: value * 1e6,
        microsecond: value * 1e3,
        millisecond: value,
        second: value / 1e3,
        minute: value / 6e4,
        hour: value / 3.6e6,
        day: value / 8.64e7,
        week: value / 6.048e8,
        month: value / 2.628e9,
        year: value / 3.154e10,
        decade: value / 3.154e11,
        century: value / 3.154e12,
        julianYear: value / 3.15576e10,
        siderealYear: value / 3.15581498e10,
        planckTime: value / 5.391e-38,
        fortnight: value / 1.2096e9
      },

      second: {
        nanosecond: value * 1e9,
        microsecond: value * 1e6,
        millisecond: value * 1e3,
        second: value,
        minute: value / 60,
        hour: value / 3600,
        day: value / 86400,
        week: value / 604800,
        month: value / 2.628e6,
        year: value / 3.154e7,
        decade: value / 3.154e8,
        century: value / 3.154e9,
        julianYear: value / 3.15576e7,
        siderealYear: value / 3.15581498e7,
        planckTime: value / 5.391e-35,
        fortnight: value / 1.2096e6
      },

      minute: {
        nanosecond: value * 6e10,
        microsecond: value * 6e7,
        millisecond: value * 6e4,
        second: value * 60,
        minute: value,
        hour: value / 60,
        day: value / 1440,
        week: value / 10080,
        month: value / 43800,
        year: value / 525600,
        decade: value / 5.256e6,
        century: value / 5.256e7,
        julianYear: value / 525960,
        siderealYear: value / 525964.663,
        planckTime: value / 3.2346e-33,
        fortnight: value / 20160
      },

      hour: {
        nanosecond: value * 3.6e12,
        microsecond: value * 3.6e9,
        millisecond: value * 3.6e6,
        second: value * 3600,
        minute: value * 60,
        hour: value,
        day: value / 24,
        week: value / 168,
        month: value / 730.001,
        year: value / 8760,
        decade: value / 87600,
        century: value / 876000,
        julianYear: value / 8766,
        siderealYear: value / 8766.077,
        planckTime: value / 1.94076e-31,
        fortnight: value / 336
      },

      day: {
        nanosecond: value * 8.64e13,
        microsecond: value * 8.64e10,
        millisecond: value * 8.64e7,
        second: value * 86400,
        minute: value * 1440,
        hour: value * 24,
        day: value,
        week: value / 7,
        month: value / 30.44,
        year: value / 365.25,
        decade: value / 3652.5,
        century: value / 36525,
        julianYear: value / 365.25,
        siderealYear: value / 365.256363,
        planckTime: value / 4.662e-30,
        fortnight: value / 14
      },

      week: {
        nanosecond: value * 6.048e14,
        microsecond: value * 6.048e11,
        millisecond: value * 6.048e8,
        second: value * 604800,
        minute: value * 10080,
        hour: value * 168,
        day: value * 7,
        week: value,
        month: value / 4.345,
        year: value / 52.1786,
        decade: value / 521.786,
        century: value / 5217.86,
        julianYear: value / 52.1786,
        siderealYear: value / 52.179,
        planckTime: value / 3.2637e-28,
        fortnight: value / 2
      },

      month: {
        nanosecond: value * 2.628e15,
        microsecond: value * 2.628e12,
        millisecond: value * 2.628e9,
        second: value * 2.628e6,
        minute: value * 43800,
        hour: value * 730.001,
        day: value * 30.44,
        week: value * 4.345,
        month: value,
        year: value / 12,
        decade: value / 120,
        century: value / 1200,
        julianYear: value / 12,
        siderealYear: value / 12.002,
        planckTime: value / 1.2285e-26,
        fortnight: value / 2.174
      },

      year: {
        nanosecond: value * 3.154e16,
        microsecond: value * 3.154e13,
        millisecond: value * 3.154e10,
        second: value * 3.154e7,
        minute: value * 525600,
        hour: value * 8760,
        day: value * 365.25,
        week: value * 52.1786,
        month: value * 12,
        year: value,
        decade: value / 10,
        century: value / 100,
        julianYear: value,
        siderealYear: value / 1.00002,
        planckTime: value / 3.8866e-25,
        fortnight: value * 26.089
      },

      decade: {
        nanosecond: value * 3.154e17,
        microsecond: value * 3.154e14,
        millisecond: value * 3.154e11,
        second: value * 3.154e8,
        minute: value * 5.256e6,
        hour: value * 87600,
        day: value * 3652.5,
        week: value * 521.786,
        month: value * 120,
        year: value * 10,
        decade: value,
        century: value / 10,
        julianYear: value * 10,
        siderealYear: value * 9.99979,
        planckTime: value / 3.8866e-24,
        fortnight: value * 260.89
      },

      century: {
        nanosecond: value * 3.154e18,
        microsecond: value * 3.154e15,
        millisecond: value * 3.154e12,
        second: value * 3.154e9,
        minute: value * 5.256e7,
        hour: value * 876000,
        day: value * 36525,
        week: value * 5217.86,
        month: value * 1200,
        year: value * 100,
        decade: value * 10,
        century: value,
        julianYear: value * 100,
        siderealYear: value * 99.9979,
        planckTime: value / 3.8866e-23,
        fortnight: value * 2608.9
      },

      julianYear: {
        nanosecond: value * 3.15576e16,
        microsecond: value * 3.15576e13,
        millisecond: value * 3.15576e10,
        second: value * 3.15576e7,
        minute: value * 5873,
        hour: value * 8766,
        day: value * 365.25,
        week: value * 52.1786,
        month: value * 12,
        year: value,
        decade: value / 10,
        century: value / 100,
        julianYear: value,
        siderealYear: value / 1.00002,
        planckTime: value / 3.8866e-25,
        fortnight: value * 26.089
      },

      siderealYear: {
        nanosecond: value * 3.15581498e16,
        microsecond: value * 3.15581498e13,
        millisecond: value * 3.15581498e10,
        second: value * 3.15581498e7,
        minute: value * 525964.663,
        hour: value * 8766.077,
        day: value * 365.256363,
        week: value * 52.179,
        month: value * 12.002,
        year: value * 1.00002,
        decade: value / 10,
        century: value / 100,
        julianYear: value * 1.00002,
        siderealYear: value,
        planckTime: value / 3.8869e-25,
        fortnight: value * 26.089
      },

      planckTime: {
        nanosecond: value * 5.391e-44,
        microsecond: value * 5.391e-41,
        millisecond: value * 5.391e-38,
        second: value * 5.391e-35,
        minute: value * 8.985e-34,
        hour: value * 1.4975e-32,
        day: value * 3.59399e-31,
        week: value * 2.51579e-30,
        month: value * 8.2283e-30,
        year: value * 1.7081e-29,
        decade: value * 1.7081e-28,
        century: value * 1.7081e-27,
        julianYear: value * 1.7081e-29,
        siderealYear: value * 1.7081e-29,
        planckTime: value,
        fortnight: value * 2.619e-29
      },

      fortnight: {
        nanosecond: value * 1.2096e15,
        microsecond: value * 1.2096e12,
        millisecond: value * 1.2096e9,
        second: value * 1.209e6,
        minute: value * 20160,
        hour: value * 336,
        day: value * 14,
        week: value * 2,
        month: value * 0.458333,
        year: value / 26.089,
        decade: value / 260.89,
        century: value / 2608.9,
        julianYear: value / 26.089,
        siderealYear: value / 26.089,
        planckTime: value / 3.815e28,
        fortnight: value
      }
    };

    return conversions[name];
  }

  function formatNumber(value) {
    if (value === 0) return "0";

    const absValue = Math.abs(value);

    if (absValue < 1e-6 || absValue > 1e9) {
      return value.toExponential(6);
    }

    if (absValue < 1) {
      return String(parseFloat(value.toFixed(10)));
    }

    return String(parseFloat(value.toFixed(8)));
  }

  function handleChangeTimeUnits(event) {
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

    if (
      !Number.isFinite(numberValue) ||
      numberValue < 0 ||
      numberValue > 1000000000
    ) {
      currentInput.classList.add("input-error");
      showMessage("0 ile 1.000.000.000 arasında geçerli bir değer giriniz.");
      return;
    }

    const newValues = convertValues(currentInput.name, numberValue);

    inputs.forEach(input => {
      if (input !== currentInput) {
        const result = newValues[input.name];
        input.value = result !== undefined ? formatNumber(result) : "";
      }
    });
  }

  function clearFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("second").focus();
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