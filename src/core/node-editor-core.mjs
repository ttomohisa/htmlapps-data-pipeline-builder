const NodeEditorCore = (() => {
  'use strict';

  const FORMAT = 'node-editor-core';
  const CORE_SCHEMA_VERSION = 1;
  const CHANGE_TYPES = Object.freeze([
    'node.add', 'node.remove', 'node.position', 'node.data', 'node.disable',
    'edge.add', 'edge.remove', 'edge.reconnect', 'edge.data', 'graph.viewport'
  ]);
  const CHANGE_TYPE_SET = new Set(CHANGE_TYPES);
  let fallbackIdCounter = 0;

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertString(value, label) {
    if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string.`);
    return value;
  }

  function assertFiniteNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`);
    return value;
  }

  function assertPositiveInteger(value, label) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer.`);
    return value;
  }

  function clonePersistentValue(value, label = 'value', seen = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`);
      return value;
    }
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      throw new TypeError(`${label} contains a value that cannot be persisted as JSON.`);
    }
    if (typeof value !== 'object') throw new TypeError(`${label} contains an unsupported value.`);
    if (seen.has(value)) throw new TypeError(`${label} contains a circular reference.`);
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map((entry, index) => clonePersistentValue(entry, `${label}[${index}]`, seen));
      if (!isPlainObject(value)) throw new TypeError(`${label} must contain only plain objects, arrays, and JSON scalar values.`);
      const result = {};
      for (const [key, entry] of Object.entries(value)) result[key] = clonePersistentValue(entry, `${label}.${key}`, seen);
      return result;
    } finally {
      seen.delete(value);
    }
  }

  function normalizePosition(position, label = 'position') {
    if (!isPlainObject(position)) throw new TypeError(`${label} must be an object.`);
    return Object.freeze({ x: assertFiniteNumber(position.x, `${label}.x`), y: assertFiniteNumber(position.y, `${label}.y`) });
  }

  function normalizeViewport(viewport = { x: 0, y: 0, zoom: 1 }, label = 'viewport') {
    if (!isPlainObject(viewport)) throw new TypeError(`${label} must be an object.`);
    const zoom = assertFiniteNumber(viewport.zoom, `${label}.zoom`);
    if (zoom <= 0) throw new RangeError(`${label}.zoom must be greater than 0.`);
    return Object.freeze({ x: assertFiniteNumber(viewport.x, `${label}.x`), y: assertFiniteNumber(viewport.y, `${label}.y`), zoom });
  }

  function normalizeNode(node, label = 'node') {
    if (!isPlainObject(node)) throw new TypeError(`${label} must be an object.`);
    return Object.freeze({
      id: assertString(node.id, `${label}.id`),
      type: assertString(node.type, `${label}.type`),
      definitionVersion: assertPositiveInteger(node.definitionVersion ?? 1, `${label}.definitionVersion`),
      position: normalizePosition(node.position ?? { x: 0, y: 0 }, `${label}.position`),
      data: clonePersistentValue(node.data ?? {}, `${label}.data`),
      disabled: Boolean(node.disabled)
    });
  }

  function normalizeEndpoint(endpoint, label) {
    if (!isPlainObject(endpoint)) throw new TypeError(`${label} must be an object.`);
    return Object.freeze({ nodeId: assertString(endpoint.nodeId, `${label}.nodeId`), portId: assertString(endpoint.portId, `${label}.portId`) });
  }

  function normalizeEdge(edge, label = 'edge') {
    if (!isPlainObject(edge)) throw new TypeError(`${label} must be an object.`);
    return Object.freeze({
      id: assertString(edge.id, `${label}.id`),
      source: normalizeEndpoint(edge.source, `${label}.source`),
      target: normalizeEndpoint(edge.target, `${label}.target`),
      data: clonePersistentValue(edge.data ?? {}, `${label}.data`)
    });
  }

  function normalizeApp(app) {
    if (!isPlainObject(app)) throw new TypeError('graph.app must be an object.');
    return Object.freeze({ id: assertString(app.id, 'graph.app.id'), schemaVersion: assertPositiveInteger(app.schemaVersion ?? 1, 'graph.app.schemaVersion') });
  }

  function createGraph({ appId = 'unknown-consumer', appSchemaVersion = 1, nodes = [], edges = [], viewport = { x: 0, y: 0, zoom: 1 } } = {}) {
    assertString(appId, 'appId');
    assertPositiveInteger(appSchemaVersion, 'appSchemaVersion');
    if (!Array.isArray(nodes)) throw new TypeError('nodes must be an array.');
    if (!Array.isArray(edges)) throw new TypeError('edges must be an array.');
    return Object.freeze({
      format: FORMAT,
      coreSchemaVersion: CORE_SCHEMA_VERSION,
      app: Object.freeze({ id: appId, schemaVersion: appSchemaVersion }),
      nodes: Object.freeze(nodes.map((node, index) => normalizeNode(node, `nodes[${index}]`))),
      edges: Object.freeze(edges.map((edge, index) => normalizeEdge(edge, `edges[${index}]`))),
      viewport: normalizeViewport(viewport)
    });
  }

  function normalizeGraph(graph) {
    if (!isPlainObject(graph)) throw new TypeError('graph must be an object.');
    if (graph.format !== FORMAT) throw new TypeError(`graph.format must be "${FORMAT}".`);
    if (!Number.isInteger(graph.coreSchemaVersion) || graph.coreSchemaVersion < 1) throw new TypeError('graph.coreSchemaVersion must be a positive integer.');
    if (!Array.isArray(graph.nodes)) throw new TypeError('graph.nodes must be an array.');
    if (!Array.isArray(graph.edges)) throw new TypeError('graph.edges must be an array.');
    return Object.freeze({
      format: FORMAT,
      coreSchemaVersion: graph.coreSchemaVersion,
      app: normalizeApp(graph.app),
      nodes: Object.freeze(graph.nodes.map((node, index) => normalizeNode(node, `graph.nodes[${index}]`))),
      edges: Object.freeze(graph.edges.map((edge, index) => normalizeEdge(edge, `graph.edges[${index}]`))),
      viewport: normalizeViewport(graph.viewport, 'graph.viewport')
    });
  }

  function createId(prefix = 'item', usedIds = null) {
    const safePrefix = assertString(prefix, 'prefix').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
    const used = usedIds instanceof Set ? usedIds : new Set(Array.isArray(usedIds) ? usedIds : []);
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      let suffix;
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') suffix = globalThis.crypto.randomUUID();
      else { fallbackIdCounter += 1; suffix = `${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`; }
      const candidate = `${safePrefix}-${suffix}`;
      if (!used.has(candidate)) return candidate;
    }
    throw new Error('Unable to create a unique ID.');
  }

  function createNode({ id = createId('node'), type, definitionVersion = 1, position = { x: 0, y: 0 }, data = {}, disabled = false } = {}) {
    return normalizeNode({ id, type, definitionVersion, position, data, disabled });
  }

  function createEdge({ id = createId('edge'), source, target, data = {} } = {}) {
    return normalizeEdge({ id, source, target, data });
  }

  function normalizePort(port, label = 'port') {
    if (!isPlainObject(port)) throw new TypeError(`${label} must be an object.`);
    const direction = assertString(port.direction, `${label}.direction`);
    if (direction !== 'input' && direction !== 'output') throw new TypeError(`${label}.direction must be "input" or "output".`);
    const maxConnections = port.maxConnections == null ? null : port.maxConnections;
    if (maxConnections !== null && (!Number.isInteger(maxConnections) || maxConnections < 1)) throw new TypeError(`${label}.maxConnections must be null or a positive integer.`);
    return Object.freeze({
      id: assertString(port.id, `${label}.id`), direction,
      dataType: assertString(port.dataType ?? 'any', `${label}.dataType`),
      required: Boolean(port.required), maxConnections,
      data: clonePersistentValue(port.data ?? {}, `${label}.data`)
    });
  }

  class NodeRegistry {
    #definitions = new Map();
    register(definition) {
      if (!isPlainObject(definition)) throw new TypeError('Node definition must be an object.');
      const type = assertString(definition.type, 'definition.type');
      if (this.#definitions.has(type)) throw new Error(`Node type is already registered: ${type}`);
      const normalized = Object.freeze({
        type,
        titleKey: assertString(definition.titleKey ?? type, 'definition.titleKey'),
        category: assertString(definition.category ?? 'general', 'definition.category'),
        definitionVersion: assertPositiveInteger(definition.definitionVersion ?? 1, 'definition.definitionVersion'),
        createDefaultData: typeof definition.createDefaultData === 'function' ? definition.createDefaultData : () => ({}),
        getPorts: typeof definition.getPorts === 'function' ? definition.getPorts : () => [],
        validate: typeof definition.validate === 'function' ? definition.validate : null,
        migrateData: typeof definition.migrateData === 'function' ? definition.migrateData : null
      });
      this.#definitions.set(type, normalized);
      return normalized;
    }
    unregister(type) { return this.#definitions.delete(type); }
    has(type) { return this.#definitions.has(type); }
    get(type) { return this.#definitions.get(type) ?? null; }
    require(type) { const definition = this.get(type); if (!definition) throw new Error(`Unknown node type: ${type}`); return definition; }
    list() { return Object.freeze(Array.from(this.#definitions.values())); }
    create(type, options = {}) {
      const definition = this.require(type);
      const defaults = clonePersistentValue(definition.createDefaultData(), `definition(${type}).defaultData`);
      const suppliedData = options.data == null ? {} : clonePersistentValue(options.data, `node(${type}).data`);
      if (!isPlainObject(defaults) || !isPlainObject(suppliedData)) throw new TypeError('Node default data and supplied data must be objects.');
      return createNode({ id: options.id ?? createId('node'), type, definitionVersion: definition.definitionVersion, position: options.position ?? { x: 0, y: 0 }, data: { ...defaults, ...suppliedData }, disabled: options.disabled ?? false });
    }
    resolvePorts(node) {
      const normalizedNode = normalizeNode(node);
      const definition = this.require(normalizedNode.type);
      const ports = definition.getPorts(normalizedNode);
      if (!Array.isArray(ports)) throw new TypeError(`Node definition ${normalizedNode.type} getPorts() must return an array.`);
      const seen = new Set();
      return Object.freeze(ports.map((port, index) => {
        const normalized = normalizePort(port, `${normalizedNode.type}.ports[${index}]`);
        if (seen.has(normalized.id)) throw new Error(`Duplicate port ID on node type ${normalizedNode.type}: ${normalized.id}`);
        seen.add(normalized.id); return normalized;
      }));
    }
    validateNode(node, graph) {
      const normalizedNode = normalizeNode(node); const definition = this.require(normalizedNode.type);
      if (!definition.validate) return Object.freeze([]);
      const result = definition.validate(normalizedNode, graph);
      if (!Array.isArray(result)) throw new TypeError(`Node definition ${normalizedNode.type} validate() must return an array.`);
      return Object.freeze(result.map((entry, index) => clonePersistentValue(entry, `validation[${index}]`)));
    }
    migrateNode(node, graph = null) {
      let current = normalizeNode(node); const definition = this.require(current.type);
      if (current.definitionVersion > definition.definitionVersion) throw new Error(`Node ${current.id} definition version ${current.definitionVersion} is newer than registered version ${definition.definitionVersion}.`);
      while (current.definitionVersion < definition.definitionVersion) {
        if (!definition.migrateData) throw new Error(`Missing node migration for ${current.type} from definition version ${current.definitionVersion}.`);
        const nextVersion = current.definitionVersion + 1;
        const nextData = definition.migrateData(Object.freeze({ fromVersion: current.definitionVersion, toVersion: nextVersion, data: clonePersistentValue(current.data, `${current.type}.migrationData`), node: current, graph }));
        if (!isPlainObject(nextData)) throw new TypeError(`Node migration for ${current.type} must return a data object.`);
        current = createNode({ ...current, definitionVersion: nextVersion, data: nextData });
      }
      return current;
    }
    migrateGraph(graphInput) {
      const graph = normalizeGraph(graphInput);
      const nodes = graph.nodes.map(node => this.has(node.type) ? this.migrateNode(node, graph) : node);
      return Object.freeze({ ...graph, nodes: Object.freeze(nodes) });
    }
  }

  function getNode(graph, nodeId) { return graph.nodes.find(node => node.id === nodeId) ?? null; }
  function getEdge(graph, edgeId) { return graph.edges.find(edge => edge.id === edgeId) ?? null; }
  function getIncomingEdges(graph, nodeId) { return graph.edges.filter(edge => edge.target.nodeId === nodeId); }
  function getOutgoingEdges(graph, nodeId) { return graph.edges.filter(edge => edge.source.nodeId === nodeId); }
  function getIncidentEdges(graph, nodeId) { return graph.edges.filter(edge => edge.source.nodeId === nodeId || edge.target.nodeId === nodeId); }
  function getUpstreamNodeIds(graph, nodeId) { return Object.freeze(Array.from(new Set(getIncomingEdges(graph, nodeId).map(edge => edge.source.nodeId)))); }
  function getDownstreamNodeIds(graph, nodeId) { return Object.freeze(Array.from(new Set(getOutgoingEdges(graph, nodeId).map(edge => edge.target.nodeId)))); }

  function getPort(registry, node, portId, direction = null) {
    if (!(registry instanceof NodeRegistry)) throw new TypeError('registry must be a NodeRegistry.');
    const normalizedNode = normalizeNode(node);
    const id = assertString(portId, 'portId');
    const port = registry.resolvePorts(normalizedNode).find(item => item.id === id) ?? null;
    if (!port) return null;
    if (direction != null && port.direction !== direction) return null;
    return port;
  }

  function arePortTypesCompatible(sourcePort, targetPort) {
    const sourceType = sourcePort?.dataType ?? 'any';
    const targetType = targetPort?.dataType ?? 'any';
    return sourceType === 'any' || targetType === 'any' || sourceType === targetType;
  }

  function topologicalSort(graphInput, { ignoreEdgeIds = [] } = {}) {
    const graph = normalizeGraph(graphInput);
    const ignored = new Set(ignoreEdgeIds);
    const indegree = new Map(graph.nodes.map(node => [node.id, 0]));
    const adjacency = new Map(graph.nodes.map(node => [node.id, []]));
    for (const edge of graph.edges) {
      if (ignored.has(edge.id) || !indegree.has(edge.source.nodeId) || !indegree.has(edge.target.nodeId)) continue;
      indegree.set(edge.target.nodeId, indegree.get(edge.target.nodeId) + 1);
      adjacency.get(edge.source.nodeId).push(edge.target.nodeId);
    }
    const queue = graph.nodes.map(node => node.id).filter(id => indegree.get(id) === 0);
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const next of adjacency.get(id) ?? []) {
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) queue.push(next);
      }
    }
    return Object.freeze({ order: Object.freeze(order), hasCycle: order.length !== graph.nodes.length });
  }

  function hasDirectedCycle(graphInput, options = {}) { return topologicalSort(graphInput, options).hasCycle; }

  function connectionResult(valid, code, messageKey, extra = {}) {
    return Object.freeze({ valid: Boolean(valid), code, messageKey, ...extra, edgesToReplace: Object.freeze([...(extra.edgesToReplace ?? [])]) });
  }

  function validateConnection(graphInput, {
    source,
    target,
    registry,
    allowSelfConnections = false,
    allowCycles = false,
    replaceExisting = false,
    isCompatible = null,
    ignoreEdgeId = null,
    validate = null
  } = {}) {
    if (!(registry instanceof NodeRegistry)) throw new TypeError('validateConnection requires a NodeRegistry.');
    const graph = normalizeGraph(graphInput);
    const sourceEndpoint = normalizeEndpoint(source, 'source');
    const targetEndpoint = normalizeEndpoint(target, 'target');
    const sourceNode = getNode(graph, sourceEndpoint.nodeId);
    const targetNode = getNode(graph, targetEndpoint.nodeId);
    if (!sourceNode) return connectionResult(false, 'MISSING_SOURCE_NODE', 'connection.missingSourceNode', { source: sourceEndpoint, target: targetEndpoint });
    if (!targetNode) return connectionResult(false, 'MISSING_TARGET_NODE', 'connection.missingTargetNode', { source: sourceEndpoint, target: targetEndpoint });
    const sourcePortAny = registry.resolvePorts(sourceNode).find(port => port.id === sourceEndpoint.portId) ?? null;
    const targetPortAny = registry.resolvePorts(targetNode).find(port => port.id === targetEndpoint.portId) ?? null;
    if (!sourcePortAny) return connectionResult(false, 'MISSING_SOURCE_PORT', 'connection.missingSourcePort', { source: sourceEndpoint, target: targetEndpoint });
    if (!targetPortAny) return connectionResult(false, 'MISSING_TARGET_PORT', 'connection.missingTargetPort', { source: sourceEndpoint, target: targetEndpoint });
    if (sourcePortAny.direction !== 'output') return connectionResult(false, 'INVALID_SOURCE_DIRECTION', 'connection.invalidSourceDirection', { source: sourceEndpoint, target: targetEndpoint, sourcePort: sourcePortAny, targetPort: targetPortAny });
    if (targetPortAny.direction !== 'input') return connectionResult(false, 'INVALID_TARGET_DIRECTION', 'connection.invalidTargetDirection', { source: sourceEndpoint, target: targetEndpoint, sourcePort: sourcePortAny, targetPort: targetPortAny });
    if (!allowSelfConnections && sourceEndpoint.nodeId === targetEndpoint.nodeId) return connectionResult(false, 'SELF_CONNECTION', 'connection.selfConnection', { source: sourceEndpoint, target: targetEndpoint, sourcePort: sourcePortAny, targetPort: targetPortAny });
    const compatibility = typeof isCompatible === 'function' ? Boolean(isCompatible(sourcePortAny, targetPortAny, { graph, sourceNode, targetNode })) : arePortTypesCompatible(sourcePortAny, targetPortAny);
    if (!compatibility) return connectionResult(false, 'TYPE_MISMATCH', 'connection.typeMismatch', { source: sourceEndpoint, target: targetEndpoint, sourcePort: sourcePortAny, targetPort: targetPortAny });

    const existing = graph.edges.filter(edge => edge.id !== ignoreEdgeId);
    const duplicate = existing.find(edge => edge.source.nodeId === sourceEndpoint.nodeId && edge.source.portId === sourceEndpoint.portId && edge.target.nodeId === targetEndpoint.nodeId && edge.target.portId === targetEndpoint.portId);
    if (duplicate) return connectionResult(false, 'DUPLICATE_CONNECTION', 'connection.duplicate', { source: sourceEndpoint, target: targetEndpoint, sourcePort: sourcePortAny, targetPort: targetPortAny });

    const sourceEdges = existing.filter(edge => edge.source.nodeId === sourceEndpoint.nodeId && edge.source.portId === sourceEndpoint.portId);
    const targetEdges = existing.filter(edge => edge.target.nodeId === targetEndpoint.nodeId && edge.target.portId === targetEndpoint.portId);
    const replaceIds = new Set();
    const enforceLimit = (port, edges, code, messageKey) => {
      if (port.maxConnections == null) return null;
      const excess = edges.length + 1 - port.maxConnections;
      if (excess <= 0) return null;
      if (!replaceExisting) return connectionResult(false, code, messageKey, { source: sourceEndpoint, target: targetEndpoint, sourcePort: sourcePortAny, targetPort: targetPortAny });
      edges.slice(0, excess).forEach(edge => replaceIds.add(edge.id));
      return null;
    };
    const sourceLimit = enforceLimit(sourcePortAny, sourceEdges, 'SOURCE_CONNECTION_LIMIT', 'connection.sourceLimit');
    if (sourceLimit) return sourceLimit;
    const targetLimit = enforceLimit(targetPortAny, targetEdges, 'TARGET_CONNECTION_LIMIT', 'connection.targetLimit');
    if (targetLimit) return targetLimit;

    const candidateEdges = existing.filter(edge => !replaceIds.has(edge.id));
    candidateEdges.push(createEdge({ id: '__connection-preview__', source: sourceEndpoint, target: targetEndpoint }));
    const candidateGraph = Object.freeze({ ...graph, edges: Object.freeze(candidateEdges) });
    if (!allowCycles && hasDirectedCycle(candidateGraph)) return connectionResult(false, 'CYCLE', 'connection.cycle', { source: sourceEndpoint, target: targetEndpoint, sourcePort: sourcePortAny, targetPort: targetPortAny, edgesToReplace: Array.from(replaceIds) });

    if (typeof validate === 'function') {
      const consumer = validate({ graph, candidateGraph, source: sourceEndpoint, target: targetEndpoint, sourceNode, targetNode, sourcePort: sourcePortAny, targetPort: targetPortAny, edgesToReplace: Object.freeze(Array.from(replaceIds)), ignoreEdgeId });
      if (consumer === false) return connectionResult(false, 'CONSUMER_REJECTED', 'connection.consumerRejected', { source: sourceEndpoint, target: targetEndpoint, sourcePort: sourcePortAny, targetPort: targetPortAny, edgesToReplace: Array.from(replaceIds) });
      if (isPlainObject(consumer) && consumer.valid === false) return connectionResult(false, consumer.code ?? 'CONSUMER_REJECTED', consumer.messageKey ?? 'connection.consumerRejected', { source: sourceEndpoint, target: targetEndpoint, sourcePort: sourcePortAny, targetPort: targetPortAny, edgesToReplace: Array.from(replaceIds), ...consumer });
    }

    return connectionResult(true, 'OK', 'connection.ok', { source: sourceEndpoint, target: targetEndpoint, sourcePort: sourcePortAny, targetPort: targetPortAny, edgesToReplace: Array.from(replaceIds), candidateGraph });
  }

  function replaceNode(graph, nodeId, updater) {
    let found = false;
    const nodes = graph.nodes.map(node => { if (node.id !== nodeId) return node; found = true; return normalizeNode(updater(node)); });
    if (!found) throw new Error(`Node not found: ${nodeId}`);
    return Object.freeze({ ...graph, nodes: Object.freeze(nodes) });
  }
  function replaceEdge(graph, edgeId, updater) {
    let found = false;
    const edges = graph.edges.map(edge => { if (edge.id !== edgeId) return edge; found = true; return normalizeEdge(updater(edge)); });
    if (!found) throw new Error(`Edge not found: ${edgeId}`);
    return Object.freeze({ ...graph, edges: Object.freeze(edges) });
  }
  function mergePersistentObject(current, patch, label) {
    const safePatch = clonePersistentValue(patch, label);
    if (!isPlainObject(safePatch)) throw new TypeError(`${label} must be an object.`);
    return { ...current, ...safePatch };
  }

  function applyChange(graphInput, change) {
    const graph = normalizeGraph(graphInput);
    if (!isPlainObject(change)) throw new TypeError('change must be an object.');
    const type = assertString(change.type, 'change.type');
    if (!CHANGE_TYPE_SET.has(type)) throw new Error(`Unsupported change type: ${type}`);
    switch (type) {
      case 'node.add': {
        const node = normalizeNode(change.node, 'change.node'); if (getNode(graph, node.id)) throw new Error(`Node ID already exists: ${node.id}`);
        return Object.freeze({ ...graph, nodes: Object.freeze([...graph.nodes, node]) });
      }
      case 'node.remove': {
        const nodeId = assertString(change.nodeId, 'change.nodeId'); if (!getNode(graph, nodeId)) throw new Error(`Node not found: ${nodeId}`);
        return Object.freeze({ ...graph, nodes: Object.freeze(graph.nodes.filter(node => node.id !== nodeId)), edges: Object.freeze(graph.edges.filter(edge => edge.source.nodeId !== nodeId && edge.target.nodeId !== nodeId)) });
      }
      case 'node.position': {
        const nodeId = assertString(change.nodeId, 'change.nodeId'); const position = normalizePosition(change.position, 'change.position');
        return replaceNode(graph, nodeId, node => ({ ...node, position }));
      }
      case 'node.data': return replaceNode(graph, assertString(change.nodeId, 'change.nodeId'), node => ({ ...node, data: mergePersistentObject(node.data, change.data ?? {}, 'change.data') }));
      case 'node.disable': {
        const nodeId = assertString(change.nodeId, 'change.nodeId'); if (typeof change.disabled !== 'boolean') throw new TypeError('change.disabled must be boolean.');
        return replaceNode(graph, nodeId, node => ({ ...node, disabled: change.disabled }));
      }
      case 'edge.add': {
        const edge = normalizeEdge(change.edge, 'change.edge'); if (getEdge(graph, edge.id)) throw new Error(`Edge ID already exists: ${edge.id}`);
        return Object.freeze({ ...graph, edges: Object.freeze([...graph.edges, edge]) });
      }
      case 'edge.remove': {
        const edgeId = assertString(change.edgeId, 'change.edgeId'); if (!getEdge(graph, edgeId)) throw new Error(`Edge not found: ${edgeId}`);
        return Object.freeze({ ...graph, edges: Object.freeze(graph.edges.filter(edge => edge.id !== edgeId)) });
      }
      case 'edge.reconnect': {
        const edgeId = assertString(change.edgeId, 'change.edgeId');
        return replaceEdge(graph, edgeId, edge => ({ ...edge, source: change.source ? normalizeEndpoint(change.source, 'change.source') : edge.source, target: change.target ? normalizeEndpoint(change.target, 'change.target') : edge.target }));
      }
      case 'edge.data': return replaceEdge(graph, assertString(change.edgeId, 'change.edgeId'), edge => ({ ...edge, data: mergePersistentObject(edge.data, change.data ?? {}, 'change.data') }));
      case 'graph.viewport': return Object.freeze({ ...graph, viewport: normalizeViewport(change.viewport, 'change.viewport') });
      default: throw new Error(`Unsupported change type: ${type}`);
    }
  }

  function applyChanges(graph, changes) {
    if (!Array.isArray(changes)) throw new TypeError('changes must be an array.');
    return changes.reduce((current, change) => applyChange(current, change), graph);
  }

  function graphContentSignature(graphInput) {
    const graph = normalizeGraph(graphInput);
    return JSON.stringify({
      format: graph.format,
      coreSchemaVersion: graph.coreSchemaVersion,
      app: graph.app,
      nodes: graph.nodes,
      edges: graph.edges
    });
  }

  function createGraphFragment(graphInput, nodeIds) {
    const graph = normalizeGraph(graphInput);
    const ids = new Set((Array.isArray(nodeIds) ? nodeIds : [nodeIds]).filter(Boolean).map(id => assertString(id, 'nodeId')));
    const nodes = graph.nodes.filter(node => ids.has(node.id)).map(node => normalizeNode(node));
    const nodeIdSet = new Set(nodes.map(node => node.id));
    const edges = graph.edges.filter(edge => nodeIdSet.has(edge.source.nodeId) && nodeIdSet.has(edge.target.nodeId)).map(edge => normalizeEdge(edge));
    return Object.freeze({
      format: `${FORMAT}-fragment`,
      version: 1,
      appId: graph.app.id,
      nodes: Object.freeze(nodes),
      edges: Object.freeze(edges)
    });
  }

  function pasteGraphFragment(graphInput, fragmentInput, { offset = { x: 24, y: 24 }, at = null } = {}) {
    const graph = normalizeGraph(graphInput);
    if (!isPlainObject(fragmentInput) || fragmentInput.format !== `${FORMAT}-fragment` || fragmentInput.version !== 1) throw new TypeError('Invalid Node Editor Core graph fragment.');
    if (!Array.isArray(fragmentInput.nodes) || !Array.isArray(fragmentInput.edges)) throw new TypeError('Graph fragment nodes and edges must be arrays.');
    const nodes = fragmentInput.nodes.map((node, index) => normalizeNode(node, `fragment.nodes[${index}]`));
    const edges = fragmentInput.edges.map((edge, index) => normalizeEdge(edge, `fragment.edges[${index}]`));
    if (!nodes.length) return Object.freeze({ graph, nodeIds: Object.freeze([]), edgeIds: Object.freeze([]), nodeIdMap: Object.freeze({}), edgeIdMap: Object.freeze({}) });

    const dx = assertFiniteNumber(offset?.x ?? 24, 'offset.x');
    const dy = assertFiniteNumber(offset?.y ?? 24, 'offset.y');
    let translateX = dx, translateY = dy;
    if (at != null) {
      if (!isPlainObject(at)) throw new TypeError('at must be an object.');
      const minX = Math.min(...nodes.map(node => node.position.x));
      const minY = Math.min(...nodes.map(node => node.position.y));
      translateX = assertFiniteNumber(at.x, 'at.x') - minX;
      translateY = assertFiniteNumber(at.y, 'at.y') - minY;
    }

    const usedNodeIds = new Set(graph.nodes.map(node => node.id));
    const usedEdgeIds = new Set(graph.edges.map(edge => edge.id));
    const nodeIdMap = {};
    const edgeIdMap = {};
    const pastedNodes = nodes.map(node => {
      const id = createId('node', usedNodeIds);
      usedNodeIds.add(id); nodeIdMap[node.id] = id;
      return createNode({
        id, type: node.type, definitionVersion: node.definitionVersion,
        position: { x: node.position.x + translateX, y: node.position.y + translateY },
        data: node.data, disabled: node.disabled
      });
    });
    const pastedEdges = edges.map(edge => {
      const sourceNodeId = nodeIdMap[edge.source.nodeId];
      const targetNodeId = nodeIdMap[edge.target.nodeId];
      if (!sourceNodeId || !targetNodeId) return null;
      const id = createId('edge', usedEdgeIds);
      usedEdgeIds.add(id); edgeIdMap[edge.id] = id;
      return createEdge({ id, source: { nodeId: sourceNodeId, portId: edge.source.portId }, target: { nodeId: targetNodeId, portId: edge.target.portId }, data: edge.data });
    }).filter(Boolean);
    const next = Object.freeze({ ...graph, nodes: Object.freeze([...graph.nodes, ...pastedNodes]), edges: Object.freeze([...graph.edges, ...pastedEdges]) });
    return Object.freeze({ graph: next, nodeIds: Object.freeze(pastedNodes.map(node => node.id)), edgeIds: Object.freeze(pastedEdges.map(edge => edge.id)), nodeIdMap: Object.freeze({ ...nodeIdMap }), edgeIdMap: Object.freeze({ ...edgeIdMap }) });
  }

  function issue(code, path, message) { return Object.freeze({ code, path, message }); }
  function validateGraph(graphInput, { registry = null } = {}) {
    const issues = [];
    if (!isPlainObject(graphInput)) return Object.freeze([issue('INVALID_GRAPH', '', 'Graph must be an object.')]);
    if (graphInput.format !== FORMAT) issues.push(issue('INVALID_FORMAT', 'format', `Expected ${FORMAT}.`));
    if (!Number.isInteger(graphInput.coreSchemaVersion) || graphInput.coreSchemaVersion < 1) issues.push(issue('INVALID_CORE_SCHEMA_VERSION', 'coreSchemaVersion', 'Core schema version must be a positive integer.'));
    if (!isPlainObject(graphInput.app)) issues.push(issue('INVALID_APP', 'app', 'App metadata must be an object.'));
    else {
      if (typeof graphInput.app.id !== 'string' || graphInput.app.id.trim() === '') issues.push(issue('INVALID_APP_ID', 'app.id', 'App ID is required.'));
      if (!Number.isInteger(graphInput.app.schemaVersion) || graphInput.app.schemaVersion < 1) issues.push(issue('INVALID_APP_SCHEMA_VERSION', 'app.schemaVersion', 'App schema version must be a positive integer.'));
    }
    const nodes = Array.isArray(graphInput.nodes) ? graphInput.nodes : null;
    const edges = Array.isArray(graphInput.edges) ? graphInput.edges : null;
    if (!nodes) issues.push(issue('INVALID_NODES', 'nodes', 'Nodes must be an array.'));
    if (!edges) issues.push(issue('INVALID_EDGES', 'edges', 'Edges must be an array.'));
    const nodeIds = new Set();
    if (nodes) nodes.forEach((node, index) => {
      const path = `nodes[${index}]`;
      try {
        const normalized = normalizeNode(node, path);
        if (nodeIds.has(normalized.id)) issues.push(issue('DUPLICATE_NODE_ID', `${path}.id`, `Duplicate node ID: ${normalized.id}`));
        nodeIds.add(normalized.id);
        if (registry instanceof NodeRegistry) {
          if (!registry.has(normalized.type)) issues.push(issue('UNKNOWN_NODE_TYPE', `${path}.type`, `Unknown node type: ${normalized.type}`));
          else {
            try { registry.resolvePorts(normalized); } catch (error) { issues.push(issue('INVALID_PORTS', path, error.message)); }
            try { for (const consumerIssue of registry.validateNode(normalized, graphInput)) issues.push(Object.freeze({ code: consumerIssue.code ?? 'NODE_VALIDATION', path: consumerIssue.path ?? path, message: consumerIssue.message ?? 'Node validation failed.', ...consumerIssue })); }
            catch (error) { issues.push(issue('NODE_VALIDATOR_ERROR', path, error.message)); }
          }
        }
      } catch (error) { issues.push(issue('INVALID_NODE', path, error.message)); }
    });
    const edgeIds = new Set();
    if (edges) edges.forEach((edge, index) => {
      const path = `edges[${index}]`;
      try {
        const normalized = normalizeEdge(edge, path);
        if (edgeIds.has(normalized.id)) issues.push(issue('DUPLICATE_EDGE_ID', `${path}.id`, `Duplicate edge ID: ${normalized.id}`));
        edgeIds.add(normalized.id);
        if (!nodeIds.has(normalized.source.nodeId)) issues.push(issue('DANGLING_SOURCE_NODE', `${path}.source.nodeId`, `Source node does not exist: ${normalized.source.nodeId}`));
        if (!nodeIds.has(normalized.target.nodeId)) issues.push(issue('DANGLING_TARGET_NODE', `${path}.target.nodeId`, `Target node does not exist: ${normalized.target.nodeId}`));
        if (registry instanceof NodeRegistry) {
          const sourceNode = nodes?.find(node => node?.id === normalized.source.nodeId);
          const targetNode = nodes?.find(node => node?.id === normalized.target.nodeId);
          let sourcePort = null, targetPort = null;
          if (sourceNode && registry.has(sourceNode.type)) {
            try {
              sourcePort = registry.resolvePorts(sourceNode).find(port => port.id === normalized.source.portId) ?? null;
              if (!sourcePort) issues.push(issue('MISSING_SOURCE_PORT', `${path}.source.portId`, `Source port does not exist: ${normalized.source.portId}`));
              else if (sourcePort.direction !== 'output') issues.push(issue('INVALID_SOURCE_DIRECTION', `${path}.source.portId`, `Source port must be an output: ${normalized.source.portId}`));
            } catch {}
          }
          if (targetNode && registry.has(targetNode.type)) {
            try {
              targetPort = registry.resolvePorts(targetNode).find(port => port.id === normalized.target.portId) ?? null;
              if (!targetPort) issues.push(issue('MISSING_TARGET_PORT', `${path}.target.portId`, `Target port does not exist: ${normalized.target.portId}`));
              else if (targetPort.direction !== 'input') issues.push(issue('INVALID_TARGET_DIRECTION', `${path}.target.portId`, `Target port must be an input: ${normalized.target.portId}`));
            } catch {}
          }
          if (sourcePort && targetPort && sourcePort.direction === 'output' && targetPort.direction === 'input' && !arePortTypesCompatible(sourcePort, targetPort)) issues.push(issue('TYPE_MISMATCH', path, `Port types are incompatible: ${sourcePort.dataType} → ${targetPort.dataType}`));
        }
      } catch (error) { issues.push(issue('INVALID_EDGE', path, error.message)); }
    });
    if (nodes && edges && registry instanceof NodeRegistry) {
      for (const node of nodes) {
        if (!node || !registry.has(node.type)) continue;
        try {
          for (const port of registry.resolvePorts(node)) {
            const count = port.direction === 'output'
              ? edges.filter(edge => edge?.source?.nodeId === node.id && edge?.source?.portId === port.id).length
              : edges.filter(edge => edge?.target?.nodeId === node.id && edge?.target?.portId === port.id).length;
            if (port.required && count === 0) issues.push(issue(port.direction === 'output' ? 'REQUIRED_SOURCE_PORT' : 'REQUIRED_TARGET_PORT', `nodes.${node.id}.ports.${port.id}`, `Required ${port.direction} port is not connected: ${port.id}`));
            if (port.maxConnections != null && count > port.maxConnections) issues.push(issue(port.direction === 'output' ? 'SOURCE_CONNECTION_LIMIT' : 'TARGET_CONNECTION_LIMIT', `nodes.${node.id}.ports.${port.id}`, `Port ${port.id} allows at most ${port.maxConnections} connection(s).`));
          }
        } catch {}
      }
    }
    if (nodes && edges) {
      try {
        const cycleGraph = normalizeGraph(graphInput);
        if (hasDirectedCycle(cycleGraph)) issues.push(issue('CYCLE', 'edges', 'Graph contains a directed cycle.'));
      } catch {}
    }
    try { normalizeViewport(graphInput.viewport, 'viewport'); } catch (error) { issues.push(issue('INVALID_VIEWPORT', 'viewport', error.message)); }
    return Object.freeze(issues);
  }

  function assertValidGraph(graph, options = {}) {
    const issues = validateGraph(graph, options);
    if (issues.length) { const error = new Error(`Graph validation failed with ${issues.length} issue(s).`); error.name = 'GraphValidationError'; error.issues = issues; throw error; }
    return true;
  }


  const RUNTIME_STATUSES = Object.freeze(['idle', 'ready', 'running', 'success', 'warning', 'error', 'disabled']);
  const RUNTIME_STATUS_SET = new Set(RUNTIME_STATUSES);

  function normalizeRuntimeStatus(status, label = 'status') {
    const value = assertString(status, label);
    if (!RUNTIME_STATUS_SET.has(value)) throw new TypeError(`${label} must be one of: ${RUNTIME_STATUSES.join(', ')}.`);
    return value;
  }

  class GraphHistory {
    constructor({ limit = 100, preserveViewport = true } = {}) {
      if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer.');
      this.limit = limit;
      this.preserveViewport = preserveViewport !== false;
      this.past = [];
      this.future = [];
    }
    _entry(graph, metadata = {}) {
      return Object.freeze({ graph: cloneGraph(graph), metadata: clonePersistentValue(metadata ?? {}, 'history.metadata') });
    }
    capture(graph, { metadata = {} } = {}) {
      this.past.push(this._entry(graph, metadata));
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
      return this.getState();
    }
    undo(currentGraph, { metadata = {} } = {}) {
      if (!this.past.length) return null;
      const current = normalizeGraph(currentGraph);
      this.future.push(this._entry(current, metadata));
      const previous = this.past.pop();
      let graph = previous.graph;
      if (this.preserveViewport) graph = Object.freeze({ ...graph, viewport: current.viewport });
      return Object.freeze({ graph, metadata: previous.metadata, state: this.getState() });
    }
    redo(currentGraph, { metadata = {} } = {}) {
      if (!this.future.length) return null;
      const current = normalizeGraph(currentGraph);
      this.past.push(this._entry(current, metadata));
      if (this.past.length > this.limit) this.past.shift();
      const next = this.future.pop();
      let graph = next.graph;
      if (this.preserveViewport) graph = Object.freeze({ ...graph, viewport: current.viewport });
      return Object.freeze({ graph, metadata: next.metadata, state: this.getState() });
    }
    clear() { this.past = []; this.future = []; return this.getState(); }
    getState() { return Object.freeze({ canUndo: this.past.length > 0, canRedo: this.future.length > 0, past: this.past.length, future: this.future.length }); }
  }

  class RuntimeStatusStore {
    #items = new Map();
    #listeners = new Set();
    get(nodeId) { return this.#items.get(assertString(nodeId, 'nodeId')) ?? Object.freeze({ status: 'idle', detail: Object.freeze({}) }); }
    has(nodeId) { return this.#items.has(assertString(nodeId, 'nodeId')); }
    set(nodeId, status, detail = {}) {
      const id = assertString(nodeId, 'nodeId');
      const entry = Object.freeze({ status: normalizeRuntimeStatus(status), detail: Object.freeze(clonePersistentValue(detail ?? {}, 'runtimeStatus.detail')) });
      this.#items.set(id, entry); this.#emit(id, entry); return entry;
    }
    clear(nodeId) { const id = assertString(nodeId, 'nodeId'); const changed = this.#items.delete(id); if (changed) this.#emit(id, Object.freeze({ status: 'idle', detail: Object.freeze({}) })); return changed; }
    clearAll() { if (!this.#items.size) return; const ids = [...this.#items.keys()]; this.#items.clear(); for (const id of ids) this.#emit(id, Object.freeze({ status: 'idle', detail: Object.freeze({}) })); }
    snapshot() { return Object.freeze(Object.fromEntries([...this.#items.entries()].map(([id, entry]) => [id, Object.freeze({ status: entry.status, detail: Object.freeze(clonePersistentValue(entry.detail, 'runtimeStatus.detail')) })]))); }
    subscribe(listener) { if (typeof listener !== 'function') throw new TypeError('RuntimeStatusStore listener must be a function.'); this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
    #emit(nodeId, entry) { for (const listener of [...this.#listeners]) listener(nodeId, entry, this); }
  }

  function normalizeTheme(theme = {}) {
    if (!isPlainObject(theme)) throw new TypeError('theme must be an object.');
    const result = {};
    for (const [key, value] of Object.entries(theme)) {
      const name = String(key).trim().replace(/^--nec-/, '').replace(/[^A-Za-z0-9_-]/g, '-');
      if (!name) throw new TypeError('Theme keys must contain at least one valid character.');
      if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`Theme value for ${key} must be a string or number.`);
      result[`--nec-${name}`] = String(value);
    }
    return Object.freeze(result);
  }

  function applyTheme(target, theme = {}) {
    if (!target?.style || typeof target.style.setProperty !== 'function') throw new TypeError('applyTheme requires an element-like target with style.setProperty().');
    const normalized = normalizeTheme(theme);
    for (const [name, value] of Object.entries(normalized)) target.style.setProperty(name, value);
    return normalized;
  }

  class Translator {
    constructor({ locale = 'en', fallbackLocale = 'en', messages = {} } = {}) {
      this.messages = new Map(); this.fallbackLocale = assertString(fallbackLocale, 'fallbackLocale'); this.locale = assertString(locale, 'locale');
      if (!isPlainObject(messages)) throw new TypeError('messages must be an object keyed by locale.');
      for (const [language, catalog] of Object.entries(messages)) this.addMessages(language, catalog);
    }
    addMessages(locale, catalog) {
      const language = assertString(locale, 'locale'); if (!isPlainObject(catalog)) throw new TypeError(`messages.${language} must be an object.`);
      const current = this.messages.get(language) ?? {}; this.messages.set(language, Object.freeze({ ...current, ...clonePersistentValue(catalog, `messages.${language}`) })); return this;
    }
    setLocale(locale) { this.locale = assertString(locale, 'locale'); return this.locale; }
    getLocale() { return this.locale; }
    has(key, locale = this.locale) { return Object.prototype.hasOwnProperty.call(this.messages.get(locale) ?? {}, key); }
    t(key, params = {}, { locale = this.locale, fallbackLocale = this.fallbackLocale } = {}) {
      const id = assertString(key, 'translation key');
      const primary = this.messages.get(locale) ?? {}, fallback = this.messages.get(fallbackLocale) ?? {};
      let value = Object.prototype.hasOwnProperty.call(primary, id) ? primary[id] : fallback[id];
      if (value == null) return id;
      value = String(value);
      if (!isPlainObject(params)) throw new TypeError('translation params must be an object.');
      return value.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, token) => Object.prototype.hasOwnProperty.call(params, token) ? String(params[token]) : match);
    }
  }

  function createValidationResult(graphInput, { registry = null } = {}) {
    const issues = validateGraph(graphInput, { registry });
    const nodes = Array.isArray(graphInput?.nodes) ? graphInput.nodes : [];
    const edges = Array.isArray(graphInput?.edges) ? graphInput.edges : [];
    const enriched = issues.map(raw => {
      let nodeId = raw.nodeId ?? null, edgeId = raw.edgeId ?? null;
      if (!nodeId) {
        const nodeIndex = String(raw.path ?? '').match(/^nodes\[(\d+)\]/);
        if (nodeIndex) nodeId = nodes[Number(nodeIndex[1])]?.id ?? null;
        const nodePath = String(raw.path ?? '').match(/^nodes\.([^\.]+)(?:\.|$)/);
        if (!nodeId && nodePath) nodeId = nodePath[1];
      }
      if (!edgeId) {
        const edgeIndex = String(raw.path ?? '').match(/^edges\[(\d+)\]/);
        if (edgeIndex) edgeId = edges[Number(edgeIndex[1])]?.id ?? null;
      }
      return Object.freeze({ severity: raw.severity ?? 'error', ...raw, nodeId, edgeId });
    });
    const byNode = {}, byEdge = {};
    for (const item of enriched) {
      if (item.nodeId) (byNode[item.nodeId] ??= []).push(item);
      if (item.edgeId) (byEdge[item.edgeId] ??= []).push(item);
    }
    for (const key of Object.keys(byNode)) byNode[key] = Object.freeze(byNode[key]);
    for (const key of Object.keys(byEdge)) byEdge[key] = Object.freeze(byEdge[key]);
    return Object.freeze({ valid: enriched.length === 0, issues: Object.freeze(enriched), byNode: Object.freeze(byNode), byEdge: Object.freeze(byEdge), firstIssue: enriched[0] ?? null });
  }

  class LayoutRegistry {
    #layouts = new Map();
    register(name, adapter) { const id = assertString(name, 'layout name'); if (typeof adapter !== 'function') throw new TypeError('Layout adapter must be a function.'); if (this.#layouts.has(id)) throw new Error(`Layout is already registered: ${id}`); this.#layouts.set(id, adapter); return adapter; }
    unregister(name) { return this.#layouts.delete(name); }
    has(name) { return this.#layouts.has(name); }
    list() { return Object.freeze([...this.#layouts.keys()]); }
    async run(name, graphInput, options = {}) {
      const id = assertString(name, 'layout name'), adapter = this.#layouts.get(id); if (!adapter) throw new Error(`Unknown layout: ${id}`);
      const graph = normalizeGraph(graphInput); const result = await adapter(cloneGraph(graph), Object.freeze({ ...options }));
      return normalizeLayoutResult(graph, result);
    }
  }

  function normalizeLayoutResult(graphInput, result) {
    const graph = normalizeGraph(graphInput);
    const positions = result?.positions ?? result;
    if (!(positions instanceof Map) && !isPlainObject(positions)) throw new TypeError('Layout adapter must return positions as an object or Map.');
    const changes = [];
    for (const node of graph.nodes) {
      const raw = positions instanceof Map ? positions.get(node.id) : positions[node.id];
      if (raw == null) continue;
      changes.push(Object.freeze({ type: 'node.position', nodeId: node.id, position: normalizePosition(raw, `layout.${node.id}`) }));
    }
    return Object.freeze({ positions: Object.freeze(Object.fromEntries(changes.map(change => [change.nodeId, change.position]))), changes: Object.freeze(changes), graph: applyChanges(graph, changes) });
  }

  function createBenchmarkGraph({ nodeCount = 100, appId = 'node-editor-core-benchmark' } = {}) {
    const count = Math.max(1, Math.floor(assertFiniteNumber(Number(nodeCount), 'nodeCount')));
    const nodes = [], edges = [];
    for (let index = 0; index < count; index += 1) {
      nodes.push(createNode({ id: `bench-${index + 1}`, type: 'benchmark', position: { x: (index % 10) * 220, y: Math.floor(index / 10) * 120 }, data: { index } }));
      if (index > 0) edges.push(createEdge({ id: `bench-edge-${index}`, source: { nodeId: `bench-${index}`, portId: 'out' }, target: { nodeId: `bench-${index + 1}`, portId: 'in' } }));
    }
    return createGraph({ appId, nodes, edges });
  }

  function benchmarkGraphModel({ nodeCount = 100, iterations = 5, now = null } = {}) {
    const clock = typeof now === 'function' ? now : (() => globalThis.performance?.now?.() ?? Date.now());
    const runs = Math.max(1, Math.floor(assertFiniteNumber(Number(iterations), 'iterations')));
    const samples = [];
    for (let index = 0; index < runs; index += 1) {
      const graph = createBenchmarkGraph({ nodeCount });
      const start = clock();
      const json = serializeGraph(graph, { pretty: false });
      const restored = deserializeGraph(json);
      validateGraph(restored);
      const elapsedMs = Math.max(0, clock() - start);
      samples.push(elapsedMs);
    }
    const totalMs = samples.reduce((sum, value) => sum + value, 0);
    return Object.freeze({ nodeCount: Math.floor(Number(nodeCount)), edgeCount: Math.max(0, Math.floor(Number(nodeCount)) - 1), iterations: runs, samplesMs: Object.freeze(samples), totalMs, averageMs: totalMs / runs, maxMs: Math.max(...samples) });
  }

  class CoreMigrationRegistry {
    #migrations = new Map();
    register(fromVersion, migrate) {
      if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new TypeError('fromVersion must be a positive integer.');
      if (typeof migrate !== 'function') throw new TypeError('migrate must be a function.');
      if (this.#migrations.has(fromVersion)) throw new Error(`Migration is already registered for schema ${fromVersion} → ${fromVersion + 1}.`);
      this.#migrations.set(fromVersion, migrate); return this;
    }
    has(fromVersion) { return this.#migrations.has(fromVersion); }
    migrate(document, targetVersion = CORE_SCHEMA_VERSION) {
      if (!isPlainObject(document)) throw new TypeError('document must be an object.');
      if (!Number.isInteger(document.coreSchemaVersion) || document.coreSchemaVersion < 1) throw new TypeError('document.coreSchemaVersion must be a positive integer.');
      if (!Number.isInteger(targetVersion) || targetVersion < 1) throw new TypeError('targetVersion must be a positive integer.');
      if (document.coreSchemaVersion > targetVersion) throw new Error(`Cannot migrate schema ${document.coreSchemaVersion} backward to ${targetVersion}.`);
      let current = clonePersistentValue(document, 'document');
      while (current.coreSchemaVersion < targetVersion) {
        const fromVersion = current.coreSchemaVersion; const migrate = this.#migrations.get(fromVersion);
        if (!migrate) throw new Error(`Missing Core migration ${fromVersion} → ${fromVersion + 1}.`);
        const next = migrate(clonePersistentValue(current, 'migration.input'));
        if (!isPlainObject(next)) throw new TypeError(`Core migration ${fromVersion} → ${fromVersion + 1} must return an object.`);
        if (next.coreSchemaVersion !== fromVersion + 1) throw new Error(`Core migration ${fromVersion} → ${fromVersion + 1} must set coreSchemaVersion to ${fromVersion + 1}.`);
        current = clonePersistentValue(next, 'migration.output');
      }
      return current;
    }
  }


  function normalizePoint(point, label = 'point') {
    if (!isPlainObject(point)) throw new TypeError(`${label} must be an object.`);
    return Object.freeze({ x: assertFiniteNumber(point.x, `${label}.x`), y: assertFiniteNumber(point.y, `${label}.y`) });
  }

  function normalizeBounds(bounds, label = 'bounds') {
    if (!isPlainObject(bounds)) throw new TypeError(`${label} must be an object.`);
    const width = assertFiniteNumber(bounds.width, `${label}.width`);
    const height = assertFiniteNumber(bounds.height, `${label}.height`);
    if (width < 0 || height < 0) throw new RangeError(`${label}.width and ${label}.height must be zero or greater.`);
    return Object.freeze({ x: assertFiniteNumber(bounds.x, `${label}.x`), y: assertFiniteNumber(bounds.y, `${label}.y`), width, height });
  }

  function clampZoom(zoom, minZoom = 0.25, maxZoom = 2.5) {
    const value = assertFiniteNumber(zoom, 'zoom');
    const min = assertFiniteNumber(minZoom, 'minZoom');
    const max = assertFiniteNumber(maxZoom, 'maxZoom');
    if (min <= 0) throw new RangeError('minZoom must be greater than 0.');
    if (max < min) throw new RangeError('maxZoom must be greater than or equal to minZoom.');
    return Math.min(max, Math.max(min, value));
  }

  function screenToFlowPosition(point, viewport, origin = { x: 0, y: 0 }) {
    const screen = normalizePoint(point, 'point');
    const vp = normalizeViewport(viewport, 'viewport');
    const root = normalizePoint(origin, 'origin');
    return Object.freeze({ x: (screen.x - root.x - vp.x) / vp.zoom, y: (screen.y - root.y - vp.y) / vp.zoom });
  }

  function flowToScreenPosition(point, viewport, origin = { x: 0, y: 0 }) {
    const flow = normalizePoint(point, 'point');
    const vp = normalizeViewport(viewport, 'viewport');
    const root = normalizePoint(origin, 'origin');
    return Object.freeze({ x: root.x + vp.x + flow.x * vp.zoom, y: root.y + vp.y + flow.y * vp.zoom });
  }

  function calculateFitViewport({ bounds, width, height, padding = 40, minZoom = 0.25, maxZoom = 2.5 } = {}) {
    const box = normalizeBounds(bounds, 'bounds');
    const viewportWidth = assertFiniteNumber(width, 'width');
    const viewportHeight = assertFiniteNumber(height, 'height');
    const pad = assertFiniteNumber(padding, 'padding');
    if (viewportWidth <= 0 || viewportHeight <= 0) throw new RangeError('width and height must be greater than 0.');
    if (pad < 0) throw new RangeError('padding must be zero or greater.');
    const usableWidth = Math.max(1, viewportWidth - pad * 2);
    const usableHeight = Math.max(1, viewportHeight - pad * 2);
    const contentWidth = Math.max(1, box.width);
    const contentHeight = Math.max(1, box.height);
    const zoom = clampZoom(Math.min(usableWidth / contentWidth, usableHeight / contentHeight), minZoom, maxZoom);
    return Object.freeze({
      x: viewportWidth / 2 - (box.x + box.width / 2) * zoom,
      y: viewportHeight / 2 - (box.y + box.height / 2) * zoom,
      zoom
    });
  }

  function snapToGridValue(value, gridSize = 20) {
    const size = assertFiniteNumber(gridSize, 'gridSize');
    if (size <= 0) throw new RangeError('gridSize must be greater than 0.');
    return Math.round(assertFiniteNumber(value, 'value') / size) * size;
  }

  function getContextualZoomLevel(zoom, { compactBelow = 0.65, detailedAbove = 1.4 } = {}) {
    const value = assertFiniteNumber(zoom, 'zoom');
    const compact = assertFiniteNumber(compactBelow, 'compactBelow');
    const detailed = assertFiniteNumber(detailedAbove, 'detailedAbove');
    if (compact <= 0 || detailed <= compact) throw new RangeError('Contextual zoom thresholds must satisfy 0 < compactBelow < detailedAbove.');
    if (value < compact) return 'compact';
    if (value >= detailed) return 'detailed';
    return 'normal';
  }

  function alignmentAnchors(bounds) {
    const box = normalizeBounds(bounds, 'bounds');
    return {
      x: [box.x, box.x + box.width / 2, box.x + box.width],
      y: [box.y, box.y + box.height / 2, box.y + box.height]
    };
  }

  function calculateAlignmentSnap({ movingBounds, candidateBounds = [], threshold = 6, snap = true } = {}) {
    const moving = normalizeBounds(movingBounds, 'movingBounds');
    const limit = assertFiniteNumber(threshold, 'threshold');
    if (limit < 0) throw new RangeError('threshold must be zero or greater.');
    const movingAnchors = alignmentAnchors(moving);
    let bestX = null, bestY = null;
    for (const raw of candidateBounds) {
      const candidate = normalizeBounds(raw, 'candidateBounds');
      const anchors = alignmentAnchors(candidate);
      for (const from of movingAnchors.x) for (const to of anchors.x) {
        const delta = to - from, distance = Math.abs(delta);
        if (distance <= limit && (!bestX || distance < bestX.distance)) bestX = { delta, guide: to, distance };
      }
      for (const from of movingAnchors.y) for (const to of anchors.y) {
        const delta = to - from, distance = Math.abs(delta);
        if (distance <= limit && (!bestY || distance < bestY.distance)) bestY = { delta, guide: to, distance };
      }
    }
    return Object.freeze({
      dx: snap && bestX ? bestX.delta : 0,
      dy: snap && bestY ? bestY.delta : 0,
      vertical: bestX ? bestX.guide : null,
      horizontal: bestY ? bestY.guide : null
    });
  }

  const NODE_CANVAS_CSS = `
.nec-canvas{--nec-accent:#16624f;--nec-accent-soft:#e1f0ea;--nec-surface:#fff;--nec-surface-muted:#f4f5f2;--nec-text:#20211f;--nec-muted:#666963;--nec-line:#d7d9d2;--nec-edge:#8a8f88;position:relative;overflow:hidden;min-height:320px;touch-action:none;user-select:none;background-color:var(--nec-surface-muted);background-image:radial-gradient(circle,var(--nec-line) 1px,transparent 1px);background-size:20px 20px;background-position:var(--nec-grid-x,0px) var(--nec-grid-y,0px);outline:none}
.nec-canvas:focus-visible{outline:3px solid color-mix(in srgb,var(--nec-accent) 38%,transparent);outline-offset:2px}
.nec-canvas.is-grid-snap{background-image:radial-gradient(circle,color-mix(in srgb,var(--nec-accent) 62%,var(--nec-line)) 1.25px,transparent 1.25px)}
.nec-stage{position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0}
.nec-zoom-layer{position:relative;left:0;top:0;width:1px;height:1px;transform-origin:0 0}
.nec-edge-layer{position:absolute;left:0;top:0;overflow:visible;pointer-events:auto}
.nec-edge{fill:none;stroke:var(--nec-edge);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linecap:round;pointer-events:none;transition:stroke .12s ease,stroke-width .12s ease,opacity .12s ease}
.nec-edge[aria-selected="true"]{stroke:var(--nec-accent);stroke-width:2.6}
.nec-edge-hit{fill:none;stroke:transparent;stroke-width:18;vector-effect:non-scaling-stroke;pointer-events:stroke;cursor:pointer}
.nec-edge-hit:hover + .nec-edge,.nec-edge-hit:focus-visible + .nec-edge{stroke:var(--nec-accent);stroke-width:3;opacity:1}
.nec-edge-preview{stroke:var(--nec-accent);stroke-dasharray:7 5;opacity:.82}
.nec-edge-preview.is-snapped{stroke-width:2.8;opacity:1}
.nec-edge-endpoint{fill:var(--nec-surface);stroke:var(--nec-accent);stroke-width:2.4;vector-effect:non-scaling-stroke;pointer-events:all;cursor:grab}.nec-edge-endpoint:hover{fill:var(--nec-accent-soft);stroke-width:3}.nec-edge-endpoint:active{cursor:grabbing}
.nec-node-layer{position:absolute;left:0;top:0;width:1px;height:1px;pointer-events:none}
.nec-node{position:absolute;width:176px;pointer-events:auto;min-height:74px;border:1px solid var(--nec-line);border-radius:12px;background:var(--nec-surface);color:var(--nec-text);box-shadow:0 6px 18px rgba(25,28,24,.08);overflow:visible;transition:border-color .12s ease,box-shadow .12s ease}
.nec-node[aria-selected="true"]{border-color:var(--nec-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--nec-accent) 18%,transparent),0 8px 24px rgba(25,28,24,.11)}
.nec-node[data-disabled="true"]{opacity:.58}
.nec-node[data-runtime-status="running"]{box-shadow:0 0 0 2px color-mix(in srgb,var(--nec-accent) 16%,transparent),0 8px 24px rgba(25,28,24,.11)}
.nec-node[data-runtime-status="success"] .nec-node-type{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--nec-accent) 42%,transparent)}
.nec-node[data-runtime-status="warning"]{border-color:#b7791f}.nec-node[data-runtime-status="error"],.nec-node[data-validation="error"]{border-color:#b3261e;box-shadow:0 0 0 2px rgba(179,38,30,.10),0 8px 24px rgba(25,28,24,.10)}
.nec-node[data-runtime-status="disabled"]{opacity:.5}
.nec-edge-hit[data-validation="error"] + .nec-edge{stroke:#b3261e;stroke-dasharray:5 4}
.nec-canvas.is-locked .nec-node-handle{cursor:default}
.nec-canvas.is-locked .nec-port,.nec-canvas.is-locked .nec-edge-endpoint{cursor:default}
.nec-node-handle{display:flex;align-items:center;gap:8px;min-height:34px;padding:7px 9px;border-bottom:1px solid var(--nec-line);border-radius:11px 11px 0 0;background:var(--nec-surface-muted);cursor:grab}
.nec-node-handle:active{cursor:grabbing}
.nec-node-type{display:grid;place-items:center;width:22px;height:22px;flex:0 0 auto;border-radius:7px;background:var(--nec-accent-soft);color:var(--nec-accent);font-size:10px;font-weight:850}
.nec-node-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:780}
.nec-node-body{padding:8px 10px 9px;color:var(--nec-muted);font-size:10px;line-height:1.45}
.nec-node-body strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--nec-text);font-size:11px}
.nec-node-meta{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nec-port{position:absolute;z-index:4;display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:transparent;box-shadow:none;cursor:crosshair;transform:translateY(-50%);touch-action:none}
.nec-port::after{content:"";width:12px;height:12px;border:2px solid var(--nec-surface);border-radius:50%;background:var(--nec-accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--nec-accent) 48%,var(--nec-line));transition:width .12s ease,height .12s ease,box-shadow .12s ease,background .12s ease,transform .12s ease}
.nec-port-input{left:-18px}.nec-port-output{right:-18px}
.nec-port:focus-visible{outline:3px solid color-mix(in srgb,var(--nec-accent) 30%,transparent);outline-offset:1px}
.nec-port.is-pending::after{box-shadow:0 0 0 4px color-mix(in srgb,var(--nec-accent) 25%,transparent);background:var(--nec-surface)}
.nec-port.is-valid-target::after{width:15px;height:15px;box-shadow:0 0 0 4px color-mix(in srgb,var(--nec-accent) 20%,transparent)}
.nec-port.is-invalid-target{opacity:.28;cursor:not-allowed}
.nec-port.is-magnet::after{transform:scale(1.28);box-shadow:0 0 0 5px color-mix(in srgb,var(--nec-accent) 22%,transparent)}
.nec-selection-marquee{position:absolute;z-index:30;display:none;border:1px solid var(--nec-accent);background:color-mix(in srgb,var(--nec-accent) 10%,transparent);pointer-events:none}
.nec-selection-marquee.is-visible{display:block}
.nec-helper-line{position:absolute;z-index:31;display:none;pointer-events:none;background:var(--nec-accent);opacity:.92;box-shadow:0 0 0 1px color-mix(in srgb,var(--nec-surface) 62%,transparent),0 0 8px color-mix(in srgb,var(--nec-accent) 24%,transparent)}
.nec-helper-line.is-visible{display:block}.nec-helper-line-vertical{top:0;bottom:0;width:1px}.nec-helper-line-horizontal{left:0;right:0;height:1px}
.nec-minimap{position:absolute;z-index:28;right:12px;bottom:12px;width:176px;height:108px;overflow:hidden;border:1px solid color-mix(in srgb,var(--nec-line) 88%,transparent);border-radius:10px;background:color-mix(in srgb,var(--nec-surface) 94%,transparent);box-shadow:0 6px 20px rgba(25,28,24,.12);backdrop-filter:blur(5px);touch-action:none;cursor:crosshair}
.nec-minimap[hidden]{display:none!important}.nec-minimap svg{display:block;width:100%;height:100%}.nec-minimap-node{fill:color-mix(in srgb,var(--nec-accent) 23%,var(--nec-surface-muted));stroke:color-mix(in srgb,var(--nec-accent) 52%,var(--nec-line));stroke-width:1}.nec-minimap-node.is-selected{fill:var(--nec-accent);stroke:var(--nec-accent)}.nec-minimap-viewport{fill:color-mix(in srgb,var(--nec-accent) 8%,transparent);stroke:var(--nec-accent);stroke-width:1.5;vector-effect:non-scaling-stroke}
.nec-node-toolbar{position:absolute;z-index:9;right:0;bottom:calc(100% + 6px);display:flex;gap:5px;padding:4px;border:1px solid var(--nec-line);border-radius:9px;background:var(--nec-surface);box-shadow:0 7px 20px rgba(25,28,24,.12)}
.nec-node-toolbar button{min-height:28px;padding:4px 7px;border:1px solid var(--nec-line);border-radius:7px;background:var(--nec-surface);color:var(--nec-text);font:inherit;font-size:9px;font-weight:760;cursor:pointer;white-space:nowrap}
.nec-node-toolbar button:hover{background:var(--nec-surface-muted)}
.nec-node-toolbar button[data-danger="true"]{color:#b3261e}
.nec-node-toolbar button:disabled{opacity:.45;cursor:not-allowed}
.nec-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
@media (pointer:coarse),(max-width:700px){.nec-canvas[data-nec-minimap-responsive="true"] .nec-minimap:not(.is-force-visible){display:none}.nec-port{width:48px;height:48px}.nec-port-input{left:-24px}.nec-port-output{right:-24px}.nec-port::after{width:13px;height:13px}.nec-node-handle{min-height:42px}.nec-node-toolbar button{min-height:38px;padding-inline:10px}}
`;

  function installNodeCanvasStyles(targetDocument = globalThis.document) {
    if (!targetDocument?.head || typeof targetDocument.createElement !== 'function') throw new Error('A DOM Document is required to install Node Canvas styles.');
    const existing = targetDocument.getElementById('node-editor-core-canvas-styles');
    if (existing) return existing;
    const style = targetDocument.createElement('style');
    style.id = 'node-editor-core-canvas-styles';
    style.textContent = NODE_CANVAS_CSS;
    targetDocument.head.append(style);
    return style;
  }

  class NodeCanvas {
    constructor({
      element,
      graph,
      registry = null,
      minZoom = 0.25,
      maxZoom = 2.5,
      zoomStep = 1.2,
      fitPadding = 48,
      getNodeTitle = null,
      getPortLabel = null,
      getEdgeLabel = null,
      renderNode = null,
      connectionPolicy = null,
      touchTapConnect = true,
      touchDragThreshold = 8,
      selectionMode = 'partial',
      helperLines = true,
      snapToHelper = true,
      helperLineThreshold = 6,
      snapToGrid = false,
      gridSize = 20,
      miniMap = false,
      observeResize = true,
      contextualZoom = { compactBelow: 0.65, detailedAbove: 1.4 },
      theme = null,
      translator = null,
      runtimeStatusStore = null,
      layoutRegistry = null,
      interactive = true,
      inspectorOpen = false,
      getNodeToolbarActions = null,
      onNodeToolbarAction = null,
      onInspectorChange = null,
      onContextMenu = null,
      onInteractiveChange = null,
      historyLimit = 100,
      clipboardOffset = { x: 24, y: 24 },
      onHistoryChange = null,
      onDirtyChange = null,
      onClipboardChange = null,
      onChange = null,
      onSelectionChange = null,
      onEdgeSelectionChange = null,
      onViewportChange = null,
      onConnectionResult = null,
      onPendingConnectionChange = null,
      onContextualZoomChange = null,
      onMiniMapChange = null,
      onLayoutRefresh = null,
      onValidationChange = null,
      getAccessibilityMessage = null,
      onAccessibilityEvent = null
    } = {}) {
      if (!element || typeof element.appendChild !== 'function') throw new TypeError('NodeCanvas requires a DOM element.');
      this.element = element;
      this.registry = registry instanceof NodeRegistry ? registry : null;
      this.minZoom = clampZoom(minZoom, Number.MIN_VALUE, Number.MAX_VALUE);
      this.maxZoom = assertFiniteNumber(maxZoom, 'maxZoom');
      if (this.maxZoom < this.minZoom) throw new RangeError('maxZoom must be greater than or equal to minZoom.');
      this.zoomStep = assertFiniteNumber(zoomStep, 'zoomStep');
      if (this.zoomStep <= 1) throw new RangeError('zoomStep must be greater than 1.');
      this.fitPadding = assertFiniteNumber(fitPadding, 'fitPadding');
      if (this.fitPadding < 0) throw new RangeError('fitPadding must be zero or greater.');
      this.getNodeTitle = typeof getNodeTitle === 'function' ? getNodeTitle : null;
      this.getPortLabel = typeof getPortLabel === 'function' ? getPortLabel : null;
      this.getEdgeLabel = typeof getEdgeLabel === 'function' ? getEdgeLabel : null;
      this.renderNode = typeof renderNode === 'function' ? renderNode : null;
      const policy = isPlainObject(connectionPolicy) ? connectionPolicy : {};
      this.touchTapConnect = touchTapConnect !== false;
      this.touchDragThreshold = Number.isFinite(Number(touchDragThreshold)) ? Math.max(3, Number(touchDragThreshold)) : 8;
      this.connectionPolicy = Object.freeze({
        allowSelfConnections: Boolean(policy.allowSelfConnections),
        allowCycles: Boolean(policy.allowCycles),
        replaceExisting: Boolean(policy.replaceExisting),
        isCompatible: typeof policy.isCompatible === 'function' ? policy.isCompatible : null,
        validate: typeof policy.validate === 'function' ? policy.validate : null,
        mouseMagnetRadius: Number.isFinite(Number(policy.mouseMagnetRadius)) ? Math.max(0, Number(policy.mouseMagnetRadius)) : 48,
        touchMagnetRadius: Number.isFinite(Number(policy.touchMagnetRadius)) ? Math.max(0, Number(policy.touchMagnetRadius)) : 64
      });
      if (selectionMode !== 'partial' && selectionMode !== 'full') throw new TypeError('selectionMode must be "partial" or "full".');
      this.selectionMode = selectionMode;
      this.helperLines = helperLines !== false;
      this.snapToHelper = snapToHelper !== false;
      this.helperLineThreshold = Number.isFinite(Number(helperLineThreshold)) ? Math.max(0, Number(helperLineThreshold)) : 6;
      this.snapToGrid = Boolean(snapToGrid);
      this.gridSize = Number.isFinite(Number(gridSize)) && Number(gridSize) > 0 ? Number(gridSize) : 20;
      const miniMapConfig = isPlainObject(miniMap) ? miniMap : null;
      this.miniMapVisible = Boolean(miniMapConfig ? miniMapConfig.visible !== false : miniMap);
      this.miniMapResponsive = miniMapConfig ? miniMapConfig.responsive !== false : true;
      this.miniMapForceVisible = Boolean(miniMapConfig?.forceVisible && this.miniMapVisible);
      this.observeResize = observeResize !== false;
      const zoomConfig = isPlainObject(contextualZoom) ? contextualZoom : {};
      this.contextualZoom = Object.freeze({ compactBelow: Number.isFinite(Number(zoomConfig.compactBelow)) ? Number(zoomConfig.compactBelow) : 0.65, detailedAbove: Number.isFinite(Number(zoomConfig.detailedAbove)) ? Number(zoomConfig.detailedAbove) : 1.4 });
      getContextualZoomLevel(1, this.contextualZoom);
      this.theme = theme == null ? Object.freeze({}) : normalizeTheme(theme);
      this.translator = translator instanceof Translator ? translator : null;
      this.runtimeStatusStore = runtimeStatusStore instanceof RuntimeStatusStore ? runtimeStatusStore : null;
      this.layoutRegistry = layoutRegistry instanceof LayoutRegistry ? layoutRegistry : null;
      this.interactive = Boolean(interactive);
      this.inspectorOpen = Boolean(inspectorOpen);
      this.getNodeToolbarActions = typeof getNodeToolbarActions === 'function' ? getNodeToolbarActions : null;
      this.onNodeToolbarAction = typeof onNodeToolbarAction === 'function' ? onNodeToolbarAction : null;
      this.onInspectorChange = typeof onInspectorChange === 'function' ? onInspectorChange : null;
      this.onContextMenu = typeof onContextMenu === 'function' ? onContextMenu : null;
      this.onInteractiveChange = typeof onInteractiveChange === 'function' ? onInteractiveChange : null;
      if (!Number.isInteger(historyLimit) || historyLimit < 1) throw new TypeError('historyLimit must be a positive integer.');
      this.historyLimit = historyLimit;
      this.clipboardOffset = normalizePosition(clipboardOffset, 'clipboardOffset');
      this.onHistoryChange = typeof onHistoryChange === 'function' ? onHistoryChange : null;
      this.onDirtyChange = typeof onDirtyChange === 'function' ? onDirtyChange : null;
      this.onClipboardChange = typeof onClipboardChange === 'function' ? onClipboardChange : null;
      this.onChange = typeof onChange === 'function' ? onChange : null;
      this.onSelectionChange = typeof onSelectionChange === 'function' ? onSelectionChange : null;
      this.onEdgeSelectionChange = typeof onEdgeSelectionChange === 'function' ? onEdgeSelectionChange : null;
      this.onViewportChange = typeof onViewportChange === 'function' ? onViewportChange : null;
      this.onConnectionResult = typeof onConnectionResult === 'function' ? onConnectionResult : null;
      this.onPendingConnectionChange = typeof onPendingConnectionChange === 'function' ? onPendingConnectionChange : null;
      this.onContextualZoomChange = typeof onContextualZoomChange === 'function' ? onContextualZoomChange : null;
      this.onMiniMapChange = typeof onMiniMapChange === 'function' ? onMiniMapChange : null;
      this.onLayoutRefresh = typeof onLayoutRefresh === 'function' ? onLayoutRefresh : null;
      this.onValidationChange = typeof onValidationChange === 'function' ? onValidationChange : null;
      this.getAccessibilityMessage = typeof getAccessibilityMessage === 'function' ? getAccessibilityMessage : null;
      this.onAccessibilityEvent = typeof onAccessibilityEvent === 'function' ? onAccessibilityEvent : null;
      this.selectedNodeIds = new Set();
      this.selectedNodeId = null;
      this.selectedEdgeId = null;
      this.pendingConnection = null;
      this.nodeElements = new Map();
      this.portElements = new Map();
      this.edgeElements = new Map();
      this.edgeHitElements = new Map();
      this.pointerState = new Map();
      this.gesture = null;
      this.history = { past: [], future: [], transaction: null };
      this.lastHistoryCoalesceKey = null;
      this.clipboard = null;
      this.clipboardPasteCount = 0;
      this.savedSignature = '';
      this.lastDirtyState = false;
      this.activeHelperGuides = { vertical: null, horizontal: null };
      this.lastContextualZoomLevel = null;
      this._miniMapViewBox = null;
      this.validationResult = null;
      this._unsubscribeRuntimeStatus = null;
      this._resizeObserver = null;
      this._layoutRefreshFrame = null;
      this._lastObservedSize = null;
      this.destroyed = false;

      installNodeCanvasStyles(element.ownerDocument);
      this.stage = element.ownerDocument.createElement('div');
      this.stage.className = 'nec-stage';
      this.zoomLayer = element.ownerDocument.createElement('div');
      this.zoomLayer.className = 'nec-zoom-layer';
      this.edgeLayer = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.edgeLayer.classList.add('nec-edge-layer');
      this.nodeLayer = element.ownerDocument.createElement('div');
      this.nodeLayer.className = 'nec-node-layer';
      this.zoomLayer.append(this.edgeLayer, this.nodeLayer);
      this.stage.append(this.zoomLayer);
      this.selectionMarquee = element.ownerDocument.createElement('div');
      this.selectionMarquee.className = 'nec-selection-marquee';
      this.helperVertical = element.ownerDocument.createElement('div');
      this.helperVertical.className = 'nec-helper-line nec-helper-line-vertical';
      this.helperHorizontal = element.ownerDocument.createElement('div');
      this.helperHorizontal.className = 'nec-helper-line nec-helper-line-horizontal';
      this.miniMap = element.ownerDocument.createElement('div');
      this.miniMap.className = 'nec-minimap';
      this.miniMap.hidden = !this.miniMapVisible;
      this.miniMap.classList.toggle('is-force-visible', this.miniMapForceVisible);
      this.miniMap.setAttribute('role', 'navigation');
      this.miniMap.setAttribute('aria-label', 'Graph MiniMap');
      this.miniMapSvg = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.miniMapSvg.setAttribute('preserveAspectRatio', 'none');
      this.miniMap.append(this.miniMapSvg);
      this.announcer = element.ownerDocument.createElement('div');
      this.announcer.className = 'nec-sr-only';
      this.announcer.setAttribute('role', 'status');
      this.announcer.setAttribute('aria-live', 'polite');
      this.announcer.setAttribute('aria-atomic', 'true');
      element.classList.add('nec-canvas');
      if (Object.keys(this.theme).length) applyTheme(element, this.theme);
      element.classList.toggle('is-locked', !this.interactive);
      element.classList.toggle('is-helper-lines', this.helperLines);
      element.classList.toggle('is-grid-snap', this.snapToGrid);
      element.dataset.necMinimapResponsive = this.miniMapResponsive ? 'true' : 'false';
      if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
      if (!element.hasAttribute('role')) element.setAttribute('role', 'application');
      element.replaceChildren(this.stage, this.selectionMarquee, this.helperVertical, this.helperHorizontal, this.miniMap, this.announcer);

      this._onWheel = event => this._handleWheel(event);
      this._onPointerDown = event => this._handleCanvasPointerDown(event);
      this._onPointerMove = event => this._handlePointerMove(event);
      this._onPointerUp = event => this._handlePointerUp(event, false);
      this._onPointerCancel = event => this._handlePointerUp(event, true);
      this._onKeyDown = event => this._handleKeyDown(event);
      this._onContextMenu = event => this._handleContextMenu(event);
      this._onMiniMapPointerDown = event => this._handleMiniMapPointerDown(event);
      element.addEventListener('wheel', this._onWheel, { passive: false });
      element.addEventListener('pointerdown', this._onPointerDown);
      element.addEventListener('pointermove', this._onPointerMove);
      element.addEventListener('pointerup', this._onPointerUp);
      element.addEventListener('pointercancel', this._onPointerCancel);
      element.addEventListener('keydown', this._onKeyDown);
      element.addEventListener('contextmenu', this._onContextMenu);
      this.miniMap.addEventListener('pointerdown', this._onMiniMapPointerDown);
      if (this.runtimeStatusStore) this._unsubscribeRuntimeStatus = this.runtimeStatusStore.subscribe(nodeId => this._syncRuntimeStatus(nodeId));

      this.setGraph(graph ?? createGraph(), { preserveSelection: false, resetHistory: true, markSaved: true });
      this._installResizeObserver();
      if (this.inspectorOpen) this._notifyInspector();
    }

    getGraph() { return this.graph; }
    getSelection() { return Object.freeze([...this.selectedNodeIds]); }
    getPrimarySelection() { return this.selectedNodeId; }
    getSelectedEdge() { return this.selectedEdgeId; }
    getViewport() { return this.graph.viewport; }
    isInteractive() { return this.interactive; }
    isInspectorOpen() { return this.inspectorOpen; }
    getPendingConnection() { return this.pendingConnection ? Object.freeze({ ...this.pendingConnection }) : null; }
    getContextualZoomLevel() { return getContextualZoomLevel(this.graph.viewport.zoom, this.contextualZoom); }
    isMiniMapVisible() { return this.miniMapVisible; }
    getMiniMapState() { return Object.freeze({ visible: this.miniMapVisible, responsive: this.miniMapResponsive, forceVisible: this.miniMapForceVisible }); }
    setMiniMapVisible(visible, { force = false } = {}) {
      this.miniMapVisible = Boolean(visible);
      this.miniMapForceVisible = Boolean(this.miniMapVisible && force);
      if (this.miniMap) {
        this.miniMap.hidden = !this.miniMapVisible;
        this.miniMap.classList?.toggle('is-force-visible', this.miniMapForceVisible);
      }
      this._renderMiniMap();
      this.onMiniMapChange?.(this.miniMapVisible, this, this.getMiniMapState());
      return this.miniMapVisible;
    }
    toggleMiniMap(options = {}) { return this.setMiniMapVisible(!this.miniMapVisible, options); }
    setMiniMapResponsive(responsive) {
      this.miniMapResponsive = Boolean(responsive);
      if (this.element?.dataset) this.element.dataset.necMinimapResponsive = this.miniMapResponsive ? 'true' : 'false';
      this._renderMiniMap();
      this.onMiniMapChange?.(this.miniMapVisible, this, this.getMiniMapState());
      return this.miniMapResponsive;
    }
    refreshLayout({ source = 'api' } = {}) {
      if (this.destroyed) return null;
      this._positionAllPorts();
      this._syncLayerBounds();
      this._renderEdges();
      this._renderHelperGuides(this.activeHelperGuides?.vertical ?? null, this.activeHelperGuides?.horizontal ?? null);
      this._renderMiniMap();
      const result = Object.freeze({ width: Math.max(0, Number(this.element?.clientWidth) || 0), height: Math.max(0, Number(this.element?.clientHeight) || 0), source: String(source || 'api') });
      this.onLayoutRefresh?.(result, { canvas: this });
      return result;
    }
    _scheduleLayoutRefresh(source = 'resize-observer') {
      if (this.destroyed || this._layoutRefreshFrame != null) return;
      const view = this.element?.ownerDocument?.defaultView;
      const request = typeof view?.requestAnimationFrame === 'function' ? view.requestAnimationFrame.bind(view) : (callback => setTimeout(callback, 0));
      this._layoutRefreshFrame = request(() => {
        this._layoutRefreshFrame = null;
        this.refreshLayout({ source });
      });
    }
    _installResizeObserver() {
      if (!this.observeResize || this.destroyed || this._resizeObserver) return false;
      const view = this.element?.ownerDocument?.defaultView;
      const ResizeObserverCtor = view?.ResizeObserver ?? globalThis.ResizeObserver;
      if (typeof ResizeObserverCtor !== 'function') return false;
      this._resizeObserver = new ResizeObserverCtor(entries => {
        const entry = entries?.find?.(item => item.target === this.element) ?? entries?.[0];
        const width = Number(entry?.contentRect?.width ?? this.element?.clientWidth ?? 0);
        const height = Number(entry?.contentRect?.height ?? this.element?.clientHeight ?? 0);
        const previous = this._lastObservedSize;
        if (previous && Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5) return;
        this._lastObservedSize = Object.freeze({ width, height });
        this._scheduleLayoutRefresh('resize-observer');
      });
      this._resizeObserver.observe(this.element);
      return true;
    }
    setTheme(theme = {}) { this.theme = normalizeTheme(theme); applyTheme(this.element, this.theme); return this.theme; }
    setTranslator(translator = null) { if (translator != null && !(translator instanceof Translator)) throw new TypeError('translator must be a Translator or null.'); this.translator = translator; this._syncNodes(); this._renderEdges(); return this.translator; }
    t(key, params = {}, fallback = null) { if (this.translator) { const translated = this.translator.t(key, params); if (translated !== key || fallback == null) return translated; } return fallback == null ? String(key) : String(fallback).replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, token) => Object.prototype.hasOwnProperty.call(params, token) ? String(params[token]) : match); }
    getValidationResult() { return this.validationResult ?? createValidationResult(this.graph, { registry: this.registry }); }
    validateGraph() { this.validationResult = createValidationResult(this.graph, { registry: this.registry }); this._applyValidationStyles(); this.onValidationChange?.(this.validationResult, { canvas: this }); return this.validationResult; }
    setRuntimeStatus(nodeId, status, detail = {}) { if (!this.runtimeStatusStore) this.runtimeStatusStore = new RuntimeStatusStore(); if (!this._unsubscribeRuntimeStatus) this._unsubscribeRuntimeStatus = this.runtimeStatusStore.subscribe(id => this._syncRuntimeStatus(id)); return this.runtimeStatusStore.set(nodeId, status, detail); }
    getRuntimeStatus(nodeId) { return this.runtimeStatusStore?.get(nodeId) ?? Object.freeze({ status: 'idle', detail: Object.freeze({}) }); }
    async applyLayout(name, options = {}) { if (!this.layoutRegistry) throw new Error('No LayoutRegistry is configured.'); const result = await this.layoutRegistry.run(name, this.graph, options); if (!result.changes.length) return result; this.beginTransaction(`layout:${name}`, { source: 'layout' }); this.dispatchMany(result.changes, { source: 'layout', transient: true }); this.commitTransaction({ source: 'layout', layout: name }); return Object.freeze({ ...result, graph: this.graph }); }
    setSnapToGrid(enabled) { this.snapToGrid = Boolean(enabled); this.element?.classList?.toggle('is-grid-snap', this.snapToGrid); return this.snapToGrid; }
    setHelperLines(enabled) { this.helperLines = Boolean(enabled); this.element?.classList?.toggle('is-helper-lines', this.helperLines); if (!this.helperLines) this._clearHelperGuides(); return this.helperLines; }
    setSnapToHelper(enabled) { this.snapToHelper = Boolean(enabled); return this.snapToHelper; }
    _accessibilityMessage(type, detail = {}) {
      const custom = this.getAccessibilityMessage?.(type, detail, this);
      if (custom != null) return String(custom);
      const port = detail.portLabel || detail.portId || '';
      const messages = {
        'connection-start': `Connection started${port ? ` from ${port}` : ''}. Choose a compatible port.`,
        'connection-cancel': 'Connection cancelled.',
        'connection-complete': 'Connection created.',
        'connection-rejected': 'That connection is not available.',
        'selection-cleared': 'Selection cleared.',
        'inspector-open': 'Node inspector opened.',
        'inspector-close': 'Node inspector closed.'
      };
      const fallback = messages[type] || '';
      return this.translator ? this.translator.t(`accessibility.${type}`, { port }, { fallbackLocale: this.translator.fallbackLocale })?.replace(`accessibility.${type}`, fallback) || fallback : fallback;
    }

    _announce(type, detail = {}) {
      const message = this._accessibilityMessage(type, detail);
      if (this.announcer && message) { this.announcer.textContent = ''; this.announcer.textContent = message; }
      this.onAccessibilityEvent?.({ type, message, ...detail, canvas: this });
      return message;
    }

    focusCanvas({ preventScroll = true } = {}) { this.element.focus?.({ preventScroll }); return this.element; }
    focusNode(nodeId, { select = true, preventScroll = true } = {}) {
      const id = assertString(nodeId, 'nodeId');
      const element = this.nodeElements.get(id); if (!element) return null;
      if (select) this.selectNode(id);
      element.focus?.({ preventScroll });
      return element;
    }
    focusPort(endpoint, { preventScroll = true } = {}) {
      if (!endpoint) return null;
      const nodeId = assertString(endpoint.nodeId, 'endpoint.nodeId');
      const direction = endpoint.direction;
      const portId = assertString(endpoint.portId, 'endpoint.portId');
      if (direction !== 'input' && direction !== 'output') throw new TypeError('endpoint.direction must be "input" or "output".');
      const element = this.portElements.get(this._portMapKey(nodeId, direction, portId));
      element?.focus?.({ preventScroll });
      return element ?? null;
    }

    focusIssue(issue, { fit = true, select = true, openInspector = true, preventScroll = true } = {}) {
      if (!issue) return null;
      const result = issue.nodeId || issue.edgeId ? issue : createValidationResult(this.graph, { registry: this.registry }).issues.find(item => item.code === issue.code && item.path === issue.path) ?? issue;
      if (result.nodeId && getNode(this.graph, result.nodeId)) {
        if (select) this.selectNode(result.nodeId);
        if (fit) this.fitNode(result.nodeId, { maxZoom: Math.min(this.maxZoom, 1.5) }); else this.centerOnNode(result.nodeId);
        if (openInspector) this.openInspector(result.nodeId);
        return this.focusNode(result.nodeId, { select: false, preventScroll });
      }
      if (result.edgeId && getEdge(this.graph, result.edgeId)) {
        this.selectEdge(result.edgeId);
        const edge = getEdge(this.graph, result.edgeId);
        if (fit) this._fitNodes([edge.source.nodeId, edge.target.nodeId], { maxZoom: Math.min(this.maxZoom, 1.5) });
        const element = this.edgeHitElements.get(result.edgeId); element?.focus?.({ preventScroll }); return element ?? null;
      }
      return null;
    }
    focusFirstIssue(options = {}) { const issue = this.getValidationResult().firstIssue; return issue ? this.focusIssue(issue, options) : null; }

    addNode(type, { id = null, data = {}, disabled = false, position = null, clientPosition = null, offset = { x: 0, y: 0 }, snap = this.snapToGrid, select = true, openInspector = false, focus = false, metadata = {} } = {}) {
      if (!this.registry) throw new Error('NodeCanvas.addNode requires a NodeRegistry.');
      const nodeType = assertString(type, 'type');
      if (position != null && clientPosition != null) throw new TypeError('Specify either position or clientPosition, not both.');
      let nextPosition;
      if (position != null) nextPosition = normalizePosition(position, 'position');
      else {
        let point = clientPosition;
        if (point == null) {
          const rect = this.element.getBoundingClientRect();
          point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        const client = normalizePosition(point, 'clientPosition');
        nextPosition = this.screenToFlowPosition(client);
      }
      const positionOffset = normalizePosition(offset, 'offset');
      nextPosition = Object.freeze({ x: nextPosition.x + positionOffset.x, y: nextPosition.y + positionOffset.y });
      if (snap) nextPosition = Object.freeze({ x: snapToGridValue(nextPosition.x, this.gridSize), y: snapToGridValue(nextPosition.y, this.gridSize) });
      const options = { position: nextPosition, data, disabled };
      if (id != null) options.id = assertString(id, 'id');
      const node = this.registry.create(nodeType, options);
      this.dispatch({ type: 'node.add', node }, { source: 'node-add', ...metadata });
      if (select) this.selectNode(node.id);
      if (openInspector) this.openInspector(node.id);
      if (focus) this.focusNode(node.id, { select: false });
      return node;
    }

    captureViewState() {
      return Object.freeze({
        viewport: Object.freeze({ ...this.graph.viewport }),
        selection: Object.freeze([...this.selectedNodeIds]),
        primaryNodeId: this.selectedNodeId,
        selectedEdgeId: this.selectedEdgeId,
        inspectorOpen: this.inspectorOpen,
        miniMap: this.getMiniMapState()
      });
    }

    restoreViewState(state, { restoreSelection = true, restoreInspector = true, restoreMiniMap = true, source = 'view-state' } = {}) {
      if (!isPlainObject(state)) throw new TypeError('view state must be an object.');
      if (state.viewport != null) this.setViewport(state.viewport);
      if (restoreMiniMap && isPlainObject(state.miniMap)) {
        if (Object.prototype.hasOwnProperty.call(state.miniMap, 'responsive')) this.setMiniMapResponsive(Boolean(state.miniMap.responsive));
        this.setMiniMapVisible(Boolean(state.miniMap.visible), { force: Boolean(state.miniMap.forceVisible) });
      }
      if (restoreSelection) {
        const ids = Array.isArray(state.selection) ? state.selection.filter(id => typeof id === 'string' && getNode(this.graph, id)) : [];
        const primaryNodeId = typeof state.primaryNodeId === 'string' && ids.includes(state.primaryNodeId) ? state.primaryNodeId : (ids.at(-1) ?? null);
        if (ids.length) this.setSelection(ids, { primaryNodeId });
        else if (typeof state.selectedEdgeId === 'string' && getEdge(this.graph, state.selectedEdgeId)) this.selectEdge(state.selectedEdgeId);
        else this.clearSelection();
      }
      if (restoreInspector) {
        if (state.inspectorOpen && this.selectedNodeId) this.openInspector(this.selectedNodeId);
        else if (!state.inspectorOpen && this.inspectorOpen) this.closeInspector();
      }
      this.refreshLayout({ source });
      return this.captureViewState();
    }

    _normalizeInteractivePort(endpoint) {
      if (!this.registry || !endpoint) return null;
      const nodeId = assertString(endpoint.nodeId, 'endpoint.nodeId');
      const portId = assertString(endpoint.portId, 'endpoint.portId');
      const direction = endpoint.direction;
      if (direction !== 'input' && direction !== 'output') throw new TypeError('endpoint.direction must be "input" or "output".');
      const node = getNode(this.graph, nodeId);
      const port = node ? getPort(this.registry, node, portId, direction) : null;
      return node && port ? Object.freeze({ nodeId, direction, portId }) : null;
    }

    _notifyPendingConnection(source = 'api') { this.onPendingConnectionChange?.(this.getPendingConnection(), { source, canvas: this }); }

    cancelPendingConnection({ announce = true, source = 'cancel' } = {}) {
      if (!this.pendingConnection) return false;
      this.pendingConnection = null;
      this._clearConnectionHighlights();
      this._notifyPendingConnection(source);
      this._renderEdges();
      if (announce) this._announce('connection-cancel');
      return true;
    }

    activatePort(endpoint, { source = 'keyboard' } = {}) {
      const next = this._normalizeInteractivePort(endpoint);
      if (!next || !this.interactive) return Object.freeze({ status: 'blocked', valid: false });
      this.selectNode(next.nodeId);
      const pending = this.pendingConnection;
      if (!pending) {
        this.pendingConnection = next;
        this._syncPendingConnectionHighlights();
        this._notifyPendingConnection(source);
        const node = getNode(this.graph, next.nodeId), port = node ? getPort(this.registry, node, next.portId, next.direction) : null;
        this._announce('connection-start', { ...next, source, portLabel: node && port ? this._portLabel(node, port) : next.portId });
        return Object.freeze({ status: 'started', valid: true, start: next });
      }
      if (pending.nodeId === next.nodeId && pending.direction === next.direction && pending.portId === next.portId) {
        this.cancelPendingConnection();
        return Object.freeze({ status: 'cancelled', valid: true });
      }
      if (pending.direction === next.direction) {
        this.pendingConnection = next;
        this._syncPendingConnectionHighlights();
        this._notifyPendingConnection(source);
        const node = getNode(this.graph, next.nodeId), port = node ? getPort(this.registry, node, next.portId, next.direction) : null;
        this._announce('connection-start', { ...next, source, portLabel: node && port ? this._portLabel(node, port) : next.portId });
        return Object.freeze({ status: 'restarted', valid: true, start: next });
      }
      const pair = this._connectionPair(pending, next);
      if (!pair) {
        this._announce('connection-rejected', { source, code: 'DIRECTION_MISMATCH' });
        return Object.freeze({ status: 'rejected', valid: false, code: 'DIRECTION_MISMATCH' });
      }
      const validation = this.validateConnection(pair.source, pair.target);
      if (!validation.valid) {
        this._announce('connection-rejected', { source, code: validation.code, result: validation });
        return Object.freeze({ status: 'rejected', ...validation });
      }
      this.pendingConnection = null;
      this._clearConnectionHighlights();
      this._notifyPendingConnection(source);
      const result = this.connectPorts(pair.source, pair.target, { metadata: { source, activation: 'sequential-port' } });
      this._announce('connection-complete', { source, edgeId: result.edgeId, result });
      this.focusPort(next);
      return Object.freeze({ status: 'connected', ...result });
    }

    _ensureHistoryState() {
      if (!this.history) this.history = { past: [], future: [], transaction: null };
      if (!Number.isInteger(this.historyLimit) || this.historyLimit < 1) this.historyLimit = 100;
      if (this.lastHistoryCoalesceKey === undefined) this.lastHistoryCoalesceKey = null;
      return this.history;
    }
    canUndo() { return this._ensureHistoryState().past.length > 0; }
    canRedo() { return this._ensureHistoryState().future.length > 0; }
    isDirty() { return graphContentSignature(this.graph) !== (this.savedSignature ?? graphContentSignature(this.graph)); }
    hasClipboard() { return Boolean(this.clipboard?.nodes?.length); }
    getClipboardFragment() { return this.clipboard; }
    setClipboardFragment(fragment) {
      if (fragment == null) { this.clipboard = null; this.clipboardPasteCount = 0; this.onClipboardChange?.(null, { source: 'clear' }); return null; }
      const appId = typeof fragment.appId === 'string' && fragment.appId.trim() ? fragment.appId : this.graph.app.id;
      const temporary = createGraph({ appId });
      const validated = pasteGraphFragment(temporary, fragment, { offset: { x: 0, y: 0 } });
      this.clipboard = createGraphFragment(validated.graph, validated.nodeIds);
      this.clipboardPasteCount = 0;
      this.onClipboardChange?.(this.clipboard, { source: 'set' });
      return this.clipboard;
    }

    _historySnapshot(graph = this.graph) {
      const normalized = normalizeGraph(graph);
      return Object.freeze({
        graph: cloneGraph(normalized),
        selection: Object.freeze([...this.selectedNodeIds]),
        primaryNodeId: this.selectedNodeId,
        selectedEdgeId: this.selectedEdgeId
      });
    }

    _restoreHistorySnapshot(snapshot, metadata = {}) {
      const currentViewport = this.graph.viewport;
      const restored = Object.freeze({ ...normalizeGraph(snapshot.graph), viewport: currentViewport });
      this.graph = restored;
      this.selectedNodeIds = new Set((snapshot.selection ?? []).filter(id => getNode(restored, id)));
      this.selectedNodeId = snapshot.primaryNodeId && this.selectedNodeIds.has(snapshot.primaryNodeId) ? snapshot.primaryNodeId : (this.selectedNodeIds.values().next().value ?? null);
      this.selectedEdgeId = snapshot.selectedEdgeId && getEdge(restored, snapshot.selectedEdgeId) ? snapshot.selectedEdgeId : null;
      this._syncNodes();
      this._applyViewport();
      this._renderEdges();
      this._notifySelection();
      this.validateGraph();
      this._notifyHistory(metadata);
      this._notifyDirty(metadata);
      this.onChange?.(this.graph, Object.freeze([]), { source: 'history-restore', history: false, ...metadata });
      return this.graph;
    }

    _pushHistory(snapshot, metadata = {}) {
      this._ensureHistoryState();
      const coalesceKey = metadata.coalesceKey == null ? null : String(metadata.coalesceKey);
      if (!(coalesceKey && this.lastHistoryCoalesceKey === coalesceKey && this.history.past.length)) {
        this.history.past.push(snapshot);
        if (this.history.past.length > this.historyLimit) this.history.past.splice(0, this.history.past.length - this.historyLimit);
      }
      this.lastHistoryCoalesceKey = coalesceKey;
      this.history.future = [];
      this._notifyHistory(metadata);
    }

    _shouldRecordHistory(changes, metadata = {}) {
      if (metadata.history === false || metadata.transient === true || metadata.source === 'viewport') return false;
      const list = Array.isArray(changes) ? changes : [changes];
      return list.some(change => change?.type && change.type !== 'graph.viewport');
    }

    beginTransaction(label = 'transaction', metadata = {}) {
      this._ensureHistoryState();
      if (this.history.transaction) return false;
      this.history.transaction = { label: String(label || 'transaction'), before: this._historySnapshot(), metadata: { ...metadata }, changed: false };
      return true;
    }

    commitTransaction(metadata = {}) {
      this._ensureHistoryState();
      const transaction = this.history.transaction;
      if (!transaction) return false;
      this.history.transaction = null;
      if (!transaction.changed || graphContentSignature(transaction.before.graph) === graphContentSignature(this.graph)) return false;
      this.lastHistoryCoalesceKey = null;
      this._pushHistory(transaction.before, { source: 'transaction', label: transaction.label, ...transaction.metadata, ...metadata });
      this._notifyDirty({ source: 'transaction', label: transaction.label, ...metadata });
      return true;
    }

    cancelTransaction() {
      this._ensureHistoryState();
      const transaction = this.history.transaction;
      if (!transaction) return false;
      this.history.transaction = null;
      this._restoreHistorySnapshot(transaction.before, { source: 'transaction-cancel' });
      return true;
    }

    clearHistory() {
      this._ensureHistoryState();
      this.history.past = [];
      this.history.future = [];
      this.history.transaction = null;
      this.lastHistoryCoalesceKey = null;
      this._notifyHistory({ source: 'clear-history' });
    }

    undo() {
      this._ensureHistoryState();
      if (!this.interactive || !this.canUndo() || this.history.transaction) return false;
      this.lastHistoryCoalesceKey = null;
      const previous = this.history.past.pop();
      this.history.future.push(this._historySnapshot());
      this._restoreHistorySnapshot(previous, { source: 'undo' });
      return true;
    }

    redo() {
      this._ensureHistoryState();
      if (!this.interactive || !this.canRedo() || this.history.transaction) return false;
      this.lastHistoryCoalesceKey = null;
      const next = this.history.future.pop();
      this.history.past.push(this._historySnapshot());
      this._restoreHistorySnapshot(next, { source: 'redo' });
      return true;
    }

    markSaved() {
      this.savedSignature = graphContentSignature(this.graph);
      this._notifyDirty({ source: 'mark-saved' }, true);
      return this.savedSignature;
    }

    _notifyHistory(metadata = {}) {
      this.onHistoryChange?.(Object.freeze({ canUndo: this.canUndo(), canRedo: this.canRedo(), undoCount: this.history.past.length, redoCount: this.history.future.length, inTransaction: Boolean(this.history.transaction) }), metadata);
    }

    _notifyDirty(metadata = {}, force = false) {
      const dirty = this.isDirty();
      if (!force && dirty === this.lastDirtyState) return;
      this.lastDirtyState = dirty;
      this.onDirtyChange?.(dirty, metadata);
    }

    setGraph(graph, { preserveSelection = true, resetHistory = false, markSaved = false } = {}) {
      this.graph = normalizeGraph(graph);
      if (!preserveSelection) this.selectedNodeIds.clear();
      else for (const id of [...this.selectedNodeIds]) if (!getNode(this.graph, id)) this.selectedNodeIds.delete(id);
      if (!preserveSelection || (this.selectedNodeId && !this.selectedNodeIds.has(this.selectedNodeId))) this.selectedNodeId = this.selectedNodeIds.values().next().value ?? null;
      if (!preserveSelection || (this.selectedEdgeId && !getEdge(this.graph, this.selectedEdgeId))) this.selectedEdgeId = null;
      this._syncNodes();
      this._applyViewport();
      this._renderEdges();
      this._notifySelection();
      this.validateGraph();
      if (resetHistory) this.clearHistory();
      if (markSaved) this.markSaved(); else this._notifyDirty({ source: 'set-graph' }, true);
      return this.graph;
    }

    dispatch(change, metadata = {}) {
      const before = this._historySnapshot();
      const next = applyChange(this.graph, change);
      this.graph = next;
      const contentChanged = graphContentSignature(before.graph) !== graphContentSignature(next);
      const persistentChange = change?.type && change.type !== 'graph.viewport' && contentChanged;
      if (this.history.transaction && persistentChange) this.history.transaction.changed = true;
      else if (persistentChange && this._shouldRecordHistory(change, metadata)) this._pushHistory(before, metadata);
      this._afterGraphChange(change, metadata);
      this._notifyDirty(metadata);
      this.onChange?.(next, change, metadata);
      return next;
    }

    dispatchMany(changes, metadata = {}) {
      if (!Array.isArray(changes) || !changes.length) return this.graph;
      const before = this._historySnapshot();
      const next = applyChanges(this.graph, changes);
      this.graph = next;
      const contentChanged = graphContentSignature(before.graph) !== graphContentSignature(next);
      const persistentChanges = contentChanged && changes.some(change => change?.type && change.type !== 'graph.viewport');
      if (this.history.transaction && persistentChanges) this.history.transaction.changed = true;
      else if (persistentChanges && this._shouldRecordHistory(changes, metadata)) this._pushHistory(before, metadata);
      this._afterGraphChange(changes, metadata);
      this._notifyDirty(metadata);
      this.onChange?.(next, Object.freeze([...changes]), metadata);
      return next;
    }

    _afterGraphChange(change, metadata) {
      const changes = Array.isArray(change) ? change : [change];
      const onlyViewport = changes.every(item => item.type === 'graph.viewport');
      const onlyPositions = changes.every(item => item.type === 'node.position');
      if (onlyViewport) {
        this._applyViewport();
        this._renderEdges();
        this.onViewportChange?.(this.graph.viewport, metadata);
      } else if (onlyPositions) {
        for (const item of changes) this._positionNode(item.nodeId);
        this._positionAllPorts();
        this._syncLayerBounds();
        this._renderEdges();
      } else {
        for (const id of [...this.selectedNodeIds]) if (!getNode(this.graph, id)) this.selectedNodeIds.delete(id);
        if (this.selectedNodeId && !this.selectedNodeIds.has(this.selectedNodeId)) this.selectedNodeId = this.selectedNodeIds.values().next().value ?? null;
        if (this.selectedEdgeId && !getEdge(this.graph, this.selectedEdgeId)) this.selectedEdgeId = null;
        this._syncNodes();
        this._renderEdges();
        this._notifySelection();
        this.validateGraph();
      }
    }

    setSelection(nodeIds, { primaryNodeId = null, additive = false } = {}) {
      const ids = Array.isArray(nodeIds) ? nodeIds : (nodeIds == null ? [] : [nodeIds]);
      const next = additive ? new Set(this.selectedNodeIds) : new Set();
      for (const rawId of ids) {
        const id = assertString(rawId, 'nodeId');
        if (!getNode(this.graph, id)) throw new Error(`Node not found: ${id}`);
        next.add(id);
      }
      const nextPrimary = primaryNodeId == null ? (ids[ids.length - 1] ?? next.values().next().value ?? null) : assertString(primaryNodeId, 'primaryNodeId');
      if (nextPrimary && !next.has(nextPrimary)) throw new Error('primaryNodeId must be included in selection.');
      const previous = this.getSelection();
      const changed = previous.length !== next.size || previous.some(id => !next.has(id)) || this.selectedNodeId !== nextPrimary || this.selectedEdgeId !== null;
      this.selectedNodeIds = next;
      this.selectedNodeId = nextPrimary;
      this.selectedEdgeId = null;
      this._updateSelectionStyles();
      this._syncNodeToolbar();
      if (changed) this._notifySelection();
      return this.getSelection();
    }

    selectNode(nodeId, { additive = false, toggle = false } = {}) {
      const nextId = nodeId == null ? null : assertString(nodeId, 'nodeId');
      if (nextId && !getNode(this.graph, nextId)) throw new Error(`Node not found: ${nextId}`);
      if (!nextId) return this.clearSelection();
      if (additive || toggle) {
        const next = new Set(this.selectedNodeIds);
        if (toggle && next.has(nextId)) next.delete(nextId); else next.add(nextId);
        const primary = next.has(nextId) ? nextId : (this.selectedNodeId && next.has(this.selectedNodeId) ? this.selectedNodeId : next.values().next().value ?? null);
        return this.setSelection([...next], { primaryNodeId: primary });
      }
      return this.setSelection([nextId], { primaryNodeId: nextId });
    }

    selectAllNodes() {
      const ids = this.graph.nodes.map(node => node.id);
      return this.setSelection(ids, { primaryNodeId: ids[ids.length - 1] ?? null });
    }

    selectEdge(edgeId) {
      const nextId = edgeId == null ? null : assertString(edgeId, 'edgeId');
      if (nextId && !getEdge(this.graph, nextId)) throw new Error(`Edge not found: ${nextId}`);
      const changed = this.selectedEdgeId !== nextId || this.selectedNodeIds.size > 0;
      this.selectedEdgeId = nextId;
      this.selectedNodeIds.clear();
      this.selectedNodeId = null;
      this._updateSelectionStyles();
      this._syncNodeToolbar();
      if (changed) { this._renderEdges(); this._notifySelection(); }
      return this.selectedEdgeId;
    }

    clearSelection() {
      const changed = this.selectedNodeIds.size > 0 || this.selectedEdgeId !== null;
      this.selectedNodeIds.clear();
      this.selectedNodeId = null;
      this.selectedEdgeId = null;
      this._updateSelectionStyles();
      this._syncNodeToolbar();
      this._renderEdges();
      if (changed) this._notifySelection();
      return this.getSelection();
    }

    setInteractive(interactive) {
      const next = Boolean(interactive);
      if (next === this.interactive) return next;
      this.interactive = next;
      if (!next && this.gesture?.type === 'node-drag' && this.history.transaction) this.cancelTransaction();
      if (!next && (this.gesture?.type === 'connection' || this.gesture?.type === 'edge-reconnect' || this.gesture?.type === 'node-drag' || this.gesture?.type === 'touch-port')) { this.gesture = null; this._clearConnectionHighlights(); this._renderEdges(); }
      if (!next) this.cancelPendingConnection({ announce: false });
      this.element.classList.toggle('is-locked', !next);
      this._syncNodeToolbar();
      this.onInteractiveChange?.(next);
      return next;
    }

    openInspector(nodeId = this.selectedNodeId) {
      if (nodeId != null) {
        const id = assertString(nodeId, 'nodeId');
        if (!getNode(this.graph, id)) throw new Error(`Node not found: ${id}`);
        if (!this.selectedNodeIds.has(id)) this.selectNode(id); else { this.selectedNodeId = id; this._syncNodeToolbar(); }
      }
      this.inspectorOpen = true;
      this._notifyInspector();
      this._announce('inspector-open', { nodeId: this.selectedNodeId });
      return this.inspectorOpen;
    }

    closeInspector({ focusNode = false } = {}) {
      if (!this.inspectorOpen) return false;
      const nodeId = this.selectedNodeId;
      this.inspectorOpen = false;
      this._notifyInspector();
      this._announce('inspector-close', { nodeId });
      if (focusNode && nodeId) this.focusNode(nodeId, { select: false });
      return false;
    }

    toggleInspector(nodeId = this.selectedNodeId) {
      if (this.inspectorOpen) return this.closeInspector();
      return this.openInspector(nodeId);
    }

    deleteSelection({ metadata = {} } = {}) {
      if (!this.interactive) return false;
      if (this.selectedEdgeId) {
        const edgeId = this.selectedEdgeId;
        this.dispatch({ type: 'edge.remove', edgeId }, { source: 'delete-selection', ...metadata });
        this.focusCanvas();
        return true;
      }
      const ids = [...this.selectedNodeIds];
      if (!ids.length) return false;
      this.dispatchMany(ids.map(nodeId => ({ type: 'node.remove', nodeId })), { source: 'delete-selection', ...metadata });
      this.focusCanvas();
      return true;
    }

    copySelection() {
      const ids = [...this.selectedNodeIds];
      if (!ids.length) return null;
      this.clipboard = createGraphFragment(this.graph, ids);
      this.clipboardPasteCount = 0;
      this.onClipboardChange?.(this.clipboard, { source: 'copy' });
      return this.clipboard;
    }

    cutSelection({ metadata = {} } = {}) {
      if (!this.interactive || !this.selectedNodeIds.size) return false;
      const fragment = this.copySelection();
      if (!fragment) return false;
      return this.deleteSelection({ metadata: { source: 'cut', ...metadata } });
    }

    pasteClipboard({ at = null, offset = null, metadata = {} } = {}) {
      if (!this.interactive || !this.clipboard?.nodes?.length) return Object.freeze([]);
      this.clipboardPasteCount += 1;
      const base = offset == null ? this.clipboardOffset : normalizePosition(offset, 'offset');
      const translated = at == null ? { x: base.x * this.clipboardPasteCount, y: base.y * this.clipboardPasteCount } : base;
      const before = this._historySnapshot();
      const result = pasteGraphFragment(this.graph, this.clipboard, { offset: translated, at });
      this.graph = result.graph;
      this._pushHistory(before, { source: 'paste', ...metadata });
      this.selectedNodeIds = new Set(result.nodeIds);
      this.selectedNodeId = result.nodeIds.at(-1) ?? null;
      this.selectedEdgeId = null;
      this._syncNodes();
      this._renderEdges();
      this._notifySelection();
      this._notifyDirty({ source: 'paste', ...metadata });
      this.onChange?.(this.graph, Object.freeze([]), { source: 'paste', ...metadata });
      return result.nodeIds;
    }

    duplicateSelection({ offset = null, metadata = {} } = {}) {
      if (!this.interactive || !this.selectedNodeIds.size) return Object.freeze([]);
      const fragment = createGraphFragment(this.graph, [...this.selectedNodeIds]);
      const base = offset == null ? this.clipboardOffset : normalizePosition(offset, 'offset');
      const before = this._historySnapshot();
      const result = pasteGraphFragment(this.graph, fragment, { offset: base });
      this.graph = result.graph;
      this._pushHistory(before, { source: 'duplicate', ...metadata });
      this.selectedNodeIds = new Set(result.nodeIds);
      this.selectedNodeId = result.nodeIds.at(-1) ?? null;
      this.selectedEdgeId = null;
      this._syncNodes();
      this._renderEdges();
      this._notifySelection();
      this._notifyDirty({ source: 'duplicate', ...metadata });
      this.onChange?.(this.graph, Object.freeze([]), { source: 'duplicate', ...metadata });
      return result.nodeIds;
    }

    setNodesDisabled(nodeIds, disabled, { metadata = {} } = {}) {
      if (!this.interactive) return false;
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
      const changes = ids.map(rawId => { const nodeId = assertString(rawId, 'nodeId'); if (!getNode(this.graph, nodeId)) throw new Error(`Node not found: ${nodeId}`); return { type: 'node.disable', nodeId, disabled: Boolean(disabled) }; });
      if (!changes.length) return false;
      this.dispatchMany(changes, { source: 'node-disable', ...metadata });
      return true;
    }

    toggleSelectedDisabled(options = {}) {
      const ids = [...this.selectedNodeIds];
      if (!ids.length) return false;
      const disable = !ids.every(id => getNode(this.graph, id)?.disabled);
      return this.setNodesDisabled(ids, disable, options);
    }

    validateConnection(source, target, { ignoreEdgeId = null } = {}) {
      if (!this.registry) return connectionResult(false, 'REGISTRY_REQUIRED', 'connection.registryRequired', { source, target });
      return validateConnection(this.graph, {
        source, target, registry: this.registry,
        allowSelfConnections: this.connectionPolicy.allowSelfConnections,
        allowCycles: this.connectionPolicy.allowCycles,
        replaceExisting: this.connectionPolicy.replaceExisting,
        isCompatible: this.connectionPolicy.isCompatible,
        ignoreEdgeId,
        validate: this.connectionPolicy.validate
      });
    }

    connectPorts(source, target, { id = null, data = {}, metadata = {} } = {}) {
      const result = this.validateConnection(source, target);
      if (!result.valid) { this.onConnectionResult?.(result, { mode: 'connect' }); return result; }
      const changes = result.edgesToReplace.map(edgeId => ({ type: 'edge.remove', edgeId }));
      const edge = createEdge({ id: id ?? createId('edge', new Set(this.graph.edges.map(item => item.id))), source: result.source, target: result.target, data });
      changes.push({ type: 'edge.add', edge });
      this.dispatchMany(changes, { source: 'connection', ...metadata });
      const success = Object.freeze({ ...result, edgeId: edge.id, edge });
      this.onConnectionResult?.(success, { mode: 'connect' });
      return success;
    }

    reconnectEdge(edgeId, endpoint, nextEndpoint, { metadata = {} } = {}) {
      const edge = getEdge(this.graph, assertString(edgeId, 'edgeId'));
      if (!edge) throw new Error(`Edge not found: ${edgeId}`);
      if (endpoint !== 'source' && endpoint !== 'target') throw new TypeError('endpoint must be "source" or "target".');
      const source = endpoint === 'source' ? normalizeEndpoint(nextEndpoint, 'nextEndpoint') : edge.source;
      const target = endpoint === 'target' ? normalizeEndpoint(nextEndpoint, 'nextEndpoint') : edge.target;
      const result = this.validateConnection(source, target, { ignoreEdgeId: edge.id });
      if (!result.valid) { this.onConnectionResult?.(result, { mode: 'reconnect', edgeId: edge.id, endpoint }); return result; }
      const changes = result.edgesToReplace.filter(id => id !== edge.id).map(id => ({ type: 'edge.remove', edgeId: id }));
      changes.push({ type: 'edge.reconnect', edgeId: edge.id, source: result.source, target: result.target });
      this.dispatchMany(changes, { source: 'edge-reconnect', ...metadata });
      this.selectedEdgeId = edge.id;
      this._renderEdges();
      const success = Object.freeze({ ...result, edgeId: edge.id, edge: getEdge(this.graph, edge.id) });
      this.onConnectionResult?.(success, { mode: 'reconnect', edgeId: edge.id, endpoint });
      return success;
    }

    setViewport(viewport, { anchor = null, emit = true } = {}) {
      const requested = normalizeViewport(viewport, 'viewport');
      const nextViewport = { ...requested, zoom: clampZoom(requested.zoom, this.minZoom, this.maxZoom) };
      const next = applyChange(this.graph, { type: 'graph.viewport', viewport: nextViewport });
      this.graph = next;
      this._applyViewport();
      this._renderEdges();
      if (emit) {
        this.onChange?.(next, { type: 'graph.viewport', viewport: nextViewport }, { source: 'viewport', anchor });
        this.onViewportChange?.(next.viewport, { anchor });
      }
      return next.viewport;
    }

    zoomTo(zoom, { clientX = null, clientY = null } = {}) {
      const current = this.graph.viewport;
      const nextZoom = clampZoom(zoom, this.minZoom, this.maxZoom);
      if (Math.abs(nextZoom - current.zoom) < 1e-9) return current;
      const rect = this.element.getBoundingClientRect();
      const anchor = { x: clientX == null ? rect.left + rect.width / 2 : clientX, y: clientY == null ? rect.top + rect.height / 2 : clientY };
      const flow = screenToFlowPosition(anchor, current, { x: rect.left, y: rect.top });
      const localX = anchor.x - rect.left;
      const localY = anchor.y - rect.top;
      return this.setViewport({ x: localX - flow.x * nextZoom, y: localY - flow.y * nextZoom, zoom: nextZoom }, { anchor });
    }

    zoomIn(options = {}) { return this.zoomTo(this.graph.viewport.zoom * this.zoomStep, options); }
    zoomOut(options = {}) { return this.zoomTo(this.graph.viewport.zoom / this.zoomStep, options); }

    screenToFlowPosition(point) {
      const rect = this.element.getBoundingClientRect();
      return screenToFlowPosition(point, this.graph.viewport, { x: rect.left, y: rect.top });
    }

    flowToScreenPosition(point) {
      const rect = this.element.getBoundingClientRect();
      return flowToScreenPosition(point, this.graph.viewport, { x: rect.left, y: rect.top });
    }

    getNodesBounds(nodeIds = null) {
      const ids = nodeIds == null ? null : new Set(Array.isArray(nodeIds) ? nodeIds : [nodeIds]);
      const nodes = this.graph.nodes.filter(node => !ids || ids.has(node.id));
      if (!nodes.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const node of nodes) {
        const element = this.nodeElements.get(node.id);
        const width = element?.offsetWidth || 176;
        const height = element?.offsetHeight || 74;
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + width);
        maxY = Math.max(maxY, node.position.y + height);
      }
      return Object.freeze({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    }

    fitView(options = {}) { return this._fitNodes(this.graph.nodes.map(node => node.id), options); }
    fitSelection(options = {}) {
      const ids = [...this.selectedNodeIds];
      if (!ids.length) return this.graph.viewport;
      return this._fitNodes(ids, options);
    }
    fitNode(nodeId, options = {}) { const id = assertString(nodeId, 'nodeId'); if (!getNode(this.graph, id)) throw new Error(`Node not found: ${id}`); return this._fitNodes([id], options); }

    centerOnNode(nodeId, { zoom = this.graph.viewport.zoom } = {}) {
      const node = getNode(this.graph, nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      const element = this.nodeElements.get(nodeId);
      const width = element?.offsetWidth || 176;
      const height = element?.offsetHeight || 74;
      const z = clampZoom(zoom, this.minZoom, this.maxZoom);
      return this.setViewport({ x: this.element.clientWidth / 2 - (node.position.x + width / 2) * z, y: this.element.clientHeight / 2 - (node.position.y + height / 2) * z, zoom: z });
    }

    resetViewport() { return this.setViewport({ x: 0, y: 0, zoom: 1 }); }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.element.removeEventListener('wheel', this._onWheel);
      this.element.removeEventListener('pointerdown', this._onPointerDown);
      this.element.removeEventListener('pointermove', this._onPointerMove);
      this.element.removeEventListener('pointerup', this._onPointerUp);
      this.element.removeEventListener('pointercancel', this._onPointerCancel);
      this.element.removeEventListener('keydown', this._onKeyDown);
      this.element.removeEventListener('contextmenu', this._onContextMenu);
      this.miniMap?.removeEventListener('pointerdown', this._onMiniMapPointerDown);
      this._resizeObserver?.disconnect?.(); this._resizeObserver = null;
      if (this._layoutRefreshFrame != null) {
        const view = this.element?.ownerDocument?.defaultView;
        if (typeof view?.cancelAnimationFrame === 'function') view.cancelAnimationFrame(this._layoutRefreshFrame); else clearTimeout(this._layoutRefreshFrame);
        this._layoutRefreshFrame = null;
      }
      this._unsubscribeRuntimeStatus?.(); this._unsubscribeRuntimeStatus = null;
      this.element.replaceChildren();
      this.nodeElements.clear();
      this.portElements.clear();
      this.edgeElements.clear();
      this.edgeHitElements.clear();
      this.pointerState.clear();
    }

    _syncRuntimeStatus(nodeId = null) {
      const ids = nodeId ? [nodeId] : this.graph.nodes.map(node => node.id);
      for (const id of ids) {
        const element = this.nodeElements.get(id); if (!element) continue;
        const entry = this.getRuntimeStatus(id); element.dataset.runtimeStatus = entry.status;
        const detailMessage = entry.detail?.message ? String(entry.detail.message) : '';
        if (detailMessage) element.setAttribute('aria-description', detailMessage); else element.removeAttribute('aria-description');
      }
    }

    _applyValidationStyles() {
      const result = this.validationResult; if (!result) return;
      if (this.nodeElements instanceof Map) for (const [id, element] of this.nodeElements) {
        const issues = result.byNode[id] ?? []; element.dataset.validation = issues.length ? 'error' : 'valid';
        if (issues.length) element.setAttribute('aria-invalid', 'true'); else element.removeAttribute('aria-invalid');
      }
      if (this.edgeHitElements instanceof Map) for (const [id, element] of this.edgeHitElements) {
        const issues = result.byEdge[id] ?? []; element.dataset.validation = issues.length ? 'error' : 'valid';
        if (issues.length) element.setAttribute('aria-invalid', 'true'); else element.removeAttribute('aria-invalid');
      }
    }

    _fitNodes(nodeIds, { padding = this.fitPadding, minZoom = this.minZoom, maxZoom = this.maxZoom } = {}) {
      const bounds = this.getNodesBounds(nodeIds);
      if (!bounds || this.element.clientWidth <= 0 || this.element.clientHeight <= 0) return this.graph.viewport;
      const fitted = calculateFitViewport({ bounds, width: this.element.clientWidth, height: this.element.clientHeight, padding, minZoom, maxZoom });
      return this.setViewport(fitted);
    }

    _nodeTitle(node) {
      if (this.getNodeTitle) return String(this.getNodeTitle(node, this.registry) ?? node.type);
      const definition = this.registry?.get(node.type);
      return String(node.data?.label ?? definition?.titleKey ?? node.type);
    }

    _portMapKey(nodeId, direction, portId) { return `${nodeId}\u0000${direction}\u0000${portId}`; }

    _portLabel(node, port) {
      if (this.getPortLabel) return String(this.getPortLabel(node, port, this.registry) ?? port.id);
      return `${port.dataType} ${port.direction}`;
    }

    _resolvePorts(node) {
      if (!this.registry || !this.registry.has(node.type)) return [];
      return this.registry.resolvePorts(node);
    }

    _createNodeElement(node) {
      const doc = this.element.ownerDocument;
      const root = doc.createElement('article');
      root.className = 'nec-node';
      root.dataset.nodeId = node.id;
      root.tabIndex = 0;
      root.setAttribute('role', 'group');
      root.setAttribute('aria-roledescription', 'Node');
      root.setAttribute('aria-selected', 'false');
      root.setAttribute('aria-keyshortcuts', 'Enter Space Delete');
      const handle = doc.createElement('div');
      handle.className = 'nec-node-handle';
      handle.dataset.nodeDragHandle = 'true';
      const type = doc.createElement('span');
      type.className = 'nec-node-type';
      type.textContent = node.type.slice(0, 1).toUpperCase();
      const title = doc.createElement('span');
      title.className = 'nec-node-title';
      handle.append(type, title);
      const body = doc.createElement('div');
      body.className = 'nec-node-body';
      root.append(handle, body);

      root.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('.nec-port,.nec-node-toolbar')) return;
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        if (additive) { this.selectNode(node.id, { additive: true, toggle: true }); event.stopPropagation(); return; }
        if (!this.selectedNodeIds.has(node.id)) this.selectNode(node.id); else { this.selectedNodeId = node.id; this._syncNodeToolbar(); }
        if (this.interactive && event.target.closest('[data-node-drag-handle]')) this._beginNodeDrag(event, node.id);
        event.stopPropagation();
      });
      root.addEventListener('dblclick', event => { if (!event.target.closest('.nec-port,.nec-node-toolbar')) { event.preventDefault(); event.stopPropagation(); this.openInspector(node.id); } });
      root.addEventListener('focus', () => { if (!this.selectedNodeIds.has(node.id)) this.selectNode(node.id); });
      root.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.selectNode(node.id); }
      });
      this.nodeElements.set(node.id, root);
      this.nodeLayer.append(root);
      return root;
    }

    _syncPorts(node, root) {
      root.querySelectorAll('.nec-port').forEach(element => element.remove());
      for (const [key, element] of this.portElements) if (element.dataset.nodeId === node.id) this.portElements.delete(key);
      for (const port of this._resolvePorts(node)) {
        const button = root.ownerDocument.createElement('button');
        button.type = 'button';
        button.className = `nec-port nec-port-${port.direction}`;
        button.dataset.nodeId = node.id;
        button.dataset.portId = port.id;
        button.dataset.direction = port.direction;
        button.dataset.dataType = port.dataType;
        button.dataset.maxConnections = port.maxConnections == null ? '' : String(port.maxConnections);
        const label = this._portLabel(node, port);
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-keyshortcuts', 'Enter Space Escape');
        button.addEventListener('pointerdown', event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          this.selectNode(node.id);
          if (!this.interactive) return;
          const endpoint = { nodeId: node.id, direction: port.direction, portId: port.id };
          if (event.pointerType === 'touch' && this.touchTapConnect) this._beginTouchPortGesture(event, endpoint);
          else this._beginConnectionDrag(event, endpoint);
        });
        button.addEventListener('focus', () => { if (!this.selectedNodeIds.has(node.id)) this.selectNode(node.id); });
        button.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); this.activatePort({ nodeId: node.id, direction: port.direction, portId: port.id }, { source: 'keyboard' }); }
          else if (event.key === 'Escape' && this.pendingConnection) { event.preventDefault(); event.stopPropagation(); this.cancelPendingConnection(); }
        });
        root.append(button);
        this.portElements.set(this._portMapKey(node.id, port.direction, port.id), button);
      }
      this._positionPorts(node.id);
    }

    _syncNodes() {
      const liveIds = new Set(this.graph.nodes.map(node => node.id));
      for (const [id, element] of this.nodeElements) {
        if (!liveIds.has(id)) { element.remove(); this.nodeElements.delete(id); }
      }
      for (const node of this.graph.nodes) {
        const element = this.nodeElements.get(node.id) || this._createNodeElement(node);
        const title = element.querySelector('.nec-node-title');
        const body = element.querySelector('.nec-node-body');
        title.textContent = this._nodeTitle(node);
        element.setAttribute('aria-label', this._nodeTitle(node));
        element.dataset.disabled = String(Boolean(node.disabled));
        element.setAttribute('aria-disabled', String(Boolean(node.disabled)));
        body.replaceChildren();
        if (this.renderNode) this.renderNode({ node, element, body, registry: this.registry, canvas: this });
        else {
          const strong = element.ownerDocument.createElement('strong'); strong.textContent = node.type;
          const meta = element.ownerDocument.createElement('span'); meta.className = 'nec-node-meta'; meta.textContent = node.id;
          body.append(strong, meta);
        }
        this._positionNode(node.id);
        this._syncPorts(node, element);
      }
      this._positionAllPorts();
      this._syncLayerBounds();
      this._updateSelectionStyles();
      this._syncNodeToolbar();
      this._syncPendingConnectionHighlights();
      this._syncRuntimeStatus();
      this._applyValidationStyles();
    }

    _syncNodeToolbar() {
      for (const element of this.nodeElements.values()) element.querySelector('.nec-node-toolbar')?.remove();
      if (!this.getNodeToolbarActions || !this.selectedNodeId || !this.selectedNodeIds.has(this.selectedNodeId)) return;
      const node = getNode(this.graph, this.selectedNodeId), element = this.nodeElements.get(this.selectedNodeId);
      if (!node || !element) return;
      const rawActions = this.getNodeToolbarActions({ node, selection: this.getSelection(), interactive: this.interactive, canvas: this });
      if (!Array.isArray(rawActions) || !rawActions.length) return;
      const toolbar = element.ownerDocument.createElement('div');
      toolbar.className = 'nec-node-toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.addEventListener('pointerdown', event => event.stopPropagation());
      for (const raw of rawActions) {
        if (!isPlainObject(raw) || !raw.id || !raw.label) continue;
        const button = element.ownerDocument.createElement('button'); button.type = 'button'; button.dataset.actionId = String(raw.id); button.textContent = String(raw.label); button.title = String(raw.title ?? raw.label); button.disabled = !this.interactive || Boolean(raw.disabled); button.dataset.danger = String(Boolean(raw.danger));
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (button.disabled) return; this.onNodeToolbarAction?.(String(raw.id), { node: getNode(this.graph, node.id), selection: this.getSelection(), canvas: this }); });
        toolbar.append(button);
      }
      if (toolbar.childElementCount) element.append(toolbar);
    }

    _positionNode(nodeId) {
      const node = getNode(this.graph, nodeId);
      const element = this.nodeElements.get(nodeId);
      if (!node || !element) return;
      element.style.transform = `translate(${node.position.x}px, ${node.position.y}px)`;
    }

    _positionPorts(nodeId) {
      const node = getNode(this.graph, nodeId);
      const element = this.nodeElements.get(nodeId);
      if (!node || !element) return;
      const height = element.offsetHeight || 74;
      const ports = this._resolvePorts(node);
      for (const direction of ['input', 'output']) {
        const list = ports.filter(port => port.direction === direction);
        list.forEach((port, index) => {
          const button = this.portElements.get(this._portMapKey(node.id, direction, port.id));
          if (!button) return;
          const top = list.length <= 1 ? height / 2 : 38 + (Math.max(18, height - 46) * (index + 1) / (list.length + 1));
          button.style.top = `${Math.min(height - 12, top)}px`;
        });
      }
    }

    _positionAllPorts() { for (const node of this.graph.nodes) this._positionPorts(node.id); }

    _syncLayerBounds() {
      let width = Math.max(1, this.element.clientWidth || 1), height = Math.max(1, this.element.clientHeight || 1);
      for (const node of this.graph.nodes) {
        const element = this.nodeElements.get(node.id);
        width = Math.max(width, node.position.x + (element?.offsetWidth || 176) + 180);
        height = Math.max(height, node.position.y + (element?.offsetHeight || 74) + 180);
      }
      this.zoomLayer.style.width = `${width}px`;
      this.zoomLayer.style.height = `${height}px`;
      this.nodeLayer.style.width = `${width}px`;
      this.nodeLayer.style.height = `${height}px`;
      this.edgeLayer.setAttribute('width', String(width));
      this.edgeLayer.setAttribute('height', String(height));
      this.edgeLayer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    _portCenter(endpoint, expectedDirection = null) {
      const node = getNode(this.graph, endpoint.nodeId);
      if (!node) return null;
      let port = null;
      if (this.registry && this.registry.has(node.type)) port = this.registry.resolvePorts(node).find(item => item.id === endpoint.portId && (!expectedDirection || item.direction === expectedDirection)) ?? null;
      if (!port) return null;
      const button = this.portElements.get(this._portMapKey(node.id, port.direction, port.id));
      const nodeElement = this.nodeElements.get(node.id);
      if (!button || !nodeElement) return null;

      // Match the visible Port center after CSS transforms/zoom. The Port uses
      // translateY(-50%), so offsetTop + offsetHeight / 2 points below the
      // rendered circle. Measure the rendered Port rectangle and convert it
      // back into graph coordinates so visual transforms stay aligned.
      if (typeof button.getBoundingClientRect === 'function' && typeof this.zoomLayer?.getBoundingClientRect === 'function') {
        const buttonRect = button.getBoundingClientRect();
        const layerRect = this.zoomLayer.getBoundingClientRect();
        const zoom = Math.max(1e-9, Number(this.graph.viewport?.zoom) || 1);
        const centerX = buttonRect.left + buttonRect.width / 2;
        const centerY = buttonRect.top + buttonRect.height / 2;
        if ([centerX, centerY, layerRect.left, layerRect.top].every(Number.isFinite)) {
          return { x: (centerX - layerRect.left) / zoom, y: (centerY - layerRect.top) / zoom };
        }
      }

      // DOM-less fallback for tests or non-layout environments. style.top is
      // the visual center because .nec-port is translated upward by 50%.
      const portWidth = button.offsetWidth || 18;
      const x = node.position.x + (button.offsetLeft || (port.direction === 'output' ? nodeElement.offsetWidth : 0)) + portWidth / 2;
      const top = Number.parseFloat(button.style?.top);
      const y = node.position.y + (Number.isFinite(top) ? top : nodeElement.offsetHeight / 2);
      return { x, y };
    }

    _edgePath(a, b) {
      const curve = Math.max(46, Math.abs(b.x - a.x) * 0.45);
      return `M ${a.x} ${a.y} C ${a.x + curve} ${a.y}, ${b.x - curve} ${b.y}, ${b.x} ${b.y}`;
    }

    _edgeLabel(edge) {
      if (this.getEdgeLabel) return String(this.getEdgeLabel(edge, this.graph, this.registry) ?? edge.id);
      const sourceNode = getNode(this.graph, edge.source.nodeId), targetNode = getNode(this.graph, edge.target.nodeId);
      const sourceTitle = sourceNode ? this._nodeTitle(sourceNode) : edge.source.nodeId;
      const targetTitle = targetNode ? this._nodeTitle(targetNode) : edge.target.nodeId;
      return `${sourceTitle} ${edge.source.portId} to ${targetTitle} ${edge.target.portId}`;
    }

    _renderEdges() {
      this.edgeLayer.replaceChildren();
      this.edgeElements.clear();
      this.edgeHitElements.clear();
      for (const edge of this.graph.edges) {
        const source = this._portCenter(edge.source, 'output');
        const target = this._portCenter(edge.target, 'input');
        if (!source || !target) continue;
        const d = this._edgePath(source, target);
        const hit = this.element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
        hit.classList.add('nec-edge-hit'); hit.dataset.edgeId = edge.id; hit.setAttribute('d', d);
        hit.setAttribute('tabindex', '0'); hit.setAttribute('role', 'button'); hit.setAttribute('aria-label', this._edgeLabel(edge)); hit.setAttribute('aria-selected', edge.id === this.selectedEdgeId ? 'true' : 'false');
        hit.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); this.selectEdge(edge.id); });
        hit.addEventListener('focus', () => {
          const changed = this.selectedEdgeId !== edge.id || this.selectedNodeIds.size > 0;
          this.selectEdge(edge.id);
          if (changed) queueMicrotask(() => this.edgeHitElements.get(edge.id)?.focus?.({ preventScroll: true }));
        });
        hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.selectEdge(edge.id); } });
        const path = this.element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('nec-edge'); path.dataset.edgeId = edge.id; path.setAttribute('d', d); path.setAttribute('aria-selected', edge.id === this.selectedEdgeId ? 'true' : 'false'); path.setAttribute('aria-hidden', 'true');
        this.edgeLayer.append(hit, path);
        this.edgeElements.set(edge.id, path);
        this.edgeHitElements.set(edge.id, hit);
        if (edge.id === this.selectedEdgeId) {
          this._appendReconnectHandle(edge, 'source', source);
          this._appendReconnectHandle(edge, 'target', target);
        }
      }
      const gesture = this.gesture;
      if (gesture?.type === 'connection' || gesture?.type === 'edge-reconnect') {
        const points = this._connectionPreviewPoints(gesture);
        if (points) {
          const preview = this.element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
          preview.classList.add('nec-edge', 'nec-edge-preview'); preview.setAttribute('aria-hidden', 'true');
          if (gesture.target) preview.classList.add('is-snapped');
          preview.setAttribute('d', this._edgePath(points.source, points.target));
          this.edgeLayer.append(preview);
        }
      }
      this._applyValidationStyles();
      this._renderMiniMap();
    }

    _appendReconnectHandle(edge, endpoint, point) {
      const circle = this.element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.classList.add('nec-edge-endpoint'); circle.setAttribute('aria-hidden', 'true');
      circle.dataset.edgeId = edge.id; circle.dataset.endpoint = endpoint;
      circle.setAttribute('cx', String(point.x)); circle.setAttribute('cy', String(point.y)); circle.setAttribute('r', '8');
      circle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        if (this.interactive) this._beginReconnectDrag(event, edge.id, endpoint);
      });
      this.edgeLayer.append(circle);
    }

    _nodeBoundsAt(nodeId, position = null) {
      const node = getNode(this.graph, nodeId);
      if (!node) return null;
      const element = this.nodeElements.get(nodeId);
      const point = position ?? node.position;
      return { x: point.x, y: point.y, width: element?.offsetWidth || 176, height: element?.offsetHeight || 74 };
    }

    _dragSnap(starts, dx, dy) {
      const selected = new Set(Object.keys(starts));
      const movedBoxes = Object.entries(starts).map(([nodeId, start]) => this._nodeBoundsAt(nodeId, { x: start.x + dx, y: start.y + dy })).filter(Boolean);
      if (!movedBoxes.length) return { dx, dy, vertical: null, horizontal: null };
      const minX = Math.min(...movedBoxes.map(box => box.x)), minY = Math.min(...movedBoxes.map(box => box.y));
      const maxX = Math.max(...movedBoxes.map(box => box.x + box.width)), maxY = Math.max(...movedBoxes.map(box => box.y + box.height));
      const movingBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      const candidates = this.graph.nodes.filter(node => !selected.has(node.id)).map(node => this._nodeBoundsAt(node.id)).filter(Boolean);
      let snapDx = dx, snapDy = dy, vertical = null, horizontal = null;
      if (this.helperLines && candidates.length) {
        const result = calculateAlignmentSnap({ movingBounds, candidateBounds: candidates, threshold: this.helperLineThreshold / Math.max(1e-9, this.graph.viewport.zoom), snap: this.snapToHelper });
        snapDx += result.dx; snapDy += result.dy; vertical = result.vertical; horizontal = result.horizontal;
      }
      if (this.snapToGrid) {
        const primaryId = this.selectedNodeId && starts[this.selectedNodeId] ? this.selectedNodeId : Object.keys(starts)[0];
        const primary = starts[primaryId];
        if (primary) {
          if (vertical == null || !this.snapToHelper) snapDx += snapToGridValue(primary.x + snapDx, this.gridSize) - (primary.x + snapDx);
          if (horizontal == null || !this.snapToHelper) snapDy += snapToGridValue(primary.y + snapDy, this.gridSize) - (primary.y + snapDy);
        }
      }
      return { dx: snapDx, dy: snapDy, vertical, horizontal };
    }

    _renderHelperGuides(vertical = null, horizontal = null) {
      this.activeHelperGuides = { vertical, horizontal };
      const { x, y, zoom } = this.graph.viewport;
      if (this.helperVertical) {
        if (vertical == null || !this.helperLines) this.helperVertical.classList.remove('is-visible');
        else { this.helperVertical.style.left = `${x + vertical * zoom}px`; this.helperVertical.classList.add('is-visible'); }
      }
      if (this.helperHorizontal) {
        if (horizontal == null || !this.helperLines) this.helperHorizontal.classList.remove('is-visible');
        else { this.helperHorizontal.style.top = `${y + horizontal * zoom}px`; this.helperHorizontal.classList.add('is-visible'); }
      }
    }

    _clearHelperGuides() { this._renderHelperGuides(null, null); }

    _renderMiniMap() {
      if (!this.miniMap || !this.miniMapSvg || !this.miniMapVisible) return;
      const nodeBounds = this.getNodesBounds();
      if (!nodeBounds) { this.miniMapSvg.replaceChildren(); return; }
      const visibleWidth = Math.max(1, this.element.clientWidth / this.graph.viewport.zoom);
      const visibleHeight = Math.max(1, this.element.clientHeight / this.graph.viewport.zoom);
      const visibleX = -this.graph.viewport.x / this.graph.viewport.zoom;
      const visibleY = -this.graph.viewport.y / this.graph.viewport.zoom;
      const minX = Math.min(nodeBounds.x - 30, visibleX), minY = Math.min(nodeBounds.y - 30, visibleY);
      const maxX = Math.max(nodeBounds.x + nodeBounds.width + 30, visibleX + visibleWidth);
      const maxY = Math.max(nodeBounds.y + nodeBounds.height + 30, visibleY + visibleHeight);
      const viewBox = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
      this._miniMapViewBox = viewBox;
      this.miniMapSvg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
      this.miniMapSvg.replaceChildren();
      for (const node of this.graph.nodes) {
        const bounds = this._nodeBoundsAt(node.id); if (!bounds) continue;
        const rect = this.element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.classList.add('nec-minimap-node'); if (this.selectedNodeIds.has(node.id)) rect.classList.add('is-selected');
        rect.setAttribute('x', String(bounds.x)); rect.setAttribute('y', String(bounds.y)); rect.setAttribute('width', String(bounds.width)); rect.setAttribute('height', String(bounds.height)); rect.setAttribute('rx', '6');
        rect.dataset.nodeId = node.id;
        this.miniMapSvg.append(rect);
      }
      const viewport = this.element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
      viewport.classList.add('nec-minimap-viewport'); viewport.setAttribute('x', String(visibleX)); viewport.setAttribute('y', String(visibleY)); viewport.setAttribute('width', String(visibleWidth)); viewport.setAttribute('height', String(visibleHeight)); viewport.setAttribute('rx', '5');
      this.miniMapSvg.append(viewport);
    }

    _handleMiniMapPointerDown(event) {
      if (!this.miniMapVisible || event.button !== 0 || !this._miniMapViewBox) return;
      event.preventDefault(); event.stopPropagation();
      const nodeTarget = event.target.closest?.('.nec-minimap-node');
      if (nodeTarget?.dataset.nodeId) { this.selectNode(nodeTarget.dataset.nodeId); this.centerOnNode(nodeTarget.dataset.nodeId); return; }
      const rect = this.miniMap.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      const box = this._miniMapViewBox;
      const worldX = box.x + ((event.clientX - rect.left) / rect.width) * box.width;
      const worldY = box.y + ((event.clientY - rect.top) / rect.height) * box.height;
      const zoom = this.graph.viewport.zoom;
      this.setViewport({ x: this.element.clientWidth / 2 - worldX * zoom, y: this.element.clientHeight / 2 - worldY * zoom, zoom });
    }

    _applyViewport() {
      const { x, y, zoom } = this.graph.viewport;
      this.stage.style.transform = `translate(${x}px, ${y}px)`;
      const view = this.element.ownerDocument?.defaultView;
      const cssApi = view?.CSS ?? globalThis.CSS;
      const supportsCssZoom = typeof cssApi?.supports === 'function' && cssApi.supports('zoom', '1');
      if (supportsCssZoom) { this.zoomLayer.style.zoom = String(zoom); this.zoomLayer.style.transform = 'none'; }
      else { this.zoomLayer.style.zoom = ''; this.zoomLayer.style.transform = `scale(${zoom})`; }
      const grid = (Number(this.gridSize) > 0 ? Number(this.gridSize) : 20) * zoom;
      this.element.style.backgroundSize = `${grid}px ${grid}px`;
      this.element.style.setProperty('--nec-grid-x', `${x % grid}px`);
      this.element.style.setProperty('--nec-grid-y', `${y % grid}px`);
      const level = getContextualZoomLevel(zoom, this.contextualZoom ?? { compactBelow: 0.65, detailedAbove: 1.4 });
      if (this.element.dataset) this.element.dataset.zoomLevel = level;
      if (level !== this.lastContextualZoomLevel) { const previous = this.lastContextualZoomLevel; this.lastContextualZoomLevel = level; this.onContextualZoomChange?.(level, { previous, zoom, canvas: this }); }
      const guides = this.activeHelperGuides ?? { vertical: null, horizontal: null };
      if (typeof this._renderHelperGuides === 'function') this._renderHelperGuides(guides.vertical, guides.horizontal);
    }

    _updateSelectionStyles() {
      for (const [id, element] of this.nodeElements) element.setAttribute('aria-selected', this.selectedNodeIds.has(id) ? 'true' : 'false');
      for (const [id, element] of this.edgeElements) element.setAttribute('aria-selected', id === this.selectedEdgeId ? 'true' : 'false');
      for (const [id, element] of this.edgeHitElements) element.setAttribute('aria-selected', id === this.selectedEdgeId ? 'true' : 'false');
    }

    _notifySelection() {
      this.onSelectionChange?.(this.getSelection(), this.selectedNodeId);
      this.onEdgeSelectionChange?.(this.selectedEdgeId);
      if (this.inspectorOpen) this._notifyInspector();
    }

    _notifyInspector() {
      this.onInspectorChange?.({ open: this.inspectorOpen, nodeId: this.selectedNodeId, selection: this.getSelection(), canvas: this });
    }

    _beginNodeDrag(event, nodeId) {
      if (!this.interactive) return;
      const node = getNode(this.graph, nodeId);
      if (!node) return;
      if (!this.selectedNodeIds.has(nodeId)) this.selectNode(nodeId);
      this._clearHelperGuides();
      this.beginTransaction('node-drag', { source: 'pointer-drag' });
      const starts = {};
      for (const id of this.selectedNodeIds) { const item = getNode(this.graph, id); if (item) starts[id] = { ...item.position }; }
      this.gesture = { type: 'node-drag', pointerId: event.pointerId, nodeId, startClient: { x: event.clientX, y: event.clientY }, starts, zoom: this.graph.viewport.zoom, moved: false };
      this.element.setPointerCapture?.(event.pointerId);
    }

    _beginTouchPortGesture(event, start) {
      if (!this.interactive || !this.registry) return;
      this.gesture = { type: 'touch-port', pointerId: event.pointerId, start: { ...start }, startClient: { x: event.clientX, y: event.clientY }, pointerType: 'touch' };
      this.element.setPointerCapture?.(event.pointerId);
    }

    _beginConnectionDrag(event, start) {
      if (!this.interactive || !this.registry) return;
      this.cancelPendingConnection({ announce: false });
      const node = getNode(this.graph, start.nodeId);
      const port = node ? getPort(this.registry, node, start.portId, start.direction) : null;
      if (!node || !port) return;
      this.gesture = {
        type: 'connection', pointerId: event.pointerId, start: { ...start },
        startClient: { x: event.clientX, y: event.clientY }, point: this.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        target: null, moved: false, pointerType: event.pointerType
      };
      this.element.setPointerCapture?.(event.pointerId);
      this._updateConnectionHighlights(this.gesture);
      this._renderEdges();
    }

    _beginReconnectDrag(event, edgeId, endpoint) {
      if (!this.interactive || !this.registry) return;
      const edge = getEdge(this.graph, edgeId); if (!edge) return;
      this.selectedEdgeId = edge.id; this.selectedNodeIds.clear(); this.selectedNodeId = null;
      this.gesture = {
        type: 'edge-reconnect', pointerId: event.pointerId, edgeId: edge.id, endpoint,
        startClient: { x: event.clientX, y: event.clientY }, point: this.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        target: null, moved: false, pointerType: event.pointerType
      };
      this.element.setPointerCapture?.(event.pointerId);
      this._updateConnectionHighlights(this.gesture);
      this._renderEdges();
    }

    _candidateDirection(gesture) {
      if (gesture.type === 'connection') return gesture.start.direction === 'output' ? 'input' : 'output';
      return gesture.endpoint === 'source' ? 'output' : 'input';
    }

    _connectionPair(start, target) {
      if (start.direction === 'output' && target.direction === 'input') return { source: { nodeId: start.nodeId, portId: start.portId }, target: { nodeId: target.nodeId, portId: target.portId } };
      if (start.direction === 'input' && target.direction === 'output') return { source: { nodeId: target.nodeId, portId: target.portId }, target: { nodeId: start.nodeId, portId: start.portId } };
      return null;
    }

    _validationForGestureTarget(gesture, target) {
      if (gesture.type === 'connection') {
        const pair = this._connectionPair(gesture.start, target);
        return pair ? this.validateConnection(pair.source, pair.target) : connectionResult(false, 'DIRECTION_MISMATCH', 'connection.directionMismatch');
      }
      const edge = getEdge(this.graph, gesture.edgeId); if (!edge) return connectionResult(false, 'MISSING_EDGE', 'connection.missingEdge');
      const source = gesture.endpoint === 'source' ? { nodeId: target.nodeId, portId: target.portId } : edge.source;
      const targetEndpoint = gesture.endpoint === 'target' ? { nodeId: target.nodeId, portId: target.portId } : edge.target;
      return this.validateConnection(source, targetEndpoint, { ignoreEdgeId: edge.id });
    }

    _updateConnectionHighlights(gesture) {
      const direction = this._candidateDirection(gesture);
      for (const element of this.portElements.values()) {
        element.classList.remove('is-valid-target', 'is-invalid-target', 'is-magnet', 'is-pending');
        element.setAttribute('aria-pressed', 'false');
        if (gesture.type === 'connection' && element.dataset.nodeId === gesture.start.nodeId && element.dataset.direction === gesture.start.direction && element.dataset.portId === gesture.start.portId) { element.classList.add('is-pending'); element.setAttribute('aria-pressed', 'true'); }
        if (element.dataset.direction !== direction) continue;
        const target = { nodeId: element.dataset.nodeId, direction, portId: element.dataset.portId };
        const result = this._validationForGestureTarget(gesture, target);
        element.classList.add(result.valid ? 'is-valid-target' : 'is-invalid-target');
      }
    }

    _clearConnectionHighlights() { for (const element of this.portElements.values()) { element.classList.remove('is-valid-target', 'is-invalid-target', 'is-magnet', 'is-pending'); element.setAttribute('aria-pressed', 'false'); } }

    _syncPendingConnectionHighlights() {
      if (this.gesture?.type === 'connection' || this.gesture?.type === 'edge-reconnect') return;
      if (!this.pendingConnection) { this._clearConnectionHighlights(); return; }
      this._updateConnectionHighlights({ type: 'connection', start: this.pendingConnection });
    }

    _nearestConnectionTarget(gesture, event) {
      const direction = this._candidateDirection(gesture);
      const radius = event.pointerType === 'touch' ? this.connectionPolicy.touchMagnetRadius : this.connectionPolicy.mouseMagnetRadius;
      let best = null, bestDistance = radius;
      for (const element of this.portElements.values()) {
        if (element.dataset.direction !== direction || !element.classList.contains('is-valid-target')) continue;
        const rect = element.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const distance = Math.hypot(event.clientX - cx, event.clientY - cy);
        if (distance <= bestDistance) { best = element; bestDistance = distance; }
      }
      return best;
    }

    _setMagnetTarget(gesture, element) {
      for (const port of this.portElements.values()) port.classList.remove('is-magnet');
      gesture.target = null;
      if (!element) return;
      element.classList.add('is-magnet');
      gesture.target = { nodeId: element.dataset.nodeId, direction: element.dataset.direction, portId: element.dataset.portId };
    }

    _connectionPreviewPoints(gesture) {
      const point = gesture.target ? this._portCenter({ nodeId: gesture.target.nodeId, portId: gesture.target.portId }, gesture.target.direction) : gesture.point;
      if (!point) return null;
      if (gesture.type === 'connection') {
        const anchor = this._portCenter({ nodeId: gesture.start.nodeId, portId: gesture.start.portId }, gesture.start.direction);
        if (!anchor) return null;
        return gesture.start.direction === 'output' ? { source: anchor, target: point } : { source: point, target: anchor };
      }
      const edge = getEdge(this.graph, gesture.edgeId); if (!edge) return null;
      if (gesture.endpoint === 'source') {
        const fixed = this._portCenter(edge.target, 'input');
        return fixed ? { source: point, target: fixed } : null;
      }
      const fixed = this._portCenter(edge.source, 'output');
      return fixed ? { source: fixed, target: point } : null;
    }

    _finishConnectionGesture(event, cancel = false) {
      const gesture = this.gesture;
      if (!gesture || (gesture.type !== 'connection' && gesture.type !== 'edge-reconnect') || gesture.pointerId !== event.pointerId) return false;
      this.gesture = null;
      let target = !cancel ? gesture.target : null;
      if (!target && !cancel) {
        const hit = this.element.ownerDocument.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('.nec-port');
        if (hit && hit.classList.contains('is-valid-target')) target = { nodeId: hit.dataset.nodeId, direction: hit.dataset.direction, portId: hit.dataset.portId };
      }
      this._clearConnectionHighlights();
      if (!cancel && gesture.moved && target) {
        if (gesture.type === 'connection') {
          const pair = this._connectionPair(gesture.start, target);
          if (pair) this.connectPorts(pair.source, pair.target, { metadata: { pointerType: event.pointerType } });
        } else this.reconnectEdge(gesture.edgeId, gesture.endpoint, { nodeId: target.nodeId, portId: target.portId }, { metadata: { pointerType: event.pointerType } });
      }
      this._renderEdges();
      return true;
    }

    _handleCanvasPointerDown(event) {
      if (event.button !== 0) return;
      this.element.focus({ preventScroll: true });
      if (event.shiftKey && event.pointerType !== 'touch') {
        event.preventDefault();
        const rect = this.element.getBoundingClientRect();
        this.gesture = { type: 'marquee', pointerId: event.pointerId, start: { x: event.clientX - rect.left, y: event.clientY - rect.top }, point: { x: event.clientX - rect.left, y: event.clientY - rect.top }, additive: event.ctrlKey || event.metaKey };
        this.element.setPointerCapture?.(event.pointerId);
        this._renderMarquee();
        return;
      }
      this.clearSelection();
      if (event.pointerType === 'touch') {
        this.pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.element.setPointerCapture?.(event.pointerId);
        if (this.pointerState.size === 2) this._beginPinch();
        else this.gesture = { type: 'pan', pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY }, startViewport: this.graph.viewport };
      } else {
        this.element.setPointerCapture?.(event.pointerId);
        this.gesture = { type: 'pan', pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY }, startViewport: this.graph.viewport };
      }
    }

    _renderMarquee() {
      const gesture = this.gesture;
      if (!gesture || gesture.type !== 'marquee') { this.selectionMarquee.classList.remove('is-visible'); this.selectionMarquee.removeAttribute('style'); return; }
      const left = Math.min(gesture.start.x, gesture.point.x), top = Math.min(gesture.start.y, gesture.point.y);
      const width = Math.abs(gesture.point.x - gesture.start.x), height = Math.abs(gesture.point.y - gesture.start.y);
      Object.assign(this.selectionMarquee.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      this.selectionMarquee.classList.add('is-visible');
    }

    _finishMarquee(gesture) {
      const canvasRect = this.element.getBoundingClientRect();
      const left = canvasRect.left + Math.min(gesture.start.x, gesture.point.x), right = canvasRect.left + Math.max(gesture.start.x, gesture.point.x);
      const top = canvasRect.top + Math.min(gesture.start.y, gesture.point.y), bottom = canvasRect.top + Math.max(gesture.start.y, gesture.point.y);
      const ids = [];
      for (const [id, element] of this.nodeElements) {
        const rect = element.getBoundingClientRect();
        const selected = this.selectionMode === 'full' ? (rect.left >= left && rect.right <= right && rect.top >= top && rect.bottom <= bottom) : (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom);
        if (selected) ids.push(id);
      }
      const next = gesture.additive ? [...new Set([...this.selectedNodeIds, ...ids])] : ids;
      this.setSelection(next, { primaryNodeId: ids[ids.length - 1] ?? (gesture.additive ? this.selectedNodeId : null) });
      this.selectionMarquee.classList.remove('is-visible'); this.selectionMarquee.removeAttribute('style');
    }

    _handlePointerMove(event) {
      let gesture = this.gesture;
      if (gesture?.type === 'touch-port' && gesture.pointerId === event.pointerId) {
        const distance = Math.hypot(event.clientX - gesture.startClient.x, event.clientY - gesture.startClient.y);
        if (distance < this.touchDragThreshold) return;
        this.cancelPendingConnection({ announce: false });
        this.gesture = gesture = { type: 'connection', pointerId: event.pointerId, start: { ...gesture.start }, startClient: { ...gesture.startClient }, point: this.screenToFlowPosition({ x: event.clientX, y: event.clientY }), target: null, moved: true, pointerType: 'touch' };
        this._updateConnectionHighlights(gesture);
      }
      if (gesture && (gesture.type === 'connection' || gesture.type === 'edge-reconnect') && gesture.pointerId === event.pointerId) {
        gesture.point = this.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        if (!gesture.moved && Math.hypot(event.clientX - gesture.startClient.x, event.clientY - gesture.startClient.y) > 3) gesture.moved = true;
        const target = this._nearestConnectionTarget(gesture, event);
        this._setMagnetTarget(gesture, target);
        this._renderEdges();
        return;
      }
      if (event.pointerType === 'touch' && this.pointerState.has(event.pointerId)) {
        this.pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (this.pointerState.size >= 2) { if (this.gesture?.type !== 'pinch') this._beginPinch(); this._updatePinch(); return; }
      }
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (gesture.type === 'marquee') {
        const rect = this.element.getBoundingClientRect(); gesture.point = { x: event.clientX - rect.left, y: event.clientY - rect.top }; this._renderMarquee(); return;
      }
      if (gesture.type === 'node-drag') {
        const rawDx = (event.clientX - gesture.startClient.x) / gesture.zoom, rawDy = (event.clientY - gesture.startClient.y) / gesture.zoom;
        if (!gesture.moved && Math.hypot(rawDx, rawDy) < 1.5) return; gesture.moved = true;
        const snapped = this._dragSnap(gesture.starts, rawDx, rawDy);
        this._renderHelperGuides(snapped.vertical, snapped.horizontal);
        const changes = Object.entries(gesture.starts).map(([nodeId, startPosition]) => ({ type: 'node.position', nodeId, position: { x: startPosition.x + snapped.dx, y: startPosition.y + snapped.dy } }));
        this.dispatchMany(changes, { source: 'pointer-drag', transient: true });
      } else if (gesture.type === 'pan') {
        this.setViewport({ x: gesture.startViewport.x + event.clientX - gesture.startClient.x, y: gesture.startViewport.y + event.clientY - gesture.startClient.y, zoom: gesture.startViewport.zoom });
      }
    }

    _handlePointerUp(event, cancel = false) {
      if (this.gesture?.type === 'touch-port' && this.gesture.pointerId === event.pointerId) {
        const gesture = this.gesture; this.gesture = null;
        if (!cancel) this.activatePort(gesture.start, { source: 'touch' });
        try { this.element.releasePointerCapture?.(event.pointerId); } catch {}
        return;
      }
      if (this._finishConnectionGesture(event, cancel)) {
        try { this.element.releasePointerCapture?.(event.pointerId); } catch {}
        return;
      }
      if (this.gesture?.type === 'marquee' && this.gesture.pointerId === event.pointerId) { const gesture = this.gesture; this.gesture = null; if (!cancel) this._finishMarquee(gesture); else { this.selectionMarquee.classList.remove('is-visible'); this.selectionMarquee.removeAttribute('style'); } try { this.element.releasePointerCapture?.(event.pointerId); } catch {} return; }
      if (event.pointerType === 'touch') this.pointerState.delete(event.pointerId);
      if (this.gesture?.type === 'node-drag' && this.gesture.pointerId === event.pointerId) {
        if (cancel) this.cancelTransaction(); else this.commitTransaction({ source: 'pointer-drag' });
        this._clearHelperGuides();
      }
      if (this.gesture?.pointerId === event.pointerId || this.gesture?.type === 'pinch') this.gesture = null;
      if (this.pointerState.size === 1 && event.pointerType === 'touch') {
        const [[pointerId, point]] = this.pointerState.entries();
        this.gesture = { type: 'pan', pointerId, startClient: { ...point }, startViewport: this.graph.viewport };
      }
      try { this.element.releasePointerCapture?.(event.pointerId); } catch {}
    }

    _beginPinch() {
      const points = Array.from(this.pointerState.values()).slice(0, 2);
      if (points.length < 2) return;
      const dx = points[1].x - points[0].x, dy = points[1].y - points[0].y;
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const rect = this.element.getBoundingClientRect();
      this.gesture = { type: 'pinch', startDistance: Math.max(1, Math.hypot(dx, dy)), startViewport: this.graph.viewport, flowAnchor: screenToFlowPosition(center, this.graph.viewport, { x: rect.left, y: rect.top }) };
    }

    _updatePinch() {
      const gesture = this.gesture; if (!gesture || gesture.type !== 'pinch') return;
      const points = Array.from(this.pointerState.values()).slice(0, 2); if (points.length < 2) return;
      const dx = points[1].x - points[0].x, dy = points[1].y - points[0].y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const rect = this.element.getBoundingClientRect();
      const zoom = clampZoom(gesture.startViewport.zoom * distance / gesture.startDistance, this.minZoom, this.maxZoom);
      const localX = center.x - rect.left, localY = center.y - rect.top;
      this.setViewport({ x: localX - gesture.flowAnchor.x * zoom, y: localY - gesture.flowAnchor.y * zoom, zoom });
    }

    _handleWheel(event) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      this.zoomTo(this.graph.viewport.zoom * factor, { clientX: event.clientX, clientY: event.clientY });
    }

    _handleKeyDown(event) {
      const target = event.target;
      const editable = target?.matches?.('input,textarea,select,[contenteditable="true"]');
      if (event.key === 'Escape') {
        if (this.pendingConnection) { event.preventDefault(); this.cancelPendingConnection(); }
        else if (this.gesture?.type === 'connection' || this.gesture?.type === 'edge-reconnect') { this.gesture = null; this._clearConnectionHighlights(); this._renderEdges(); }
        else if (this.gesture?.type === 'marquee') { this.gesture = null; this._renderMarquee(); }
        else if (this.gesture?.type === 'node-drag') { event.preventDefault(); this.cancelTransaction(); this.gesture = null; this._clearHelperGuides(); }
        else this.clearSelection();
      }
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (!editable && modifier && key === 'z') { event.preventDefault(); if (event.shiftKey) this.redo(); else this.undo(); }
      else if (!editable && modifier && key === 'y') { event.preventDefault(); this.redo(); }
      else if (!editable && modifier && key === 'c') { event.preventDefault(); this.copySelection(); }
      else if (!editable && modifier && key === 'x') { event.preventDefault(); this.cutSelection({ metadata: { source: 'keyboard' } }); }
      else if (!editable && modifier && key === 'v') { event.preventDefault(); this.pasteClipboard({ metadata: { source: 'keyboard' } }); }
      else if (!editable && modifier && key === 'd') { event.preventDefault(); this.duplicateSelection({ metadata: { source: 'keyboard' } }); }
      else if (!editable && this.interactive && (event.key === 'Delete' || event.key === 'Backspace') && (this.selectedEdgeId || this.selectedNodeIds.size)) { event.preventDefault(); this.deleteSelection({ metadata: { source: 'keyboard' } }); }
      if (!editable && modifier && key === 'a') { event.preventDefault(); this.selectAllNodes(); }
      if ((event.key === '+' || event.key === '=') && !event.ctrlKey && !event.metaKey) { event.preventDefault(); this.zoomIn(); }
      if (event.key === '-' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); this.zoomOut(); }
      if (event.key === '0' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); this.resetViewport(); }
    }

    _handleContextMenu(event) {
      if (!this.onContextMenu) return;
      const nodeElement = event.target.closest?.('.nec-node'), edgeElement = event.target.closest?.('.nec-edge-hit');
      let kind = 'canvas', nodeId = null, edgeId = null;
      if (nodeElement) { kind = 'node'; nodeId = nodeElement.dataset.nodeId; }
      else if (edgeElement) { kind = 'edge'; edgeId = edgeElement.dataset.edgeId; }
      event.preventDefault();
      this.onContextMenu({ kind, nodeId, edgeId, selection: this.getSelection(), primaryNodeId: this.selectedNodeId, selectedEdgeId: this.selectedEdgeId, flowPosition: this.screenToFlowPosition({ x: event.clientX, y: event.clientY }), clientPosition: { x: event.clientX, y: event.clientY }, interactive: this.interactive, originalEvent: event, canvas: this });
    }
  }


  function cloneGraph(graph) { return normalizeGraph(clonePersistentValue(graph, 'graph')); }
  function serializeGraph(graph, { pretty = true } = {}) { assertValidGraph(graph); return JSON.stringify(normalizeGraph(graph), null, pretty ? 2 : 0); }
  function deserializeGraph(jsonOrObject, { migrations = new CoreMigrationRegistry(), targetVersion = CORE_SCHEMA_VERSION, registry = null } = {}) {
    let document;
    if (typeof jsonOrObject === 'string') {
      try { document = JSON.parse(jsonOrObject); }
      catch (error) { const wrapped = new SyntaxError(`Graph JSON could not be parsed: ${error.message}`); wrapped.cause = error; throw wrapped; }
    } else document = clonePersistentValue(jsonOrObject, 'document');
    if (!isPlainObject(document)) throw new TypeError('Graph document must be an object.');
    if (document.format !== FORMAT) throw new TypeError(`Graph document format must be "${FORMAT}".`);
    if (!Number.isInteger(document.coreSchemaVersion) || document.coreSchemaVersion < 1) throw new TypeError('Graph document must include a positive coreSchemaVersion.');
    if (document.coreSchemaVersion > targetVersion) throw new Error(`Graph schema ${document.coreSchemaVersion} is newer than supported schema ${targetVersion}.`);
    if (document.coreSchemaVersion < targetVersion) document = migrations.migrate(document, targetVersion);
    let normalized = normalizeGraph(document);
    if (registry instanceof NodeRegistry) normalized = registry.migrateGraph(normalized);
    assertValidGraph(normalized, { registry }); return normalizeGraph(normalized);
  }

  return Object.freeze({ FORMAT, CORE_SCHEMA_VERSION, CHANGE_TYPES, RUNTIME_STATUSES, NodeRegistry, CoreMigrationRegistry, GraphHistory, RuntimeStatusStore, Translator, LayoutRegistry, NodeCanvas, NODE_CANVAS_CSS, installNodeCanvasStyles, normalizeTheme, applyTheme, clampZoom, screenToFlowPosition, flowToScreenPosition, calculateFitViewport, snapToGridValue, calculateAlignmentSnap, getContextualZoomLevel, createValidationResult, normalizeLayoutResult, createBenchmarkGraph, benchmarkGraphModel, createId, createGraph, createNode, createEdge, cloneGraph, graphContentSignature, createGraphFragment, pasteGraphFragment, applyChange, applyChanges, getNode, getEdge, getPort, getIncomingEdges, getOutgoingEdges, getIncidentEdges, getUpstreamNodeIds, getDownstreamNodeIds, arePortTypesCompatible, topologicalSort, hasDirectedCycle, validateConnection, validateGraph, assertValidGraph, serializeGraph, deserializeGraph });
})();

globalThis.NodeEditorCore = NodeEditorCore;
export default NodeEditorCore;
