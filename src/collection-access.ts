import type { Collection } from 'lokijs';
import { applyPatch } from 'rfc6902';
import type { Operation } from 'rfc6902';
import { LokiDatabaseLifecycle, DatabaseLifecycle } from './database-lifecycle';
import { sortByDateDesc } from './utils';

export type CollectionAccessErrorCode =
  | 'INVALID_COLLECTION'
  | 'COLLECTION_NOT_FOUND'
  | 'INVALID_FILTER'
  | 'INVALID_PROJECTION'
  | 'INVALID_PAGINATION'
  | 'INVALID_ORDERING'
  | 'INVALID_RECORD'
  | 'IDENTITY_CONFLICT'
  | 'RECORD_NOT_FOUND'
  | 'INVALID_IDENTITY'
  | 'INVALID_PATCH'
  | 'BULK_FAILED';

export class CollectionAccessError extends Error {
  public constructor(
    public readonly code: CollectionAccessErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'CollectionAccessError';
  }
}

export interface CollectionQuery {
  filter?: Record<string, unknown>;
  projection?: string[];
  offset?: number;
  limit?: number;
  orderBy?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
}

export type RecordIdentity = number | Record<string, unknown>;

export type BulkMutation =
  | { type: 'create'; record: Record<string, unknown> }
  | { type: 'replace'; identity: RecordIdentity; record: Record<string, unknown> }
  | { type: 'patch'; identity: RecordIdentity; patch: Operation[] }
  | { type: 'delete'; identity: RecordIdentity };

export interface CollectionAccess {
  collections(): Array<{ name: string; entries: number }>;
  query(collection: string, query?: CollectionQuery): Promise<Array<Record<string, unknown>>>;
  get(collection: string, identity: RecordIdentity): Promise<Record<string, unknown>>;
  create(collection: string, record: Record<string, unknown>): Promise<Record<string, unknown>>;
  replace(
    collection: string,
    identity: RecordIdentity,
    record: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  patch(collection: string, identity: RecordIdentity, patch: Operation[]): Promise<Record<string, unknown>>;
  delete(collection: string, identity: RecordIdentity): Promise<Record<string, unknown>>;
  bulk(collection: string, mutations: BulkMutation[]): Promise<Array<Record<string, unknown>>>;
}

const collectionNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const propertyNamePattern = /^[A-Za-z_$][A-Za-z0-9_$.-]*$/;
const forbiddenProperties = new Set(['__proto__', 'prototype', 'constructor']);
const supportedOperators = new Set([
  '$eq',
  '$aeq',
  '$ne',
  '$dteq',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$jgt',
  '$jgte',
  '$jlt',
  '$jlte',
  '$between',
  '$jbetween',
  '$in',
  '$nin',
  '$keyin',
  '$nkeyin',
  '$definedin',
  '$undefinedin',
  '$containsString',
  '$containsNone',
  '$containsAny',
  '$contains',
  '$elemMatch',
  '$type',
  '$finite',
  '$size',
  '$len',
  '$not',
  '$and',
  '$or',
  '$exists',
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clone = <T>(value: T): T => structuredClone(value);

const validateProperty = (property: string, code: CollectionAccessErrorCode) => {
  const segments = property.split('.');
  if (
    !propertyNamePattern.test(property) ||
    segments.some((segment) => forbiddenProperties.has(segment))
  ) {
    throw new CollectionAccessError(code, `Invalid property '${property}'.`, 400);
  }
};

const validateFilterValue = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(validateFilterValue);
    return;
  }
  if (!isObject(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith('$')) {
      if (!supportedOperators.has(key)) {
        throw new CollectionAccessError('INVALID_FILTER', `Unsupported filter operator '${key}'.`, 400);
      }
    } else {
      validateProperty(key, 'INVALID_FILTER');
    }
    validateFilterValue(nested);
  }
};

const isOperation = (value: unknown): value is Operation => {
  if (!isObject(value) || typeof value.op !== 'string' || typeof value.path !== 'string') {
    return false;
  }
  switch (value.op) {
    case 'add':
    case 'replace':
    case 'test':
      return 'value' in value;
    case 'copy':
    case 'move':
      return typeof value.from === 'string';
    case 'remove':
      return true;
    default:
      return false;
  }
};

export const isJsonPatch = (value: unknown): value is Operation[] =>
  Array.isArray(value) && value.length > 0 && value.every(isOperation);

const pathRoot = (pointer: string) => pointer.split('/')[1]?.replace(/~1/g, '/').replace(/~0/g, '~');

export class LokiCollectionAccess implements CollectionAccess {
  public constructor(private readonly database: LokiDatabaseLifecycle) {}

