// Tailoring with ChatGPT through the OpenAI API. Enabled when OPENAI_API_KEY is set on the server; the key
// never reaches the browser. Same prompt and answer format as Claude (js/tailor.js), and the browser checks
// the answer (reviewPlan) before anyone sees it.
import OpenAI from 'openai';
import { tailorPrompt, TAILOR_SCHEMA } from '../js/tailor.js';
import { TailorError } from './tailor.js';

/** @returns {(doc: object, job: object) => Promise<object>} resolves to the model's plan */
export function createOpenAITailor({ model = 'gpt-5.5' } = {}) {
  const client = new OpenAI(); // reads OPENAI_API_KEY
  return async function tailor(doc, job) {
    const { system, user } = tailorPrompt(doc, job);
    let completion;
    try {
      completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name: 'tailoring_plan', schema: TAILOR_SCHEMA, strict: true } },
      });
    } catch (err) {
      if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
        console.error('OpenAI API key rejected:', err.message);
        throw new TailorError(503, 'ChatGPT is not set up correctly on the server.');
      }
      if (err instanceof OpenAI.RateLimitError) throw new TailorError(429, 'ChatGPT is busy or out of credit. Try again later, or pick another AI.');
      if (err instanceof OpenAI.APIError) {
        console.error('OpenAI API error:', err.status, err.message);
        throw new TailorError(502, 'ChatGPT could not tailor the CV right now. Try again, or pick another AI.');
      }
      throw err;
    }
    const choice = completion.choices?.[0];
    if (choice?.message?.refusal) throw new TailorError(422, 'ChatGPT declined this request. Check the job description, or pick another AI.');
    if (choice?.finish_reason === 'length') throw new TailorError(502, 'The ChatGPT answer was cut off. Try again, or shorten the job description.');
    try {
      return JSON.parse(choice?.message?.content || '');
    } catch {
      throw new TailorError(502, 'The ChatGPT answer could not be read. Try again.');
    }
  };
}
