// Optional. Only used when you paste an Anthropic API key in Settings.
// The key stays in this browser's storage and is sent only to api.anthropic.com.

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';

async function ask(key, system, prompt, schema) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const data = await res.json();
  if (data.stop_reason !== 'end_turn') throw new Error(`AI stopped early (${data.stop_reason})`);
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

const TASKS_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          deadline: { type: ['string', 'null'] },
          minutes: { type: ['integer', 'null'] },
          priority: { type: 'string', enum: ['normal', 'high'] },
        },
        required: ['name', 'deadline', 'minutes', 'priority'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
};

export async function aiParse(key, text, today) {
  const system =
    'You turn a dictated to-do note from a busy UK doctor into tasks. For each task give a short name, ' +
    'the deadline as YYYY-MM-DD (null if not said), total estimated effort in minutes (null if not said), ' +
    'and priority "high" only if they say it is urgent or important. Dates are day/month. ' +
    `Today is ${today}. A weekday name means the next one on or after today.`;
  const out = await ask(key, system, text, TASKS_SCHEMA);
  return out.tasks.map((t) => ({
    name: t.name,
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(t.deadline || '') ? t.deadline : null,
    minutes: t.minutes > 0 ? t.minutes : null,
    priority: t.priority === 'high' ? 'high' : 'normal',
  }));
}

export async function aiSteps(key, taskName, count, minutesEach) {
  const schema = {
    type: 'object',
    properties: { steps: { type: 'array', items: { type: 'string' } } },
    required: ['steps'],
    additionalProperties: false,
  };
  const system =
    'Split a task into small, concrete sub-steps of equal size. Each step name is 2 to 5 words, ' +
    'starts with a verb, and has no numbering. Return exactly the number of steps asked for, in order.';
  const out = await ask(key, system, `Task: ${taskName}\nNumber of steps: ${count}\nEach step takes about ${minutesEach} minutes.`, schema);
  const steps = out.steps.map((s) => String(s).trim()).filter(Boolean);
  return steps.length === count ? steps : null;
}
