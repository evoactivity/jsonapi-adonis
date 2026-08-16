# Polymorphic relationships

A relationship is polymorphic when its members are not all the same kind of thing. A fan's favourites list holds football teams and rugby teams. An article's attachments are images and videos. A feed mixes posts, photos, and links. One relationship holds several kinds of member.

In JSON:API terms, that means resource linkage whose identifiers carry different `type` values:

```jsonc
"favourites": {
  "data": [
    { "type": "football-teams", "id": "1" },
    { "type": "rugby-teams", "id": "2" }
  ]
}
```

Client-side data libraries expect exactly this shape. [WarpDrive's polymorphism guide](https://warp-drive.io/guides/the-manual/misc/relational-data/features/polymorphism), for instance, is explicit that linkage should carry the concrete type, not an abstract umbrella type, because `type` + `id` is a resource's whole identity and an umbrella type creates a second identity for the same row.

## Single-table inheritance

Databases offer several ways to build the shape, such as one table per type joined by id, or Laravel-style `imageable_type` + `imageable_id` column pairs, which Lucid has no native relations for. This package supports one of them, **single-table inheritance (STI)**. All the types share one table, and a discriminator column says which type each row is, with columns only some types use sitting null on the others:

```
sports_teams
  id   name       sport      league_tier   scrum_wins
  1    Arsenal    football   1             NULL
  2    Saracens   rugby      NULL          312
```

With one shared table, the database layer already works. Anything pointing at the family is an ordinary foreign key, a mixed to-many is an ordinary pivot, and plain `belongsTo` / `hasMany` / `manyToMany` declared against the base class work mechanically. Subclasses set `static table` to the shared table and scope their queries to their discriminator value.

The only thing left to solve is _naming_, and it is a serialization problem, not a Lucid one. Lucid hydrates a relation's rows as the relation's declared target, the base class, which is correct behaviour for an ORM with no concept of a discriminator. The row still carries its discriminator column. Without the declarations on this page, the serializer derived a row's JSON:API type from its class rather than from the row, so base-hydrated rows serialized under the base type, and writes compared incoming identifiers against the one declared target type. Teaching the serializer to ask the row is what the rest of this page describes.

Declaring nothing is also workable. The base serializes as one `sports-teams` type, the discriminator rides along as an ordinary attribute, and clients branch on it. Nothing in JSON:API forbids that, and for an API that is content to mirror its database it is less machinery. The declarations below exist so the API does not have to mirror the schema. Clients see `football-teams` and `rugby-teams` as if each had its own table, the shared table stays an implementation detail, and storage can be reorganized later without renaming anything a client depends on.

## Declaring the family

Lucid's own serialization needs none of what follows. `row.serialize()` emits the columns, the discriminator among them, and that is all anyone expects of it, so with plain Adonis serialization STI simply works. JSON:API asks for more. Every resource object and every identifier must carry a `type`, and the correct type for an STI row is the concrete one. The declarations in this section are that extra effort. They hand the serializer the mapping from a row to its concrete type, which the model definitions alone do not carry.

The examples below use one family. `SportsTeam` is the base, `FootballTeam` and `RugbyTeam` share its table, and `sport` is the discriminator.

```ts
// app/models/sports_team.ts
export default class SportsTeam extends BaseModel {
  static table = 'sports_teams'

  /**
   * The discriminator value each subclass owns. Null on the base. The
   * base stays unscoped, so a relation targeting it can hold the whole
   * family.
   */
  static readonly teamSport: 'football' | 'rugby' | null = null

  @column() declare name: string
  @column() declare sport: 'football' | 'rugby'

  /**
   * Scopes subclass queries to their discriminator, so
   * FootballTeam.query() only ever sees football rows. find/findOrFail/
   * first inherit the scope because they build on query().
   */
  static query<Model extends LucidModel, Result = InstanceType<Model>>(
    this: Model,
    options?: ModelAdapterOptions
  ): ModelQueryBuilderContract<Model, Result> {
    const query = super.query(options) as unknown as ModelQueryBuilderContract<Model, Result>
    const sport = (this as unknown as typeof SportsTeam).teamSport
    if (sport) query.where('sport', sport)
    return query
  }

  /**
   * Rows created through a subclass carry its discriminator without the
   * caller spelling it out.
   */
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

// app/models/fan.ts
export default class Fan extends BaseModel {
  @manyToMany(() => SportsTeam, { pivotTable: 'favourites' })
  declare favourites: ManyToMany<typeof SportsTeam>
}
```

`Fan.favourites` is the relation that needs the declarations. It targets the base, so Lucid hydrates its rows as `SportsTeam` and only the discriminator says what each one is. Contrast a direct query. `FootballTeam.query()` hydrates `FootballTeam` instances, the class itself names the type, and those rows serialize as `football-teams` with no help. Giving base-targeted rows the same treatment takes two statics on the base resource. Each resource stays in its own file, scaffolded with `node ace make:jsonapi:resource`, and the subtype resources are ordinary resources:

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

The base resource imports them and declares the family:

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

`resolveResource` serves reads. It takes a row and returns its concrete resource, typically by reading the discriminator, and returning `undefined` keeps the row on the base resource. `subtypes` serves writes. It lists the types a relation targeting the base accepts.

The two look similar but answer opposite questions, and neither can be derived from the other. When serializing, the input is a hydrated row, and the question is which one resource it belongs to, which only a function can answer. When validating a write, the input is a type string from the request body, and no row exists yet because the check runs before any database access, so the question is whether the string belongs to the family, and that needs the family as a list, which cannot be computed out of an opaque function.

Register all three in the config, the same as any other resource:

```ts
// config/jsonapi.ts
resources: [
  () => import('#resources/sports_team_resource'),
  () => import('#resources/football_team_resource'),
  () => import('#resources/rugby_team_resource'),
]
```

The base also registers its declared subtypes as a safety net. Registration is what gives a direct query its type, so a subtype missing from the map would make `FootballTeam.query()` rows serialize under an auto-derived type, and the safety net prevents that silent degradation when an entry is forgotten. It never overrides you. An explicitly registered resource for a subtype's model always wins over the base's declaration.

## Families discovered at runtime

So far the family has been fixed. Football and rugby are known while the code is written, so each subtype gets a model, a resource file, and a config entry.

Some applications cannot know the family upfront, because the types are made by users. A form builder where users define their own field kinds. A CMS where editors invent content types. A tracker where each workspace declares its own item categories. The rows still live in one table with a discriminator column, since a table per kind would need a migration every time a user invents one, but the discriminator's values are data, created at runtime, different in every installation. There is no moment at which a developer can write `football_team_resource.ts`, because nobody knows what the kinds will be.

The declarations still work, because both are functions. Nothing forces `subtypes()` to return classes that exist as files, and nothing forces `resolveResource` to pick from a fixed set. A base resource can build concrete resources on demand, keyed on discriminator values that are themselves user data:

```ts
// app/resources/team_resource.ts
const cache = new Map<string, JsonApiResourceClass>()

export function resourceForSport(sport: string) {
  let resource = cache.get(sport)
  if (!resource) {
    // the discriminator value doubles as the JSON:API type, so one
    // vocabulary covers the column, the URL, and the documents
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

Three details make this work.

- **One class per value, memoized.** The registry caches type strings per class object, and the resolution walk ends when it sees a repeated class, so the same discriminator value must always resolve to the same class. The `Map` provides that identity.
- **`subtypes()` is consulted on every write**, never captured at boot. The moment a new kind lands in the cache, writes naming its type are accepted. Before any kind exists, the accepted set is empty and every write is a 409.
- **Inheriting from the base resource is safe.** The runtime-built class inherits `resolveResource`, and resolving again returns the same memoized class, which ends the walk. It also inherits `exposeRelationships`, `filters`, and any attribute customization, so the family shares the base's behaviour by default.

How kinds enter the cache is the application's decision, and the choice shows on writes. Filled lazily, as above, a kind's type is only accepted after some row of that kind has been serialized once. Seeded at boot, every known kind is accepted from the first request. Seeding is a preload file that reads the kinds from wherever they are defined, here the distinct discriminator values already in the table:

```ts
// start/team_kinds.ts
import db from '@adonisjs/lucid/services/db'
import { resourceForSport } from '#resources/team_resource'

const rows = await db.from('sports_teams').distinct('sport')
for (const { sport } of rows) {
  resourceForSport(sport)
}
```

Registered in `adonisrc.ts` so it runs at boot, restricted to the web environment:

```ts
preloads: [{ file: () => import('#start/team_kinds'), environment: ['web'] }]
```

The restriction matters. Preloads also run when ace commands boot the app, and on a fresh database the table does not exist until `migration:run` finishes, so a preload that reads it would crash the very command that creates it. Web-only registration keeps the seed out of console commands and tests, where rows are seeded per test anyway.

A kind created after boot is registered where it is created. The endpoint or service that saves a new kind calls `resourceForSport` as part of the same operation, so the seed covers everything known at boot and the create path covers everything after.

Runtime kinds cannot have routes registered per type, so their endpoints are wildcard routes over the base model:

```ts
// GET /api/v1/:type
async index({ jsonApi, params }: HttpContext) {
  const teams = await jsonApi.query(SportsTeam).where('sport', params.type).paginate(...)
  return jsonApi.render(teams)
}

// POST /api/v1/:type
async store({ jsonApi, params }: HttpContext) {
  const input = await jsonApi.deserialize(SportsTeam, { expectedType: params.type })
  const team = await SportsTeam.create({ ...input.attributes, sport: input.type })
  return jsonApi.render(team, { status: 201 })
}
```

Reads need nothing special, because every row is named through `resolveResource` regardless of which endpoint served it. Writes lean on two things. Deserializing against an STI base accepts any member of the declared family, and `expectedType` narrows that to the one type the URL names, so a body claiming a different member is a 409. The result carries the validated `type` back, which is also how an endpoint without a type in its URL would decide which discriminator to stamp.

The controllers trust `params.type`, so validate it against the known kinds first and 404 the rest. `expectedType` pins the body to the URL, and it accepts whatever string it is given, so an unvalidated URL segment would let a made-up kind straight through to the row.

None of this shape is prescribed by the package. The cache, the factory, and the seeding are ordinary application code, and the package only ever calls the two declared functions. The example exists to show how much room those two functions leave.

## What documents look like

Rows resolve to concrete types everywhere they appear, in primary data, linkage, `included` (deduplicated under the concrete type), and relationship-endpoint GETs. Sparse fieldsets key on the concrete type (`fields[football-teams]=name`).

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

The relationship endpoint serves the same concrete linkage:

```jsonc
// GET /fans/1/relationships/favourites
{
  "jsonapi": { "version": "1.1" },
  "data": [
    { "type": "football-teams", "id": "1" },
    { "type": "rugby-teams", "id": "2" },
  ],
  "links": {
    "self": "/fans/1/relationships/favourites",
    "related": "/fans/1/favourites",
  },
}
```

The abstract type (`sports-teams`) never appears in a payload. Clients see a family of concrete types over one shared id space, which is what client caches expect of polymorphic data.

## Writes

A relation targeting the base accepts any member of the family, in any mix. Adding a rugby team to favourites that already hold a football team:

```jsonc
// POST /fans/1/relationships/favourites
{ "data": [{ "type": "rugby-teams", "id": "2" }] }

// 200
{
  "jsonapi": { "version": "1.1" },
  "data": [
    { "type": "football-teams", "id": "1" },
    { "type": "rugby-teams", "id": "2" },
  ],
  "links": {
    "self": "/fans/1/relationships/favourites",
    "related": "/fans/1/favourites",
  },
}
```

A type outside the family is a `409` naming every acceptable type. The abstract base type is rejected the same way, it never belongs in a payload:

```jsonc
// POST /fans/1/relationships/favourites
{ "data": [{ "type": "referees", "id": "1" }] }

// 409
{
  "jsonapi": { "version": "1.1" },
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

A claimed type the row's discriminator contradicts is a `404`. The family shares one id space, so any id "exists" for any subtype, and the claimed type has to be checked against the row. Row 2 exists, but it is a rugby team, so `football-teams/2` names a resource that does not exist, and an existence check alone would attach it silently:

```jsonc
// POST /fans/1/relationships/favourites
{ "data": [{ "type": "football-teams", "id": "2" }] }

// 404
{
  "jsonapi": { "version": "1.1" },
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

`verifyRelatedExist` performs the discriminator check, which is why the function takes the registry.

## The one place a type cannot be known

Resource linkage for an unloaded belongsTo is normally derived from the bare foreign key, without touching the database. With STI that derivation is impossible, because the discriminator lives on the target row, and the foreign key is just an id. Suppose a stadium belongs to a team:

```ts
export default class Stadium extends BaseModel {
  @column() declare teamId: number

  @belongsTo(() => SportsTeam, { foreignKey: 'teamId' })
  declare team: BelongsTo<typeof SportsTeam>
}
```

Fetching a stadium on its own leaves `team` unloaded. If the serializer guessed from the foreign key anyway, the id would come from `team_id` and the only type it could name is the relation's declared target, the base:

```jsonc
// GET /stadiums/9, as it would look if the guess were made
{
  "data": {
    "type": "stadiums",
    "id": "9",
    "attributes": { "name": "Emirates" },
    "relationships": {
      "team": {
        // team_id = 1, and the declared target is SportsTeam
        "data": { "type": "sports-teams", "id": "1" },
        "links": {
          "self": "/stadiums/9/relationships/team",
          "related": "/stadiums/9/team",
        },
      },
    },
  },
}
```

Row 1 is a football team, so the true identity of this resource is `football-teams/1`, and that is what every other document calls it. This one calls it `sports-teams/1`. That one guess causes three problems.

- The identity never resolves. No endpoint serves `sports-teams`, so nothing a client does with `sports-teams/1` produces a resource. Following the `related` link works, but it returns `football-teams/1`, which does not match the linkage that pointed at it.
- It forks client caches. A cache keys resources by `type` + `id`, so when the same row arrives through any other path, a favourites list, a direct fetch, it lands as `football-teams/1` and the cache now holds two records for one row, the abstract one empty forever.
- It dead-ends type-keyed client logic. Code that routes from linkage, opening a team page for `football-teams` or `rugby-teams`, has no branch for `sports-teams`.

In a compound document the same guess also violates the spec's full-linkage rule, since the row can sit in `included` under its concrete type while the guessed identifier dangles.

So the package refuses to guess. An unloaded belongsTo targeting an STI base emits the relationship member with **no `data`**, keeping its `links`:

```jsonc
"team": {
  "links": {
    "self": "/stadiums/9/relationships/team",
    "related": "/stadiums/9/team",
  },
}
```

A client that needs the target follows the `related` link and gets the concrete type from the loaded row. Loading the relation (or including it) always yields full concrete linkage. Relations targeting a concrete subclass, or any non-STI model, keep FK-derived linkage exactly as before.

## Custom type schemes

Type derivation lives in one overridable method on the resource, consulted for models and rows alike:

```ts
static typeName(): string {
  return this.type ?? string.dashCase(this.model().table)
}
```

Override it on a resource to compute types under a different scheme; the registry honours it everywhere, including subtype resolution.

## Should you design your schema this way?

Polymorphic schemas have a poor reputation, and the criticism is fair. A relational schema is supposed to declare what the data is and have the database enforce it, and every polymorphic shape gives some of that up. A morph column pair cannot be a real foreign key, an STI table cannot mark a subtype's column `NOT NULL`, and either way rules the database once enforced become application conventions that every program touching the database has to honour by hand. Critics read polymorphism as an ORM convenience imposed on a schema.

The criticism does not make the need go away. Favourites lists, feeds, and attachments are mixed collections in reality, and a design that refuses polymorphism pays elsewhere, with a pivot table and an endpoint per type, union queries behind every mixed list, and the same feature built several times over. Neither side of the trade is free, so the question is which set of costs fits your data.

Reach for STI when the types are **variations of one thing**. They share most of their columns, they appear together in the same lists and relationships, and things point at "any of them". Teams that are football, rugby, or cricket teams. Attachments that are images or videos. If you need one relationship that holds several of these types, STI fits.

STI is also the only workable shape when **the types themselves are user data**. If users define their own kinds at runtime, there is no way to create a table or a model per kind upfront, while a discriminator column absorbs new values without a migration. See [Families discovered at runtime](#families-discovered-at-runtime) for how the resource side keeps up.

The costs are real, and they are schema costs, so they outlive any library choice:

- **Sparse columns.** Every subtype's columns exist on every row. A column only rugby teams use is `NULL` on every football team. The table gets wide, and `NOT NULL` stops being expressible for subtype-specific columns, the database cannot say "scrum_wins is required, but only for rugby teams" without check constraints keyed on the discriminator.
- **The schema does not enforce the discriminator.** Nothing stops a query from treating a rugby row as a football team; the id space is shared, so any id "exists" for any subtype. Discipline has to live in the application layer, which is why this package verifies claimed types against the discriminator on writes.
- **Everything shares the table.** Migrations, indexes, and locks affect the whole family. A busy subtype's traffic is every subtype's traffic.
- **One relation cannot span the split.** If you later move a subtype out to its own table, every relation targeting the base breaks.

If the types share little beyond a name, prefer separate tables and separate endpoints and no polymorphism at all. A relationship that must span genuinely different tables needs the type + id column pair, with the trade-offs above.

---

Next: [Links](./links.md) · [Errors & negotiation](./errors.md) · [Reference](./reference.md)
