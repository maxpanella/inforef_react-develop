const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // proxy per endpoint SicurwebApi
  app.use(
    '/SicurwebApi',
    createProxyMiddleware({
      target: 'http://192.168.15.81:8080',
      changeOrigin: true,
      secure: false,
      // opzionale: rewrite se necessario
      // pathRewrite: { '^/SicurwebApi': '/SicurwebApi' },
      onProxyReq(proxyReq, req, res) {
        // log di debug
        // console.log('proxying', req.method, req.originalUrl);
      },
    })
  );

  // proxy per il backend locale (se vuoi inoltrare /api a localhost:4000)
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:4000',
      changeOrigin: true,
      secure: false,
    })
  );
};