# Blog example

A complete AdonisJS application demonstrating [jsonapi-adonis](../../README.md): articles, comments, tags and users, served as a JSON:API under both `/api/v1` and `/api/v2` (to show versioned link generation).

Built from the official `api` starter kit; the JSON:API integration was added with `node ace configure jsonapi-adonis`.

## Run it

From the repository root:

```sh
pnpm install
cd examples/blog
node ace migration:run
node ace serve --watch
```

Seed the demo data: two authors, three articles with spread-out publication dates, tags and comments, shaped so every filter visibly changes the result.

```sh
node ace db:seed
```

## Try it

```sh
# A compound document with nested includes
curl 'localhost:3333/api/v1/articles/1?include=author,comments.author,tags'

# Sparse fieldsets
curl 'localhost:3333/api/v1/articles/1?include=author&fields[articles]=title,author&fields[users]=fullName'

# Sorting + pagination
curl 'localhost:3333/api/v1/articles?sort=-title&page[number]=1&page[size]=2'

# Filtering. Only filters declared on ArticleResource work; curl needs -g
# so it doesn't eat the square brackets.

# substring search across title and body: "Intro to JSON:API", "Testing AdonisJS apps"
curl -g 'localhost:3333/api/v1/articles?filter[search]=json'

# only Bob's articles: "Testing AdonisJS apps" (use the id from your seed run)
curl -g 'localhost:3333/api/v1/articles?filter[author]=2'

# published on/after March: "Advanced Lucid patterns", "Testing AdonisJS apps"
curl -g 'localhost:3333/api/v1/articles?filter[publishedAfter]=2026-02-01'

# filters compose (AND): "Advanced Lucid patterns"
curl -g 'localhost:3333/api/v1/articles?filter[author]=1&filter[search]=lucid'

# undeclared filters are rejected: 400 with source.parameter = "filter[hacky]"
curl -g 'localhost:3333/api/v1/articles?filter[hacky]=1'

# The same article under v2. Every link switches to /api/v2
curl 'localhost:3333/api/v2/articles/1'

# Create an article from a JSON:API document
curl -X POST 'localhost:3333/api/v1/articles' \
  -H 'content-type: application/vnd.api+json' \
  -d '{
    "data": {
      "type": "articles",
      "attributes": { "title": "Written via the API", "body": "Hello!" },
      "relationships": {
        "author": { "data": { "type": "users", "id": "1" } },
        "tags": { "data": [{ "type": "tags", "id": "1" }] }
      }
    }
  }'

# Relationship endpoints
curl 'localhost:3333/api/v1/articles/1/relationships/tags'
curl -X POST 'localhost:3333/api/v1/articles/1/relationships/tags' \
  -H 'content-type: application/vnd.api+json' \
  -d '{ "data": [{ "type": "tags", "id": "1" }] }'

# Spec-compliant errors
curl 'localhost:3333/api/v1/articles/1?include=nonsense'   # 400, source.parameter
curl 'localhost:3333/api/v1/articles/9999'                 # 404 errors document
```

## Where to look

| File                                                  | What it shows                                         |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `config/jsonapi.ts`                                   | Package configuration + resource registration         |
| `start/routes.ts`                                     | `router.jsonApiResource()` under two versioned groups |
| `app/controllers/articles_controller.ts`              | index/show/store/update/destroy                       |
| `app/controllers/article_relationships_controller.ts` | Relationship endpoints                                |
| `app/resources/`                                      | Customized resources (curated user attributes)        |
| `app/exceptions/handler.ts`                           | JSON:API error documents for API routes               |
| `tests/functional/jsonapi_*.spec.ts`                  | The full compliance test suite                        |

## Generate a new resource

The package ships scaffolding commands (registered in `adonisrc.ts`):

```sh
# resource class + both controllers, routes appended to start/routes.ts
node ace make:jsonapi:resource review --relationships --routes

# controllers only, relying on the auto-derived resource
node ace make:jsonapi:controller review --relationships
```

## Tests

```sh
node ace test
```

The suite covers resource objects, compound documents, sparse fieldsets, sorting, pagination, filtering, resource writes, relationship endpoints, error documents, content negotiation and versioned links. Every test runs in a rolled-back transaction, and the database is truncated before the suite starts.
