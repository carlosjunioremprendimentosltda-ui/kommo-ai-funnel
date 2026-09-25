const express = require('express');
const cors = require('cors');
const path = require('path');
const configRoutes = require('./routes/config.routes');
const webhookRoutes = require('./routes/webhook.routes');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir frontend estático
app.use(express.static(path.join(__dirname, '../public')));

// Logger simples de requisições
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// Rotas da API
app.use('/api', configRoutes);

// Rotas de Webhook
app.use('/', webhookRoutes);

// Redireciona qualquer outra rota para o frontend
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;
