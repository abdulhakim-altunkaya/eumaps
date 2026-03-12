const brevo = require("@getbrevo/brevo");

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

async function sendEmailBrevo({ site, to, subject, html }) {
  const siteConfig = MAIL_SITES[site];

  if (!siteConfig) {
    throw new Error(`Unknown mail site: ${site}`);
  }

  if (!siteConfig.apiKey) {
    throw new Error(`Missing Brevo API key for site: ${site}`);
  }

  const apiInstance = new brevo.TransactionalEmailsApi();

  apiInstance.setApiKey(
    brevo.TransactionalEmailsApiApiKeys.apiKey,
    siteConfig.apiKey
  );

  const email = new brevo.SendSmtpEmail();

  email.sender = {
    email: siteConfig.fromEmail,
    name: siteConfig.fromName,
  };

  email.to = [{ email: to }];
  email.subject = subject;
  email.htmlContent = html;

  return apiInstance.sendTransacEmail(email);
}

module.exports = sendEmailBrevo;