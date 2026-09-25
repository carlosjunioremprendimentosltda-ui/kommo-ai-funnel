const express = require('express');
const router = express.Router();
const { getConfig, saveConfig, fetchPipelines } = require('../controllers/config.controller');

router.get('/config', getConfig);
router.post('/config', saveConfig);
router.post('/kommo/pipelines', fetchPipelines);

module.exports = router;
