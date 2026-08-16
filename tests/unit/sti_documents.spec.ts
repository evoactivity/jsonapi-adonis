/**
 * Documents carry concrete types for STI rows (issue #9). Loaded rows
 * resolve through resolveResource wherever they appear, as primary data,
 * in linkage, and in included. An unloaded belongsTo targeting an STI
 * base emits no data member at all, because a bare foreign key cannot
 * name a concrete type; guessing produced a second identity for the same
 * row and a full-linkage violation.
 */
import { test } from '@japa/runner'
import { DocumentBuilder } from '../../src/document_builder.ts'
import { JsonApiRegistry } from '../../src/registry.ts'
import { JsonApiResource } from '../../src/resource.ts'
import { LinkBuilder } from '../../src/links.ts'
import { parseQueryParams } from '../../src/params.ts'
import { Fan, SportsTeam, Stadium, make } from '../fixtures/models.ts'
import { stiRegistry as registry } from '../fixtures/sti_resources.ts'
import { stubRouter } from '../fixtures/stub_router.ts'

function build(input: any, qs: Record<string, unknown> = {}, reg = registry()) {
  return new DocumentBuilder(reg, parseQueryParams(qs), new LinkBuilder(false)).build(input)
}

test.group('STI documents: primary data', () => {
  test('a base-hydrated row serializes under its concrete type', ({ assert }) => {
    const doc = build(make(SportsTeam, { name: 'Arsenal', sport: 'football' }))
    assert.equal((doc.data as any).type, 'football-teams')
  })

  test('a mixed collection carries one concrete type per row', ({ assert }) => {
    const doc = build([
      make(SportsTeam, { name: 'Arsenal', sport: 'football' }),
      make(SportsTeam, { name: 'Saracens', sport: 'rugby' }),
    ])
    assert.deepEqual(
      (doc.data as any[]).map((resource) => resource.type),
      ['football-teams', 'rugby-teams']
    )
  })

  test('sparse fieldsets key on the concrete type', ({ assert }) => {
    const doc = build(make(SportsTeam, { name: 'Arsenal', sport: 'football' }), {
      fields: { 'football-teams': 'name' },
    })
    assert.deepEqual(Object.keys((doc.data as any).attributes), ['name'])
  })

  test('the abstract type is inert as a fieldset key', ({ assert }) => {
    const doc = build(make(SportsTeam, { name: 'Arsenal', sport: 'football' }), {
      fields: { 'sports-teams': 'name' },
    })
    // the row is football-teams, so a sports-teams fieldset matches nothing
    // and no filtering happens
    assert.includeMembers(Object.keys((doc.data as any).attributes), ['name', 'sport'])
  })
})

test.group('STI documents: linkage and included', () => {
  test('to-many linkage carries the concrete type per row', ({ assert }) => {
    const fan = make(Fan, { name: 'Liam' })
    fan.$setRelated('favourites', [
      make(SportsTeam, { name: 'Arsenal', sport: 'football' }),
      make(SportsTeam, { name: 'Saracens', sport: 'rugby' }),
    ])

    const doc = build(fan)
    const linkage = (doc.data as any).relationships.favourites.data
    assert.deepEqual(
      linkage.map((identifier: any) => identifier.type),
      ['football-teams', 'rugby-teams']
    )
  })

  test('included resources carry concrete types and dedupe under them', ({ assert }) => {
    const fan = make(Fan, { name: 'Liam' })
    const team = make(SportsTeam, { name: 'Arsenal', sport: 'football' })
    fan.$setRelated('favourites', [team])

    const doc = build(fan, { include: 'favourites' })
    const included = doc.included as any[]
    assert.equal(included.length, 1)
    assert.equal(included[0].type, 'football-teams')
    assert.equal(included[0].attributes.name, 'Arsenal')
  })

  test('a loaded belongsTo to the base gives concrete linkage', ({ assert }) => {
    const stadium = make(Stadium, { name: 'Emirates', teamId: 5 })
    stadium.$setRelated('team', make(SportsTeam, { id: 5, name: 'Arsenal', sport: 'rugby' }))

    const doc = build(stadium)
    assert.deepEqual((doc.data as any).relationships.team.data, { type: 'rugby-teams', id: '5' })
  })
})

test.group('STI documents: unloaded belongsTo to the base', () => {
  test('emits no data member, because the concrete type is unknowable', ({ assert }) => {
    const stadium = make(Stadium, { name: 'Emirates', teamId: 5 })

    const doc = build(stadium)
    // With links disabled the member has nothing left and is omitted
    // entirely; either way, no base-typed data escapes.
    assert.isUndefined((doc.data as any).relationships?.team?.data)
  })

  test('a relationship self link survives without the data member', ({ assert }) => {
    const stadium = make(Stadium, { name: 'Emirates', teamId: 5 })
    const links = new LinkBuilder(true, stubRouter(), 'api.stadiums.show')

    const doc = new DocumentBuilder(registry(), parseQueryParams({}), links).build(stadium)
    const team = (doc.data as any).relationships.team
    assert.notProperty(team, 'data')
    assert.isDefined(team.links)
  })

  test('an unloaded belongsTo to a non-STI target keeps FK-derived linkage', ({ assert }) => {
    class PlainStadium extends Stadium {}
    // Stadium.team targets SportsTeam; registering it WITHOUT subtypes
    // makes it a normal model, so the FK fallback must behave exactly as
    // today.
    class PlainTeamResource extends JsonApiResource<SportsTeam> {
      static type = 'sports-teams'
      static model = () => SportsTeam
    }
    const reg = new JsonApiRegistry().register([PlainTeamResource])
    const stadium = make(PlainStadium, { name: 'Emirates', teamId: 5 })

    const doc = build(stadium, {}, reg)
    assert.deepEqual((doc.data as any).relationships.team.data, {
      type: 'sports-teams',
      id: '5',
    })
  })

  test('a loaded-but-null belongsTo still says data null', ({ assert }) => {
    const stadium = make(Stadium, { name: 'Orphan Park', teamId: null })
    stadium.$setRelated('team', null)

    const doc = build(stadium)
    assert.isNull((doc.data as any).relationships.team.data)
  })
})
