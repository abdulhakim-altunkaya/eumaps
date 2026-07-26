document.addEventListener("DOMContentLoaded", () => {
  const cards = document.querySelectorAll(".card");

  // Keyboard accessibility and click handling
  cards.forEach((card, index) => {
    card.addEventListener("click", (e) => {
      const cardTitle = card.querySelector("h3")?.textContent || `Card ${index + 1}`;
      console.log(`Navigating to target page for: ${cardTitle}`);
    });
  });
});