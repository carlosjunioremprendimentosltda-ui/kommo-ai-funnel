require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
┌────────────────────────────────────────────────────────────┐
│   🚀 KOMMO AI FUNNEL BACKEND INICIADO COM SUCESSO!        │
│                                                            │
│   • Porta: http://localhost:${PORT}                           │
│   • Webhook: http://localhost:${PORT}/webhook/kommo           │
│   • Health Check: http://localhost:${PORT}/health             │
│   • Buffer Debounce: ${process.env.BUFFER_TIMEOUT_MS || 25000} ms                     │
│   • Kommo Subdomain: ${process.env.KOMMO_SUBDOMAIN || 'Não configurado'}            │
└────────────────────────────────────────────────────────────┘
`);
});

// Tratamento de encerramento seguro (Graceful Shutdown)
process.on('SIGTERM', () => {
  console.log('SIGTERM recebido. Encerrando servidor HTTP...');
  server.close(() => {
    console.log('Servidor encerrado.');
    process.exit(0);
  });
});
