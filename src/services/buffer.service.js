const { executeLeadPipeline } = require('./pipeline.service');
const { log } = require('./logger.service');

// Mapa em memória para gerenciar o debounce por lead
const leadBuffers = new Map();

/**
 * Adiciona uma mensagem ou áudio ao buffer do lead e reinicia o cronômetro de silêncio
 * @param {Object} params
 * @param {string|number} params.leadId - ID do lead no Kommo
 * @param {string} params.type - Tipo ('text', 'voice', 'audio')
 * @param {string} params.content - Texto ou URL do áudio
 */
function enqueueMessage({ leadId, type, content }) {
  const timeoutMs = parseInt(process.env.BUFFER_TIMEOUT_MS, 10) || 25000;

  if (!leadBuffers.has(leadId)) {
    leadBuffers.set(leadId, {
      items: [],
      timer: null,
    });
  }

  const leadData = leadBuffers.get(leadId);

  // Armazena a mensagem
  leadData.items.push({
    type,
    content,
    receivedAt: new Date(),
  });

  // Reseta o timer de debounce se já existir
  if (leadData.timer) {
    clearTimeout(leadData.timer);
    log('info', `⏳ [Lead ${leadId}] Nova mensagem recebida. Timer de debounce reiniciado para ${timeoutMs / 1000}s.`);
  } else {
    log('info', `⏱️ [Lead ${leadId}] Mensagem colocada no buffer. Aguardando ${timeoutMs / 1000}s de silêncio para consolidar...`);
  }

  // Define o timer para processar o buffer quando houver silêncio
  leadData.timer = setTimeout(() => {
    processLeadBuffer(leadId);
  }, timeoutMs);
}

/**
 * Disparado quando o timer de debounce expira.
 * Extrai os itens acumulados e delega para o Pipeline de Triagem sequencial.
 * @param {string|number} leadId 
 */
async function processLeadBuffer(leadId) {
  const leadData = leadBuffers.get(leadId);
  if (!leadData) return;

  // Remove do buffer ativo imediatamente
  leadBuffers.delete(leadId);

  const items = leadData.items || [];
  log('info', `🚀 [Lead ${leadId}] Buffer concluído! Consolidando ${items.length} mensagem(ns) para envio ao pipeline...`);

  // Delega a execução organizada para o Pipeline Service
  await executeLeadPipeline(leadId, items);
}

/**
 * Retorna o status do buffer (útil para diagnósticos)
 */
function getBufferStatus() {
  const activeLeads = [];
  leadBuffers.forEach((val, key) => {
    activeLeads.push({
      leadId: key,
      pendingItems: val.items.length,
    });
  });
  return {
    totalActiveLeads: activeLeads.length,
    leads: activeLeads,
  };
}

module.exports = {
  enqueueMessage,
  processLeadBuffer,
  getBufferStatus,
};
