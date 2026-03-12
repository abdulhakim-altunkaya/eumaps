const axios = require("axios");

const MAIL_SITES = {
  pagalbapro: {
    apiKey: process.env.BREVO_API_KEY_PAGALBAPRO,
    fromEmail: "info@pagalbapro.lt",
    fromName: "PagalbaPro.lt",
  },
  latvijasmeistari: {
    apiKey: process.env.BREVO_API_KEY_LATVIJASMEISTARI,
    fromEmail: "info@meistarilatvija.lv",
    fromName: "Latvijas Meistari",
  },
};

async function sendEmailBrevo({ site, to, subject, html, text }) {
  const siteConfig = MAIL_SITES[site];

  if (!siteConfig) {
    throw new Error(`Unknown mail site: ${site}`);
  }

  if (!siteConfig.apiKey) {
    throw new Error(`Missing Brevo API key for site: ${site}`);
  }

  const payload = {
    sender: {
      email: siteConfig.fromEmail,
      name: siteConfig.fromName,
    },
    to: [{ email: to }],
    subject,
  };

  if (html) payload.htmlContent = html;
  if (text) payload.textContent = text;

  const response = await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    payload,
    {
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": siteConfig.apiKey,
      },
    }
  );

  return response.data;
}

module.exports = sendEmailBrevo;