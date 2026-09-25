const { transcribeAudioFromUrl, classifyCustomerIntent } = require('./ai.service');
const { updateLeadStage, addLeadNote } = require('./kommo.service');
const { log } = require('./logger.service');
const db = require('./db.service');

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
 * Processa todas as mensagens e áudios acumulados para um determinado lead
 * @param {string|number} leadId 
 */
async function processLeadBuffer(leadId) {
  const leadData = leadBuffers.get(leadId);
  if (!leadData) return;

  // Remove do buffer ativo
  leadBuffers.delete(leadId);

  const totalItems = leadData.items.length;
  log('info', `🚀 [Lead ${leadId}] Buffer concluído! Iniciando processamento de ${totalItems} mensagem(ns)...`);

  try {
    const parts = [];

    // 1. Processa cada item (transcreve áudio ou pega texto)
    for (let i = 0; i < leadData.items.length; i++) {
      const item = leadData.items[i];
      if (item.type === 'voice' || item.type === 'audio') {
        log('info', `🎙️ [Lead ${leadId}] [${i + 1}/${totalItems}] Transcrevendo áudio...`);
        try {
          const audioText = await transcribeAudioFromUrl(item.content);
          parts.push(`[Áudio ${i + 1}]: "${audioText}"`);
          log('success', `🎙️ [Lead ${leadId}] Áudio transcrito: "${audioText}"`);
        } catch (audioErr) {
          parts.push(`[Áudio ${i + 1}]: (Falha ao transcrever: ${audioErr.message})`);
          log('error', `❌ [Lead ${leadId}] Falha ao transcrever áudio: ${audioErr.message}`);
        }
      } else {
        parts.push(`[Texto ${i + 1}]: "${item.content}"`);
      }
    }

    const fullTranscript = parts.join('\n');
    log('info', `🧠 [Lead ${leadId}] Enviando conteúdo consolidado para IA:\n${fullTranscript}`);

    // 2. Classifica a intenção com IA
    const analysis = await classifyCustomerIntent(fullTranscript);
    log('ai', `🎯 [Lead ${leadId}] Resultado da IA: [${analysis.classificacao}] - ${analysis.motivo}`, analysis);

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
      targetStageId = process.env.STAGE_HUMANO_ID || null;
      stageName = 'INCONCLUSIVO (Revisão Manual)';
    }

    // 4. Executa a mudança de etapa no Kommo se houver ID configurado
    if (targetStageId && targetStageId !== '00000000' && targetStageId.trim() !== '') {
      log('kommo', `➡️ [Lead ${leadId}] Movendo para a etapa: ${stageName} (ID: ${targetStageId})...`);
      await updateLeadStage(leadId, targetStageId);
      log('success', `✅ [Lead ${leadId}] Etapa alterada com sucesso no Kommo!`);
    } else {
      log('warn', `⚠️ [Lead ${leadId}] Nenhuma etapa válida configurada para ${analysis.classificacao} no seu .env. O lead permaneceu na mesma etapa.`);
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
    log('success', `📝 [Lead ${leadId}] Nota de auditoria salva na linha do tempo do CRM.`);

    // 6. Grava no banco de dados para exibição no histórico do frontend
    db.recordLeadEvent({
      leadId,
      message: fullTranscript,
      classification: analysis.classificacao,
      reason: analysis.motivo,
      targetStageId: targetStageId || '',
      stageName: stageName || 'Não alterada',
      success: true,
    });

  } catch (err) {
    log('error', `❌ [Lead ${leadId}] Erro crítico no processamento: ${err.message}`, err.stack);
    db.recordLeadEvent({
      leadId,
      message: 'Falha durante o processamento',
      classification: 'ERRO',
      reason: err.message,
      targetStageId: '',
      stageName: 'Erro',
      success: false,
    });
  }
}

module.exports = {
  enqueueMessage,
};
