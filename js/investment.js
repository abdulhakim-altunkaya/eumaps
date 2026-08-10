document.addEventListener("DOMContentLoaded", () => {
  const pageIdVisitorPage = "tools_investment";

  const investmentForm = document.getElementById("investmentForm");
  const amountInput = document.getElementById("invAmount");
  const durationInput = document.getElementById("invDuration");
  const percentageInput = document.getElementById("invPercentage");
  const clearButton = document.getElementById("clearButton");
  const printButton = document.getElementById("printButton");
  const formMessage = document.getElementById("formMessage");
  const resultsSection = document.getElementById("resultsSection");
  const resultTableBody = document.getElementById("resultTableBody");
  const initialAmountResult = document.getElementById("initialAmountResult");
  const totalProfitResult = document.getElementById("totalProfitResult");
  const finalAmountResult = document.getElementById("finalAmountResult");

  //logVisitor();

  investmentForm.addEventListener("submit", calculateInvestment);
  clearButton.addEventListener("click", clearInvestment);
  printButton.addEventListener("click", () => window.print());

  [amountInput, durationInput, percentageInput].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("input-error");
      hideMessage();
    });
  });

  function calculateInvestment(event) {
    event.preventDefault();

    hideMessage();
    removeInputErrors();

    const investmentAmount = Number(amountInput.value);
    const investmentDuration = Number(durationInput.value);
    const investmentPercentage = Number(percentageInput.value);

    if (!validateInteger(amountInput, investmentAmount, 1, 10000000000)) {
      showMessage("Başlangıç yatırım tutarı 1 ile 10 milyar arasında tam sayı olmalıdır.");
      return;
    }

    if (!validateInteger(durationInput, investmentDuration, 1, 100)) {
      showMessage("Yatırım süresi 1 ile 100 yıl arasında tam sayı olmalıdır.");
      return;
    }

    if (!validateInteger(percentageInput, investmentPercentage, 1, 10000)) {
      showMessage("Yıllık kazanç oranı 1 ile 10.000 arasında tam sayı olmalıdır.");
      return;
    }

    const yearlyResults = [];
    let balance = investmentAmount;

    for (let year = 1; year <= investmentDuration; year++) {
      const startingBalance = balance;
      const yearlyProfit = startingBalance * (investmentPercentage / 100);
      balance = startingBalance + yearlyProfit;

      yearlyResults.push({
        year,
        startingBalance,
        yearlyProfit,
        endingBalance: balance
      });
    }

    displayResults(investmentAmount, balance, yearlyResults);
  }

  function validateInteger(input, value, minimum, maximum) {
    const isValid =
      input.value.trim() !== "" &&
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= minimum &&
      value <= maximum;

    if (!isValid) {
      input.classList.add("input-error");
      input.focus();
    }

    return isValid;
  }

  function displayResults(initialAmount, finalAmount, yearlyResults) {
    const totalProfit = finalAmount - initialAmount;

    initialAmountResult.textContent = formatCurrency(initialAmount);
    totalProfitResult.textContent = formatCurrency(totalProfit);
    finalAmountResult.textContent = formatCurrency(finalAmount);

    resultTableBody.innerHTML = "";

    const tableFragment = document.createDocumentFragment();

    yearlyResults.forEach((result) => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${result.year}. yıl</td>
        <td>${formatCurrency(result.startingBalance)}</td>
        <td>${formatCurrency(result.yearlyProfit)}</td>
        <td>${formatCurrency(result.endingBalance)}</td>
      `;

      tableFragment.appendChild(row);
    });

    resultTableBody.appendChild(tableFragment);
    resultsSection.hidden = false;

    resultsSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function clearInvestment() {
    investmentForm.reset();
    resultTableBody.innerHTML = "";
    resultsSection.hidden = true;

    initialAmountResult.textContent = "0 ₺";
    totalProfitResult.textContent = "0 ₺";
    finalAmountResult.textContent = "0 ₺";

    removeInputErrors();
    hideMessage();
    amountInput.focus();
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value);
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
    amountInput.classList.remove("input-error");
    durationInput.classList.remove("input-error");
    percentageInput.classList.remove("input-error");
  }

/*  async function logVisitor() {
    try {
      const response = await fetch(
        `/serversavevisitor/${encodeURIComponent(pageIdVisitorPage)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({}),
          credentials: "same-origin"
        }
      );

      if (!response.ok) {
        console.error("Ziyaret kaydı gönderilemedi:", response.status);
      }
    } catch (error) {
      console.error("Ziyaret kaydı sırasında hata oluştu:", error.message);
    }
  } */

});