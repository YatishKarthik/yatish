import Ajv from 'ajv';
import schema from '../../../data/schema/sites.schema.json';
import type { SitesJson } from './types';

export const asset = (p: string) => `${import.meta.env.BASE_URL}${p.replace(/^\//, '')}`;

/** Fetch sites.json once and check it against the shared schema. Throws a readable message. */
export async function loadSites(): Promise<SitesJson> {
  const res = await fetch(asset('data/sites.json'), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`data/sites.json could not be loaded (HTTP ${res.status}).`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error('data/sites.json is not valid JSON.');
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema as object);
  if (!validate(json)) {
    const msgs = (validate.errors ?? []).slice(0, 6).map((e) => `${e.instancePath || '/'} ${e.message}`);
    throw new Error(`data/sites.json does not match the schema:\n${msgs.join('\n')}`);
  }
  return Object.freeze(json) as SitesJson;
}
