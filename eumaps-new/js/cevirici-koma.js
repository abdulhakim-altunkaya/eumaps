document.addEventListener("DOMContentLoaded", () => {
  const eyeInput = document.getElementById("eye");
  const verbalInput = document.getElementById("verbal");
  const motorInput = document.getElementById("motor");
  const gcsInput = document.getElementById("gcs");
  const gcsCategory = document.getElementById("gcsCategory");
  const mrs = document.getElementById("mrs");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");

  const editableInputs = [eyeInput, verbalInput, motorInput];

  editableInputs.forEach(input => input.addEventListener("input", calculate));
  clearBtn.addEventListener("click", clearFields);

  function calculate() {
    hideMessage();
    removeErrors();

    const eye = Number(eyeInput.value);
    const verbal = Number(verbalInput.value);
    const motor = Number(motorInput.value);

    if (!eyeInput.value || !verbalInput.value || !motorInput.value) {
      clearResults();
      return;
    }

    if (!Number.isInteger(eye) || eye < 1 || eye > 4) {
      setError(eyeInput, "Göz yanıtı 1 ile 4 arasında tam sayı olmalıdır.");
      return;
    }

    if (!Number.isInteger(verbal) || verbal < 1 || verbal > 5) {
      setError(verbalInput, "Sözel yanıt 1 ile 5 arasında tam sayı olmalıdır.");
      return;
    }

    if (!Number.isInteger(motor) || motor < 1 || motor > 6) {
      setError(motorInput, "Motor yanıt 1 ile 6 arasında tam sayı olmalıdır.");
      return;
    }

    const totalGcs = eye + verbal + motor;

    gcsInput.value = totalGcs;
    gcsCategory.textContent = getGcsCategory(totalGcs);
    mrs.textContent = getMrs(totalGcs);
  }

  function getGcsCategory(gcs) {
    if (gcs <= 8) return "Ağır";
    if (gcs <= 12) return "Orta";
    return "Hafif";
  }

  function getMrs(gcs) {
    if (gcs === 15) return "0–1";
    if (gcs >= 13) return "1–2";
    if (gcs >= 9) return "3–4";
    if (gcs >= 6) return "4–5";
    return "5–6";
  }

  function clearFields() {
    editableInputs.forEach(input => {
      input.value = "";
      input.classList.remove("input-error");
    });

    clearResults();
    hideMessage();
    eyeInput.focus();
  }

  function clearResults() {
    gcsInput.value = "";
    gcsCategory.textContent = "-";
    mrs.textContent = "-";
  }

  function setError(input, message) {
    input.classList.add("input-error");
    showMessage(message);
    clearResults();
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
    editableInputs.forEach(input => input.classList.remove("input-error"));
  }
});