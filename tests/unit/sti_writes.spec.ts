/**
 * Write paths accept the STI family (issue #9). A relation targeting a
 * base resource that declares subtypes accepts any member type in the
 * family, and rejects types outside it — including the base's own
 * abstract type, which never belongs in a payload. Rejections happen
 * before any database access, so they are unit-testable; the accept-and-
 * attach paths are covered functionally in the example app.
 */
import { test } from '@japa/runner'
import { JsonApiRegistry } from '../../src/registry.ts'
import { JsonApiResource } from '../../src/resource.ts'
import { JsonApiException } from '../../src/errors.ts'
import { deserializeResourceDocument } from '../../src/deserializer.ts'
import { updateRelationship } from '../../src/relationships.ts'
import { Fan, FootballTeam, RugbyTeam, SportsTeam, Stadium, make } from '../fixtures/models.ts'

class FootballTeamResource extends JsonApiResource<FootballTeam> {
  static type = 'football-teams'
  static model = () => FootballTeam
}

class RugbyTeamResource extends JsonApiResource<RugbyTeam> {
  static type = 'rugby-teams'
  static model = () => RugbyTeam
}

class SportsTeamResource extends JsonApiResource<SportsTeam> {
  static model = () => SportsTeam
  static subtypes = () => [FootballTeamResource, RugbyTeamResource]
  static resolveResource(row: SportsTeam) {
    return { football: FootballTeamResource, rugby: RugbyTeamResource }[row.sport]
  }
}

function registry() {
  return new JsonApiRegistry().register([
    SportsTeamResource,
    FootballTeamResource,
    RugbyTeamResource,
  ])
}

async function rejection(fn: () => Promise<unknown>): Promise<JsonApiException> {
  try {
    await fn()
  } catch (error) {
    return error as JsonApiException
  }
  throw new Error('expected the call to reject, it resolved')
}

test.group('STI writes: resource body (deserializer)', () => {
  test('a belongsTo to the base accepts any family member type', ({ assert }) => {
    for (const type of ['football-teams', 'rugby-teams']) {
      const result = deserializeResourceDocument(Stadium, registry(), {
        data: {
          type: 'stadiums',
          attributes: { name: 'Emirates' },
          relationships: { team: { data: { type, id: '5' } } },
        },
      })
      assert.equal(result.attributes.teamId, '5')
    }
  })

  test('a type outside the family is a 409 naming every acceptable type', ({ assert }) => {
    const error = assert.throws(
      () =>
        deserializeResourceDocument(Stadium, registry(), {
          data: {
            type: 'stadiums',
            relationships: { team: { data: { type: 'trains', id: '5' } } },
          },
        }),
      JsonApiException
    ) as unknown as JsonApiException

    assert.equal(error.status, 409)
    assert.match(error.errors[0].detail!, /football-teams/)
    assert.match(error.errors[0].detail!, /rugby-teams/)
  })

  test('the abstract base type is rejected too', ({ assert }) => {
    const error = assert.throws(
      () =>
        deserializeResourceDocument(Stadium, registry(), {
          data: {
            type: 'stadiums',
            relationships: { team: { data: { type: 'sports-teams', id: '5' } } },
          },
        }),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 409)
  })

  test('a to-many to the base accepts mixed family types in one payload', ({ assert }) => {
    const result = deserializeResourceDocument(Fan, registry(), {
      data: {
        type: 'fans',
        attributes: { name: 'Liam' },
        relationships: {
          favourites: {
            data: [
              { type: 'football-teams', id: '1' },
              { type: 'rugby-teams', id: '2' },
            ],
          },
        },
      },
    })
    assert.deepEqual(result.toMany.favourites, ['1', '2'])
  })

  test('a relation to a non-STI target still holds its single type', ({ assert }) => {
    class PlainTeamResource extends JsonApiResource<SportsTeam> {
      static type = 'sports-teams'
      static model = () => SportsTeam
    }
    const reg = new JsonApiRegistry().register([PlainTeamResource])

    const error = assert.throws(
      () =>
        deserializeResourceDocument(Stadium, reg, {
          data: {
            type: 'stadiums',
            relationships: { team: { data: { type: 'football-teams', id: '5' } } },
          },
        }),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 409)
  })
})

test.group('STI writes: relationship endpoints (parse stage)', () => {
  test('a to-one write with a type outside the family is a 409', async ({ assert }) => {
    const stadium = make(Stadium, { name: 'Emirates', teamId: 7 })

    const error = await rejection(() =>
      updateRelationship(
        stadium,
        'team',
        registry(),
        { data: { type: 'trains', id: '1' } },
        'replace'
      )
    )
    assert.equal(error.status, 409)
    assert.match(error.errors[0].detail!, /football-teams/)
  })

  test('a to-many write with a type outside the family is a 409', async ({ assert }) => {
    const fan = make(Fan, { name: 'Liam' })

    const error = await rejection(() =>
      updateRelationship(
        fan,
        'favourites',
        registry(),
        { data: [{ type: 'trains', id: '1' }] },
        'add'
      )
    )
    assert.equal(error.status, 409)
    assert.match(error.errors[0].detail!, /rugby-teams/)
  })

  test('the abstract base type is rejected at the endpoint too', async ({ assert }) => {
    const fan = make(Fan, { name: 'Liam' })

    const error = await rejection(() =>
      updateRelationship(
        fan,
        'favourites',
        registry(),
        { data: [{ type: 'sports-teams', id: '1' }] },
        'add'
      )
    )
    assert.equal(error.status, 409)
  })
})
