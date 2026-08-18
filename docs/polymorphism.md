# Polymorphism

Every JSON:API resource object and every identifier must carry a concrete `type`. For an ordinary model this is settled: one model, one type. A polymorphic relationship breaks that assumption. It holds rows of several concrete types over one shared id space, so the type can no longer come from the relation's declared target. It has to come from the row.

This page is about that one problem: naming the concrete type of a row, and checking a claimed type on a write. The package solves it with two hooks on the base resource. The rest is those two hooks, consulted at fixed points.

## The two questions

The registry answers two questions, and each has one hook behind it.

| Question                       | Hook                   | Registry method                 | Consulted when                                                        |
| ------------------------------ | ---------------------- | ------------------------------- | --------------------------------------------------------------------- |
| What type is _this row_?       | `resolveResource(row)` | `resourceForRow` → `typeForRow` | serializing primary data, linkage, `included`, and relationship reads |
| What types may a write _name_? | `subtypes()`           | `acceptedTypesFor`              | validating a write body and a relationship-endpoint body              |

`resolveResource` takes a row and returns the concrete resource for it, usually by reading a discriminator column. `subtypes` returns the family as a list of resource classes. The two look similar but answer opposite questions, and neither can be computed from the other. A row is a value you can inspect, so a function answers it. A write carries a type string and no row yet, checked before any database access, so the answer needs the family as a plain list.

The rest of this page follows those two hooks through the code.

## The database shape

The package supports **single-table inheritance (STI)**. Every type in the family shares one table. A discriminator column says which type each row is. Columns that only some types use are null on the others:

```
sports_teams
  id   name       sport      league_tier   scrum_wins
  1    Arsenal    football   1             NULL
  2    Saracens   rugby      NULL          312
```

The model side is ordinary Lucid. The base stays unscoped, so a relation that targets it sees the whole family. Each subclass points at the same table and scopes its own queries to its discriminator:

```ts
// app/models/sports_team.ts
export default class SportsTeam extends BaseModel {
  static table = 'sports_teams'

  /** The discriminator value each subclass owns. Null on the base. */
  static readonly teamSport: 'football' | 'rugby' | null = null

  @column() declare name: string
  @column() declare sport: 'football' | 'rugby'

  /** Scope subclass queries to their discriminator. */
  static query<Model extends LucidModel, Result = InstanceType<Model>>(
    this: Model,
    options?: ModelAdapterOptions
  ): ModelQueryBuilderContract<Model, Result> {
    const query = super.query(options) as unknown as ModelQueryBuilderContract<Model, Result>
    const sport = (this as unknown as typeof SportsTeam).teamSport
    if (sport) query.where('sport', sport)
    return query
  }

  /** Stamp the discriminator on rows created through a subclass. */
  @beforeCreate()
  static assignSport(row: SportsTeam) {
    const sport = (row.constructor as typeof SportsTeam).teamSport
    if (sport && !row.sport) row.sport = sport
  }
}

export class FootballTeam extends SportsTeam {
  static table = 'sports_teams'
  static readonly teamSport = 'football' as const
}

export class RugbyTeam extends SportsTeam {
  static table = 'sports_teams'
  static readonly teamSport = 'rugby' as const
}
```

The package never sees this model code. It only ever calls the two hooks on the resource. Everything above is your own Lucid, and you can shape it however your schema needs, as long as a row can report its own kind.

## Declaring the resources

Each concrete type is an ordinary resource:

```ts
// app/resources/football_team_resource.ts
export default class FootballTeamResource extends JsonApiResource<FootballTeam> {
  static type = 'football-teams'
  static model = () => FootballTeam
}

// app/resources/rugby_team_resource.ts
export default class RugbyTeamResource extends JsonApiResource<RugbyTeam> {
  static type = 'rugby-teams'
  static model = () => RugbyTeam
}
```

The base resource adds the two hooks:

