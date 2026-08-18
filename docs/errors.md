# Errors and content negotiation

## The error document

An error response has no `data`. It carries an `errors` array, one object per problem, served as `application/vnd.api+json` like every other response. This is a real validation failure on `POST /api/v1/articles`:

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

An error object can carry these members:

| Member             | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `status`           | The HTTP status, as a string. One document can mix statuses         |
| `code`             | An application-specific code, here the failing Vine rule            |
| `title`            | A short, general description of the problem                         |
| `detail`           | A human-readable explanation of this occurrence                     |
| `source.pointer`   | A JSON Pointer into the request document at fault                   |
| `source.parameter` | The query parameter at fault, for a bad `?include=` or `?filter[]=` |
| `source.header`    | The header at fault, for a content negotiation failure              |
| `meta`             | Anything else you attach                                            |

`source` tells the client where the problem is. A body problem points at a pointer. A query problem points at the parameter. A bad `?include=nonsense` returns `source: { parameter: "include" }` and a `400`.

## One function maps every error

`toErrorDocument(error, debug)` is a pure function that turns any thrown value into `{ status, body }`. It has four branches:

- A `JsonApiException` already carries its own error objects (an invalid parameter, a deserialization conflict). The package throws these, and you can throw your own.
- A VineJS validation error becomes a `422` with one error object per failed field, each with a `/data/attributes/...` pointer.
- Any other HTTP exception (a `404` from `findOrFail`, an auth failure) maps its status and a matching title.
- Anything else is an opaque `500`. The `detail` is filled only in debug mode, so an internal message never leaks in production.

Because it is pure, the same function serves a job or a test with no HTTP request. See [Building blocks](./low-level.md#error-documents-anywhere).

## Rendering errors in your app

`toErrorDocument` runs from your exception handler through `renderJsonApiError`. Guard it so only JSON:API requests get JSON:API errors:

```ts
// app/exceptions/handler.ts
import { renderJsonApiError } from '@evoactivity/jsonapi-adonis'

async handle(error: unknown, ctx: HttpContext) {
  if (ctx.jsonApi.handlesErrors()) {
    return renderJsonApiError(error, ctx, this.debug)
  }
  return super.handle(error, ctx)
}
```

`handlesErrors()` returns true when either condition holds: the matched route was registered by `router.jsonApiResource()`, or the client named the JSON:API media type in its `Accept` or `Content-Type` header. To decide another way, for example every URL under a prefix including unmatched 404s, set a predicate in the config:

```ts
export default defineConfig({
  errorDetection: (ctx) => ctx.request.url().startsWith('/api/'),
})
```

## Content negotiation

The `jsonApi` named middleware runs the spec's media type rules. Apply it to your resource route group.

- A request `Content-Type` of the JSON:API media type, with any media type parameter other than `profile` or a supported `ext`, is a `415`.
- An `Accept` header that names the JSON:API media type, where no listed instance of it is acceptable, is a `406`.
- A `profile` parameter always passes, because the spec lets a server ignore a profile it does not know.
- An `ext` parameter is a contract. An extension the package does not support is a `415` or `406`, not a document processed as if the extension were absent. No extensions are supported yet. Atomic Operations will be the first.

Every response is served as `application/vnd.api+json`.

## Strict query parameters

The spec reserves simple lowercase parameter names for itself. So an unrecognized all-lowercase parameter (`?foo=bar`) is a `400`. Your own parameters must contain a non-lowercase character (`?cacheBust=1`, `?api_key=…`), and the package ignores them.

---

Next: [Building blocks](./low-level.md) · [Reference](./reference.md)
