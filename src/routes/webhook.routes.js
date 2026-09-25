const express = require('express');
const router = express.Router();
const { handleKommoWebhook, handleHealthCheck } = require('../controllers/webhook.controller');

// Health Check
router.get('/health', handleHealthCheck);

// Webhook endpoint principal (aceita POST do Kommo)
router.post('/webhook/kommo', handleKommoWebhook);

// Aceita GET também caso o Salesbot faça webhook simples ou teste
router.get('/webhook/kommo', (req, res) => {
  res.status(200).send('Webhook endpoint online. Utilize requisições POST para enviar dados.');
});

module.exports = router;
