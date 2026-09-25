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

/**
 * GET /api/config - Retorna a configuração atual
 */
function getConfig(req, res) {
  try {
    const config = readEnvFile();
    res.json({
      success: true,
      data: {
        PORT: config.PORT || process.env.PORT || '3000',
        KOMMO_SUBDOMAIN: config.KOMMO_SUBDOMAIN || process.env.KOMMO_SUBDOMAIN || '',
        KOMMO_ACCESS_TOKEN: config.KOMMO_ACCESS_TOKEN || process.env.KOMMO_ACCESS_TOKEN || '',
        STAGE_POSITIVO_ID: config.STAGE_POSITIVO_ID || process.env.STAGE_POSITIVO_ID || '',
        STAGE_NEGATIVO_ID: config.STAGE_NEGATIVO_ID || process.env.STAGE_NEGATIVO_ID || '',
        STAGE_HUMANO_ID: config.STAGE_HUMANO_ID || process.env.STAGE_HUMANO_ID || '',
        BUFFER_TIMEOUT_MS: config.BUFFER_TIMEOUT_MS || process.env.BUFFER_TIMEOUT_MS || '25000',
        OPENAI_API_KEY: config.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/config - Salva novas configurações no .env
 */
function saveConfig(req, res) {
  try {
    const {
      KOMMO_SUBDOMAIN,
      KOMMO_ACCESS_TOKEN,
      OPENAI_API_KEY,
      STAGE_POSITIVO_ID,
      STAGE_NEGATIVO_ID,
      STAGE_HUMANO_ID,
      BUFFER_TIMEOUT_MS,
    } = req.body;

    const payload = {};
    if (KOMMO_SUBDOMAIN !== undefined) payload.KOMMO_SUBDOMAIN = KOMMO_SUBDOMAIN.trim();
    if (KOMMO_ACCESS_TOKEN !== undefined) payload.KOMMO_ACCESS_TOKEN = KOMMO_ACCESS_TOKEN.trim();
    if (OPENAI_API_KEY !== undefined) payload.OPENAI_API_KEY = OPENAI_API_KEY.trim();
    if (STAGE_POSITIVO_ID !== undefined) payload.STAGE_POSITIVO_ID = STAGE_POSITIVO_ID;
    if (STAGE_NEGATIVO_ID !== undefined) payload.STAGE_NEGATIVO_ID = STAGE_NEGATIVO_ID;
    if (STAGE_HUMANO_ID !== undefined) payload.STAGE_HUMANO_ID = STAGE_HUMANO_ID;
    if (BUFFER_TIMEOUT_MS !== undefined) payload.BUFFER_TIMEOUT_MS = BUFFER_TIMEOUT_MS;

    writeEnvFile(payload);

    res.json({
      success: true,
      message: 'Configurações salvas e aplicadas com sucesso!',
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

module.exports = {
  getConfig,
  saveConfig,
  fetchPipelines,
};
