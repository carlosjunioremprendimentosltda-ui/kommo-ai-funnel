const { OpenAI } = require('openai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

let openaiClient = null;

function getOpenAIClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY não configurada no arquivo .env');
    }
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

/**
 * Faz o download do arquivo de áudio (OGG/MP3/WAV) a partir de uma URL
 * e o transcreve usando o Whisper da OpenAI.
 * @param {string} audioUrl - URL direta do arquivo de áudio
 * @returns {Promise<string>} Texto transcrito
 */
async function transcribeAudioFromUrl(audioUrl) {
  const tempDir = path.join(os.tmpdir(), 'kommo_audios');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `audio_${Date.now()}_${Math.random().toString(36).substring(7)}.ogg`);

  try {
    console.log(`[AIService] Baixando áudio: ${audioUrl}`);

    // Download do arquivo de áudio em stream
    const response = await axios({
      url: audioUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 15000,
    });

    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log(`[AIService] Áudio salvo temporariamente. Enviando para o Whisper...`);

    const openai = getOpenAIClient();
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
      language: 'pt',
      temperature: 0.2,
    });

    console.log(`[AIService] Transcrição concluída: "${transcription.text}"`);
    return transcription.text;
  } catch (error) {
    console.error('[AIService] Erro ao transcrever áudio:', error.message);
    throw new Error(`Falha na transcrição do áudio: ${error.message}`);
  } finally {
    // Garante que o arquivo temporário será deletado
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupErr) {
        console.warn('[AIService] Falha ao remover arquivo temporário:', cleanupErr.message);
      }
    }
  }
}

/**
 * Classifica a intenção do cliente com base no histórico consolidado de mensagens
 * @param {string} messageContent - Texto ou transcrição consolidada
 * @returns {Promise<{classificacao: string, motivo: string, transcricao_resumida: string}>}
 */
async function classifyCustomerIntent(messageContent) {
  const openai = getOpenAIClient();

  const prompt = `
Você é o assistente inteligente de triagem de um funil de vendas via WhatsApp.
Analise a resposta dada pelo cliente e determine com precisão a intenção dele.

MENSAGEM DO CLIENTE:
"""
${messageContent}
"""

REGRAS DE CLASSIFICAÇÃO:
1. "POSITIVO":
   - Demonstra claro interesse em comprar, contratar, agendar reunião ou receber a proposta.
   - Pede chave Pix, link de pagamento, dados bancários ou pergunta como pagar.
   - Responde com frases como "quero sim", "pode mandar", "gostei", "vamos fechar", "tenho interesse".

2. "NEGATIVO":
   - Diz abertamente que não tem interesse, pede para parar de enviar mensagens ou remover da lista.
   - Recusa explicitamente o serviço/produto, diz que achou muito caro e não tem como, ou diz que já contratou outro.

3. "DUVIDA":
   - Faz perguntas sobre o funcionamento, prazo, garantia, parcelamento, endereço, especificações.
   - Pede para falar com um atendente humano ("falar com atendente", "me liga").
   - Demonstra interesse mas tem objeções ou dúvidas que precisam de um vendedor humano para negociar.

4. "INCONCLUSIVO":
   - Mensagens monossilábicas sem sentido (ex: "ok", "👍", "...", "opa").
   - Áudio com barulho inaudível ou mensagem sem nexo comercial.

RESPONDA EXCLUSIVAMENTE NO FORMATO JSON ABAIXO:
{
  "classificacao": "POSITIVO" | "NEGATIVO" | "DUVIDA" | "INCONCLUSIVO",
  "motivo": "Justificativa concisa em 1 ou 2 frases do porquê desta classificação",
  "transcricao_resumida": "Resumo em uma linha da intenção real do cliente"
}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });

    const parsedResult = JSON.parse(completion.choices[0].message.content);
    return parsedResult;
  } catch (error) {
    console.error('[AIService] Erro ao classificar intenção:', error.message);
    return {
      classificacao: 'INCONCLUSIVO',
      motivo: `Erro na análise de IA: ${error.message}`,
      transcricao_resumida: messageContent.slice(0, 100),
    };
  }
}

module.exports = {
  transcribeAudioFromUrl,
  classifyCustomerIntent,
};
