const express = require('express');
const router = express.Router();
const { handleKommoWebhook, handleHealthCheck } = require('../controllers/webhook.controller');

// Health Check
router.get('/health', handleHealthCheck);

// Webhook endpoint principal (aceita POST do Kommo Salesbot ou Gatilhos de Funil)
router.post('/webhook/kommo', handleKommoWebhook);

// Webhook endpoint dedicado para Mensagens Recebidas (Integrações > Webhooks > Mensagem adicionada)
router.post('/webhook/message', handleKommoWebhook);

// Aceita GET também para testes no navegador
router.get('/webhook/kommo', (req, res) => {
  res.status(200).send('Webhook endpoint online. Utilize requisições POST para enviar dados.');
});

router.get('/webhook/message', (req, res) => {
  res.status(200).send('Webhook de mensagem online. Configure este endpoint no Kommo para mensagens recebidas.');
});

module.exports = router;