```ts
// app/resources/sports_team_resource.ts
import FootballTeamResource from '#resources/football_team_resource'
import RugbyTeamResource from '#resources/rugby_team_resource'

export default class SportsTeamResource extends JsonApiResource<SportsTeam> {
  static model = () => SportsTeam
  static subtypes = () => [FootballTeamResource, RugbyTeamResource]
  static resolveResource(row: SportsTeam) {
    return { football: FootballTeamResource, rugby: RugbyTeamResource }[row.sport]
  }
}
```

Register all three, the same as any other resource:

```ts
// config/jsonapi.ts
resources: [
  () => import('#resources/sports_team_resource'),
  () => import('#resources/football_team_resource'),
  () => import('#resources/rugby_team_resource'),
]
```

Registering the base also registers its `subtypes` as a backup. A subtype needs its own registration so that a direct `FootballTeam.query()` finds a resource and serializes as `football-teams`. If you forget a subtype in the config, the base fills it in. Your explicit registration always wins, so the backup never overrides a resource you registered yourself.

## Reads: naming a row

`typeForRow(row)` is the whole read path. It calls `resourceForRow`, which starts at the model's resource and follows `resolveResource` while one exists:

```
resourceForRow(row):
  resource = resource for row's model        // SportsTeamResource
  while resource.resolveResource:
    next = resource.resolveResource(row)      // FootballTeamResource
    if next is undefined or already seen: stop
    resource = next
  return resource
```

The walk stops on a repeated class, so a hook that resolves to itself cannot loop. For a fixed family the walk is one step: the base resolves to a concrete resource, and the concrete resource has no `resolveResource`, so it ends there. Returning `undefined` from the hook keeps the row on the base resource.

Because every row goes through this one function, the concrete type is consistent everywhere a row appears. A `Fan` with mixed favourites serializes each member under its own type, and `included` deduplicates under the concrete type:

```jsonc
// GET /fans/1?include=favourites
{
  "data": {
    "type": "fans",
    "id": "1",
    "relationships": {
      "favourites": {
        "data": [
          { "type": "football-teams", "id": "1" },
          { "type": "rugby-teams", "id": "2" },
        ],
      },
    },
  },
  "included": [
    { "type": "football-teams", "id": "1", "attributes": { "name": "Arsenal" } },
    { "type": "rugby-teams", "id": "2", "attributes": { "name": "Saracens" } },
  ],
}
```

The abstract type `sports-teams` never reaches a payload, because `resolveResource` runs before any type is written. Sparse fieldsets key on the concrete type too (`fields[football-teams]=name`).

## Writes: checking a claimed type

A write names a type in the body. The package validates it with `acceptedTypesFor(Model)`, which reads `subtypes`. A model whose resource declares `subtypes` accepts every member of the family and nothing else. Its own abstract type is never accepted, because that type never belongs in a payload. Any other model accepts its single type.

There are two separate checks, and they fail differently.

**Membership.** A type outside the family is a `409`, naming the acceptable types. This runs in the deserializer and in the relationship endpoints:

```jsonc
// POST /fans/1/relationships/favourites  with { "data": [{ "type": "referees", "id": "1" }] }
// 409
{
  "errors": [
    {
      "status": "409",
      "title": "Conflict",
      "detail": "This relationship holds resources of type \"football-teams\" or \"rugby-teams\"",
      "source": { "pointer": "/data" },
    },
  ],
}
```

**Identity.** A type inside the family, but wrong for the row it names, is a `404`. The family shares one id space, so any id exists for some subtype. `verifyRelatedExist` loads the referenced rows and compares each row's real type against the claimed type. Row 2 is a rugby team, so `football-teams/2` names a resource that does not exist:

```jsonc
// POST /fans/1/relationships/favourites  with { "data": [{ "type": "football-teams", "id": "2" }] }
// 404
{
  "errors": [
    {
      "status": "404",
      "title": "Not Found",
      "detail": "Related resources do not exist: football-teams/2",
      "source": { "pointer": "/data/relationships/favourites" },
    },
  ],
}
```

