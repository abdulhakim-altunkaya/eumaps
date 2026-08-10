document.addEventListener("DOMContentLoaded", () => {

  document.querySelectorAll(".tool-card").forEach(card => {

    card.addEventListener("click", () => {

      window.location.href = card.dataset.url;

    });

  });

});