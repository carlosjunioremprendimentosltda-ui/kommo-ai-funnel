const { transcribeAudioFromUrl, classifyCustomerIntent } = require('./ai.service');
const { updateLeadStage, addLeadNote } = require('./kommo.service');

// Mapa em memória para gerenciar o debounce por lead
const leadBuffers = new Map();

/**
 * Adiciona uma mensagem ou áudio ao buffer do lead e reinicia o cronômetro
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
    console.log(`[BufferService] Novo evento do Lead ${leadId}. Timer de ${timeoutMs / 1000}s reiniciado.`);
  } else {
    console.log(`[BufferService] Primeiro evento do Lead ${leadId}. Aguardando ${timeoutMs / 1000}s por mais mensagens...`);
  }

  // Define o timer para processar o buffer quando houver silêncio
  leadData.timer = setTimeout(() => {
    processLeadBuffer(leadId);
  }, timeoutMs);
}

/**
 * Processa todas as mensagens e áudios acumulados para um determinado lead
 * @param {string|number} leadId 
 */
async function processLeadBuffer(leadId) {
  const leadData = leadBuffers.get(leadId);
  if (!leadData) return;

  // Remove do buffer ativo
  leadBuffers.delete(leadId);

  const totalItems = leadData.items.length;
  console.log(`\n==================================================`);
  console.log(`[BufferService] INICIANDO PROCESSAMENTO: Lead ${leadId} (${totalItems} mensagem(ns))`);
  console.log(`==================================================`);

  try {
    const parts = [];

    // 1. Processa cada item (transcreve áudio ou pega texto)
    for (let i = 0; i < leadData.items.length; i++) {
      const item = leadData.items[i];
      if (item.type === 'voice' || item.type === 'audio') {
        console.log(`[BufferService] [${i + 1}/${totalItems}] Transcrevendo áudio...`);
        try {
          const audioText = await transcribeAudioFromUrl(item.content);
          parts.push(`[Áudio ${i + 1}]: "${audioText}"`);
        } catch (audioErr) {
          parts.push(`[Áudio ${i + 1}]: (Falha ao transcrever: ${audioErr.message})`);
        }
      } else {
        parts.push(`[Texto ${i + 1}]: "${item.content}"`);
      }
    }

    const fullTranscript = parts.join('\n');
    console.log(`[BufferService] Conteúdo consolidado do Lead ${leadId}:\n${fullTranscript}`);

    // 2. Classifica a intenção com IA
    console.log(`[BufferService] Enviando para classificação de IA...`);
    const analysis = await classifyCustomerIntent(fullTranscript);
    console.log(`[BufferService] Resultado IA:`, analysis);

    // 3. Define a etapa de destino
    let targetStageId = null;
    let stageName = '';

    if (analysis.classificacao === 'POSITIVO') {
      targetStageId = process.env.STAGE_POSITIVO_ID;
      stageName = 'POSITIVO (Interessado / Fechamento)';
    } else if (analysis.classificacao === 'NEGATIVO') {
      targetStageId = process.env.STAGE_NEGATIVO_ID;
      stageName = 'NEGATIVO (Descarte / Sem Interesse)';
    } else if (analysis.classificacao === 'DUVIDA') {
      targetStageId = process.env.STAGE_HUMANO_ID;
      stageName = 'DÚVIDA (Atendimento Humano)';
    } else {
      // INCONCLUSIVO: se configurado, envia para atendimento humano ou triagem
      targetStageId = process.env.STAGE_HUMANO_ID || null;
      stageName = 'INCONCLUSIVO (Revisão Manual)';
    }

    // 4. Executa a mudança de etapa no Kommo se houver ID configurado
    if (targetStageId && targetStageId !== '00000000') {
      console.log(`[BufferService] Movendo lead para a etapa ${stageName} (ID: ${targetStageId})...`);
      await updateLeadStage(leadId, targetStageId);
    } else {
      console.warn(`[BufferService] Nenhuma etapa válida configurada para ${analysis.classificacao}. O lead permaneceu na etapa atual.`);
    }

    // 5. Salva a nota de auditoria detalhada no Lead
    const noteText = `🤖 TRIAGEM AUTOMÁTICA DE RESPOSTA/ÁUDIO
━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Classificação: ${analysis.classificacao}
🎯 Decisão: ${stageName}
💡 Motivo da IA: ${analysis.motivo}

💬 Mensagens/Áudios Analisados:
${fullTranscript}
━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    await addLeadNote(leadId, noteText);
    console.log(`[BufferService] Lead ${leadId} processado e documentado com sucesso!\n`);

  } catch (err) {
    console.error(`[BufferService] Erro crítico ao processar buffer do lead ${leadId}:`, err);
  }
}

module.exports = {
  enqueueMessage,
};