Without the identity check, a mislabelled identifier would attach the wrong row. That is why `verifyRelatedExist` takes the registry: it needs `typeForRow` to learn each row's real type.

## The unloaded belongsTo

One case has no answer. Resource linkage for an unloaded belongsTo normally comes from the bare foreign key, with no query. The document builder reads the foreign-key value and pairs it with the relation's declared target type. That works for an ordinary target, because the target type is fixed.

It cannot work for an STI base. The discriminator lives on the target row, and the foreign key is only an id. The declared target is the base, so a guess would name the abstract type:

```jsonc
"team": { "data": { "type": "sports-teams", "id": "1" } } // wrong: row 1 is a football team
```

That guess would fork client caches. The same row would arrive as `sports-teams/1` here and `football-teams/1` everywhere else, so a cache keyed by type and id would hold two records for one row. The builder detects the STI base (the target model's resource declares `subtypes`) and refuses to guess. It omits `data` and keeps the links:

```jsonc
"team": {
  "links": {
    "self": "/stadiums/9/relationships/team",
    "related": "/stadiums/9/team"
  }
}
```

A client that needs the target follows the `related` link, which loads the row and returns the concrete type. Loading or including the relation always gives full concrete linkage. A belongsTo whose target is a concrete subclass, or any non-STI model, keeps foreign-key linkage as before.

## Families made at runtime

Both hooks are functions, so the family does not have to be fixed in code. When users define their own kinds at runtime, `subtypes()` can return classes from a cache and `resolveResource` can build one on demand, keyed on the discriminator value:

```ts
// app/resources/team_resource.ts
const cache = new Map<string, JsonApiResourceClass>()

export function resourceForSport(sport: string) {
  let resource = cache.get(sport)
  if (!resource) {
    // the discriminator value is also the JSON:API type
    resource = class extends TeamResource {
      static type = sport
    }
    cache.set(sport, resource)
  }
  return resource
}

export default class TeamResource extends JsonApiResource<SportsTeam> {
  static model = () => SportsTeam
  static subtypes = () => [...cache.values()]
  static resolveResource(row: SportsTeam) {
    return resourceForSport(row.sport)
  }
}
```

Two things make this safe. The `Map` returns one stable class per value, so `resourceForRow` sees a repeated class on the second step and ends the walk. And `subtypes()` reads the cache on every write, so a kind becomes acceptable the moment it enters the cache, not at boot.

Seed the cache at boot if you want a kind accepted before its first row is serialized:

```ts
// start/team_kinds.ts, registered as a web-only preload
const rows = await db.from('sports_teams').distinct('sport')
for (const { sport } of rows) resourceForSport(sport)
```

Keep the seed web-only. Preloads also run when ace commands boot the app, and reading the table before `migration:run` creates it would crash the command that creates it.

## Custom type schemes

Type derivation is one method, used for models and rows alike. Override it to compute types differently, and the registry uses it everywhere, including subtype resolution:

```ts
static typeName(): string {
  return this.type ?? string.dashCase(this.model().table)
}
```

## Is STI the right schema?

STI trades schema guarantees for one shared table, and the trade is real.

- **Sparse columns.** Every subtype's columns exist on every row, so `NOT NULL` cannot express a rule that holds for one subtype only.
- **No enforced discriminator.** The database cannot stop a query from reading a rugby row as a football team. The rule lives in the application layer, which is why this package checks the claimed type against the discriminator on writes.
- **Shared table.** Migrations, indexes, and locks affect the whole family.
- **No later split.** Moving a subtype to its own table breaks every relation that targets the base.

Reach for STI when the types are variations of one thing: they share most columns, appear in the same lists, and things point at any of them. Reach for it too when the types are user data, because a discriminator column absorbs new kinds without a migration. When the types share little beyond a name, prefer separate tables and separate endpoints.

---

Next: [Links](./links.md) · [Errors and negotiation](./errors.md) · [Reference](./reference.md)
