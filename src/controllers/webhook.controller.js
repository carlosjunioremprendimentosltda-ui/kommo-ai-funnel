const { enqueueMessage } = require('../services/buffer.service');

/**
 * Controller responsável por receber webhooks do Salesbot ou da Chats API do Kommo
 */
async function handleKommoWebhook(req, res) {
  // REGRA DE OURO DO KOMMO: Retornar 200 OK imediatamente dentro de 2-3 segundos
  res.status(200).json({ status: 'ok', received_at: new Date().toISOString() });

  try {
    const payload = req.body || {};
    const query = req.query || {};

    console.log(`[Webhook] Evento recebido em /webhook/kommo`);

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

    // Se o webhook não enviou conteúdo, mas veio do Salesbot com lead_id, registramos para debug
    if (!leadId) {
      console.warn('[Webhook] Payload ignorado: Não foi possível identificar o lead_id:', JSON.stringify(payload).slice(0, 200));
      return;
    }

    if (!content) {
      console.warn(`[Webhook] Lead ${leadId} recebido, mas nenhum conteúdo de mensagem/áudio foi encontrado no payload.`);
      return;
    }

    console.log(`[Webhook] Enfileirando interação para o Lead ${leadId} (Tipo: ${type})`);

    // 3. Envia para o serviço de buffer / debounce
    enqueueMessage({
      leadId,
      type,
      content,
    });

  } catch (error) {
    console.error('[Webhook] Erro ao processar payload do webhook:', error);
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
