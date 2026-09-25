const express = require('express');
const router = express.Router();
const { 
  getConfig, 
  saveConfig, 
  fetchPipelines, 
  getLogsEndpoint, 
  clearLogsEndpoint, 
  simulateWebhookEndpoint 
} = require('../controllers/config.controller');

router.get('/config', getConfig);
router.post('/config', saveConfig);
router.post('/kommo/pipelines', fetchPipelines);
router.get('/logs', getLogsEndpoint);
router.post('/logs/clear', clearLogsEndpoint);
router.post('/test/simulate', simulateWebhookEndpoint);

module.exports = router;
