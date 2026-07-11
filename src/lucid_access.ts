/**
 * Dynamic-by-name access to Lucid rows.
 *
 * Lucid types `row.related()`, `row.load()` and attribute access with
 * literal-name generics (`ExtractModelRelations<this>`), which is great in
 * application code where names are static, but this package works
 * generically over any model with names known only at runtime. These
 * helpers are the single place where that gap is bridged — every cast in
 * the package that cannot be removed lives here, behind a narrow,
 * documented structural type instead of `any`.
 */
import type { LucidRow } from '@adonisjs/lucid/types/model'

/**
 * The subset of Lucid's relationship query clients used by this package.
 * All relation kinds expose what their type supports at runtime; callers
 * only invoke methods valid for the relation kind they checked.
 */
export type DynamicRelationClient = {
  sync(ids: (string | number)[], detach?: boolean): Promise<void>
  detach(ids?: (string | number)[]): Promise<void>
  saveMany(rows: LucidRow[]): Promise<unknown>
}

type DynamicRow = {
  related(name: string): DynamicRelationClient
  load(name: string): Promise<void>
} & Record<string, unknown>

/**
 * The relationship client for a relation resolved by its runtime name.
 */
export function relatedClient(row: LucidRow, relationName: string): DynamicRelationClient {
  return (row as unknown as DynamicRow).related(relationName)
}

/**
 * Loads (or reloads) a relation by its runtime name.
 */
export function loadRelation(row: LucidRow, relationName: string): Promise<void> {
  return (row as unknown as DynamicRow).load(relationName)
}

/**
 * Reads a model attribute (e.g. a foreign key) by its runtime name.
 */
export function getAttribute(row: LucidRow, attribute: string): unknown {
  return (row as unknown as DynamicRow)[attribute]
}

/**
 * Assigns a model attribute (e.g. a foreign key) by its runtime name,
 * going through Lucid's column setters so the change is tracked.
 */
export function setAttribute(row: LucidRow, attribute: string, value: unknown): void {
  ;(row as unknown as Record<string, unknown>)[attribute] = value
}

/**
 * The structural slice of Lucid's model query builder this package drives
 * with runtime relation/column names. Lucid's own contract types preload()
 * with literal-name generics; real builders satisfy this shape through
 * method bivariance, so no casts are needed at call sites.
 */
export type DynamicModelQuery = {
  preload(relation: string, callback?: (query: DynamicModelQuery) => void): unknown
  orderBy(column: string, direction: 'asc' | 'desc'): unknown
}
