document.addEventListener('DOMContentLoaded', () => {
  const svg = document.getElementById("svg-display");
  if (!svg) return;

  svg.addEventListener("load", () => {
    const svgDoc = svg.contentDocument;
    if (!svgDoc) {
      console.error("SVG content not loaded yet");
      return;
    }

    // Select paths inside loaded SVG (use data-name or id for provinces)
    const clickableEls = svgDoc.querySelectorAll("path[data-name]");
    if (clickableEls.length === 0) {
      console.warn('No SVG paths found');
      return;
    }
    
    clickableEls.forEach(el => {
      el.style.cursor = "pointer";
      el.style.transition = "fill 0.2s ease";
      
      // Hover effects
      el.addEventListener("mouseover", () => {
        el.style.fill = "#db3939ff";
      });
      el.addEventListener("mouseout", () => {
        el.style.fill = ""; // Reset to default
      });
      
      // Click to navigate
      el.addEventListener("click", () => {
        const provinceId = el.id; // e.g., "75"
        window.location.href = `https://kacmilyon.com/il-nufus.html?provinceId=${provinceId}`;
      });
    });

    console.log("✅ SVG provinces clickable");
  });
});