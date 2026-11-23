/**
 * Semantic tag allow-list (TAG_ALLOWLIST).
 *
 * With RESTRICT_TO_EXISTING_TAGS=yes the model never saw the tag list, and every existing tag
 * (including operational ones such as ai-processed or source:mail) was accepted on the way back.
 * When TAG_ALLOWLIST is set, only those tags are shown to the model, offered in the response
 * schema (TAG_SCHEMA_ENUM=yes) and accepted from its answer. Misconfiguration fails closed:
 * the document is not analysed (and so not marked processed) until the list resolves.
 * TAG_ALLOWLIST unset keeps the previous behaviour.
 */

const MAX_TAGS = 4;

function norm(name) {
  return name.trim().toLowerCase();
}

/**
 * Parse TAG_ALLOWLIST: a JSON array of strings, or a comma-separated list.
 * @param {string|undefined} raw
 * @returns {string[]|null} names, or null when unset (feature off)
 */
function parseAllowlist(raw) {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  let names;
  if (raw.trim().startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`TAG_ALLOWLIST is not valid JSON: ${error.message}`);
    }
    if (!Array.isArray(parsed) || parsed.some(n => typeof n !== 'string')) {
      throw new Error('TAG_ALLOWLIST must be a JSON array of strings');
    }
    names = parsed;
  } else {
    names = raw.split(',');
  }
  names = names.map(n => n.trim()).filter(n => n.length > 0);
  if (names.length === 0) throw new Error('TAG_ALLOWLIST is set but empty');
  const seen = new Set();
  for (const n of names) {
    if (seen.has(norm(n))) throw new Error(`TAG_ALLOWLIST has a duplicate: ${n}`);
    seen.add(norm(n));
  }
  return names;
}

/**
 * Resolve the allow-list against the tags that exist in Paperless.
 * @param {string[]} allowNames from parseAllowlist
 * @param {Array<string|{name:string}>} existingTags tag names or tag objects
 * @param {string} aiProcessedTagName never allowed as a semantic tag
 * @returns {string[]} canonical Paperless names, in allow-list order
 */
function resolveAllowlist(allowNames, existingTags, aiProcessedTagName) {
  const byNorm = new Map();
  for (const t of existingTags || []) {
    const name = typeof t === 'string' ? t : t?.name;
    if (typeof name === 'string' && name.trim()) byNorm.set(norm(name), name);
  }
  if (aiProcessedTagName) {
    const bad = allowNames.filter(n => norm(n) === norm(aiProcessedTagName));
    if (bad.length) throw new Error(`TAG_ALLOWLIST must not contain the AI-processed tag: ${bad.join(', ')}`);
  }
  const missing = allowNames.filter(n => !byNorm.has(norm(n)));
  if (missing.length) throw new Error(`TAG_ALLOWLIST names not found in Paperless: ${missing.join(', ')}`);
  return allowNames.map(n => byNorm.get(norm(n)));
}

/**
 * Keep only allowed tags from the model's answer.
 * @param {*} proposed the model's tags value
 * @param {string[]} allowed resolved names
 * @param {number} max cap on kept tags
 * @returns {{kept: string[], rejected: Array}} kept in canonical spelling
 */
function filterProposedTags(proposed, allowed, max = MAX_TAGS) {
  const byNorm = new Map(allowed.map(n => [norm(n), n]));
  const kept = [];
  const rejected = [];
  for (const p of Array.isArray(proposed) ? proposed : []) {
    const canonical = typeof p === 'string' ? byNorm.get(norm(p)) : undefined;
    if (!canonical || kept.includes(canonical) || kept.length >= max) {
      rejected.push(p);
    } else {
      kept.push(canonical);
    }
  }
  return { kept, rejected };
}

/**
 * Copy of the response schema with tags limited to the allowed names.
 * @param {object} baseSchema schema with properties.tags
 * @param {string[]} allowed resolved names
 * @param {number} max maxItems
 * @returns {object}
 */
function buildTagSchema(baseSchema, allowed, max = MAX_TAGS) {
  const schema = JSON.parse(JSON.stringify(baseSchema));
  schema.properties.tags = {
    type: 'array', items: { type: 'string', enum: [...allowed] }, minItems: 0, maxItems: max, uniqueItems: true
  };
  return schema;
}

/**
 * Allow-list for one document from the environment, or null when TAG_ALLOWLIST is unset.
 * Throws on misconfiguration so the caller skips the document without marking it processed.
 * @param {Array<string|{name:string}>} existingTags
 * @returns {{names: string[], schemaEnum: boolean}|null}
 */
function fromEnv(existingTags) {
  const names = parseAllowlist(process.env.TAG_ALLOWLIST);
  if (!names) return null;
  return {
    names: resolveAllowlist(names, existingTags, process.env.AI_PROCESSED_TAG_NAME),
    schemaEnum: process.env.TAG_SCHEMA_ENUM === 'yes'
  };
}

/**
 * Replace the model's tags with the allowed subset (in place) and log what was dropped.
 * @param {object} analysis analyzeDocument result ({document: {tags}})
 * @param {{names: string[]}|null} allow from fromEnv
 * @param {number} docId for the log line
 */
function enforce(analysis, allow, docId) {
  if (!allow || !analysis?.document) return;
  const { kept, rejected } = filterProposedTags(analysis.document.tags, allow.names);
  if (rejected.length) {
    console.log(`[DEBUG] Document ${docId}: tags outside TAG_ALLOWLIST dropped: ${JSON.stringify(rejected)}`);
  }
  analysis.document.tags = kept;
}

module.exports = { MAX_TAGS, parseAllowlist, resolveAllowlist, filterProposedTags, buildTagSchema, fromEnv, enforce };
