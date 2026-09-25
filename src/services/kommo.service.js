const axios = require('axios');

/**
 * Instância do Axios configurada para a API v4 do Kommo
 */
function getKommoClient() {
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const token = process.env.KOMMO_ACCESS_TOKEN;

  if (!subdomain || !token) {
    throw new Error('KOMMO_SUBDOMAIN ou KOMMO_ACCESS_TOKEN não estão configurados no .env');
  }

  return axios.create({
    baseURL: `https://${subdomain}.kommo.com/api/v4`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'KommoAIFunnel/1.0',
    },
    timeout: 10000,
  });
}

/**
 * Atualiza o status/etapa de um Lead
 * @param {number|string} leadId - ID do lead no Kommo
 * @param {number|string} statusId - ID do status/etapa de destino
 * @param {number|string} [pipelineId] - ID do funil (opcional)
 */
async function updateLeadStage(leadId, statusId, pipelineId = null) {
  try {
    const client = getKommoClient();
    const payload = {
      status_id: Number(statusId),
    };

    if (pipelineId) {
      payload.pipeline_id = Number(pipelineId);
    }

    const response = await client.patch(`/leads/${leadId}`, payload);
    console.log(`[KommoService] Lead ${leadId} movido para a etapa ${statusId}`);
    return response.data;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[KommoService] Erro ao mover lead ${leadId}:`, errorDetails);
    throw new Error(`Falha ao atualizar etapa do lead: ${errorDetails}`);
  }
}

/**
 * Adiciona uma nota interna na linha do tempo do lead
 * @param {number|string} leadId - ID do lead
 * @param {string} text - Conteúdo da nota
 */
async function addLeadNote(leadId, text) {
  try {
    const client = getKommoClient();
    const payload = [
      {
        note_type: 'common',
        params: {
          text: text,
        },
      },
    ];

    const response = await client.post(`/leads/${leadId}/notes`, payload);
    console.log(`[KommoService] Nota interna adicionada ao lead ${leadId}`);
    return response.data;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[KommoService] Erro ao adicionar nota no lead ${leadId}:`, errorDetails);
    // Não interrompe o fluxo principal se a nota falhar
    return null;
  }
}

/**
 * Busca detalhes do lead incluindo contatos vinculados
 * @param {number|string} leadId 
 */
async function getLeadDetails(leadId) {
  try {
    const client = getKommoClient();
    const response = await client.get(`/leads/${leadId}?with=contacts`);
    return response.data;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[KommoService] Erro ao buscar lead ${leadId}:`, errorDetails);
    return null;
  }
}

/**
 * Lista todos os funis e suas respectivas etapas
 */
async function getPipelines() {
  const client = getKommoClient();
  const response = await client.get('/leads/pipelines');
  return response.data._embedded.pipelines;
}

/**
 * Busca as últimas notas/interações do lead para extrair a última mensagem ou áudio do WhatsApp
 * @param {number|string} leadId 
 */
async function getLeadLatestMessage(leadId) {
  try {
    const client = getKommoClient();
    const response = await client.get(`/leads/${leadId}/notes?order[created_at]=desc&limit=10`);
    const notes = response.data?._embedded?.notes || [];

    for (const note of notes) {
      // Ignora notas internas geradas pela nossa própria IA
      if (note.params?.text && note.params.text.includes('TRIAGEM AUTOMÁTICA')) {
        continue;
      }

      // Se for link de arquivo de áudio
      const link = note.params?.link || note.params?.file?.link || note.params?.attachment?.link;
      if (link && (link.includes('.ogg') || link.includes('.mp3') || link.includes('.opus') || link.includes('media'))) {
        return { type: 'voice', content: link };
      }

      // Se for texto
      if (note.params?.text && note.params.text.trim()) {
        const text = note.params.text.trim();
        if (text.startsWith('http') && (text.includes('.ogg') || text.includes('.mp3') || text.includes('.opus'))) {
          return { type: 'voice', content: text };
        }
        return { type: 'text', content: text };
      }
    }

    return null;
  } catch (error) {
    const msg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.warn(`[KommoService] Não foi possível obter histórico de notas do lead ${leadId}:`, msg);
    return null;
  }
}

module.exports = {
  updateLeadStage,
  addLeadNote,
  getLeadDetails,
  getPipelines,
  getLeadLatestMessage,
};
