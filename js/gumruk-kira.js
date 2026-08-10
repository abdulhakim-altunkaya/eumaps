document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("rentForm");
  const salaryInput = document.getElementById("amountSalary");
  const rentInput = document.getElementById("amountRent");
  const currencyInput = document.getElementById("typeCurrency");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");
  const resultSection = document.getElementById("resultSection");
  const resultArea = document.getElementById("resultArea");

  form.addEventListener("submit", calculateRentSupport);
  clearBtn.addEventListener("click", clearForm);

  [salaryInput, rentInput, currencyInput].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("input-error");
      hideMessage();
    });
  });

  function calculateRentSupport(event) {
    event.preventDefault();

    hideMessage();
    removeInputErrors();

    const salary = Number(salaryInput.value);
    const rent = Number(rentInput.value);
    const currency = currencyInput.value;

    if (
      salaryInput.value.trim() === "" ||
      !Number.isInteger(salary) ||
      salary < 1 ||
      salary > 10000000000
    ) {
      setInputError(
        salaryInput,
        "Geçerli bir aylık maaş tutarı girin. Ondalık işareti kullanmayın."
      );
      return;
    }

    if (
      rentInput.value.trim() === "" ||
      !Number.isInteger(rent) ||
      rent < 1 ||
      rent > 10000000000000
    ) {
      setInputError(
        rentInput,
        "Geçerli bir aylık kira tutarı girin. Ondalık işareti kullanmayın."
      );
      return;
    }

    if (!currency) {
      setInputError(
        currencyInput,
        "Para birimini seçin."
      );
      return;
    }

    const salaryQuarter = salary / 4;

    if (rent <= salaryQuarter) {
      resultArea.innerHTML = `
        <div class="no-support-result">
          Ödediğiniz kira maaşınızın %25'inden çok olmadığı için kira yardımı alamazsınız.
        </div>
      `;

      resultSection.hidden = false;
      scrollToResult();
      return;
    }

    const supportAmount =
      Math.round((rent - salaryQuarter) * 0.8);

    resultArea.innerHTML = `
      <div class="support-result">
        <span>Alacağınız tahmini kira yardımı</span>
        <strong>${formatNumber(supportAmount)} ${currency}</strong>
      </div>
    `;

    resultSection.hidden = false;
    scrollToResult();
  }

  function clearForm() {
    form.reset();
    resultSection.hidden = true;
    resultArea.innerHTML = "";

    removeInputErrors();
    hideMessage();
    salaryInput.focus();
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  function scrollToResult() {
    resultSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function setInputError(input, message) {
    input.classList.add("input-error");
    input.focus();
    showMessage(message);
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
    [salaryInput, rentInput, currencyInput].forEach((input) => {
      input.classList.remove("input-error");
    });
  }
});