  public collections() {
    this.requireReady();
    return this.database.collections();
  }

  public async query(collectionName: string, query: CollectionQuery = {}) {
    const collection = this.requireCollection(collectionName);
    const { filter, projection, offset, limit, orderBy } = query;
    if (filter !== undefined) {
      if (!isObject(filter)) {
        throw new CollectionAccessError('INVALID_FILTER', 'Filter must be a JSON object.', 400);
      }
      validateFilterValue(filter);
    }
    if (projection !== undefined) {
      if (!Array.isArray(projection) || projection.length === 0 || projection.some((property) => !property)) {
        throw new CollectionAccessError('INVALID_PROJECTION', 'Projection must contain at least one property.', 400);
      }
      projection.forEach((property) => {
        validateProperty(property, 'INVALID_PROJECTION');
        if (property.includes('.')) {
          throw new CollectionAccessError('INVALID_PROJECTION', 'Projection supports top-level properties only.', 400);
        }
      });
    }
    if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
      throw new CollectionAccessError('INVALID_PAGINATION', 'Offset must be a non-negative integer.', 400);
    }
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      throw new CollectionAccessError('INVALID_PAGINATION', 'Limit must be a non-negative integer.', 400);
    }
    if (orderBy !== undefined) {
      if (!Array.isArray(orderBy) || orderBy.length === 0) {
        throw new CollectionAccessError('INVALID_ORDERING', 'Ordering must contain at least one property.', 400);
      }
      orderBy.forEach(({ field, direction }) => {
        validateProperty(field, 'INVALID_ORDERING');
        if (direction !== undefined && direction !== 'asc' && direction !== 'desc') {
          throw new CollectionAccessError('INVALID_ORDERING', `Invalid direction for '${field}'.`, 400);
        }
      });
    }

    let result = collection.chain();
    if (filter) {
      result = result.find(filter);
    }
    if (orderBy) {
      result = result.compoundsort(orderBy.map(({ field, direction }) => [field, direction === 'desc']));
    } else {
      result = result.sort(sortByDateDesc);
    }
    if (offset !== undefined) {
      result = result.offset(offset);
    }
    if (limit !== undefined) {
      result = result.limit(limit);
    }

