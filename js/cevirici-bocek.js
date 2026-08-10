document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll(".inputFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

const ratings = {
  sweatBee: 1.5,          // Mild, short-lived
  fireAnt: 2.0,          // Slightly stronger + burning sensation
  europeanHornet: 3.5,    // Sharp, hot pain
  paperWasp: 5.0,         // Classic "very painful" wasp sting
  harvesterAnt: 5.5,     // Deep, throbbing, longer lasting
  tarantulaHawk: 7.5,     // Extremely intense but relatively short
  bulletAnt: 9.0,        // Peak of the insect scale (Schmidt 4.0+)
  executionerWasp: 9.5,   // Often described as worse than bullet ant
  scorpionSting: 7.0,     // Highly variable, but typically less than top wasps
  electricShock: 8.5,     // Intense but instantaneous
  bulletWound: 10         // Clearly the highest on this list
};

  inputs.forEach(input => {
    input.addEventListener("input", handleSchmidtInput);
  });

  clearBtn.addEventListener("click", clearSchmidtFields);

  function convertSchmidt(name, value) {
    let painValue;

    if (name === "schmidt") {
      painValue = value;
    } else {
      painValue = value * ratings[name];
    }

    return {
      schmidt: painValue,
      sweatBee: painValue / ratings.sweatBee,
      fireAnt: painValue / ratings.fireAnt,
      europeanHornet: painValue / ratings.europeanHornet,
      paperWasp: painValue / ratings.paperWasp,
      harvesterAnt: painValue / ratings.harvesterAnt,
      tarantulaHawk: painValue / ratings.tarantulaHawk,
      bulletAnt: painValue / ratings.bulletAnt,
      executionerWasp: painValue / ratings.executionerWasp,
      scorpionSting: painValue / ratings.scorpionSting,
      electricShock: painValue / ratings.electricShock,
      bulletWound: painValue / ratings.bulletWound
    };
  }

  function formatNumber(value) {
    if (value === 0) return "0";

    if (Math.abs(value) >= 1000) {
      return parseFloat(value.toFixed(1));
    }

    if (Math.abs(value) >= 10) {
      return parseFloat(value.toFixed(2));
    }

    return parseFloat(value.toFixed(3));
  }

  function handleSchmidtInput(event) {
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
    const maximum = currentInput.name === "schmidt" ? 10 : 1000;

    if (
      !Number.isFinite(numberValue) ||
      numberValue < 0 ||
      numberValue > maximum
    ) {
      currentInput.classList.add("input-error");

      if (currentInput.name === "schmidt") {
        showMessage("Ağrı değeri 0 ile 10 arasında olmalıdır.");
      } else {
        showMessage("0 ile 1000 arasında geçerli bir değer giriniz.");
      }

      return;
    }

    const results = convertSchmidt(
      currentInput.name,
      numberValue
    );

    inputs.forEach(input => {
      if (input !== currentInput) {
        const result = results[input.name];

        input.value =
          result !== undefined
            ? formatNumber(result)
            : "";
      }
    });
  }

  function clearSchmidtFields() {
    inputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    hideMessage();
    document.getElementById("schmidt").focus();
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