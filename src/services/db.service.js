const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/db.json');

const DEFAULT_DB = {
  config: {
    subdomain: '',
    accessToken: '',
    geminiApiKey: '',
    openaiApiKey: '',
    stagePositivoId: '',
    stageNegativoId: '',
    stageHumanoId: '',
    stageInconclusivoId: '',
    bufferTimeoutMs: 25000,
  },
  incomingMessages: [], // Mensagens recebidas via webhook
  leadsHistory: [],
  logs: [],
};

// Cache em memória para leitura ultrarrápida
let memoryDb = null;

/**
 * Garante a inicialização do banco de dados e sincroniza com o ambiente
 */
function init() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      memoryDb = JSON.parse(raw);
    } catch (e) {
      console.warn('[DB] Arquivo corrompido ou vazio. Recriando banco inicial...');
      memoryDb = { ...DEFAULT_DB };
      persist();
    }
  } else {
    memoryDb = { ...DEFAULT_DB };
    persist();
  }

  // Garante que o array de mensagens recebidas exista
  if (!Array.isArray(memoryDb.incomingMessages)) {
    memoryDb.incomingMessages = [];
  }

  // Sincronização Inteligente:
  // 1. Se houver variáveis no process.env (Render / .env), carrega para o DB se o DB estiver vazio
  if (process.env.KOMMO_SUBDOMAIN && process.env.KOMMO_SUBDOMAIN !== 'suaempresa' && !memoryDb.config.subdomain) {
    memoryDb.config.subdomain = process.env.KOMMO_SUBDOMAIN;
  }
  if (process.env.KOMMO_ACCESS_TOKEN && !memoryDb.config.accessToken) {
    memoryDb.config.accessToken = process.env.KOMMO_ACCESS_TOKEN;
  }
  if (process.env.GEMINI_API_KEY && !memoryDb.config.geminiApiKey) {
    memoryDb.config.geminiApiKey = process.env.GEMINI_API_KEY;
  }
  if (process.env.OPENAI_API_KEY && !memoryDb.config.openaiApiKey) {
    memoryDb.config.openaiApiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.STAGE_POSITIVO_ID && !memoryDb.config.stagePositivoId) {
    memoryDb.config.stagePositivoId = process.env.STAGE_POSITIVO_ID;
  }
  if (process.env.STAGE_NEGATIVO_ID && !memoryDb.config.stageNegativoId) {
    memoryDb.config.stageNegativoId = process.env.STAGE_NEGATIVO_ID;
  }
  if (process.env.STAGE_HUMANO_ID && !memoryDb.config.stageHumanoId) {
    memoryDb.config.stageHumanoId = process.env.STAGE_HUMANO_ID;
  }
  if (process.env.STAGE_INCONCLUSIVO_ID && !memoryDb.config.stageInconclusivoId) {
    memoryDb.config.stageInconclusivoId = process.env.STAGE_INCONCLUSIVO_ID;
  }

  // 2. Injeta os dados do DB de volta no process.env para que todos os serviços (Kommo, Gemini) acessem instantaneamente
  syncToProcessEnv();
  persist();

  console.log('[DB] Mini Banco de Dados inicializado com sucesso.');
}

function persist() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(memoryDb, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[DB] Aviso: Não foi possível salvar em disco (comum em sistemas temporários):', err.message);
  }
}

function syncToProcessEnv() {
  if (!memoryDb || !memoryDb.config) return;
  const cfg = memoryDb.config;

  if (cfg.subdomain) process.env.KOMMO_SUBDOMAIN = cfg.subdomain;
  if (cfg.accessToken) process.env.KOMMO_ACCESS_TOKEN = cfg.accessToken;
  if (cfg.geminiApiKey) process.env.GEMINI_API_KEY = cfg.geminiApiKey;
  if (cfg.openaiApiKey) process.env.OPENAI_API_KEY = cfg.openaiApiKey;
  if (cfg.stagePositivoId) process.env.STAGE_POSITIVO_ID = cfg.stagePositivoId;
  if (cfg.stageNegativoId) process.env.STAGE_NEGATIVO_ID = cfg.stageNegativoId;
  if (cfg.stageHumanoId) process.env.STAGE_HUMANO_ID = cfg.stageHumanoId;
  if (cfg.stageInconclusivoId) process.env.STAGE_INCONCLUSIVO_ID = cfg.stageInconclusivoId;
  if (cfg.bufferTimeoutMs) process.env.BUFFER_TIMEOUT_MS = String(cfg.bufferTimeoutMs);
}

