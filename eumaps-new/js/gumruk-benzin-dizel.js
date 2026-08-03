document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("customsForm");
  const vehicleConditionInputs = document.querySelectorAll(
    'input[name="vehicleCondition"]'
  );
  const calculationFields = document.getElementById("calculationFields");
  const clearBtn = document.getElementById("clearBtn");
  const formMessage = document.getElementById("formMessage");
  const resultSection = document.getElementById("resultSection");
  const vehicleWarning = document.getElementById("vehicleWarning");

  const invoiceAmountInput = document.getElementById("invoiceAmount");
  const invoiceYearInput = document.getElementById("invoiceYear");
  const productionYearInput = document.getElementById("productionYear");
  const customsRegYearInput = document.getElementById("customsRegYear");
  const engineCapacityInput = document.getElementById("engineCapacity");

  const otvResult = document.getElementById("otvResult");
  const kdvResult = document.getElementById("kdvResult");
  const freightResult = document.getElementById("freightResult");
  const otherTaxesResult = document.getElementById("otherTaxesResult");
  const totalTaxResult = document.getElementById("totalTaxResult");
  const brokerResult = document.getElementById("brokerResult");
  const grandTotalResult = document.getElementById("grandTotalResult");

  const exchangeDollar = 46.72;
  const exchangeEuro = 53.42;
  const customsBrokerFee = 500;

  form.addEventListener("submit", calculateTax);

  vehicleConditionInputs.forEach((input) => {
    input.addEventListener("change", () => {
      calculationFields.hidden = false;
      hideMessage();
    });
  });

  clearBtn.addEventListener("click", clearForm);

  [
    invoiceAmountInput,
    invoiceYearInput,
    productionYearInput,
    customsRegYearInput,
    engineCapacityInput
  ].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("input-error");
      hideMessage();
    });
  });

  function calculateTax(event) {
    event.preventDefault();

    hideMessage();
    removeInputErrors();
    vehicleWarning.hidden = true;
    vehicleWarning.textContent = "";

    const selectedCondition = form.querySelector(
      'input[name="vehicleCondition"]:checked'
    );

    const selectedCurrency = form.querySelector(
      'input[name="currency"]:checked'
    );

    if (!selectedCondition) {
      showMessage("Aracın yeni veya ikinci el olduğunu seçin.");
      return;
    }

    if (!selectedCurrency) {
      showMessage("Para birimini Dolar veya Euro olarak seçin.");
      return;
    }

    const invoiceAmount = Number(invoiceAmountInput.value);
    const invoiceYear = Number(invoiceYearInput.value);
    const productionYear = Number(productionYearInput.value);
    const customsRegYear = Number(customsRegYearInput.value);
    const engineCapacity = Number(engineCapacityInput.value);

    if (
      invoiceAmountInput.value.trim() === "" ||
      !Number.isFinite(invoiceAmount) ||
      invoiceAmount < 100 ||
      invoiceAmount > 10000000
    ) {
      setInputError(
        invoiceAmountInput,
        "Geçerli bir KDV hariç fatura bedeli girin."
      );
      return;
    }

    if (
      invoiceYearInput.value.trim() === "" ||
      !Number.isInteger(invoiceYear) ||
      invoiceYear < 2000 ||
      invoiceYear > 2050
    ) {
      setInputError(
        invoiceYearInput,
        "Fatura yılını dört rakam olarak girin."
      );
      return;
    }

    if (
      productionYearInput.value.trim() === "" ||
      !Number.isInteger(productionYear) ||
      productionYear < 2000 ||
      productionYear > 2050
    ) {
      setInputError(
        productionYearInput,
        "Aracın üretim yılını dört rakam olarak girin."
      );
      return;
    }

    if (
      customsRegYearInput.value.trim() === "" ||
      !Number.isInteger(customsRegYear) ||
      customsRegYear < 2000 ||
      customsRegYear > 2050
    ) {
      setInputError(
        customsRegYearInput,
        "Türkiye'ye kayıt yılını dört rakam olarak girin."
      );
      return;
    }

    if (
      engineCapacityInput.value.trim() === "" ||
      !Number.isFinite(engineCapacity) ||
      engineCapacity < 100 ||
      engineCapacity > 10000
    ) {
      setInputError(
        engineCapacityInput,
        "Motor hacmini 100 ile 10.000 cc arasında girin."
      );
      return;
    }

    if (invoiceYear - productionYear > 3) {
      showMessage(
        "Araç satın alındığı tarihte üç yaşından büyük olmamalıdır. Bu araç ithal edilemez."
      );
      return;
    }

    let yearDifference = customsRegYear - invoiceYear;

    if (yearDifference < 0) {
      showMessage(
        "Türkiye'ye kayıt yılı, fatura yılından önce olamaz."
      );
      return;
    }

    if (yearDifference === 0) {
      showMessage(
        "Fatura yılı ile kayıt yılı aynı olduğu için amortisman indirimi uygulanamaz."
      );
      return;
    }

    if (yearDifference > 8) {
      yearDifference = 8;
    }

    let firstYear = 0;

    if (selectedCondition.value === "new") {
      if (invoiceYear - productionYear >= 1) {
        vehicleWarning.hidden = false;
        vehicleWarning.textContent =
          "Üretim yılı ile fatura yılı farklı olduğu için araç ikinci el olarak değerlendirildi.";

        firstYear = 0;
      } else if (yearDifference < 8) {
        firstYear = 1;
      }
    }

    const depreciationPercentage =
      10 * (yearDifference + firstYear);

    const depreciationDiscount =
      (depreciationPercentage * invoiceAmount) / 100;

    const basePrice =
      invoiceAmount - depreciationDiscount;

    const currencyRate =
      selectedCurrency.value === "euro"
        ? exchangeEuro
        : exchangeDollar;

    const currencyName =
      selectedCurrency.value === "euro"
        ? "Euro"
        : "Dolar";

    const basePriceLira =
      basePrice * currencyRate;

    const taxPercentage = getTaxPercentage(
      engineCapacity,
      basePriceLira
    );

    if (taxPercentage === null) {
      showMessage("Girilen değerler için ÖTV oranı belirlenemedi.");
      return;
    }

    const freightAmount =
      Math.round(basePrice * 0.02);

    const domesticExpense = 200;
    const stampTax = 28;
    const banderol = 15;

    const otherTaxes =
      domesticExpense + stampTax + banderol;

    const finalBasePrice =
      basePrice + freightAmount + otherTaxes;

    const otvAmount =
      Math.round(finalBasePrice * taxPercentage);

    const kdvAmount =
      Math.round((otvAmount + finalBasePrice) * 0.2);

    const totalTax =
      kdvAmount +
      otvAmount +
      freightAmount +
      otherTaxes;

    const grandTotal =
      totalTax + customsBrokerFee;

    showResults({
      depreciationPercentage,
      basePrice,
      otvAmount,
      kdvAmount,
      freightAmount,
      otherTaxes,
      totalTax,
      grandTotal,
      currencyName
    });
  }

  function getTaxPercentage(engineCapacity, basePriceLira) {
    if (engineCapacity < 1401 && basePriceLira < 650001) {
      return 0.7;
    }

    if (engineCapacity < 1401 && basePriceLira < 900001) {
      return 0.75;
    }

    if (engineCapacity < 1401 && basePriceLira < 1100001) {
      return 0.8;
    }

    if (engineCapacity < 1401) {
      return 0.9;
    }

    if (engineCapacity < 1601 && basePriceLira < 850001) {
      return 0.75;
    }

    if (engineCapacity < 1601 && basePriceLira < 1100001) {
      return 0.8;
    }

    if (engineCapacity < 1601 && basePriceLira < 1650001) {
      return 0.9;
    }

    if (engineCapacity < 1601) {
      return 1;
    }

    if (engineCapacity < 2001 && basePriceLira < 1650001) {
      return 1.5;
    }

    if (engineCapacity < 2001) {
      return 1.7;
    }

    if (engineCapacity > 2000) {
      return 2.2;
    }

    return null;
  }

  function showResults(result) {
    otvResult.textContent =
      formatCurrency(result.otvAmount, result.currencyName);

    kdvResult.textContent =
      formatCurrency(result.kdvAmount, result.currencyName);

    freightResult.textContent =
      formatCurrency(result.freightAmount, result.currencyName);

    otherTaxesResult.textContent =
      formatCurrency(result.otherTaxes, result.currencyName);

    totalTaxResult.textContent =
      formatCurrency(result.totalTax, result.currencyName);

    brokerResult.textContent =
      formatCurrency(customsBrokerFee, result.currencyName);

    grandTotalResult.textContent =
      formatCurrency(result.grandTotal, result.currencyName);

    resultSection.hidden = false;

    resultSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function clearForm() {
    form.reset();
    calculationFields.hidden = true;
    resultSection.hidden = true;
    vehicleWarning.hidden = true;
    vehicleWarning.textContent = "";
    otvResult.textContent = "0";
    kdvResult.textContent = "0";
    freightResult.textContent = "0";
    otherTaxesResult.textContent = "0";
    totalTaxResult.textContent = "0";
    brokerResult.textContent = "500";
    grandTotalResult.textContent = "0";

    removeInputErrors();
    hideMessage();
  }

  function formatCurrency(value, currencyName) {
    return `${new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value)} ${currencyName}`;
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
    [
      invoiceAmountInput,
      invoiceYearInput,
      productionYearInput,
      customsRegYearInput,
      engineCapacityInput
    ].forEach((input) => {
      input.classList.remove("input-error");
    });
  }
});