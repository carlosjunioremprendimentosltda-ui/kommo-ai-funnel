const { enqueueMessage } = require('../services/buffer.service');
const { log } = require('../services/logger.service');

/**
 * Controller responsável por receber webhooks do Salesbot ou da Chats API do Kommo
 */
async function handleKommoWebhook(req, res) {
  // REGRA DE OURO DO KOMMO: Retornar 200 OK imediatamente dentro de 2-3 segundos
  res.status(200).json({ status: 'ok', received_at: new Date().toISOString() });

  try {
    const payload = req.body || {};
    const query = req.query || {};

    log('info', `📬 Webhook recebido do Kommo!`, { query, payload: Object.keys(payload).length > 0 ? payload : '(Vazio)' });

    // 1. Extração flexível do lead_id (atende Salesbot, Chats API ou Webhook geral)
    let leadId = 
      query.lead_id ||
      payload.lead_id || 
      payload.lead?.id ||
      payload.data?.lead_id ||
      payload.message?.lead_id ||
      payload.leads?.status?.[0]?.id ||
      payload.leads?.add?.[0]?.id;

    // 2. Extração do tipo e conteúdo da mensagem (texto ou link de áudio)
    let type = 'text';
    let content = '';

    if (payload.message) {
      type = payload.message.type || 'text';
      content = payload.message.media || payload.message.text || '';
    } else if (payload.type === 'voice' || payload.type === 'audio') {
      type = payload.type;
      content = payload.media || payload.url || '';
    } else {
      content = payload.text || payload.last_message || payload.client_message || payload.data?.message || '';
      if (typeof content === 'string' && (content.startsWith('http') && (content.includes('.ogg') || content.includes('.mp3') || content.includes('.opus')))) {
        type = 'voice';
      }
    }

    if (!leadId) {
      log('warn', `⚠️ Webhook recebido sem lead_id identificado. Verifique se o Salesbot está enviando ?lead_id={{lead.id}} na URL.`, payload);
      return;
    }

    if (!content) {
      // Se não veio texto direto, vamos tentar processar mesmo assim ou alertar
      log('warn', `⚠️ Lead ${leadId} recebido, mas nenhum texto ou link de áudio veio no corpo do webhook.`);
      content = '(Mensagem recebida sem corpo no webhook)';
    }

    log('success', `📥 Lead ${leadId} identificado! Conteúdo detectado: [${type.toUpperCase()}] "${content.slice(0, 100)}..."`);

    // 3. Envia para o serviço de buffer / debounce
    enqueueMessage({
      leadId,
      type,
      content,
    });

  } catch (error) {
    log('error', `❌ Erro crítico no webhook: ${error.message}`, error.stack);
  }
}

/**
 * Endpoint de Health Check
 */
function handleHealthCheck(req, res) {
  res.status(200).json({
    status: 'online',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  handleKommoWebhook,
  handleHealthCheck,
};
