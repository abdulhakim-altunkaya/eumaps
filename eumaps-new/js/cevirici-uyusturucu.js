const conversionFactors = {
  morphine: 5,
  oxycodone: 3.3,
  hydrocodone: 5,
  tramadol: 50,
  codeine: 33.33,
  hydromorphone: 1.25,
  fentanyl: 2
};

function convertOpioids(name, rawValue) {
  const clean = String(rawValue).replace(",", ".").trim();
  const value = parseFloat(clean);
  if (isNaN(value) || value < 0) return null;

  const spuValue = value / conversionFactors[name];
  const result = {};
  for (const key in conversionFactors) {
    result[key] = parseFloat((spuValue * conversionFactors[key]).toFixed(4));
  }
  return result;
}

function handleOpioidInput(e) {
  const { name, value } = e.target;
  if (value === "") {
    // Optional: clear all when the active field is emptied
    // document.querySelectorAll(".inputFields").forEach(input => input.value = "");
    return;
  }
  const results = convertOpioids(name, value);
  if (!results) return;

  document.querySelectorAll(".inputFields").forEach(input => {
    input.value = results[input.name] ?? "";
  });
}

function clearOpioidFields() {
  document.querySelectorAll(".inputFields").forEach(input => {
    input.value = "";
  });
}

document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".inputFields").forEach(input => {
    input.addEventListener("input", handleOpioidInput);
  });

  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearOpioidFields);
  }
});