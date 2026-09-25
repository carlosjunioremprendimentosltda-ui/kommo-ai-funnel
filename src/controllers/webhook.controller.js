const { enqueueMessage } = require('../services/buffer.service');
const { log } = require('../services/logger.service');
const { getLeadLatestMessage } = require('../services/kommo.service');

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

    // Se vier subdomínio da conta no payload e o nosso estiver padrão, atualiza automaticamente
    const accountSubdomain = payload.account?.subdomain || query.subdomain;
    if (accountSubdomain && (!process.env.KOMMO_SUBDOMAIN || process.env.KOMMO_SUBDOMAIN === 'suaempresa')) {
      process.env.KOMMO_SUBDOMAIN = accountSubdomain;
      log('info', `📌 Subdomínio do Kommo detectado automaticamente: "${accountSubdomain}"`);
    }

    // Validador de ID numérico real (descarta tags não substituídas como {{lead.id}})
    function isValidId(val) {
      if (!val) return false;
      const str = String(val).trim();
      return str !== '' && !str.includes('{') && !str.includes('}') && /^\d+$/.test(str);
    }

    // 1. Extração flexível e robusta do lead_id
    let leadId = null;

    if (isValidId(query.lead_id)) {
      leadId = query.lead_id;
    } else if (isValidId(payload.lead_id)) {
      leadId = payload.lead_id;
    } else if (isValidId(payload.leads?.add?.[0]?.id)) {
      leadId = payload.leads.add[0].id;
    } else if (isValidId(payload.leads?.status?.[0]?.id)) {
      leadId = payload.leads.status[0].id;
    } else if (isValidId(payload.leads?.update?.[0]?.id)) {
      leadId = payload.leads.update[0].id;
    } else if (isValidId(payload.lead?.id)) {
      leadId = payload.lead.id;
    } else if (isValidId(payload.data?.lead_id)) {
      leadId = payload.data.lead_id;
    } else if (isValidId(payload.message?.lead_id)) {
      leadId = payload.message.lead_id;
    } else if (isValidId(payload['leads[add][0][id]'])) {
      leadId = payload['leads[add][0][id]'];
    } else if (isValidId(payload['leads[status][0][id]'])) {
      leadId = payload['leads[status][0][id]'];
    }

    if (!leadId) {
      log('warn', `⚠️ Webhook recebido sem lead_id numérico válido.`, { query, payload });
      return;
    }

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
      content = query.message || payload.text || payload.last_message || payload.client_message || payload.data?.message || '';
      if (typeof content === 'string' && (content.startsWith('http') && (content.includes('.ogg') || content.includes('.mp3') || content.includes('.opus')))) {
        type = 'voice';
      }
    }

    // 3. Se não veio texto direto no webhook, busca na linha do tempo do Kommo
    if (!content || content.includes('{{') || content.trim() === '') {
      log('info', `🔍 Webhook sem texto direto. Buscando última mensagem do Lead ${leadId} no Kommo...`);
      const fetched = await getLeadLatestMessage(leadId);
      if (fetched) {
        type = fetched.type;
        content = fetched.content;
        log('success', `📥 Mensagem obtida do Kommo: [${type.toUpperCase()}] "${content.slice(0, 100)}..."`);
      } else {
        log('warn', `⚠️ Nenhuma mensagem encontrada no histórico recente do Lead ${leadId}.`);
        content = '(Mensagem não localizada)';
      }
    } else {
      log('success', `📥 Lead ${leadId} identificado! Conteúdo detectado: [${type.toUpperCase()}] "${content.slice(0, 100)}..."`);
    }

    // 4. Envia para o serviço de buffer / debounce
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
