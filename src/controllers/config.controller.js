const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getPipelines } = require('../services/kommo.service');

const ENV_PATH = path.join(__dirname, '../../.env');

/**
 * Lê o arquivo .env e retorna um objeto chave-valor
 */
function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    return {};
  }
  const content = fs.readFileSync(ENV_PATH, 'utf-8');
  const lines = content.split('\n');
  const config = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      config[key] = val;
    }
  }
  return config;
}

/**
 * Atualiza o arquivo .env preservando estrutura
 */
function writeEnvFile(newConfig) {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf-8');
  }

  // Chaves para atualizar
  const keysToUpdate = Object.keys(newConfig);
  let updatedLines = content.split('\n');

  for (const key of keysToUpdate) {
    let found = false;
    updatedLines = updatedLines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('#') && trimmed.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${newConfig[key]}`;
      }
      return line;
    });

    if (!found) {
      updatedLines.push(`${key}=${newConfig[key]}`);
    }

    // Atualiza também no process.env em tempo de execução
    process.env[key] = String(newConfig[key]);
  }

  try {
    fs.writeFileSync(ENV_PATH, updatedLines.join('\n'), 'utf-8');
  } catch (fsErr) {
    console.warn('[Config] Aviso: Não foi possível gravar no arquivo .env (comum em ambientes de nuvem como Render). Usando variáveis em memória.');
  }
}

const db = require('../services/db.service');

/**
 * GET /api/config - Retorna a configuração atual do banco de dados
 */
function getConfig(req, res) {
  try {
    const config = db.getConfig();
    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/config - Salva novas configurações no banco de dados e ambiente
 */
function saveConfig(req, res) {
  try {
    const updated = db.updateConfig(req.body);
    // Também tenta persistir no .env para desenvolvimento local se possível
    writeEnvFile(req.body);

    res.json({
      success: true,
      data: updated,
      message: 'Configurações salvas e sincronizadas com sucesso no banco de dados!',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/history - Retorna o histórico de leads triados
 */
function getLeadHistoryEndpoint(req, res) {
  try {
    const history = db.getLeadHistory(50);
    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/kommo/pipelines - Testa credenciais e busca funis e etapas
 */
async function fetchPipelines(req, res) {
  try {
    const subdomain = req.body.subdomain || process.env.KOMMO_SUBDOMAIN;
    const token = req.body.token || process.env.KOMMO_ACCESS_TOKEN;

    if (!subdomain || !token) {
      return res.status(400).json({
        success: false,
        error: 'Informe o subdomínio e o Access Token do Kommo.',
      });
    }

    const response = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/pipelines`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const rawPipelines = response.data._embedded.pipelines || [];
    const pipelines = rawPipelines.map((p) => ({
      id: p.id,
      name: p.name,
      statuses: (p._embedded?.statuses || []).map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color || '#6366f1',
      })),
    }));

    res.json({
      success: true,
      pipelines,
    });
  } catch (error) {
    const msg = error.response?.data?.detail || error.response?.data?.title || error.message;
    res.status(error.response?.status || 500).json({
      success: false,
      error: `Erro ao conectar com Kommo: ${msg}`,
    });
  }
}

const { getLogs, clearLogs, log } = require('../services/logger.service');
const { enqueueMessage } = require('../services/buffer.service');

function getLogsEndpoint(req, res) {
  res.json({
    success: true,
    logs: getLogs(),
  });
}

function clearLogsEndpoint(req, res) {
  clearLogs();
  res.json({
    success: true,
    message: 'Logs limpos com sucesso.',
  });
}

/**
 * Simula um webhook para testes diretos pelo navegador
 */
function simulateWebhookEndpoint(req, res) {
  const { lead_id, message, type = 'text' } = req.body;

  if (!lead_id || !message) {
    return res.status(400).json({
      success: false,
      error: 'Informe lead_id e message para simular.',
    });
  }

  log('info', `🧪 [SIMULAÇÃO DE TESTE] Simulando webhook para Lead ${lead_id}...`);
  enqueueMessage({
    leadId: lead_id,
    type,
    content: message,
  });

  res.json({
    success: true,
    message: `Mensagem de teste enfileirada para o Lead ${lead_id}. Acompanhe o log abaixo!`,
  });
}

module.exports = {
  getConfig,
  saveConfig,
  fetchPipelines,
  getLogsEndpoint,
  clearLogsEndpoint,
  simulateWebhookEndpoint,
  getLeadHistoryEndpoint,
};
