// Tailoring with Claude through the Anthropic API. Enabled when ANTHROPIC_API_KEY is set on the server;
// the key never reaches the browser. The prompt and the answer format come from js/tailor.js, and the
// browser checks the answer (reviewPlan) before anyone sees it.
import Anthropic from '@anthropic-ai/sdk';
import { tailorPrompt, TAILOR_SCHEMA } from '../js/tailor.js';

export class TailorError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** @returns {(doc: object, job: object) => Promise<object>} resolves to the model's plan */
export function createTailor({ model = 'claude-opus-5-5' } = {}) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return async function tailor(doc, job) {
    const { system, user } = tailorPrompt(doc, job);
    let response;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        // If the model declines, the API retries on a fallback model it chooses (server-side, same call).
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high', format: { type: 'json_schema', schema: TAILOR_SCHEMA } },
        system,
        messages: [{ role: 'user', content: user }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        console.error('Anthropic API key rejected:', err.message);
        throw new TailorError(503, 'The AI service is not set up correctly on the server.');
      }
      if (err instanceof Anthropic.RateLimitError) throw new TailorError(429, 'The AI service is busy. Try again in a minute.');
      if (err instanceof Anthropic.APIError) {
        console.error('Anthropic API error:', err.status, err.message);
        throw new TailorError(502, 'The AI service could not tailor the CV right now. Try again.');
      }
      throw err;
    }
    if (response.stop_reason === 'refusal') throw new TailorError(422, 'The AI declined this request. Check the job description and try again.');
    if (response.stop_reason === 'max_tokens') throw new TailorError(502, 'The AI answer was cut off. Try again, or shorten the job description.');
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new TailorError(502, 'The AI answer could not be read. Try again.');
    }
  };
}
