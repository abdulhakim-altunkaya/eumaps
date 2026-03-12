const { TransactionalEmailsApi, SendSmtpEmail } = require("@getbrevo/brevo");
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

  const emailApi = new TransactionalEmailsApi();
  emailApi.authentications.apiKey.apiKey = siteConfig.apiKey;

  const message = new SendSmtpEmail();
  message.sender = {
    email: siteConfig.fromEmail,
    name: siteConfig.fromName,
  };
  message.to = [{ email: to }];
  message.subject = subject;
  message.htmlContent = html;
  message.textContent = "Brevo test email";

  return emailApi.sendTransacEmail(message);
}

module.exports = sendEmailBrevo;