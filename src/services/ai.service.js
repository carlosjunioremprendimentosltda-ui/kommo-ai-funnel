const { GoogleGenAI } = require('@google/genai');
const { OpenAI } = require('openai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

let geminiClient = null;
let openaiClient = null;

/**
 * Retorna o provedor ativo (prioriza Gemini se configurado)
 */
function getActiveProvider() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '') {
    return 'gemini';
  }
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '') {
    return 'openai';
  }
  throw new Error('Nenhuma chave de IA configurada! Defina GEMINI_API_KEY ou OPENAI_API_KEY no .env');
}

function getGeminiClient() {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }
  return geminiClient;
}

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

/**
 * Faz o download do arquivo de áudio e o transcreve usando Gemini ou Whisper
 * @param {string} audioUrl - URL direta do arquivo de áudio (.ogg / WhatsApp)
 * @returns {Promise<string>} Texto transcrito
 */
async function transcribeAudioFromUrl(audioUrl) {
  const provider = getActiveProvider();
  console.log(`[AIService] Baixando áudio para transcrição via [${provider.toUpperCase()}]...`);

  // Download do áudio em memória (ArrayBuffer)
  const response = await axios({
    url: audioUrl,
    method: 'GET',
    responseType: 'arraybuffer',
    timeout: 15000,
  });

  const audioBuffer = Buffer.from(response.data);

const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

/**
 * Executa chamada ao Gemini tentando os modelos disponíveis para a conta
 */
async function callGeminiWithFallback(ai, contents, config = {}) {
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents,
        config,
      });
      return res;
    } catch (err) {
      lastErr = err;
      const errStr = (err.message || '') + (typeof err === 'object' ? JSON.stringify(err) : '');
      if (
        errStr.includes('404') ||
        errStr.includes('NOT_FOUND') ||
        errStr.includes('not found') ||
        errStr.includes('no longer available') ||
        errStr.includes('deprecated') ||
        err.status === 404 ||
        err.code === 404
      ) {
        console.warn(`[AIService - Gemini] Modelo ${model} indisponível. Tentando próximo modelo...`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

  // 1. VIA GOOGLE GEMINI (Rápido, em memória e sem arquivos temporários)
  if (provider === 'gemini') {
    try {
      const ai = getGeminiClient();
      const base64Audio = audioBuffer.toString('base64');

      const result = await callGeminiWithFallback(ai, [
        {
          inlineData: {
            mimeType: 'audio/ogg',
            data: base64Audio,
          },
        },
        'Transcreva este áudio de WhatsApp em português brasileiro exatamente como foi falado. Retorne estritamente apenas a transcrição do áudio, sem introduções ou explicações.',
      ]);

      const text = result.text ? result.text.trim() : '';
      console.log(`[AIService - Gemini] Transcrição concluída: "${text}"`);
      return text;
    } catch (err) {
      console.error('[AIService - Gemini] Erro ao transcrever:', err.message);
      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === '') {
        throw new Error(`Falha na transcrição com Gemini: ${err.message}`);
      }
      console.warn('[AIService] Falha no Gemini, tentando Whisper da OpenAI...');
    }
  }

  // 2. VIA OPENAI WHISPER
  const tempDir = path.join(os.tmpdir(), 'kommo_audios');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `audio_${Date.now()}_${Math.random().toString(36).substring(7)}.ogg`);

  try {
    fs.writeFileSync(tempFilePath, audioBuffer);
    const openai = getOpenAIClient();
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
      language: 'pt',
      temperature: 0.2,
    });

    console.log(`[AIService - Whisper] Transcrição concluída: "${transcription.text}"`);
    return transcription.text;
  } catch (err) {
    console.error('[AIService - Whisper] Erro ao transcrever:', err.message);
    throw new Error(`Falha na transcrição com Whisper: ${err.message}`);
  } finally {
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
    }
  }
}

/**
 * Classifica a intenção do cliente com base no histórico consolidado de mensagens
 * @param {string} messageContent - Texto ou transcrição consolidada
 * @returns {Promise<{classificacao: string, motivo: string, transcricao_resumida: string}>}
 */
async function classifyCustomerIntent(messageContent) {
  const provider = getActiveProvider();
  console.log(`[AIService] Classificando intenção via [${provider.toUpperCase()}]...`);

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
    // 1. VIA GOOGLE GEMINI
    if (provider === 'gemini') {
      try {
        const ai = getGeminiClient();
        const result = await callGeminiWithFallback(ai, prompt, {
          responseMimeType: 'application/json',
          temperature: 0.1,
        });

        const parsed = JSON.parse(result.text);
        return parsed;
      } catch (geminiErr) {
        if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '') {
          console.warn('[AIService] Gemini falhou, acionando fallback OpenAI...', geminiErr.message);
          const openai = getOpenAIClient();
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
          });
          return JSON.parse(completion.choices[0].message.content);
        }
        throw geminiErr;
      }
    }

    // 2. VIA OPENAI
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });

    const parsedResult = JSON.parse(completion.choices[0].message.content);
    return parsedResult;

  } catch (error) {
    console.error(`[AIService - ${provider}] Erro ao classificar:`, error.message);
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
  getActiveProvider,
};
