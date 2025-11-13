// export const env = {
// 	useMock: process.env.REACT_APP_USE_MOCK_DATA === 'true',
// 	companyId: process.env.REACT_APP_COMPANY_ID,
// 	companyName: process.env.REACT_APP_COMPANY_NAME,
// 	adminUser: process.env.REACT_APP_ADMIN_USERNAME,
// 	adminHash: process.env.REACT_APP_ADMIN_PASSWORD_HASH,
// 	crmUrl: process.env.REACT_APP_CRM_BASE_URL,
// 	backendUrl: process.env.REACT_APP_BACKEND_URL,
// 	blueiotHost: process.env.REACT_APP_BLUEIOT_HOST,
// 	blueiotUsername: process.env.REACT_APP_BLUEIOT_USERNAME,
// 	blueiotPassword: process.env.REACT_APP_BLUEIOT_PASSWORD,
// };

// console.log('[ENV]', {
// 	adminUser: process.env.REACT_APP_ADMIN_USERNAME,
// 	adminHash: process.env.REACT_APP_ADMIN_PASSWORD_HASH,
// });

export const env = {
  // true solo se REACT_APP_USE_MOCK_DATA === 'true'
  useMock: String(process.env.REACT_APP_USE_MOCK_DATA || 'false').toLowerCase() === 'true',
  companyId: process.env.REACT_APP_COMPANY_ID || "1",
  companyName: process.env.REACT_APP_COMPANY_NAME || "Impresa Demo",
  adminUser: process.env.REACT_APP_ADMIN_USERNAME || "admin@example.com",
  adminHash:
    process.env.REACT_APP_ADMIN_PASSWORD_HASH ||
    "5f4dcc3b5aa765d61d8327deb882cf99",
  crmUrl:
    process.env.REACT_APP_CRM_BASE_URL || "http://192.168.15.81:8080/SicurwebApi",  backendUrl: process.env.REACT_APP_BACKEND_URL || "http://localhost:4000",
  blueiotHost: process.env.REACT_APP_BLUEIOT_HOST || "ws://192.168.1.11:48300",
  blueiotUsername: process.env.REACT_APP_BLUEIOT_USERNAME || "admin",
  blueiotPassword: process.env.REACT_APP_BLUEIOT_PASSWORD || "#BlueIOT",
  blueiotSalt:
    process.env.REACT_APP_BLUEIOT_SALT ||
    "abcdefghijklmnopqrstuvwxyz20191107salt",
};

// Debug: stampa la configurazione (rimuovi in produzione)
console.log("[ENV] Configuration loaded:", {
  useMock: env.useMock,
  companyId: env.companyId,
  crmUrl: env.crmUrl,
  backendUrl: env.backendUrl,
});
