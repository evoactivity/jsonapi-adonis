/**
 * The registry's per-row resolution seam for single-table inheritance
 * (issue #9). A base resource declares resolveResource(row) and the
 * registry resolves rows through it, so a SportsTeam row whose
 * discriminator says football serializes as football-teams, not
 * sports-teams.
 */
import { test } from '@japa/runner'
import { JsonApiRegistry } from '../../src/registry.ts'
import { JsonApiResource } from '../../src/resource.ts'
import { FootballTeam, RugbyTeam, SportsTeam, make } from '../fixtures/models.ts'
import {
  FootballTeamResource,
  RugbyTeamResource,
  SportsTeamResource,
  stiRegistry as registry,
} from '../fixtures/sti_resources.ts'

test.group('registry: resolveResource', () => {
  test('a base-hydrated row resolves to its concrete resource', ({ assert }) => {
    const row = make(SportsTeam, { name: 'Arsenal', sport: 'football' })
    assert.strictEqual(registry().resourceForRow(row), FootballTeamResource)
  })

  test('the discriminator decides, not the constructor', ({ assert }) => {
    const football = make(SportsTeam, { name: 'Arsenal', sport: 'football' })
    const rugby = make(SportsTeam, { name: 'Saracens', sport: 'rugby' })
    const reg = registry()
    assert.strictEqual(reg.resourceForRow(football), FootballTeamResource)
    assert.strictEqual(reg.resourceForRow(rugby), RugbyTeamResource)
  })

  test('typeForRow gives the concrete type for a base-hydrated row', ({ assert }) => {
    const reg = registry()
    assert.equal(reg.typeForRow(make(SportsTeam, { sport: 'football' })), 'football-teams')
    assert.equal(reg.typeForRow(make(SportsTeam, { sport: 'rugby' })), 'rugby-teams')
  })

  test('an unrecognised discriminator falls back to the base resource', ({ assert }) => {
    const row = make(SportsTeam, { name: 'Mystery XI', sport: 'handball' })
    const reg = registry()
    assert.strictEqual(reg.resourceForRow(row), SportsTeamResource)
    assert.equal(reg.typeForRow(row), 'sports-teams')
  })

  test('models without resolveResource behave exactly as before', ({ assert }) => {
    class PlainResource extends JsonApiResource<FootballTeam> {
      static type = 'plain-teams'
      static model = () => FootballTeam
    }
    const reg = new JsonApiRegistry().register([PlainResource])
    const row = make(FootballTeam, { name: 'Arsenal', sport: 'football' })
    assert.strictEqual(reg.resourceForRow(row), PlainResource)
    assert.equal(reg.typeForRow(row), 'plain-teams')
  })

  test('typeForRow equals typeFor for unregistered models', ({ assert }) => {
    const reg = new JsonApiRegistry()
    const row = make(FootballTeam, { name: 'Arsenal', sport: 'football' })
    assert.equal(reg.typeForRow(row), reg.typeFor(FootballTeam))
  })

  test('a hook returning its own class does not loop', ({ assert }) => {
    class SelfResource extends JsonApiResource<SportsTeam> {
      static type = 'selfies'
      static model = () => SportsTeam
      static resolveResource(_row: SportsTeam) {
        return SelfResource
      }
    }
    const reg = new JsonApiRegistry().register([SelfResource])
    const row = make(SportsTeam, { sport: 'football' })
    assert.strictEqual(reg.resourceForRow(row), SelfResource)
    assert.equal(reg.typeForRow(row), 'selfies')
  })

  test('a chain of hooks resolves through every link', ({ assert }) => {
    class FinalResource extends JsonApiResource<SportsTeam> {
      static type = 'finals'
      static model = () => SportsTeam
    }
    class MiddleResource extends JsonApiResource<SportsTeam> {
      static model = () => SportsTeam
      static resolveResource(_row: SportsTeam) {
        return FinalResource
      }
    }
    class EntryResource extends JsonApiResource<SportsTeam> {
      static model = () => SportsTeam
      static resolveResource(_row: SportsTeam) {
        return MiddleResource
      }
    }
    const reg = new JsonApiRegistry().register([EntryResource])
    const row = make(SportsTeam, { sport: 'football' })
    assert.strictEqual(reg.resourceForRow(row), FinalResource)
    assert.equal(reg.typeForRow(row), 'finals')
  })

  test('a cycle between two hooks stops instead of looping', ({ assert }) => {
    class AResource extends JsonApiResource<SportsTeam> {
      static type = 'a-things'
      static model = () => SportsTeam
      static resolveResource(_row: SportsTeam): typeof JsonApiResource<SportsTeam> {
        return BResource
      }
    }
    class BResource extends JsonApiResource<SportsTeam> {
      static type = 'b-things'
      static model = () => SportsTeam
      static resolveResource(_row: SportsTeam) {
        return AResource
      }
    }
    const reg = new JsonApiRegistry().register([AResource])
    const row = make(SportsTeam, { sport: 'football' })
    // resolution must terminate; landing on either class is acceptable
    const resolved = reg.resourceForRow(row)
    assert.include([AResource, BResource], resolved)
  })
})

