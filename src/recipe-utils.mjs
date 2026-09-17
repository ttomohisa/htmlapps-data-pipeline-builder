const INPUT_TYPES = new Set(['csv-input', 'jsonl-input', 'parquet-input']);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeGraph(graph) {
  const clean = deepClone(graph);
  if (!clean || typeof clean !== 'object' || !Array.isArray(clean.nodes) || !Array.isArray(clean.edges)) {
    throw new TypeError('Pipeline graph must contain nodes and edges.');
  }
  for (const node of clean.nodes) {
    delete node.runtime;
    delete node.preview;
    delete node.result;
    if (INPUT_TYPES.has(node.type) && node.data && typeof node.data === 'object') {
      for (const key of ['file', 'fileName', 'filename', 'path', 'blobUrl', 'preview', 'result', 'runtime']) delete node.data[key];
    }
  }
  return clean;
}

function stringifyPipeline(graph, { appVersion = '' } = {}) {
  return JSON.stringify({
    format: 'data-pipeline-builder',
    schemaVersion: 1,
    appVersion: String(appVersion || ''),
    graph: sanitizeGraph(graph),
  }, null, 2);
}

function parsePipeline(text) {
  let document;
  try { document = typeof text === 'string' ? JSON.parse(text) : deepClone(text); }
  catch (error) {
    const wrapped = new SyntaxError('Pipeline JSON could not be parsed.');
    wrapped.cause = error;
    throw wrapped;
  }
  const graph = document?.format === 'data-pipeline-builder' ? document.graph : document;
  return sanitizeGraph(graph);
}

function inputNodes(graph) {
  return (graph?.nodes || []).filter(node => INPUT_TYPES.has(node.type));
}

function makeRecipe({ id, name, graph, now = Date.now() }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new TypeError('Recipe name is required.');
  return {
    id: String(id || `recipe-${now}`),
    name: cleanName,
    createdAt: Number(now),
    updatedAt: Number(now),
    graph: sanitizeGraph(graph),
  };
}

function normalizeRecipes(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !item.id || !item.name || !item.graph) continue;
    try {
      normalized.push({
        id: String(item.id),
        name: String(item.name).trim(),
        createdAt: Number(item.createdAt) || 0,
        updatedAt: Number(item.updatedAt) || Number(item.createdAt) || 0,
        graph: sanitizeGraph(item.graph),
      });
    } catch {}
  }
  return normalized.filter(item => item.name);
}

const RecipeUtils = Object.freeze({ INPUT_TYPES, sanitizeGraph, stringifyPipeline, parsePipeline, inputNodes, makeRecipe, normalizeRecipes });
globalThis.RecipeUtils = RecipeUtils;
export default RecipeUtils;
