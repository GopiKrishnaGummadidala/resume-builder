// Tailoring with Google Gemini through the Gemini API, which has a free tier (a key from
// aistudio.google.com). Enabled when GEMINI_API_KEY is set on the server; the key never reaches the
// browser. Same prompt and answer format as the other AIs (js/tailor.js), and the browser checks the
// answer (reviewPlan) before anyone sees it.
import { GoogleGenAI, ApiError } from '@google/genai';
import { tailorPrompt, TAILOR_SCHEMA } from '../js/tailor.js';
import { TailorError } from './tailor.js';

/** @returns {(doc: object, job: object) => Promise<object>} resolves to the model's plan */
export function createGeminiTailor({ apiKey, model = 'gemini-3.5-flash' } = {}) {
  const ai = new GoogleGenAI({ apiKey });
  return async function tailor(doc, job) {
    const { system, user } = tailorPrompt(doc, job);
    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: TAILOR_SCHEMA,
          maxOutputTokens: 16000,
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('Gemini API error:', err.status, err.message);
        if (err.status === 429) {
          throw new TailorError(429, 'Gemini\'s free tier is busy or its daily limit is reached. Try again later, or pick another option.');
        }
        if (err.status === 400 && /api key/i.test(err.message)) throw new TailorError(503, 'Gemini is not set up correctly on the server (the API key is not valid).');
        if (err.status === 401 || err.status === 403) throw new TailorError(503, 'Gemini is not set up correctly on the server.');
        if (err.status === 404) throw new TailorError(503, `Gemini does not offer the model "${model}" to this key. Set GEMINI_MODEL on the server.`);
        throw new TailorError(502, 'Gemini could not tailor the CV right now. Try again, or pick another option.');
      }
      throw err;
    }
    const finish = response.candidates?.[0]?.finishReason;
    if (response.promptFeedback?.blockReason || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') {
      throw new TailorError(422, 'Gemini declined this request. Check the job description, or pick another option.');
    }
    if (finish === 'MAX_TOKENS') throw new TailorError(502, 'The Gemini answer was cut off. Try again, or shorten the job description.');
    try {
      return JSON.parse(response.text || '');
    } catch {
      throw new TailorError(502, 'The Gemini answer could not be read. Try again.');
    }
  };
}
