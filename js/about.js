document.addEventListener("DOMContentLoaded", () => {
  const contactForm = document.getElementById("contactForm");

  if (contactForm) {
    contactForm.addEventListener("submit", handleContact);
  }
});

function getErrorMessage(code) {
  switch (code) {
    case 1:
      return "Bu bağlantı üzerinden mesaj gönderilemiyor.";
    case 2:
      return "Çok fazla mesaj gönderdiniz. Lütfen daha sonra tekrar deneyiniz.";
    case 3:
    case 4:
      return "Lütfen tüm alanları eksiksiz doldurunuz.";
    case 5:
      return "İsim çok uzun.";
    case 6:
      return "E-posta adresi çok uzun.";
    case 7:
      return "Konu çok uzun.";
    case 8:
      return "Mesaj çok uzun.";
    case 9:
      return "Mesaj gönderilemedi. Lütfen tekrar deneyiniz.";
    case 10:
      return "Lütfen geçerli bir e-posta adresi giriniz.";
    case 11:
      return "Sunucu hatası oluştu. Lütfen daha sonra tekrar deneyiniz.";
    default:
      return "Mesaj gönderilemedi. Lütfen tekrar deneyiniz.";
  }
}

async function handleContact(event) {
  event.preventDefault();

  clearError();

  const name = document.getElementById("contactName").value.trim();
  const email = document.getElementById("contactEmail").value.trim();
  const subject = document.getElementById("contactSubject").value.trim();
  const message = document.getElementById("contactMessage").value.trim();
  const btn = document.getElementById("contactBtn");

  if (!name || !email || !subject || !message) {
    showError("Lütfen tüm alanları doldurunuz.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Gönderiliyor...";

  try {
    const response = await axios.post(
      "https://www.eumaps.org/api/post/message",
      {
        name,
        email,
        subject,
        message,
        source: "eumaps-general"
      }
    );

    if (!response.data?.resStatus) {
      showError(getErrorMessage(response.data?.resErrorCode));
      btn.disabled = false;
      btn.textContent = "Mesaj Gönder";
      return;
    }

    document.getElementById("contactForm").style.display = "none";

    const success = document.getElementById("contactSuccess");
    success.style.display = "flex";

  } catch (err) {
    const errorCode = err.response?.data?.resErrorCode;

    showError(getErrorMessage(errorCode));

    btn.disabled = false;
    btn.textContent = "Mesaj Gönder";
  }
}

function showError(message) {
  const errorArea = document.getElementById("contactError");

  if (!errorArea) return;

  errorArea.textContent = message;
  errorArea.classList.add("show");
}

function clearError() {
  const errorArea = document.getElementById("contactError");

  if (!errorArea) return;

  errorArea.textContent = "";
  errorArea.classList.remove("show");
}