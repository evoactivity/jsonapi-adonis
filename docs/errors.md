# Errors and content negotiation

## What an error document looks like

A JSON:API error response has no `data`. It carries an `errors` array instead, with one error object per problem, and is served as `application/vnd.api+json` like everything else. This is a real response from the example app, a validation failure on `POST /api/v1/articles`:

```json
HTTP/1.1 422 Unprocessable Content
Content-Type: application/vnd.api+json

{
  "jsonapi": { "version": "1.1" },
  "errors": [
    {
      "status": "422",
      "code": "minLength",
      "title": "Validation Failure",
      "detail": "The title field must have at least 3 characters",
      "source": { "pointer": "/data/attributes/title" }
    },
    {
      "status": "422",
      "code": "required",
      "title": "Validation Failure",
      "detail": "The body field must be defined",
      "source": { "pointer": "/data/attributes/body" }
    }
  ]
}
```

Each error object can carry:

| Member             | Meaning                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `status`           | The HTTP status, as a string (one document can mix statuses)          |
| `code`             | An application-specific identifier, here the failing Vine rule        |
| `title`            | A short, general description of the problem                           |
| `detail`           | A human-readable explanation of this occurrence                       |
| `source.pointer`   | A JSON Pointer into the request document that caused the problem      |
| `source.parameter` | The query parameter at fault, for input errors like a bad `?include=` |
| `source.header`    | The header at fault, for content negotiation failures                 |
| `meta`             | Anything else you want to attach                                      |

Query-parameter problems point at the parameter instead of the body. Asking for `?include=nonsense` returns:

```json
{
  "jsonapi": { "version": "1.1" },
  "errors": [
    {
      "status": "400",
      "title": "Invalid Query Parameter",
      "detail": "\"nonsense\" is not a supported include path for Article",
      "source": { "parameter": "include" }
    }
  ]
}
```

## Rendering errors

Every error can render as a spec-compliant errors document. Delegate from your exception handler:

```ts
// app/exceptions/handler.ts
import { renderJsonApiError } from 'jsonapi-adonis'

async handle(error: unknown, ctx: HttpContext) {
  if (ctx.jsonApi.handlesErrors()) {
    return renderJsonApiError(error, ctx, this.debug)
  }
  return super.handle(error, ctx)
}
```

`handlesErrors()` detects JSON:API requests automatically: either the matched route was registered via `router.jsonApiResource()`, or the client is speaking the JSON:API media type in its `Accept` or `Content-Type` header. When you'd rather decide yourself (say, everything under a URL prefix, including unmatched 404s), set the predicate in `config/jsonapi.ts`:

```ts
export default defineConfig({
  errorDetection: (ctx) => ctx.request.url().startsWith('/api/'),
})
```

What renders how:

- VineJS validation failures become `422` with one error object per failure, each pointing into the request document (`source: { pointer: "/data/attributes/title" }`).
- HTTP exceptions (404s from `findOrFail`, auth failures, …) map their status and title.
- Anything else is an opaque `500`, with details included only in debug mode.
- Exceptions thrown by this package (invalid parameters, deserialization conflicts, …) are `JsonApiException` instances carrying ready-made error objects. You can throw your own, too.

## Content negotiation

The `jsonApi` middleware implements the spec's media type rules:

- A JSON:API `Content-Type` carrying media type parameters gets a `415`, and an `Accept` header whose JSON:API offers are all parameterized gets a `406`.
- `profile` parameters always pass, since the spec lets servers ignore unrecognized profiles.
- `ext` parameters are honored as the contract they are: an extension this package doesn't support is rejected with `415`/`406` rather than silently processed as a plain document. No extensions are supported yet. Atomic Operations will be the first.

All responses are served as `application/vnd.api+json`.

## Strict query parameters

One more strict-input rule lives in the query-string parser. The spec reserves simple lowercase parameter names for itself, which makes an unrecognized all-lowercase parameter (`?foo=bar`) a `400`. Application-specific parameters must contain a non-lowercase character (`?cacheBust=1`, `?api_key=…`) and are ignored by the package.

---

Next: [Reference](./reference.md)
