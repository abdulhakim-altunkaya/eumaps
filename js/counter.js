document.addEventListener("DOMContentLoaded", () => {
  const pageIdVisitorPage = "tools_counter";
  const twitterCharacterLimit = 280;

  const textInput = document.getElementById("textInput");
  const countButton = document.getElementById("countButton");
  const clearButton = document.getElementById("clearButton");
  const copyButton = document.getElementById("copyButton");
  const actionMessage = document.getElementById("actionMessage");

  const wordCount = document.getElementById("wordCount");
  const characterCount = document.getElementById("characterCount");
  const characterWithoutSpacesCount = document.getElementById("characterWithoutSpacesCount");
  const letterCount = document.getElementById("letterCount");
  const numberCount = document.getElementById("numberCount");
  const sentenceCount = document.getElementById("sentenceCount");
  const paragraphCount = document.getElementById("paragraphCount");
  const lineCount = document.getElementById("lineCount");
  const readingTime = document.getElementById("readingTime");
  const speakingTime = document.getElementById("speakingTime");
  const liveCharacterCount = document.getElementById("liveCharacterCount");

  const twitterLimitBox = document.getElementById("twitterLimitBox");
  const twitterLimitValue = document.getElementById("twitterLimitValue");
  const twitterProgress = document.getElementById("twitterProgress");
  const twitterProgressBar = document.getElementById("twitterProgressBar");
  const twitterStatus = document.getElementById("twitterStatus");

  updateCounts();
  textInput.addEventListener("input", updateCounts);
  countButton.addEventListener("click", () => {
    updateCounts();
    showMessage("Metin bilgileri güncellendi.");
  });

  clearButton.addEventListener("click", clearCounter);
  copyButton.addEventListener("click", copyText);

  function updateCounts() {
    const text = textInput.value;
    const trimmedText = text.trim();

    const characters = text.length;
    const charactersWithoutSpaces = text.replace(/\s/g, "").length;
    const words = trimmedText === "" ? 0 : trimmedText.split(/\s+/).length;
    const letters = countLetters(text);
    const numbers = countNumbers(text);
    const sentences = countSentences(trimmedText);
    const paragraphs = countParagraphs(text);
    const lines = text === "" ? 0 : text.split(/\r\n|\r|\n/).length;

    wordCount.textContent = formatNumber(words);
    characterCount.textContent = formatNumber(characters);
    characterWithoutSpacesCount.textContent = formatNumber(charactersWithoutSpaces);
    letterCount.textContent = formatNumber(letters);
    numberCount.textContent = formatNumber(numbers);
    sentenceCount.textContent = formatNumber(sentences);
    paragraphCount.textContent = formatNumber(paragraphs);
    lineCount.textContent = formatNumber(lines);

    readingTime.textContent = formatDuration((words / 200) * 60);
    speakingTime.textContent = formatDuration((words / 130) * 60);
    liveCharacterCount.textContent = `${formatNumber(characters)} karakter`;

    updateTwitterLimit(characters);
  }

  function countLetters(text) {
    try {
      return (text.match(/\p{L}/gu) || []).length;
    } catch (error) {
      return (text.match(/[a-zA-ZçÇğĞıİöÖşŞüÜ]/g) || []).length;
    }
  }

  function countNumbers(text) {
    try {
      return (text.match(/\p{N}/gu) || []).length;
    } catch (error) {
      return (text.match(/[0-9]/g) || []).length;
    }
  }

  function countSentences(text) {
    if (text === "") {
      return 0;
    }

    const sentenceParts = text
      .split(/[.!?…]+(?=\s|$)/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    return sentenceParts.length || 1;
  }

  function countParagraphs(text) {
    if (text.trim() === "") {
      return 0;
    }

    return text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean).length;
  }

  function updateTwitterLimit(characters) {
    const percentage = Math.min(
      (characters / twitterCharacterLimit) * 100,
      100
    );

    twitterLimitValue.textContent =
      `${formatNumber(characters)} / ${twitterCharacterLimit}`;

    twitterProgress.setAttribute(
      "aria-valuenow",
      String(Math.min(characters, twitterCharacterLimit))
    );

    twitterProgressBar.style.width = `${percentage}%`;

    if (characters <= twitterCharacterLimit) {
      const remainingCharacters = twitterCharacterLimit - characters;

      twitterLimitBox.classList.remove("exceeded");
      twitterStatus.textContent =
        `Metin sınırın içinde. ${remainingCharacters} karakter hakkınız kaldı.`;
    } else {
      const exceededCharacters = characters - twitterCharacterLimit;

      twitterLimitBox.classList.add("exceeded");
      twitterStatus.textContent =
        `Metin sınırı ${exceededCharacters} karakter aşıyor.`;
    }
  }

  function formatDuration(totalSeconds) {
    if (totalSeconds <= 0) {
      return "0 saniye";
    }

    if (totalSeconds < 60) {
      return `${Math.max(1, Math.ceil(totalSeconds))} saniye`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.ceil(totalSeconds % 60);

    if (seconds === 0) {
      return `${minutes} dakika`;
    }

    return `${minutes} dakika ${seconds} saniye`;
  }

  function clearCounter() {
    textInput.value = "";
    actionMessage.textContent = "";
    updateCounts();
    textInput.focus();
  }

  async function copyText() {
    const text = textInput.value;

    if (text.trim() === "") {
      showMessage("Kopyalanacak bir metin bulunmuyor.");
      textInput.focus();
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showMessage("Metin panoya kopyalandı.");
    } catch (error) {
      textInput.select();

      const copied = document.execCommand("copy");

      if (copied) {
        showMessage("Metin panoya kopyalandı.");
      } else {
        showMessage("Metin kopyalanamadı.");
      }

      window.getSelection()?.removeAllRanges();
    }
  }

  function showMessage(message) {
    actionMessage.textContent = message;

    window.clearTimeout(showMessage.timeout);

    showMessage.timeout = window.setTimeout(() => {
      actionMessage.textContent = "";
    }, 2500);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("tr-TR").format(value);
  }


});