    const records = result.data().map((record) => clone(record));
    return projection
      ? records.map((record) =>
          Object.fromEntries(projection.filter((property) => property in record).map((property) => [property, record[property]])),
        )
      : records;
  }

  public async create(collectionName: string, record: Record<string, unknown>) {
    const created = this.createRecord(collectionName, record);
    await this.database.persist('create');
    return clone(created);
  }

  public async get(collectionName: string, identity: RecordIdentity) {
    const collection = this.requireCollection(collectionName);
    const record = this.requireRecord(collection, identity);
    return clone(record as Record<string, unknown>);
  }

  public async replace(collectionName: string, identity: RecordIdentity, record: Record<string, unknown>) {
    const collection = this.requireCollection(collectionName);
    const updated = this.replaceRecord(collection, identity, record);
    await this.database.persist('replace');
    return clone(updated);
  }

  public async patch(collectionName: string, identity: RecordIdentity, patch: Operation[]) {
    const collection = this.requireCollection(collectionName);
    const updated = this.patchRecord(collection, identity, patch);
    await this.database.persist('patch');
    return clone(updated);
  }

  public async delete(collectionName: string, identity: RecordIdentity) {
    const collection = this.requireCollection(collectionName);
    const deleted = this.deleteRecord(collection, identity);
    await this.database.persist('delete');
    return clone(deleted);
  }

  public async bulk(collectionName: string, mutations: BulkMutation[]) {
    const collection = this.requireCollection(collectionName);
    if (!Array.isArray(mutations) || mutations.length === 0) {
      throw new CollectionAccessError('BULK_FAILED', 'Bulk mutation must contain at least one operation.', 400);
    }

    const results: Array<Record<string, unknown>> = [];
    for (const mutation of mutations) {
      try {
        if (!isObject(mutation) || typeof mutation.type !== 'string') {
          throw new CollectionAccessError('BULK_FAILED', 'Each bulk operation must be an object with a type.', 400);
        }
        const result = (() => {
          switch (mutation.type) {
            case 'create':
              return this.createRecord(collectionName, mutation.record);
            case 'replace':
              return this.replaceRecord(collection, mutation.identity, mutation.record);
            case 'patch':
              return this.patchRecord(collection, mutation.identity, mutation.patch);
            case 'delete':
              return this.deleteRecord(collection, mutation.identity);
            default:
              return assertNever(mutation);
          }
        })();
        results.push(result);
      } catch (error) {
        if (results.length > 0) {
          await this.database.persist('partial bulk mutation');
        }
        const status = error instanceof CollectionAccessError ? error.status : 500;
        throw new CollectionAccessError(
          'BULK_FAILED',
          `Bulk mutation stopped after ${results.length} successful operation(s): ${errorMessage(error)}`,
          status,
        );
      }
    }
    await this.database.persist('bulk mutation');
    return results.map((record) => clone(record));
  }

  private createRecord(collectionName: string, record: Record<string, unknown>) {
    this.validateCollectionName(collectionName);
    if (!isObject(record)) {
      throw new CollectionAccessError('INVALID_RECORD', 'Record must be a JSON object.', 400);
    }
    if ('$loki' in record || 'meta' in record) {
      throw new CollectionAccessError(
        'IDENTITY_CONFLICT',
        "New records must not provide Loki-managed '$loki' or 'meta' properties.",
        409,
      );
    }
    const collection = this.database.collection(collectionName) || this.database.createCollection(collectionName);
    let created: unknown;
    try {
      created = collection.insert(clone(record));
    } catch (error) {
      throw new CollectionAccessError(
        'IDENTITY_CONFLICT',
        `Could not create record in collection '${collectionName}': ${errorMessage(error)}`,
        409,
      );
    }
    return created as Record<string, unknown>;
  }

  private replaceRecord(collection: Collection, identity: RecordIdentity, record: Record<string, unknown>) {
    const current = this.requireRecord(collection, identity);
    if (!isObject(record)) {
      throw new CollectionAccessError('INVALID_RECORD', 'Replacement must be a JSON object.', 400);
    }
    if ('$loki' in record && record.$loki !== current.$loki) {
      throw new CollectionAccessError('IDENTITY_CONFLICT', "Replacement '$loki' does not match route identity.", 409);
    }

    const replacement = clone(record);
    delete replacement.$loki;
    delete replacement.meta;
    if (typeof identity !== 'number') {
      const [field, value] = Object.entries(identity)[0];
      if (field in replacement && !Object.is(replacement[field], value)) {
        throw new CollectionAccessError(
          'IDENTITY_CONFLICT',
          `Replacement '${field}' does not match route identity.`,
          409,
        );
      }
      replacement[field] = value;
    }
    const updated = {
      ...replacement,
      $loki: current.$loki,
      meta: current.meta,
    };
    return this.updateRecord(collection, updated, 'replace');
  }

  private patchRecord(collection: Collection, identity: RecordIdentity, patch: Operation[]) {
    const current = this.requireRecord(collection, identity);
    if (!isJsonPatch(patch)) {
      throw new CollectionAccessError('INVALID_PATCH', 'Patch must be a non-empty RFC 6902 operation array.', 400);
    }
    const protectedProperties = new Set(['$loki', 'meta']);
    if (typeof identity !== 'number') {
      protectedProperties.add(Object.keys(identity)[0]);
    }
    if (
      patch.some(
        (operation) =>
          protectedProperties.has(pathRoot(operation.path)) ||
          (('from' in operation && typeof operation.from === 'string') && protectedProperties.has(pathRoot(operation.from))),
      )
    ) {
      throw new CollectionAccessError('IDENTITY_CONFLICT', 'Patch must not change managed or route identity fields.', 409);
    }

    const updated = clone(current as Record<string, unknown>);
    const errors = applyPatch(updated, patch).filter((error) => error !== null);
    if (errors.length > 0) {
      throw new CollectionAccessError('INVALID_PATCH', `Patch could not be applied: ${errors[0]}`, 400);
    }
    return this.updateRecord(collection, updated, 'patch');
  }

  private deleteRecord(collection: Collection, identity: RecordIdentity) {
    const record = this.requireRecord(collection, identity);
    collection.remove(record);
    return record as Record<string, unknown>;
  }

  private requireCollection(name: string) {
    this.validateCollectionName(name);
    const collection = this.database.collection(name);
    if (!collection) {
      throw new CollectionAccessError('COLLECTION_NOT_FOUND', `Collection '${name}' does not exist.`, 404);
    }
    return collection;
  }

  private findRecord(collection: Collection, identity: RecordIdentity) {
    if (typeof identity === 'number') {
      if (!Number.isInteger(identity) || identity <= 0) {
        throw new CollectionAccessError('INVALID_IDENTITY', 'Loki identity must be a positive integer.', 400);
      }
      return collection.get(identity);
    }
    if (!isObject(identity)) {
      throw new CollectionAccessError('INVALID_IDENTITY', 'Identity must be a Loki ID or one unique-field value.', 400);
    }
    const entries = Object.entries(identity);
    if (entries.length !== 1) {
      throw new CollectionAccessError('INVALID_IDENTITY', 'Identity must contain exactly one unique field.', 400);
    }
    const [field, value] = entries[0];
    validateProperty(field, 'INVALID_IDENTITY');
    if (!collection.uniqueNames.includes(field)) {
      throw new CollectionAccessError(
        'INVALID_IDENTITY',
        `Property '${field}' is not a configured unique field for collection '${collection.name}'.`,
        400,
      );
    }
    return collection.by(field, value);
  }

  private requireRecord(collection: Collection, identity: RecordIdentity) {
    const record = this.findRecord(collection, identity);
    if (!record) {
      throw new CollectionAccessError('RECORD_NOT_FOUND', `Record was not found in collection '${collection.name}'.`, 404);
    }
    return record;
  }

  private updateRecord(collection: Collection, record: Record<string, unknown>, operation: string) {
    let updated: unknown;
    try {
      updated = collection.update(record);
    } catch (error) {
      throw new CollectionAccessError(
        'IDENTITY_CONFLICT',
        `Could not ${operation} record in collection '${collection.name}': ${errorMessage(error)}`,
        409,
      );
    }
    return updated as Record<string, unknown>;
  }

  private validateCollectionName(name: string) {
    if (!collectionNamePattern.test(name) || forbiddenProperties.has(name)) {
      throw new CollectionAccessError('INVALID_COLLECTION', `Invalid collection name '${name}'.`, 400);
    }
    this.requireReady();
  }

  private requireReady() {
    if (this.database.state !== 'ready') {
      throw new Error('Database is not ready.');
    }
  }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const assertNever = (value: never): never => {
  throw new Error(`Unsupported bulk mutation: ${String(value)}`);
};

export const createCollectionAccess = (database: DatabaseLifecycle): CollectionAccess => {
  if (!(database instanceof LokiDatabaseLifecycle)) {
    throw new Error('Collection access requires a database lifecycle created by createDatabaseLifecycle().');
  }
  return new LokiCollectionAccess(database);
};
