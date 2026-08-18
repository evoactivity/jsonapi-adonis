# Resources

A resource is the rule for turning one Lucid model into a JSON:API resource object. The rule has a default built from Lucid metadata. You write a resource class only to change part of it.

## From row to resource object

When the builder serializes a row, it runs a fixed sequence:

1. Find the resource class for the row.
2. Read `id()`, the primary key as a string.
3. Read `attributes()`, the serializable columns.
4. Drop any attribute the request's sparse fieldset excludes.
5. Build `relationships` from the model's relations.
6. Merge the generated links with `links()`, and add `meta()`.

Every step has a default, so a model with no resource class already produces a correct resource object. A resource class overrides one or more steps.

## The defaults

- **type** is the kebab-cased table name (`users`, `articles`, `access-tokens`).
- **id** is the primary key, converted to a string. The spec requires string ids.
- **attributes** are the serializable columns, minus two sets: the primary key, and every belongsTo foreign key. A column marked `serializeAs: null`, like a password hash, is already gone, because Lucid never serializes it.
- **relationships** are the relations defined on the model.

The two exclusions from attributes are not arbitrary. The primary key is already in `id`. A belongsTo foreign key is already in `relationships` as a pointer, so repeating it as an attribute would state the same fact twice.

## Auto-derivation is the default, applied

A model with no registered resource still gets one. On a lookup miss, the registry makes an anonymous resource class bound to that model and caches it. So "no resource class" is not a separate code path. It is the default resource, built on demand. Writing a resource class replaces that default for one model.

## Writing a resource class

```ts
// app/resources/user_resource.ts
import User from '#models/user'
import { JsonApiResource } from '@evoactivity/jsonapi-adonis'

export default class UserResource extends JsonApiResource<User> {
  static model = () => User
}
```

Register it in `config/jsonapi.ts`:

```ts
export default defineConfig({
  resources: [() => import('#resources/user_resource')],
})
```

The class above is valid as written. `static model` is the only required member, and everything else falls back to the default. It is required because the registry files each class under its model, and serialization always starts from a row and looks the resource up by the row's model. A class with no `static model` has no key, so the registry throws instead of silently ignoring a class you wrote.

Inside a method, `this.resource` is the row, typed by the generic. `this.ctx` is the current HttpContext inside a request, or `undefined` outside one.

## The members

The members come in two kinds, static members and instance methods. The static members configure the mapping from model to type, and the registry reads them off the class, often with no row in hand: to derive a type name, to list a family on a write, or to pick a resource for a row. The instance methods serialize one row, so they run on an instance that holds `this.resource` (the row) and `this.ctx` (the request). For the same reason `static resolveResource` takes the row as an argument instead of reading `this.resource`. It chooses which resource to build, before any instance exists.

| Member                       | Kind     | Required | Default                                                                       |
| ---------------------------- | -------- | -------- | ----------------------------------------------------------------------------- |
| `static model`               | static   | Yes      | none, the registry throws without it                                          |
| `static type`                | static   | No       | kebab-cased table name (`access_tokens` → `access-tokens`)                    |
| `static exposeRelationships` | static   | No       | every relation on the model                                                   |
| `static filters`             | static   | No       | none, every `?filter[...]` request gets a `400`                               |
| `static subtypes`            | static   | No       | none, declares an STI family (see [Polymorphism](./polymorphism.md))          |
| `static resolveResource`     | static   | No       | none, maps a row to its concrete resource ([Polymorphism](./polymorphism.md)) |
| `id()`                       | instance | No       | the primary key, as a string                                                  |
| `attributes()`               | instance | No       | serializable columns minus pk, belongsTo FKs, and `serializeAs: null`         |
| `links()`                    | instance | No       | nothing extra, the generated `self` link stands alone                         |
| `meta()`                     | instance | No       | no `meta` member                                                              |

### `static type`

Sets the type everywhere the model appears: primary data, linkage pointers, `included`, and the type a client must send in a write.

```ts
static type = 'people'
```

### `id()`

Returns the public id. Override it to expose a slug or a prefixed id instead of the primary key:

```ts
id() {
  return `u-${this.resource.id}`
}
```

The override applies everywhere at once, because `data.id`, linkage, and `included` all read this one method. The id is identity, not decoration. If you override it on a resource with write endpoints, clients send this id back, so your controllers must be able to find records by it.

### `attributes()`

Returns the attribute members. The default is every serializable column minus the primary key, the belongsTo foreign keys, and `serializeAs: null` columns. Override it to curate the set. `this.pick([...])` selects columns by their serialized names, and a computed value is a plain property:

```ts
attributes() {
  return {
    ...this.pick(['fullName', 'email']),
    initials: this.resource.initials,
  }
}
```

A sparse fieldset filters whatever this method returns, so a computed attribute behaves like any column. See [Queries](./queries.md#sparse-fieldsets).

### `links()`

Whatever you return is merged over the generated links:

```ts
links() {
  return { canonical: `https://example.com/u/${this.resource.id}` }
}
```

The generated `self` stays unless you return your own `self`, which then wins.

### `meta()`

Returns per-resource metadata, or `undefined` to omit the member. An empty object omits it too, so the method can be conditional:

```ts
meta() {
  return { isOwn: this.ctx?.auth?.user?.id === this.resource.id }
}
```

### `static exposeRelationships`

Lists the relations to show. The rest disappear:

```ts
static exposeRelationships = ['author', 'tags']
```

## One visibility rule, four call sites

Whether a relation is visible is decided by one function, `isRelationExposed`. It returns false for a `serializeAs: null` relation, or for a relation left out of `exposeRelationships`. Four separate places call that one function, so a hidden relation is hidden in all of them with no extra flags:

| Call site               | A hidden relation gets |
| ----------------------- | ---------------------- |
| `?include=` validation  | `400`                  |
| Serialization           | absent from documents  |
| Relationship endpoints  | `404`                  |
| Write-body deserializer | `400`                  |

The relationship endpoints return `404`, not `403`. A `403` would confirm the relation exists, which is the fact you were hiding. A `404` reads the same as a relation that was never defined.

### `static filters`

Declares the `?filter[...]` parameters this resource accepts. Nothing is filterable without it. See [Queries](./queries.md#filtering).

---

Next: [Queries](./queries.md) · [Scopes](./scopes.md) · [Writes](./writes.md) · [Reference](./reference.md)
