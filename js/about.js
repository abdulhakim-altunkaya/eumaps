document.addEventListener("DOMContentLoaded", () => {
  const contactForm = document.getElementById("contactForm");

  if (contactForm) {
    contactForm.addEventListener("submit", handleContact);
  }
});

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
    await axios.post(
      "https://www.eumaps.org/api/post/message",
      {
        name,
        email,
        subject,
        message,
        source: "eumaps-general"
      }
    );

    document.getElementById("contactForm").style.display = "none";

    const success = document.getElementById("contactSuccess");
    success.style.display = "flex";

  } catch (err) {
    showError(
      err.response?.data?.resMessage ||
      "Mesaj gönderilemedi. Lütfen tekrar deneyiniz."
    );

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