/**
 * Retorna as configurações ativas unificadas
 */
function getConfig() {
  if (!memoryDb) init();
  return {
    PORT: process.env.PORT || '3000',
    KOMMO_SUBDOMAIN: memoryDb.config.subdomain || process.env.KOMMO_SUBDOMAIN || '',
    KOMMO_ACCESS_TOKEN: memoryDb.config.accessToken || process.env.KOMMO_ACCESS_TOKEN || '',
    GEMINI_API_KEY: memoryDb.config.geminiApiKey || process.env.GEMINI_API_KEY || '',
    OPENAI_API_KEY: memoryDb.config.openaiApiKey || process.env.OPENAI_API_KEY || '',
    STAGE_POSITIVO_ID: memoryDb.config.stagePositivoId || process.env.STAGE_POSITIVO_ID || '',
    STAGE_NEGATIVO_ID: memoryDb.config.stageNegativoId || process.env.STAGE_NEGATIVO_ID || '',
    STAGE_HUMANO_ID: memoryDb.config.stageHumanoId || process.env.STAGE_HUMANO_ID || '',
    STAGE_INCONCLUSIVO_ID: memoryDb.config.stageInconclusivoId || process.env.STAGE_INCONCLUSIVO_ID || '',
    BUFFER_TIMEOUT_MS: String(memoryDb.config.bufferTimeoutMs || process.env.BUFFER_TIMEOUT_MS || 25000),
  };
}

/**
 * Salva e atualiza as configurações no banco e no ambiente em tempo real
 */
function updateConfig(newConfig) {
  if (!memoryDb) init();

  if (newConfig.KOMMO_SUBDOMAIN !== undefined) memoryDb.config.subdomain = newConfig.KOMMO_SUBDOMAIN.trim();
  if (newConfig.KOMMO_ACCESS_TOKEN !== undefined) memoryDb.config.accessToken = newConfig.KOMMO_ACCESS_TOKEN.trim();
  if (newConfig.GEMINI_API_KEY !== undefined) memoryDb.config.geminiApiKey = newConfig.GEMINI_API_KEY.trim();
  if (newConfig.OPENAI_API_KEY !== undefined) memoryDb.config.openaiApiKey = newConfig.OPENAI_API_KEY.trim();
  if (newConfig.STAGE_POSITIVO_ID !== undefined) memoryDb.config.stagePositivoId = String(newConfig.STAGE_POSITIVO_ID).trim();
  if (newConfig.STAGE_NEGATIVO_ID !== undefined) memoryDb.config.stageNegativoId = String(newConfig.STAGE_NEGATIVO_ID).trim();
  if (newConfig.STAGE_HUMANO_ID !== undefined) memoryDb.config.stageHumanoId = String(newConfig.STAGE_HUMANO_ID).trim();
  if (newConfig.STAGE_INCONCLUSIVO_ID !== undefined) memoryDb.config.stageInconclusivoId = String(newConfig.STAGE_INCONCLUSIVO_ID).trim();
  if (newConfig.BUFFER_TIMEOUT_MS !== undefined) memoryDb.config.bufferTimeoutMs = Number(newConfig.BUFFER_TIMEOUT_MS) || 25000;

  syncToProcessEnv();
  persist();

  return getConfig();
}

/**
 * Grava um evento de lead no histórico do banco de dados
 */
