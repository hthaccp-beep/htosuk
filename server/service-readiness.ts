import {externalServiceEnabled} from './htos-runtime.ts';
export function serviceReadiness(env: Record<string,string|undefined> = process.env) {
  const enabled = externalServiceEnabled('OCR',env);
  const keyPresent = !!(env.GEMINI_API_KEY?.trim() || env.GOOGLE_GENAI_API_KEY?.trim() || env.API_KEY?.trim());
  return {
    email: externalServiceEnabled('EMAIL',env), ocr: enabled && keyPresent,
    ocrStatus: !enabled ? 'Switched off' : !keyPresent ? 'Key needed' : 'Configured',
    ocrDetail: !enabled
      ? 'Invoice scanning is switched off by the workspace owner. Enabling it requires server setup and a Gemini service key. You can still enter invoice details manually.'
      : !keyPresent
        ? 'Invoice scanning is enabled, but its Gemini service key is missing from the server. Ask the workspace owner to complete the setup.'
        : 'The scanning switch and service key are configured. Provider access, quota and successful scanning have not been tested by this status check.',
  };
}
