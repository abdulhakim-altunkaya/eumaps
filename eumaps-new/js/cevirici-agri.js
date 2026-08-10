const conversionFactors = {
  spu: 1,

  // Opioids (kept close to previous values)
  hydromorphone: 1.25,
  fentanyl: 2,
  oxycodone: 3.3,
  morphine: 5,
  hydrocodone: 5,
  codeine: 33,
  tramadol: 50,

  // Non-opioids – ordered from stronger to weaker
  ibuprofen: 4,        // 1 × 400 mg tablet
  marijuana: 3.5,      // THC product
  sleep: 3,            // 60 minutes
  whiskey: 4,          // ≈40 ml
  wine: 5,             // 175 ml glass
  nicotine: 6,         // 1 cigarette
  coffee: 7,           // 1 cup
  coldshower: 10       // 3 minutes (weakest – mostly short distraction)
};

function convert(name, rawValue) {
  const clean = String(rawValue).replace(",", ".").trim();
  const value = parseFloat(clean);
  if (isNaN(value) || value < 0) return null;

  const spuValue = name === "spu" ? value : value / conversionFactors[name];
  const result = {};
  for (const key in conversionFactors) {
    result[key] = parseFloat((spuValue * conversionFactors[key]).toFixed(4));
  }
  return result;
}

function handleInput(e) {
  const { name, value } = e.target;
  if (value === "") return;

  const results = convert(name, value);
  if (!results) return;

  document.querySelectorAll(".inputFields").forEach(input => {
    input.value = results[input.name] ?? "";
  });
}

function clearFields() {
  document.querySelectorAll(".inputFields").forEach(input => {
    input.value = "";
  });
}

document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".inputFields").forEach(input => {
    input.addEventListener("input", handleInput);
  });

  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearFields);
  }
});