function recordLeadEvent(eventData) {
  if (!memoryDb) init();

  const record = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    leadId: eventData.leadId,
    timestamp: new Date().toLocaleTimeString('pt-BR'),
    date: new Date().toLocaleDateString('pt-BR'),
    fullDate: new Date().toISOString(),
    message: eventData.message || '',
    type: eventData.type || 'text',
    classification: eventData.classification || 'INCONCLUSIVO',
    reason: eventData.reason || '',
    targetStageId: eventData.targetStageId || '',
    stageName: eventData.stageName || '',
    success: eventData.success !== false,
  };

  memoryDb.leadsHistory.unshift(record);

  // Mantém os últimos 200 leads no histórico
  if (memoryDb.leadsHistory.length > 200) {
    memoryDb.leadsHistory.pop();
  }

  persist();
  return record;
}

/**
 * Retorna o histórico de leads processados
 */
function getLeadHistory(limit = 50) {
  if (!memoryDb) init();
  return memoryDb.leadsHistory.slice(0, limit);
}

/**
 * Salva uma mensagem ou áudio recebido via webhook no banco de dados interno
 * @param {Object} msgData
 * @param {string|number} [msgData.leadId]
 * @param {string|number} [msgData.contactId]
 * @param {string} msgData.type - 'text' | 'voice'
 * @param {string} msgData.content - texto ou URL do áudio
 */
function saveIncomingMessage(msgData) {
  if (!memoryDb) init();
  if (!Array.isArray(memoryDb.incomingMessages)) {
    memoryDb.incomingMessages = [];
  }

  const content = (msgData.content || '').toString().trim();
  if (!content) return null;

  const leadIdStr = msgData.leadId ? String(msgData.leadId).trim() : null;
  const contactIdStr = msgData.contactId ? String(msgData.contactId).trim() : null;

  const record = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    leadId: leadIdStr,
    contactId: contactIdStr,
    type: msgData.type || 'text',
    content,
    timestamp: new Date().toLocaleTimeString('pt-BR'),
    date: new Date().toLocaleDateString('pt-BR'),
    fullDate: new Date().toISOString(),
    createdAt: Date.now(),
  };

  // Insere a mais recente no início
  memoryDb.incomingMessages.unshift(record);

  // Mantém até 500 mensagens recentes no banco
  if (memoryDb.incomingMessages.length > 500) {
    memoryDb.incomingMessages.pop();
  }

  persist();
  return record;
}

/**
 * Retorna a mensagem mais recente salva no banco para um determinado leadId
 * @param {string|number} leadId 
 */
function getLatestMessageForLead(leadId) {
  if (!memoryDb) init();
  if (!Array.isArray(memoryDb.incomingMessages)) return null;

  const searchId = String(leadId).trim();
  const found = memoryDb.incomingMessages.find(m => m.leadId === searchId);
  return found || null;
}

/**
 * Retorna todas as mensagens recentes de um lead armazenadas no banco (ex: múltiplos áudios/textos consecutivos)
 * @param {string|number} leadId 
 * @param {number} limit 
 */
function getRecentMessagesForLead(leadId, limit = 10) {
  if (!memoryDb) init();
  if (!Array.isArray(memoryDb.incomingMessages)) return [];

  const searchId = String(leadId).trim();
  return memoryDb.incomingMessages
    .filter(m => m.leadId === searchId)
    .slice(0, limit);
}

/**
 * Retorna todas as mensagens armazenadas
 */
function getIncomingMessages(limit = 100) {
  if (!memoryDb) init();
  return (memoryDb.incomingMessages || []).slice(0, limit);
}

function clearIncomingMessages() {
  if (!memoryDb) init();
  memoryDb.incomingMessages = [];
  persist();
}

// Inicializa automaticamente no carregamento do módulo
init();

module.exports = {
  init,
  getConfig,
  updateConfig,
  recordLeadEvent,
  getLeadHistory,
  saveIncomingMessage,
  getLatestMessageForLead,
  getRecentMessagesForLead,
  getIncomingMessages,
  clearIncomingMessages,
};
