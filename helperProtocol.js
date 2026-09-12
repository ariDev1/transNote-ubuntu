export function parseHelperResponse(stdout) {
  const text = String(stdout ?? '').trim();

  if (text === '')
    throw new Error('helper returned no JSON');

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('helper returned invalid JSON');
  }

  if (!value || value.ok !== true) {
    const code = value?.error?.code || 'HELPER_FAILED';
    const message = value?.error?.message || 'helper failed';
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    error.detail = message;
    throw error;
  }

  return value;
}
