document.addEventListener("DOMContentLoaded", () => {
  if (typeof sectionIdVisitorPage === "undefined" || !sectionIdVisitorPage) {
    return;
  }

  const logVisitor = async () => {
    try {
      await axios.post(`https://www.eumaps.org/serversavevisitor/${encodeURIComponent(sectionIdVisitorPage)}`);
    } catch (error) {
      console.error("Visitor logging failed:", error.message);
    }
  };

  logVisitor();
});