test.group('registry: subtypes register with their base', () => {
  test('registering the base registers every declared subtype', ({ assert }) => {
    const reg = new JsonApiRegistry().register([SportsTeamResource])

    assert.equal(reg.typeFor(FootballTeam), 'football-teams')
    assert.equal(reg.typeFor(RugbyTeam), 'rugby-teams')
    assert.strictEqual(reg.resourceFor(FootballTeam), FootballTeamResource)
  })

  test('an explicitly registered subtype is not overwritten', ({ assert }) => {
    class CustomFootballResource extends JsonApiResource<FootballTeam> {
      static type = 'custom-football-teams'
      static model = () => FootballTeam
    }
    const reg = new JsonApiRegistry().register([CustomFootballResource, SportsTeamResource])

    assert.strictEqual(reg.resourceFor(FootballTeam), CustomFootballResource)
  })
})

test.group('registry: typeName as the single home for type derivation', () => {
  test('a resource overriding typeName controls its type everywhere', ({ assert }) => {
    class VersionedTeamResource extends JsonApiResource<FootballTeam> {
      static model = () => FootballTeam
      static typeName() {
        return 'v2-football-teams'
      }
    }
    class RoutingResource extends JsonApiResource<SportsTeam> {
      static model = () => SportsTeam
      static resolveResource(_row: SportsTeam) {
        return VersionedTeamResource
      }
    }
    const reg = new JsonApiRegistry().register([RoutingResource, VersionedTeamResource])

    assert.equal(reg.typeForRow(make(SportsTeam, { sport: 'football' })), 'v2-football-teams')
    assert.equal(reg.typeFor(FootballTeam), 'v2-football-teams')
  })

  test('the default typeName is the static type, then the kebab-cased table', ({ assert }) => {
    class NamedResource extends JsonApiResource<SportsTeam> {
      static type = 'named-things'
      static model = () => SportsTeam
    }
    class UnnamedResource extends JsonApiResource<SportsTeam> {
      static model = () => SportsTeam
    }
    assert.equal(NamedResource.typeName(), 'named-things')
    assert.equal(UnnamedResource.typeName(), 'sports-teams')
  })
})

test.group('registry: families discovered at runtime', () => {
  /**
   * A family whose discriminator values are user data, so the concrete
   * resources are built on demand. One class per value, memoized: the
   * registry caches types per class object, and the resolution walk ends
   * on a repeated class, so identity matters.
   */
  function dynamicFamily() {
    const cache = new Map<string, typeof JsonApiResource<SportsTeam>>()

    class TeamResource extends JsonApiResource<SportsTeam> {
      static model = () => SportsTeam
      static subtypes = () => [...cache.values()]
      static resolveResource(row: SportsTeam) {
        let resource = cache.get(row.sport)
        if (!resource) {
          resource = class extends TeamResource {
            static type = `${row.sport}-teams`
          }
          cache.set(row.sport, resource)
        }
        return resource
      }
    }
    return { TeamResource, cache }
  }

  test('rows resolve to memoized runtime-built resources', ({ assert }) => {
    const { TeamResource } = dynamicFamily()
    const reg = new JsonApiRegistry().register([TeamResource])

    assert.equal(reg.typeForRow(make(SportsTeam, { sport: 'quidditch' })), 'quidditch-teams')
    assert.equal(reg.typeForRow(make(SportsTeam, { sport: 'chess' })), 'chess-teams')
    // the same value resolves to the same class, not a fresh one
    assert.strictEqual(
      reg.resourceForRow(make(SportsTeam, { sport: 'quidditch' })),
      reg.resourceForRow(make(SportsTeam, { sport: 'quidditch' }))
    )
  })

  test('a kind discovered after boot is accepted on writes', ({ assert }) => {
    const { TeamResource } = dynamicFamily()
    const reg = new JsonApiRegistry().register([TeamResource])

    // boot time: no kinds exist yet, so no types are accepted
    assert.deepEqual(reg.acceptedTypesFor(SportsTeam), [])

    // a row with a new kind arrives and resolves
    reg.typeForRow(make(SportsTeam, { sport: 'quidditch' }))

    // subtypes() is consulted per write, so the family grew
    assert.deepEqual(reg.acceptedTypesFor(SportsTeam), ['quidditch-teams'])
  })

  test('a runtime-built resource serializes through the inherited chain safely', ({ assert }) => {
    // the dynamic class inherits resolveResource from its base; resolving
    // again returns the same memoized class, which ends the walk
    const { TeamResource } = dynamicFamily()
    const reg = new JsonApiRegistry().register([TeamResource])
    const row = make(SportsTeam, { sport: 'quidditch' })

    const resolved = reg.resourceForRow(row)
    assert.equal(reg.typeForRow(row), 'quidditch-teams')
    assert.strictEqual(reg.resourceForRow(row), resolved)
  })
})
